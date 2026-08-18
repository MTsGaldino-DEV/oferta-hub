import cron from 'node-cron';
import { OfferSource, OfferStatus, Platform } from '@prisma/client';
import { prisma, num } from '../db.js';
import { logger } from '../lib/logger.js';
import { sleep } from '../lib/http.js';
import { connectors } from '../connectors/index.js';
import { NICHOS_SHOPEE } from '../connectors/nichos.js';
import { ingestProduct, upsertProduct } from '../services/ingest.js';
import { sendOffer } from '../services/dispatch.js';

/**
 * Resumo do que uma rodada fez. Existe porque disparo manual sem retorno e
 * indistinguivel de "nao rodou": monitor com lista vazia termina em silencio,
 * e garimpo que toma 403 da plataforma tambem.
 */
export interface MonitorSummary {
  checked: number;
  fired: number;
  failed: number;
}

export interface DiscoverySummary {
  rules: {
    keyword: string;
    platform: Platform;
    found: number;
    added: number;
    error?: string;
  }[];
}

/**
 * 1) MONITOR DE PRECO -- roda de hora em hora.
 * Le o preco atual dos produtos vigiados, grava no historico e cria uma oferta
 * PENDENTE quando o produto bate seu gatilho. Nada e enviado sozinho: cai na
 * fila e espera voce aprovar.
 */
export async function runPriceMonitor(): Promise<MonitorSummary> {
  const items = await prisma.watchItem.findMany({ where: { active: true }, include: { product: true } });
  logger.info({ count: items.length }, 'monitor de preco iniciado');
  let fired = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const connector = connectors[item.product.platform];
      const fresh = await connector.getProduct(item.product.externalId);
      if (!fresh?.price) continue;

      const before = num(item.product.currentPrice) ?? fresh.price;
      await upsertProduct(fresh);

      const target = num(item.targetPrice);
      const minDrop = num(item.minDropPct) ?? 10;
      const dropPct = before > 0 ? ((before - fresh.price) / before) * 100 : 0;

      const hitTarget = target !== null && fresh.price <= target;
      const hitDrop = dropPct >= minDrop;

      // Nao repete o alerta do mesmo produto em menos de 12h.
      const cooling = item.lastFiredAt && Date.now() - item.lastFiredAt.getTime() < 12 * 60 * 60 * 1000;

      if ((hitTarget || hitDrop) && !cooling) {
        await ingestProduct(fresh, OfferSource.WATCHLIST);
        await prisma.watchItem.update({ where: { id: item.id }, data: { lastFiredAt: new Date() } });
        logger.info({ product: fresh.title, from: before, to: fresh.price }, 'queda detectada');
        fired++;
      }

      await sleep(1500); // respeita rate limit das APIs
    } catch (err) {
      failed++;
      logger.warn({ productId: item.productId, err: String(err) }, 'falha ao checar produto');
    }
  }

  return { checked: items.length, fired, failed };
}

/**
 * 2) GARIMPO AUTOMATICO -- roda a cada 3 horas.
 * Varre as palavras-chave que voce cadastrou e traz o que passar dos filtros.
 */
/** Como a regra aparece no resumo: "Beleza e cuidados", "fone", ou os dois. */
function rotulo(rule: { categoryId: number | null; keyword: string | null }): string {
  const nicho = NICHOS_SHOPEE.find((n) => n.id === rule.categoryId)?.label;
  return [nicho, rule.keyword].filter(Boolean).join(' · ') || 'regra sem filtro';
}

