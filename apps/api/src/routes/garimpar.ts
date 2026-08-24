import { Platform } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { connectors } from '../connectors/index.js';
import type { NormalizedProduct } from '../connectors/types.js';
import { mesclar } from './garimpar-merge.js';

/**
 * `categoryIds` chega repetido na query string (`?categoryIds=1&categoryIds=2`).
 * Com um valor so o Fastify entrega string, com varios entrega array -- por
 * isso o preprocess normaliza para lista antes de validar.
 */
const listaDeIds = z.preprocess(
  (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]),
  z.array(z.coerce.number().int().positive()).max(10),
);

const query = z
  .object({
    keyword: z.string().trim().min(2, 'Digite pelo menos 2 caracteres.').optional(),
    categoryIds: listaDeIds,
    sort: z.enum(['relevancia', 'vendas', 'comissao', 'menor-preco', 'desconto']).default('vendas'),
    minCommissionPct: z.coerce
      .number()
      .min(0, 'A comissão mínima não pode ser negativa.')
      .max(100, 'A comissão mínima não pode passar de 100%.')
      .optional(),
    maxPrice: z.coerce.number().positive('O preço deve ser maior que zero.').optional(),
    // Nao usar z.coerce.boolean aqui: ele transforma a string "false" em true,
    // porque toda string nao vazia e truthy. So a string "true" liga o filtro.
    keySeller: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    page: z.coerce.number().int().min(1, 'A página começa em 1.').default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'Peça pelo menos 1 resultado.')
      .max(60, 'O limite é de 60 resultados por página.')
      .default(40),
  })
  .refine((q) => q.keyword || q.categoryIds.length > 0, {
    message: 'Escolha uma categoria ou digite uma palavra-chave.',
  });

function serialize(p: NormalizedProduct) {
  return {
    externalId: p.externalId,
    platform: p.platform,
    title: p.title,
    imageUrl: p.imageUrl ?? null,
    price: p.price ?? null,
    listPrice: p.listPrice ?? null,
    commissionPct: p.commissionPct ?? null,
    sellerCommissionPct: p.sellerCommissionPct ?? null,
    commissionBrl: p.commissionBrl ?? null,
    soldCount: p.soldCount ?? null,
    rating: p.rating ?? null,
    shopName: p.shopName ?? null,
  };
}

export async function garimparRoutes(app: FastifyInstance) {
  /**
   * Busca ao vivo na Shopee. Aceita palavra-chave, varias categorias, ou os
   * dois. A Shopee so aceita uma categoria por query, entao N categorias viram
   * N buscas em paralelo, mescladas depois.
   */
  app.get('/api/garimpar/produtos', async (req, reply) => {
    const q = query.parse(req.query);
    const shopee = connectors[Platform.SHOPEE];
    const buscar =
      shopee.searchPage ??
      (async (p) => {
        const produtos = await shopee.search(p);
        return { produtos, hasNextPage: false, antesDoFiltro: produtos.length };
      });

    const base = {
      keyword: q.keyword,
      sort: q.sort,
      minCommissionPct: q.minCommissionPct,
      maxPrice: q.maxPrice,
      keySeller: q.keySeller,
      page: q.page,
      limit: q.limit,
    };

    // Sem categoria e uma busca so, por palavra-chave.
    const alvos: (number | null)[] = q.categoryIds.length > 0 ? q.categoryIds : [null];

    const respostas = await Promise.allSettled(
      alvos.map((categoryId) => buscar({ ...base, categoryId: categoryId ?? undefined })),
    );

    const listas: NormalizedProduct[][] = [];
    const falhas: { categoryId: number | null; motivo: string }[] = [];
    let bruto = 0;
    let antesDoFiltro = 0;
    let hasNextPage = false;

    respostas.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        listas.push(r.value.produtos);
        bruto += r.value.produtos.length;
        antesDoFiltro += r.value.antesDoFiltro;
        // Com varias categorias, basta uma ter mais pagina pra valer avancar.
        hasNextPage = hasNextPage || r.value.hasNextPage;
      } else {
        falhas.push({
          categoryId: alvos[i],
          motivo: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });

    // Todas falharam: devolve o erro da loja em vez de "nada encontrado", que
    // mandaria o usuario procurar problema no filtro.
    if (listas.length === 0) {
      return reply.code(400).send({ error: falhas[0]?.motivo ?? 'A busca falhou.' });
    }

    const cats =
      q.categoryIds.length > 0
        ? await prisma.category.findMany({
            where: { platform: Platform.SHOPEE, externalId: { in: q.categoryIds } },
            select: { externalId: true, nameBr: true },
          })
        : [];

    return {
      ok: true,
      categorias: q.categoryIds.map((id) => ({
        id,
        nome: cats.find((c) => c.externalId === id)?.nameBr ?? `Categoria ${id}`,
      })),
      bruto,
      // Distinto de bruto: antesDoFiltro conta antes do corte de preco/comissao
      // do conector, bruto conta depois dele e antes so do dedupe/merge.
      antesDoFiltro,
      produtos: mesclar(listas, q.sort, q.limit).map(serialize),
      pageInfo: { page: q.page, hasNextPage },
      falhas,
    };
  });
}
