import { DisparoStatus, DisparoItemStatus, OfferStatus } from '@prisma/client';
import { prisma, num } from '../db.js';
import { logger } from '../lib/logger.js';
import { sendOffer } from './dispatch.js';
import { renderTemplate } from './template.js';
import { WhatsAppRetryableError } from '../whatsapp/baileys.js';

const MINUTE_MS = 60_000;
// Teto diario nao reseta antes da virada do dia e uma reconexao do WhatsApp
// costuma levar segundos a poucos minutos -- 30min evita tanto martelar a
// cada tick (o bug que isso corrige) quanto travar o disparo por horas numa
// reconexao rapida.
const RETRY_DELAY_MINUTES = 30;

export interface CriarDisparoInput {
  offerIds: string[];
  templateId: string;
  groupJids: string[];
  startNow: boolean;
  scheduledFor?: string;
  intervalMinutes: number;
  avoidNightHours: boolean;
  avoidWeekends: boolean;
  skipExpiredOffers: boolean;
}

/**
 * Cria o disparo e ja reserva as ofertas escolhidas (PENDING -> DISPATCHING),
 * na mesma transacao -- assim elas somem da Fila e de qualquer automacao no
 * instante em que o disparo existe, nunca antes nem depois.
 *
 * Ordem dos envios: pra cada oferta, todos os grupos, na ordem em que as
 * ofertas e os grupos foram escolhidos. Isso garante que duas mensagens
 * nunca saem no mesmo instante ("rajada") -- cada par (oferta, grupo) fica
 * numa fatia de tempo so dele, espacada pelo intervalo configurado.
 */
export async function criarDisparo(input: CriarDisparoInput) {
  const offers = await prisma.offer.findMany({
    where: { id: { in: input.offerIds }, status: OfferStatus.PENDING },
  });
  if (offers.length !== input.offerIds.length) {
    throw new Error('Alguma oferta escolhida ja nao esta mais pendente -- atualize a lista.');
  }
  const template = await prisma.messageTemplate.findUnique({ where: { id: input.templateId } });
  if (!template) throw new Error('Modelo de mensagem nao encontrado.');

  const porId = new Map(offers.map((o) => [o.id, o]));
  const ordenadas = input.offerIds.map((id) => porId.get(id)!);

  const startAt = input.startNow ? new Date() : new Date(input.scheduledFor!);
  const pares = ordenadas.flatMap((o) => input.groupJids.map((groupJid) => ({ offerId: o.id, groupJid })));

  return prisma.$transaction(async (tx) => {
    const disparo = await tx.disparo.create({
      data: {
        status: input.startNow ? DisparoStatus.SENDING : DisparoStatus.DRAFT,
        templateId: input.templateId,
        groupJids: input.groupJids,
        startAt,
        intervalMinutes: input.intervalMinutes,
        avoidNightHours: input.avoidNightHours,
        avoidWeekends: input.avoidWeekends,
        skipExpiredOffers: input.skipExpiredOffers,
        items: {
          create: pares.map((p, i) => ({
            offerId: p.offerId,
            groupJid: p.groupJid,
            scheduledFor: new Date(startAt.getTime() + i * input.intervalMinutes * MINUTE_MS),
          })),
        },
      },
      include: { items: true, template: true },
    });
    // Filtra por PENDING de novo aqui dentro (nao so no findMany la em cima):
    // entre a leitura e esta escrita, outro criarDisparo concorrente pode ter
    // reservado a mesma oferta. So esta updateMany e atomica o bastante pra
    // pegar isso -- se sobrar oferta que nao virou DISPATCHING, alguem chegou
    // primeiro, e o throw derruba a transacao inteira (nao cria o disparo
    // pela metade nem forca de volta uma oferta que virou SENT nesse meio-tempo).
    const reservadas = await tx.offer.updateMany({
      where: { id: { in: input.offerIds }, status: OfferStatus.PENDING },
      data: { status: OfferStatus.DISPATCHING },
    });
    if (reservadas.count !== input.offerIds.length) {
      throw new Error('Alguma oferta escolhida ja nao esta mais pendente -- atualize a lista.');
    }
    return disparo;
  });
}

