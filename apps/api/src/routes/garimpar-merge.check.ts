/**
 * Self-check do merge de varias categorias. Roda sem rede e sem banco:
 *   npx tsx apps/api/src/routes/garimpar-merge.check.ts
 *
 * O que precisa valer: duplicado sai (a mesma oferta aparece em duas
 * categorias e a Shopee cobra uma query por categoria), a ordem final respeita
 * o sort pedido, e o corte em `limit` acontece DEPOIS de ordenar -- cortar
 * antes devolveria os piores itens de cada lista.
 */
import assert from 'node:assert/strict';
import { Platform } from '@prisma/client';
import { mesclar } from './garimpar-merge.js';
import type { NormalizedProduct } from '../connectors/types.js';

const p = (
  externalId: string,
  extra: Partial<NormalizedProduct> = {},
): NormalizedProduct => ({
  platform: Platform.SHOPEE,
  externalId,
  title: externalId,
  canonicalUrl: `https://x/${externalId}`,
  available: true,
  ...extra,
});

// Duplicado entre listas sai, e a primeira ocorrencia e a que fica.
const dedup = mesclar([[p('a'), p('b')], [p('b'), p('c')]], 'vendas', 10);
assert.deepEqual(
  dedup.map((x) => x.externalId).sort(),
  ['a', 'b', 'c'],
  'b aparece nas duas listas e deve sobrar uma vez',
);

// Ordena por vendas, decrescente.
const vendas = mesclar(
  [[p('baixo', { soldCount: 10 }), p('alto', { soldCount: 900 })], [p('meio', { soldCount: 100 })]],
  'vendas',
  10,
);
assert.deepEqual(vendas.map((x) => x.externalId), ['alto', 'meio', 'baixo']);

// Ordena por comissao do vendedor, decrescente.
const comissao = mesclar(
  [[p('x', { sellerCommissionPct: 5 }), p('y', { sellerCommissionPct: 40 })]],
  'comissao',
  10,
);
assert.deepEqual(comissao.map((x) => x.externalId), ['y', 'x']);

// Menor preco, crescente.
const preco = mesclar([[p('caro', { price: 90 }), p('barato', { price: 9 })]], 'menor-preco', 10);
assert.deepEqual(preco.map((x) => x.externalId), ['barato', 'caro']);

// Desconto usa listPrice contra price.
const desc = mesclar(
  [[p('pouco', { price: 90, listPrice: 100 }), p('muito', { price: 10, listPrice: 100 })]],
  'desconto',
  10,
);
assert.deepEqual(desc.map((x) => x.externalId), ['muito', 'pouco']);

// Relevancia nao tem nota comparavel entre categorias -- a ordem de chegada
// tem que sobreviver, mesmo atravessando a fronteira entre duas listas e
// mesmo quando vendas/preco/desconto teriam reordenado pro lado contrario.
const relevancia = mesclar(
  [
    [p('primeiro', { soldCount: 1, price: 100, listPrice: 100 })],
    [p('segundo', { soldCount: 999, price: 1, listPrice: 1000 })],
  ],
  'relevancia',
  10,
);
assert.deepEqual(
  relevancia.map((x) => x.externalId),
  ['primeiro', 'segundo'],
  'relevancia devia manter ordem de chegada, mesmo com segundo vendendo mais, custando menos e com desconto maior',
);

// O corte vem DEPOIS de ordenar: com limit 1 sobra o melhor do conjunto todo,
// nao o primeiro da primeira lista.
const cortado = mesclar(
  [[p('fraco', { soldCount: 1 })], [p('forte', { soldCount: 999 })]],
  'vendas',
  1,
);
assert.deepEqual(cortado.map((x) => x.externalId), ['forte'], 'cortar antes de ordenar perderia o forte');

// Campo ausente nao pode jogar o item pra frente da fila.
const semDado = mesclar([[p('sem'), p('com', { soldCount: 5 })]], 'vendas', 10);
assert.deepEqual(semDado.map((x) => x.externalId), ['com', 'sem']);

// Lista vazia nao explode.
assert.deepEqual(mesclar([], 'vendas', 10), []);
assert.deepEqual(mesclar([[], []], 'vendas', 10), []);

console.log('garimpar-merge.check: ok');
