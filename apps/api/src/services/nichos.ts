import { Platform } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { sleep } from '../lib/http.js';
import { connectors } from '../connectors/index.js';
import type { NormalizedProduct } from '../connectors/types.js';
import { agruparSimilares, normalizar } from './similaridade.js';

/**
 * Busca por nicho: varre todas as categorias do recorte e aplica os filtros.
 *
 * Por que existe: categoria sozinha nao entrega nicho. Medido na Shopee, a
 * prateleira "Fones" e 99% TWS generico e so 2 em 50 dos mais vendidos sao
 * headset gamer; "Microfones" e lapela; "Moveis" esconde a cadeira gamer no
 * meio de mesa de cabeceira. O recorte util e conjunto de categorias + o que
 * aceitar dentro de cada uma.
 */

export { normalizar };

export interface NichoParaBusca {
  platform: Platform;
  name: string;
  minSales: number;
  excludeTerms: string[];
  entries: { categoryId: number; requireTerms: string[] }[];
}

export interface AchadoDoNicho {
  produto: NormalizedProduct;
  categoryId: number;
}

export interface BuscaNichoSummary {
  bruto: number;
  aceitos: number;
  /** Anuncios repetidos do mesmo produto que foram colapsados. */
  repetidos: number;
  porCategoria: { categoryId: number; bruto: number; aceitos: number; erro?: string }[];
}

/**
 * Decide se o produto entra. A ordem importa para o custo e para o log:
 * vendas primeiro (o corte que mais elimina), depois exclusao, depois exigencia.
 */
export function passaNoFiltro(
  produto: NormalizedProduct,
  nicho: Pick<NichoParaBusca, 'minSales' | 'excludeTerms'>,
  requireTerms: string[],
): boolean {
  if (nicho.minSales > 0 && (produto.soldCount ?? 0) < nicho.minSales) return false;

  const titulo = normalizar(produto.title);
  if (nicho.excludeTerms.some((t) => t.trim() && titulo.includes(normalizar(t)))) return false;

  // Lista vazia = categoria pura, entra inteira (Consoles, Teclados e mouses).
  const exigidos = requireTerms.filter((t) => t.trim());
  if (exigidos.length && !exigidos.some((t) => titulo.includes(normalizar(t)))) return false;

  return true;
}

/**
 * `porCategoria` e o teto de itens puxados de cada prateleira. Categoria pura
 * devolve quase tudo; categoria mista devolve pouco, e e por isso que o teto
 * vale por categoria e nao no total -- senao a primeira prateleira comeria a cota.
 */
export async function buscarPorNicho(
  nicho: NichoParaBusca,
  opcoes: {
    porCategoria?: number;
    maxPrice?: number;
    limiarDedup?: number;
    minCommissionPct?: number;
    keySeller?: boolean;
  } = {},
): Promise<{ achados: AchadoDoNicho[]; resumo: BuscaNichoSummary }> {
  const connector = connectors[nicho.platform];
  const porCategoria = opcoes.porCategoria ?? 50;
  const limiarDedup = opcoes.limiarDedup;

  const achados: AchadoDoNicho[] = [];
  const resumo: BuscaNichoSummary = { bruto: 0, aceitos: 0, repetidos: 0, porCategoria: [] };
  const jaVisto = new Set<string>();

  for (const entry of nicho.entries) {
    try {
      const produtos = await connector.search({
        categoryId: entry.categoryId,
        maxPrice: opcoes.maxPrice,
        minCommissionPct: opcoes.minCommissionPct,
        keySeller: opcoes.keySeller,
        sort: 'vendas',
        limit: porCategoria,
      });
      resumo.bruto += produtos.length;

      let aceitos = 0;
      for (const produto of produtos) {
        if (jaVisto.has(produto.externalId)) continue;
        if (!passaNoFiltro(produto, nicho, entry.requireTerms)) continue;
        jaVisto.add(produto.externalId);
        achados.push({ produto, categoryId: entry.categoryId });
        aceitos++;
      }
      resumo.aceitos += aceitos;
      resumo.porCategoria.push({ categoryId: entry.categoryId, bruto: produtos.length, aceitos });

      await sleep(600); // respeita o rate limit da loja
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err);
      logger.warn({ nicho: nicho.name, categoryId: entry.categoryId, erro }, 'categoria do nicho falhou');
      resumo.porCategoria.push({ categoryId: entry.categoryId, bruto: 0, aceitos: 0, erro });
    }
  }

  // Colapsa anuncios do mesmo produto, ficando com o mais barato. Roda depois
  // de juntar todas as categorias porque o mesmo item aparece em mais de uma.
  const grupos = agruparSimilares(
    achados.map((a) => ({ ...a, title: a.produto.title, price: a.produto.price })),
    limiarDedup,
  );
  resumo.repetidos = achados.length - grupos.length;
  const unicos: AchadoDoNicho[] = grupos.map((g) => ({
    produto: g.escolhido.produto,
    categoryId: g.escolhido.categoryId,
  }));

  // Mais vendidos primeiro: e o criterio que o nicho existe para servir.
  unicos.sort((a, b) => (b.produto.soldCount ?? 0) - (a.produto.soldCount ?? 0));
  return { achados: unicos, resumo };
}

/** Carrega o nicho do banco no formato que `buscarPorNicho` espera. */
export async function carregarNicho(id: string): Promise<NichoParaBusca | null> {
  const nicho = await prisma.niche.findUnique({ where: { id }, include: { entries: true } });
  if (!nicho) return null;
  return {
    platform: nicho.platform,
    name: nicho.name,
    minSales: nicho.minSales,
    excludeTerms: nicho.excludeTerms,
    entries: nicho.entries.map((e) => ({ categoryId: e.categoryId, requireTerms: e.requireTerms })),
  };
}
