import { OfferStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { whatsapp } from '../whatsapp/baileys.js';

/** Grupo padrao marcado no dashboard, ou o primeiro sincronizado. */
async function defaultGroupJid(): Promise<string> {
  const group =
    (await prisma.whatsappGroup.findFirst({ where: { isDefault: true } })) ??
    (await prisma.whatsappGroup.findFirst());
  if (!group) throw new Error('Nenhum grupo sincronizado. Conecte o WhatsApp e clique em "Atualizar grupos".');
  return group.jid;
}

/**
 * Envia a oferta aprovada. Chamado quando voce clica em "Enviar ao grupo"
 * ou pelo agendador, quando chega a hora marcada.
 */
export async function sendOffer(offerId: string, groupJid?: string) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: { product: true } });
  if (!offer) throw new Error('Oferta nao encontrada.');
  if (offer.status === OfferStatus.SENT) throw new Error('Essa oferta ja foi enviada.');

  const jid = groupJid ?? offer.groupJid ?? (await defaultGroupJid());

  try {
    await whatsapp.sendOffer(jid, offer.message, {
      title: offer.product.title,
      link: offer.affiliateUrl,
      imageUrl: offer.product.imageUrl,
    });
    logger.info({ offerId, jid }, 'oferta enviada');
    return prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.SENT, sentAt: new Date(), groupJid: jid, failReason: null },
    });
  } catch (err) {
    const failReason = err instanceof Error ? err.message : 'erro desconhecido';
    logger.error({ offerId, failReason }, 'falha ao enviar');
    await prisma.offer.update({ where: { id: offerId }, data: { status: OfferStatus.FAILED, failReason } });
    throw err;
  }
}
