import { OfferSource, type Offer } from '@prisma/client';
import { prisma, num } from '../db.js';
import { shortCode } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { env } from '../env.js';
import { connectors, detectPlatform } from '../connectors/index.js';
import type { NormalizedProduct } from '../connectors/types.js';
import { lowestPrice, scoreOffer } from './scoring.js';
import { renderMessage } from './message.js';

/** Grava/atualiza o produto e sempre registra um ponto no historico de preco. */
export async function upsertProduct(p: NormalizedProduct) {
  const product = await prisma.product.upsert({
    where: { platform_externalId: { platform: p.platform, externalId: p.externalId } },
    create: {
      platform: p.platform,
      externalId: p.externalId,
      title: p.title,
      imageUrl: p.imageUrl,
      canonicalUrl: p.canonicalUrl,
      category: p.category,
      brand: p.brand,
      currentPrice: p.price,
      listPrice: p.listPrice,
      commissionPct: p.commissionPct,
      rating: p.rating,
      reviewCount: p.reviewCount,
      available: p.available,
      lastSyncAt: new Date(),
    },
    update: {
      title: p.title,
      imageUrl: p.imageUrl,
      currentPrice: p.price,
      listPrice: p.listPrice,
      commissionPct: p.commissionPct,
      rating: p.rating,
      reviewCount: p.reviewCount,
      available: p.available,
      lastSyncAt: new Date(),
    },
  });

  if (p.price && p.price > 0) {
    await prisma.priceSnapshot.create({
      data: { productId: product.id, price: p.price, available: p.available },
    });
  }

  return product;
}

/**
 * Coracao do sistema: recebe uma URL (colada por voce ou achada pelo worker),
 * busca o produto na API, calcula a nota, gera o link de afiliado + link curto
 * e deixa a oferta PENDENTE esperando seu clique em "Enviar".
 */
export async function ingestUrl(
  rawUrl: string,
  source: OfferSource = OfferSource.MANUAL,
  note?: string,
): Promise<Offer> {
  const connector = detectPlatform(rawUrl);
  if (!connector) throw new Error('Nao reconheci a loja desse link. Plataformas aceitas: Amazon, Mercado Livre, Shopee, AliExpress, Lomadee.');

  const externalId = connector.parseId(rawUrl);
  if (!externalId) throw new Error(`Nao consegui extrair o codigo do produto na URL da ${connector.label}.`);

  const found = await connector.getProduct(externalId);
  if (!found) throw new Error('A API da loja nao devolveu esse produto. Ele pode ter saido do ar.');

  return ingestProduct(found, source, note);
}

export async function ingestProduct(
  found: NormalizedProduct,
  source: OfferSource,
  note?: string,
): Promise<Offer> {
  const connector = connectors[found.platform];
  const product = await upsertProduct(found);
  const price = found.price ?? 0;

  const scored = await scoreOffer({
    productId: product.id,
    price,
    listPrice: found.listPrice,
    commissionPct: found.commissionPct ?? num(product.commissionPct),
    rating: found.rating,
    reviewCount: found.reviewCount,
  });

  const affiliateUrl = await connector.buildAffiliateLink(found.canonicalUrl, found.externalId);

  const offer = await prisma.offer.create({
    data: {
      productId: product.id,
      source,
      price,
      comparePrice: found.listPrice,
      discountPct: scored.discountPct,
      commissionBrl: scored.commissionBrl,
      score: scored.score,
      scoreReasons: scored.reasons,
      affiliateUrl,
      couponCode: found.couponCode,
      message: '',
    },
  });

  // Link curto proprio: e o que permite contar cliques por oferta.
  const link = await prisma.shortLink.create({
    data: { code: shortCode(), targetUrl: affiliateUrl, offerId: offer.id },
  });

  const message = renderMessage({
    platform: found.platform,
    title: found.title,
    price,
    comparePrice: found.listPrice,
    discountPct: scored.discountPct,
    lowest: await lowestPrice(product.id),
    couponCode: found.couponCode,
    link: `${env.publicUrl}/r/${link.code}`,
    note,
  });

  logger.info({ offerId: offer.id, score: scored.score, platform: found.platform }, 'oferta capturada');
  return prisma.offer.update({ where: { id: offer.id }, data: { message } });
}
