import { OfferStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { whatsapp } from '../whatsapp/baileys.js';
import { buildManualSelectionData } from './manual-selection.js';

/** Grupo padrao marcado no dashboard, ou o primeiro sincronizado. */
async function defaultGroupJid(): Promise<string> {
  const group =
    (await prisma.whatsappGroup.findFirst({ where: { isDefault: true } })) ??
    (await prisma.whatsappGroup.findFirst());
  if (!group) throw new Error('Nenhum grupo sincronizado. Conecte o WhatsApp e clique em "Atualizar grupos".');
  return group.jid;
}

/**
 * Envia a oferta aprovada. Chamado quando voce clica em "Enviar ao grupo",
 * pelo agendador quando chega a hora marcada, ou pelo worker de Disparos.
 *
 * `options.message` sobrepoe o texto so nesse envio -- o campo Offer.message
 * gravado no banco nao muda (ele e do fluxo manual da Fila). E o que o
 * Disparo usa pra mandar o texto renderizado do template escolhido, com sua
 * propria CTA sorteada por envio.
 *
 * `options.allowResend` pula o guard de "ja foi enviada". Existe porque uma
 * mesma oferta pode ir pra VARIOS grupos num disparo -- o primeiro envio ja
 * marca a oferta como SENT, e sem essa saida o segundo grupo cairia no
 * guard pensando que era reenvio duplicado. So o worker de Disparos usa essa
 * opcao; o botao "Enviar ao grupo" da Fila e o agendador continuam
 * bloqueando reenvio normalmente.
 */
export async function sendOffer(
  offerId: string,
  groupJid?: string,
  options?: { message?: string; allowResend?: boolean },
) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: { product: true } });
  if (!offer) throw new Error('Oferta nao encontrada.');
  if (offer.status === OfferStatus.SENT && !options?.allowResend) {
    throw new Error('Essa oferta ja foi enviada.');
  }

  const jid = groupJid ?? offer.groupJid ?? (await defaultGroupJid());
  const message = options?.message ?? offer.message;

  try {
    await whatsapp.sendOffer(jid, message, {
      title: offer.product.title,
      link: offer.affiliateUrl,
      imageUrl: offer.product.imageUrl,
    });
    logger.info({ offerId, jid }, 'oferta enviada');
    const sent = await prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.SENT, sentAt: new Date(), groupJid: jid, failReason: null },
    });
    await prisma.manualSelection.create({ data: buildManualSelectionData(offer, offer.product) });
    return sent;
  } catch (err) {
    const failReason = err instanceof Error ? err.message : 'erro desconhecido';
    logger.error({ offerId, failReason }, 'falha ao enviar');
    await prisma.offer.update({ where: { id: offerId }, data: { status: OfferStatus.FAILED, failReason } });
    throw err;
  }
}
