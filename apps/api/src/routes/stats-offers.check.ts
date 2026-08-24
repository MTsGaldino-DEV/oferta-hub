/**
 * Self-check da ordenacao das ofertas enviadas. Roda sem banco e sem rede:
 *   npx tsx apps/api/src/routes/stats-offers.check.ts
 *
 * O que precisa valer: pendente vem primeiro no modo padrao, cada coluna
 * ordena nos dois sentidos, e linha sem dado nao sobe artificialmente na
 * lista. A regra de "pendente" e por exclusao, entao um status que a Shopee
 * inventar amanha tem que continuar caindo em pendente.
 */
import assert from 'node:assert/strict';
import { ehPendente, ordenar, type LinhaOferta } from './stats-offers.js';

const l = (id: string, extra: Partial<LinhaOferta> = {}): LinhaOferta => ({
  id,
  title: id,
  imageUrl: null,
  platform: 'SHOPEE',
  price: 0,
  discountPct: 0,
  score: 0,
  sentAt: new Date('2026-01-01'),
  clicks: 0,
  orders: 0,
  revenue: 0,
  conversionRate: 0,
  pendente: false,
  ...extra,
});

// "Pendente" e por exclusao, e ignora a caixa: o banco real tem `approved`
// minusculo e `CANCELLED` maiusculo vindos da mesma API.
assert.equal(ehPendente(['approved']), false);
assert.equal(ehPendente(['APPROVED']), false);
assert.equal(ehPendente(['CANCELLED']), false);
assert.equal(ehPendente(['cancelled']), false);
assert.equal(ehPendente(['pending']), true);
assert.equal(ehPendente(['PENDING']), true);
assert.equal(ehPendente(['algo_que_a_shopee_inventou']), true, 'status novo conta como pendente');
assert.equal(ehPendente([]), false, 'sem venda nenhuma nao e comissao pendente');
assert.equal(ehPendente(['approved', 'pending']), true, 'basta uma pendente');

// Padrao: pendente primeiro, e dentro do grupo o mais recente na frente.
const porPadrao = ordenar(
  [
    l('velha-ok', { sentAt: new Date('2026-01-10') }),
    l('nova-pendente', { sentAt: new Date('2026-01-20'), pendente: true }),
    l('velha-pendente', { sentAt: new Date('2026-01-05'), pendente: true }),
  ],
  'pendente',
  'desc',
);
assert.deepEqual(porPadrao.map((x) => x.id), ['nova-pendente', 'velha-pendente', 'velha-ok']);

// Cada coluna ordena nos dois sentidos.
const cliques = [l('a', { clicks: 5 }), l('b', { clicks: 90 }), l('c', { clicks: 40 })];
assert.deepEqual(ordenar(cliques, 'clicks', 'desc').map((x) => x.id), ['b', 'c', 'a']);
assert.deepEqual(ordenar(cliques, 'clicks', 'asc').map((x) => x.id), ['a', 'c', 'b']);

const receita = [l('x', { revenue: 1.5 }), l('y', { revenue: 30 })];
assert.deepEqual(ordenar(receita, 'revenue', 'desc').map((x) => x.id), ['y', 'x']);
assert.deepEqual(ordenar(receita, 'revenue', 'asc').map((x) => x.id), ['x', 'y']);

const datas = [l('antiga', { sentAt: new Date('2026-01-01') }), l('recente', { sentAt: new Date('2026-02-01') })];
assert.deepEqual(ordenar(datas, 'sentAt', 'desc').map((x) => x.id), ['recente', 'antiga']);
assert.deepEqual(ordenar(datas, 'sentAt', 'asc').map((x) => x.id), ['antiga', 'recente']);

// sentAt nulo nao pode ir pro topo de uma ordem decrescente.
const comNulo = ordenar(
  [l('sem-data', { sentAt: null }), l('com-data', { sentAt: new Date('2026-01-01') })],
  'sentAt',
  'desc',
);
assert.deepEqual(comNulo.map((x) => x.id), ['com-data', 'sem-data']);

// Ordenar nao muda o tamanho da lista nem perde item.
assert.equal(ordenar(cliques, 'orders', 'desc').length, 3);
assert.deepEqual(ordenar([], 'clicks', 'desc'), []);

console.log('stats-offers.check: ok');
