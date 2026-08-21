import { OfferStatus, type AutomationRule } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { sendOffer } from './dispatch.js';

/**
 * Envio automatico: e o unico lugar do app onde uma oferta sai sem voce
 * clicar. Fica desligado por padrao (AutomationRule.active=false) e, ligado,
 * ainda passa pelas mesmas grades do envio manual -- teto diario e intervalo
 * minimo em whatsapp/baileys.ts. A regra so decide QUAIS ofertas e QUANDO;
 * quem manda de verdade continua sendo o mesmo sendOffer de sempre.
 */

/**
 * Tolerancia na checagem do intervalo.
 *
 * `lastRunAt` e gravado DEPOIS do envio -- que leva alguns segundos (o
 * "digitando..." simulado em whatsapp.sendOffer). Com intervalo=5min, tick do
 * cron as :15 e o envio fecha as :15:03; no tick de :20 ja se passaram so
 * 4min57s desde lastRunAt, MENOS que o intervalo -- pula, e a rodada real so
 * sai as :25. Foi o que aconteceu: 16:15 -> 16:25 em vez de 16:15 -> 16:20.
 * 60s de folga absorve essa deriva sem abrir brecha de verdade no intervalo.
 */
const TOLERANCIA_MS = 60_000;

/** Ela pode rodar agora? Dia da semana, janela do dia, intervalo desde a ultima vez. */
export function deveRodar(rule: AutomationRule, agora: Date): boolean {
  if (!rule.active) return false;
  if (!rule.weekdays.includes(agora.getDay())) return false;

  const hhmm = agora.toTimeString().slice(0, 5);
  if (hhmm < rule.windowStart || hhmm > rule.windowEnd) return false;

  if (rule.lastRunAt) {
    const decorridoMs = agora.getTime() - rule.lastRunAt.getTime();
    if (decorridoMs < rule.intervalMinutes * 60_000 - TOLERANCIA_MS) return false;
  }
  return true;
}

/**
 * Ofertas pendentes que a regra pode escolher: do nicho certo, melhor nota
 * primeiro, sem repetir produto que saiu ha menos de `cooldownHours`. O
 * cooldown olha o PRODUTO, nao a oferta -- o mesmo produto pode ter entrado
 * na fila de novo por outra captura.
 */
async function elegiveis(rule: AutomationRule) {
  const desde = new Date(Date.now() - rule.cooldownHours * 3_600_000);
  const recentes = await prisma.offer.findMany({
    where: { status: OfferStatus.SENT, sentAt: { gte: desde } },
    select: { productId: true },
  });
  const bloqueados = new Set(recentes.map((o) => o.productId));

  const candidatos = await prisma.offer.findMany({
    where: { status: OfferStatus.PENDING, ...(rule.nicheId ? { nicheId: rule.nicheId } : {}) },
    orderBy: { score: 'desc' },
    // folga sobre o tamanho do lote: parte pode cair no cooldown.
    take: rule.batchSize * 3,
    include: { product: true },
  });

  return candidatos.filter((o) => !bloqueados.has(o.productId)).slice(0, rule.batchSize);
}

export interface ResumoRodada {
  grupo: string;
  escolhidos: number;
  enviados: number;
  falhas: string[];
}

/**
 * Manda o lote da vez. Uma oferta so pode ter UM grupo de destino
 * (Offer.groupJid e singular) -- por isso, com mais de um grupo configurado,
 * a rodada usa um por vez, em rodizio, e nao repete o mesmo lote em todos.
 */
export async function executarRodada(rule: AutomationRule): Promise<ResumoRodada> {
  if (!rule.groupJids.length) throw new Error(`Regra "${rule.name}" sem grupo de destino.`);

  const jid = rule.groupJids[rule.runsCount % rule.groupJids.length];
  const offers = await elegiveis(rule);

  let enviados = 0;
  const falhas: string[] = [];
  for (const offer of offers) {
    try {
      await sendOffer(offer.id, jid);
      enviados++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      falhas.push(`${offer.product.title.slice(0, 40)}: ${msg}`);
    }
  }

  await prisma.automationRule.update({
    where: { id: rule.id },
    data: { lastRunAt: new Date(), runsCount: { increment: 1 } },
  });

  logger.info({ regra: rule.name, grupo: jid, escolhidos: offers.length, enviados }, 'automacao rodou');
  return { grupo: jid, escolhidos: offers.length, enviados, falhas };
}

/** Roda por cima de todas as regras ativas, chamado pelo cron a cada 5 min. */
export async function runAutomacoes(): Promise<{ rodaram: number }> {
  const regras = await prisma.automationRule.findMany({ where: { active: true } });
  const agora = new Date();
  let rodaram = 0;

  for (const rule of regras) {
    if (!deveRodar(rule, agora)) continue;
    try {
      await executarRodada(rule);
      rodaram++;
    } catch (err) {
      logger.warn({ regra: rule.name, err: String(err) }, 'falha ao rodar automacao');
    }
  }

  return { rodaram };
}
