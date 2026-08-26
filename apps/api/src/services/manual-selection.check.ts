/**
 * Self-check de buildManualSelectionData. Roda sem rede e sem banco:
 *   npx tsx apps/api/src/services/manual-selection.check.ts
 */
import assert from 'node:assert/strict';
import { OfferSource, Platform } from '@prisma/client';
import { buildManualSelectionData } from './manual-selection.js';

const offer = {
  id: 'offer_1',
  price: 129.9,
  commissionBrl: 12.5,
  source: OfferSource.SCAN,
} as any;

const product = {
  platform: Platform.SHOPEE,
  externalId: '111_222',
  title: 'Fone bluetooth',
  category: 'Eletronicos',
  commissionPct: 18.5,
} as any;

const data = buildManualSelectionData(offer, product);

assert.deepEqual(data.offer, { connect: { id: 'offer_1' } });
assert.equal(data.platform, Platform.SHOPEE);
assert.equal(data.externalId, '111_222');
assert.equal(data.title, 'Fone bluetooth');
assert.equal(data.category, 'Eletronicos');
assert.equal(data.price, 129.9);
assert.equal(data.commissionPct, 18.5);
assert.equal(data.commissionBrl, 12.5);
assert.equal(data.source, OfferSource.SCAN);

// category nula do produto (ML/Amazon nao mandam categoria) passa nula, nao quebra.
const semCategoria = buildManualSelectionData(offer, { ...product, category: null } as any);
assert.equal(semCategoria.category, null);

console.log('manual-selection.check: ok');