export async function runDiscovery(): Promise<DiscoverySummary> {
  const rules = await prisma.discoveryRule.findMany({ where: { active: true } });
  logger.info({ count: rules.length }, 'garimpo iniciado');
  const summary: DiscoverySummary['rules'] = [];

  for (const rule of rules) {
    let found = 0;
    let added = 0;
    try {
      const connector = connectors[rule.platform];
      const results = await connector.search({
        keyword: rule.keyword ?? undefined,
        categoryId: rule.categoryId ?? undefined,
        maxPrice: num(rule.maxPrice) ?? undefined,
        limit: 20,
      });
      found = results.length;

      const minDiscount = num(rule.minDiscount) ?? 20;
      const minCommission = num(rule.minCommission) ?? 0;

      for (const p of results) {
        if (!p.price) continue;
        const discount = p.listPrice && p.listPrice > p.price ? ((p.listPrice - p.price) / p.listPrice) * 100 : 0;
        if (discount < minDiscount) continue;
        if (minCommission > 0 && (p.commissionPct ?? 0) < minCommission) continue;

        // Se ja existe oferta aberta ou recente desse produto, nao duplica.
        const existing = await prisma.product.findUnique({
          where: { platform_externalId: { platform: p.platform, externalId: p.externalId } },
          include: {
            offers: {
              where: {
                OR: [
                  { status: { in: [OfferStatus.PENDING, OfferStatus.QUEUED] } },
                  { sentAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
                ],
              },
              take: 1,
            },
          },
        });
        if (existing?.offers.length) continue;

        await ingestProduct(p, OfferSource.DISCOVERY);
        added++;
        await sleep(1200);
      }

      await prisma.discoveryRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date() } });
      summary.push({ keyword: rotulo(rule), platform: rule.platform, found, added });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ rule: rotulo(rule), err: message }, 'falha no garimpo');
      summary.push({ keyword: rotulo(rule), platform: rule.platform, found, added, error: message });
    }
  }

  return { rules: summary };
}

/**
 * 3) AGENDADOR -- roda a cada minuto.
 * Envia as ofertas que voce aprovou com hora marcada.
 */
export async function runScheduler() {
  const due = await prisma.offer.findMany({
    where: { status: OfferStatus.QUEUED, scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: 'asc' },
    take: 3,
  });

  for (const offer of due) {
    try {
      await sendOffer(offer.id);
    } catch (err) {
      logger.error({ offerId: offer.id, err: String(err) }, 'agendamento falhou');
    }
  }
}

/**
 * 4) SINCRONIA DE VENDAS -- roda 2x por dia.
 * Puxa as transacoes confirmadas das redes que expoem relatorio por API.
 */
export async function runConversionSync() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  for (const connector of Object.values(connectors)) {
    if (!connector.fetchConversions) continue;
    try {
      const rows = await connector.fetchConversions(since);
      for (const row of rows) {
        // clickRef carrega o codigo do link curto, e como amarramos venda a oferta.
        const link = row.clickRef
          ? await prisma.shortLink.findUnique({ where: { code: row.clickRef } })
          : null;

        await prisma.conversion.upsert({
          where: { platform_externalId: { platform: connector.platform, externalId: row.externalId } },
          create: {
            platform: connector.platform,
            externalId: row.externalId,
            offerId: link?.offerId ?? null,
            orderValue: row.orderValue,
            commissionBrl: row.commissionBrl,
            status: row.status,
            occurredAt: row.occurredAt,
          },
          update: { commissionBrl: row.commissionBrl, status: row.status },
        });
      }
      logger.info({ platform: connector.platform, count: rows.length }, 'vendas sincronizadas');
    } catch (err) {
      logger.warn({ platform: connector.platform, err: String(err) }, 'falha ao sincronizar vendas');
    }
  }
}

export function startWorkers() {
  const tz = 'America/Sao_Paulo';
  cron.schedule('*/1 * * * *', () => void runScheduler(), { timezone: tz });
  cron.schedule('7 * * * *', () => void runPriceMonitor(), { timezone: tz });
  cron.schedule('23 */3 * * *', () => void runDiscovery(), { timezone: tz });
  cron.schedule('40 6,18 * * *', () => void runConversionSync(), { timezone: tz });
  logger.info('workers agendados (fuso America/Sao_Paulo)');
}
