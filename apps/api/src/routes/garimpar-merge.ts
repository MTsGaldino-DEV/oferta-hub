import type { NormalizedProduct, SearchSort } from '../connectors/types.js';

/** Desconto anunciado, usado so pra ordenar. */
function descontoPct(p: NormalizedProduct): number {
  if (!p.listPrice || !p.price || p.listPrice <= p.price) return 0;
  return ((p.listPrice - p.price) / p.listPrice) * 100;
}

/**
 * Cada `sort` vira uma nota: maior nota primeiro. Preco e o unico invertido,
 * porque "menor preco" quer o menor no topo.
 */
const NOTA: Record<SearchSort, (p: NormalizedProduct) => number> = {
  vendas: (p) => p.soldCount ?? 0,
  comissao: (p) => p.sellerCommissionPct ?? p.commissionPct ?? 0,
  desconto: descontoPct,
  'menor-preco': (p) => -(p.price ?? Number.MAX_SAFE_INTEGER),
  // A Shopee ja devolve cada lista na ordem de relevancia dela, e nao ha nota
  // comparavel entre categorias diferentes -- entao mantem a ordem de chegada.
  relevancia: () => 0,
};

/**
 * Junta o resultado de varias categorias numa lista so.
 *
 * O dedupe importa porque a Shopee cobra uma query por categoria e a mesma
 * oferta costuma aparecer em mais de uma. O corte vem depois da ordenacao: com
 * N categorias chegam ate N x limit itens, e cortar antes devolveria os piores
 * de cada lista em vez dos melhores do conjunto.
 */
export function mesclar(
  listas: NormalizedProduct[][],
  sort: SearchSort,
  limit: number,
): NormalizedProduct[] {
  const vistos = new Set<string>();
  const juntos: NormalizedProduct[] = [];

  for (const lista of listas) {
    for (const p of lista) {
      if (vistos.has(p.externalId)) continue;
      vistos.add(p.externalId);
      juntos.push(p);
    }
  }

  const nota = NOTA[sort];
  // Ordenacao estavel (padrao no V8), entao com nota igual a ordem de chegada
  // sobrevive -- e o que faz `relevancia` preservar a ordem da Shopee.
  juntos.sort((a, b) => nota(b) - nota(a));

  return juntos.slice(0, limit);
}
