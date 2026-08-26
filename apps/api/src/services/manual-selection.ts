import type { Offer, Prisma, Product } from '@prisma/client';

/**
 * Foto do momento do envio, pra ManualSelection. Product muda de preco com o
 * tempo (o monitor reescreve currentPrice a cada ciclo) -- sem essa foto,
 * consultar essa base depois mostraria o preco de HOJE, nao o que convenceu
 * o envio.
 */
export function buildManualSelectionData(
  offer: Offer,
  product: Product,
): Prisma.ManualSelectionCreateInput {
  return {
    offer: { connect: { id: offer.id } },
    platform: product.platform,
    externalId: product.externalId,
    title: product.title,
    category: product.category,
    price: offer.price,
    commissionPct: product.commissionPct,
    commissionBrl: offer.commissionBrl,
    source: offer.source,
  };
}