/**
 * Cancela o disparo: os itens que ainda nao saíram viram FAILED (com motivo
 * "Disparo cancelado"), e as ofertas voltam pra PENDING (Fila) em dois casos:
 * as que ainda estavam DISPATCHING (nunca tentaram sair), e as que estao
 * FAILED sem nenhum DisparoItem SENT neste disparo (tentaram e todo envio
 * falhou -- sem isso ficam presas em FAILED, invisiveis em toda pagina do
 * app). Uma oferta que ja saiu pra pelo menos um grupo fica SENT e essa nao
 * volta: nao da pra desenviar uma mensagem de WhatsApp, e reaparecer na Fila
 * sugeriria que ela nunca saiu.
 */
export async function cancelarDisparo(id: string) {
  const disparo = await prisma.disparo.findUnique({ where: { id }, include: { items: true } });
  if (!disparo) throw new Error('Disparo nao encontrado.');
  if (disparo.status === DisparoStatus.CANCELLED || disparo.status === DisparoStatus.DONE) {
    throw new Error('Esse disparo ja terminou -- nao da pra cancelar.');
  }

  const sentOfferIds = new Set(
    disparo.items.filter((i) => i.status === DisparoItemStatus.SENT).map((i) => i.offerId),
  );

  const pendentes = disparo.items.filter((i) => i.status === DisparoItemStatus.PENDING);
  // Oferta que ja saiu pra algum grupo NAO volta pra fila: ela foi enviada de
  // verdade, e reverter pra PENDING deixaria a automacao reenviar o mesmo
  // produto pro mesmo grupo.
  const dispatchingIds = [...new Set(pendentes.map((i) => i.offerId))].filter((oid) => !sentOfferIds.has(oid));

  const failedOfferIds = [...new Set(disparo.items.filter((i) => i.status === DisparoItemStatus.FAILED).map((i) => i.offerId))];
  const failedSemSent = failedOfferIds.filter((oid) => !sentOfferIds.has(oid));

  await prisma.$transaction([
    prisma.disparoItem.updateMany({
      where: { disparoId: id, status: DisparoItemStatus.PENDING },
      data: { status: DisparoItemStatus.FAILED, failReason: 'Disparo cancelado.' },
    }),
    prisma.offer.updateMany({
      where: { id: { in: dispatchingIds }, status: OfferStatus.DISPATCHING },
      data: { status: OfferStatus.PENDING },
    }),
    prisma.offer.updateMany({
      where: { id: { in: failedSemSent }, status: OfferStatus.FAILED },
      data: { status: OfferStatus.PENDING, failReason: null },
    }),
    prisma.disparo.update({
      where: { id },
      data: { status: DisparoStatus.CANCELLED, cancelledAt: new Date() },
    }),
  ]);
}

// Hoisted pro modulo: proximoLiberado chama bloqueado() minuto a minuto (ate
// ~3300x no pior caso), e construir um Intl.DateTimeFormat novo a cada volta
// e desperdicio -- a formatacao em si (formatToParts) ja recebe o `t` de cada
// chamada, o formatter e reutilizavel.
const fusoSaoPaulo = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo',
  hourCycle: 'h23',
  hour: '2-digit',
  weekday: 'short',
});

/** Horario (America/Sao_Paulo) ou dia da semana bloqueiam o envio agora? */
function bloqueado(t: Date, avoidNightHours: boolean, avoidWeekends: boolean): boolean {
  const partes = fusoSaoPaulo.formatToParts(t);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '0');
  const diaSemana = partes.find((p) => p.type === 'weekday')?.value;

  if (avoidNightHours && (hora >= 23 || hora < 6)) return true;
  if (avoidWeekends && (diaSemana === 'Sat' || diaSemana === 'Sun')) return true;
  return false;
}

/**
 * Proximo instante liberado, andando minuto a minuto ate sair das janelas
 * bloqueadas. Pior caso (sexta 23h com as duas guardas ligadas) sao uns
 * 3300 minutos ate segunda 06h -- calculo puro, sem I/O, nao pesa nem nesse
 * extremo.
 */
function proximoLiberado(de: Date, avoidNightHours: boolean, avoidWeekends: boolean): Date {
  let t = de;
  let voltas = 0;
  while (bloqueado(t, avoidNightHours, avoidWeekends) && voltas < 4 * 24 * 60) {
    t = new Date(t.getTime() + MINUTE_MS);
    voltas++;
  }
  return t;
}

