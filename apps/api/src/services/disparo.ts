import { DisparoStatus, DisparoItemStatus, OfferStatus } from '@prisma/client';
import { prisma, num } from '../db.js';
import { logger } from '../lib/logger.js';
import { sendOffer } from './dispatch.js';
import { renderTemplate } from './template.js';

const MINUTE_MS = 60_000;

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
    await tx.offer.updateMany({
      where: { id: { in: input.offerIds } },
      data: { status: OfferStatus.DISPATCHING },
    });
    return disparo;
  });
}

/**
 * Cancela o disparo: os itens que ainda nao saíram viram FAILED (com motivo
 * "Disparo cancelado"), e SO as ofertas que ainda estavam DISPATCHING voltam
 * pra PENDING (Fila). Uma oferta que ja saiu pra pelo menos um grupo ja
 * esta SENT (sendOffer marca isso no primeiro envio) -- essa nao volta:
 * nao da pra desenviar uma mensagem de WhatsApp, e reaparecer na Fila
 * sugeriria que ela nunca saiu.
 */
export async function cancelarDisparo(id: string) {
  const disparo = await prisma.disparo.findUnique({ where: { id }, include: { items: true } });
  if (!disparo) throw new Error('Disparo nao encontrado.');
  if (disparo.status === DisparoStatus.CANCELLED || disparo.status === DisparoStatus.DONE) {
    throw new Error('Esse disparo ja terminou -- nao da pra cancelar.');
  }

  const pendentes = disparo.items.filter((i) => i.status === DisparoItemStatus.PENDING);
  const offerIds = [...new Set(pendentes.map((i) => i.offerId))];

  await prisma.$transaction([
    prisma.disparoItem.updateMany({
      where: { disparoId: id, status: DisparoItemStatus.PENDING },
      data: { status: DisparoItemStatus.FAILED, failReason: 'Disparo cancelado.' },
    }),
    prisma.offer.updateMany({
      where: { id: { in: offerIds }, status: OfferStatus.DISPATCHING },
      data: { status: OfferStatus.PENDING },
    }),
    prisma.disparo.update({
      where: { id },
      data: { status: DisparoStatus.CANCELLED, cancelledAt: new Date() },
    }),
  ]);
}

/** Horario (America/Sao_Paulo) ou dia da semana bloqueiam o envio agora? */
function bloqueado(t: Date, avoidNightHours: boolean, avoidWeekends: boolean): boolean {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hourCycle: 'h23',
    hour: '2-digit',
    weekday: 'short',
  }).formatToParts(t);
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
 */
async function adiar(
  item: { disparoId: string; scheduledFor: Date },
  disparo: { intervalMinutes: number; avoidNightHours: boolean; avoidWeekends: boolean },
) {
  const cauda = await prisma.disparoItem.findMany({
    where: {
      disparoId: item.disparoId,
      status: DisparoItemStatus.PENDING,
      scheduledFor: { gte: item.scheduledFor },
    },
    orderBy: { scheduledFor: 'asc' },
  });
  const inicio = proximoLiberado(new Date(), disparo.avoidNightHours, disparo.avoidWeekends);

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
      if (disparo.status === DisparoStatus.DRAFT) {
        await prisma.disparo.update({ where: { id: disparo.id }, data: { status: DisparoStatus.SENDING } });
      }

      if (bloqueado(new Date(), disparo.avoidNightHours, disparo.avoidWeekends)) {
        await adiar(item, disparo);
        continue;
      }

      try {
        const texto = renderTemplate(disparo.template.body, dadosTemplate(item.offer), disparo.template.ctas);
        await sendOffer(item.offerId, item.groupJid, { message: texto, allowResend: true });
        await prisma.disparoItem.update({
          where: { id: item.id },
          data: { status: DisparoItemStatus.SENT, sentAt: new Date() },
        });
      } catch (err) {
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
        await prisma.disparo.update({ where: { id: disparo.id }, data: { status: DisparoStatus.DONE } });
      }
    }
  } finally {
    rodando = false;
  }
}