/**
 * Adia este item e todos os que vem depois dele no mesmo disparo (ainda
 * pendentes), recomecando a contagem do intervalo a partir do proximo
 * horario liberado.
 *
 * Por que a cauda inteira, e nao so este item: se so este item fosse adiado
 * pro exato instante em que a janela reabre, e os de depois continuassem
 * com o scheduledFor original (que tambem ja passou, porque a janela
 * bloqueada emperrou todos igual), TODOS ficariam "vencidos" ao mesmo tempo
 * -- o worker mandaria todos juntos no primeiro tick apos a janela reabrir.
 * Isso e exatamente a rajada que o intervalo minimo existe pra evitar.
 * Recalculando a cauda inteira a partir do novo inicio, o espacamento
 * configurado se mantem intacto -- so desliza no tempo, nunca comprime.
 *
 * `atrasoMs` desloca o ponto de partida antes de procurar o proximo horario
 * liberado -- usado no retry de erro retryable (teto diario / desconectado),
 * pra nao recalcular a cauda pra "agora" (que so bateria de novo na mesma
 * falha no proximo tick).
 */
async function adiar(
  item: { disparoId: string; scheduledFor: Date },
  disparo: { intervalMinutes: number; avoidNightHours: boolean; avoidWeekends: boolean },
  atrasoMs = 0,
) {
  const cauda = await prisma.disparoItem.findMany({
    where: {
      disparoId: item.disparoId,
      status: DisparoItemStatus.PENDING,
      scheduledFor: { gte: item.scheduledFor },
    },
    orderBy: { scheduledFor: 'asc' },
  });
  const inicio = proximoLiberado(new Date(Date.now() + atrasoMs), disparo.avoidNightHours, disparo.avoidWeekends);

  await prisma.$transaction(
    cauda.map((it, i) =>
      prisma.disparoItem.update({
        where: { id: it.id },
        data: { scheduledFor: new Date(inicio.getTime() + i * disparo.intervalMinutes * MINUTE_MS) },
      }),
    ),
  );
}

function dadosTemplate(offer: {
  price: unknown;
  comparePrice: unknown;
  couponCode: string | null;
  affiliateUrl: string;
  product: { title: string };
}) {
  return {
    title: offer.product.title,
    price: num(offer.price) ?? 0,
    comparePrice: num(offer.comparePrice),
    couponCode: offer.couponCode,
    link: offer.affiliateUrl,
  };
}

/**
 * Roda pelo cron a cada minuto (workers/index.ts). Manda no maximo um item
 * por disparo por rodada -- o espacamento entre os proximos ja vem certo no
 * scheduledFor calculado na criacao (ou reajustado por adiar()), entao nao
 * precisa mandar mais de um por vez pra respeitar o intervalo.
 *
 * Reentrancia: trava em memoria de processo unico (`rodando`). sendOffer em
 * si ja serializa qualquer envio real por baixo (whatsapp/baileys.ts usa um
 * lock proprio), mas sem essa trava aqui duas rodadas do cron sobrepostas
 * poderiam ler o MESMO item PENDING antes de qualquer uma marca-lo SENT, e
 * as duas chamariam sendOffer pro mesmo par (oferta, grupo) -- mensagem
 * duplicada. So funciona com uma instancia da API rodando, que e o caso
 * hoje; com mais de um processo precisaria de lock no banco.
 *
 * Ordem claim-antes-de-enviar: reservamos o item (PENDING -> SENT) ANTES de
 * chamar sendOffer, nao depois. Se o processo cair (deploy, restart, OOM) ou
 * o proprio UPDATE de "marcar enviado" falhar (pool esgotado, erro de rede
 * no banco) DEPOIS do envio de verdade, o item antigo ficava PENDING e era
 * reenviado no proximo tick -- repetidamente, pra um numero que pode ser
 * banido. Com a reserva vindo primeiro, o pior caso vira o oposto: o envio
 * falha meio do caminho e o item fica marcado SENT sem ter saido de fato
 * (envio perdido, nao reenviado). Perder um envio ocasional e aceitavel;
 * reenviar em loop pro grupo errado numero de vezes nao e -- essa e a troca
 * deliberada aqui.
 */
let rodando = false;
export async function runDisparos() {
  if (rodando) return;
  rodando = true;
  try {
    const due = await prisma.disparoItem.findMany({
      where: {
        status: DisparoItemStatus.PENDING,
        scheduledFor: { lte: new Date() },
        disparo: { status: { in: [DisparoStatus.DRAFT, DisparoStatus.SENDING] } },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 5,
      include: {
        disparo: { include: { template: true } },
        offer: { include: { product: true } },
      },
    });

    const processados = new Set<string>();
    for (const item of due) {
      if (processados.has(item.disparoId)) continue;
      processados.add(item.disparoId);

      const { disparo } = item;

      if (bloqueado(new Date(), disparo.avoidNightHours, disparo.avoidWeekends)) {
        await adiar(item, disparo);
        continue;
      }

      // Pacing por disparo: se o startAt caiu no passado (ou o disparo ficou
      // parado numa janela bloqueada), varios itens ficam "vencidos" de uma
      // vez. Sem essa checagem, cada tick manda o proximo vencido -- um por
      // minuto, bem mais rapido que o intervalMinutes configurado. So manda
      // de novo quando ja passou intervalMinutes desde o ultimo envio deste
      // disparo.
      const ultimoEnvio = await prisma.disparoItem.findFirst({
        where: { disparoId: disparo.id, status: DisparoItemStatus.SENT },
        orderBy: { sentAt: { sort: 'desc', nulls: 'last' } },
      });
      if (ultimoEnvio?.sentAt && Date.now() - ultimoEnvio.sentAt.getTime() < disparo.intervalMinutes * MINUTE_MS) {
        continue;
      }

      // So flipa DRAFT -> SENDING quando o trabalho de fato comeca -- antes
      // disso (bloqueado ou aguardando pacing) o disparo ainda nao mandou
      // nada, e "enviando" seria mentira por horas numa janela bloqueada.
      if (disparo.status === DisparoStatus.DRAFT) {
        await prisma.disparo.update({ where: { id: disparo.id }, data: { status: DisparoStatus.SENDING } });
      }

      // Reserva atomica: so entra quem ainda achar o item PENDING. Se outra
      // rodada (ou um cancelamento) ja mexeu nele, count fica 0 e pulamos --
      // sem isso duas rodadas sobrepostas mandariam a mesma mensagem duas vezes.
      const claim = await prisma.disparoItem.updateMany({
        where: { id: item.id, status: DisparoItemStatus.PENDING },
        data: { status: DisparoItemStatus.SENT, sentAt: new Date() },
      });
      if (claim.count !== 1) continue;

      try {
        const texto = renderTemplate(disparo.template.body, dadosTemplate(item.offer), disparo.template.ctas);
        await sendOffer(item.offerId, item.groupJid, { message: texto, allowResend: true });
        // Sucesso: o claim acima ja gravou SENT/sentAt, nada mais a fazer.
      } catch (err) {
        if (err instanceof WhatsAppRetryableError) {
          // Retryable (teto diario ou desconectado): desfaz a reserva --
          // volta o item pra PENDING -- e adia a cauda inteira pro retry, em
          // vez de queimar o item e a oferta como se fosse erro definitivo.
          // dispatch.ts (sendOffer) ja marcou a OFERTA como FAILED no catch
          // dele antes de repassar o erro; aqui desfazemos isso tambem,
          // porque a oferta continua "em disparo" de verdade, so adiada.
          await prisma.disparoItem.updateMany({
            where: { id: item.id, status: DisparoItemStatus.SENT },
            data: { status: DisparoItemStatus.PENDING, sentAt: null },
          });
          await prisma.offer.updateMany({
            where: { id: item.offerId, status: OfferStatus.FAILED },
            data: { status: OfferStatus.DISPATCHING, failReason: null },
          });
          logger.warn(
            { disparoId: disparo.id, itemId: item.id, motivo: err.message },
            'envio de disparo adiado (falha retryable)',
          );
          await adiar(item, disparo, RETRY_DELAY_MINUTES * MINUTE_MS);
          continue;
        }

        const failReason = err instanceof Error ? err.message : 'erro desconhecido';
        logger.error({ disparoId: disparo.id, itemId: item.id, failReason }, 'envio de disparo falhou');
        await prisma.disparoItem.update({
          where: { id: item.id },
          data: { status: DisparoItemStatus.FAILED, failReason },
        });
      }

      const restam = await prisma.disparoItem.count({
        where: { disparoId: disparo.id, status: DisparoItemStatus.PENDING },
      });
      if (restam === 0) {
        // updateMany com o status como parte do where: se um cancelamento
        // concorrente ja levou o disparo pra CANCELLED enquanto este ultimo
        // envio estava em voo, essa checagem impede reescrever por cima com
        // DONE e apagar o fato de que foi cancelado.
        await prisma.disparo.updateMany({
          where: { id: disparo.id, status: { in: [DisparoStatus.DRAFT, DisparoStatus.SENDING] } },
          data: { status: DisparoStatus.DONE },
        });
      }
    }
  } finally {
    rodando = false;
  }
}
