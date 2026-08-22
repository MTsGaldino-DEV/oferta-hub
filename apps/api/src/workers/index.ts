import cron from 'node-cron';
import { OfferSource, OfferStatus, Platform } from '@prisma/client';
import { prisma, num } from '../db.js';
import { logger } from '../lib/logger.js';
import { sleep } from '../lib/http.js';
import { connectors } from '../connectors/index.js';
import { NICHOS_SHOPEE } from '../connectors/nichos.js';
import { harvestCategories, type CategorySyncSummary } from '../connectors/shopee-feed.js';
import { NICHOS_PRONTOS } from '../connectors/nichos-prontos.js';
import { seedCategoriasN3 } from '../connectors/categorias-n3.js';
import { buscarPorNicho, carregarNicho } from '../services/nichos.js';
import { ingestProduct, upsertProduct } from '../services/ingest.js';
import { sendOffer } from '../services/dispatch.js';
import { runAutomacoes } from '../services/automacoes.js';
import { runDisparos } from '../services/disparo.js';

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
    /** Anuncios repetidos do mesmo produto que o nicho colapsou. */
    repetidos?: number;
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
/** Como a regra aparece no resumo: "Gamer e setup", "fone", ou os dois. */
function rotulo(rule: {
  categoryId: number | null;
  keyword: string | null;
  niche?: { name: string } | null;
}): string {
  const nicho = rule.niche?.name ?? NICHOS_SHOPEE.find((n) => n.id === rule.categoryId)?.label;
  return [nicho, rule.keyword].filter(Boolean).join(' · ') || 'regra sem filtro';
}

export async function runDiscovery(): Promise<DiscoverySummary> {
  const rules = await prisma.discoveryRule.findMany({
    where: { active: true },
    include: { niche: true },
  });
  logger.info({ count: rules.length }, 'garimpo iniciado');
  const summary: DiscoverySummary['rules'] = [];

  for (const rule of rules) {
    let found = 0;
    let added = 0;
    try {
      // Regra com nicho varre todas as categorias do recorte e filtra por
      // termo; sem nicho, cai no modo antigo de uma categoria/palavra so.
      let results;
      let repetidos = 0;
      if (rule.nicheId) {
        const nicho = await carregarNicho(rule.nicheId);
        if (!nicho) throw new Error('O nicho dessa regra foi apagado.');
        const busca = await buscarPorNicho(nicho, { maxPrice: num(rule.maxPrice) ?? undefined });
        results = busca.achados.map((a) => a.produto).slice(0, 20);
        found = busca.resumo.aceitos;
        repetidos = busca.resumo.repetidos;
      } else {
        const connector = connectors[rule.platform];
        results = await connector.search({
          keyword: rule.keyword ?? undefined,
          categoryId: rule.categoryId ?? undefined,
          maxPrice: num(rule.maxPrice) ?? undefined,
          limit: 20,
        });
        found = results.length;
      }

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
                  // DISPATCHING entra aqui: oferta reservada por um Disparo
                  // ainda esta "ativa" pro produto, so ainda nao saiu -- sem
                  // isso o garimpo duplicava o produto no meio de um disparo.
                  { status: { in: [OfferStatus.PENDING, OfferStatus.QUEUED, OfferStatus.DISPATCHING] } },
                  { sentAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
                ],
              },
              take: 1,
            },
          },
        });
        if (existing?.offers.length) continue;

        await ingestProduct(p, OfferSource.DISCOVERY, { nicheId: rule.nicheId ?? undefined });
        added++;
        await sleep(1200);
      }

      await prisma.discoveryRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date() } });
      summary.push({ keyword: rotulo(rule), platform: rule.platform, found, added, repetidos });
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

/**
 * 5) CATALOGO DE CATEGORIAS -- roda toda segunda de madrugada.
 * Colhe as categorias do datafeed da Shopee e semeia os nichos prontos.
 * Semanal porque o catalogo praticamente nao muda: na medicao, 30 raizes e
 * ~276 categorias, estaveis. O feed em si e diario, mas so os produtos mudam.
 */
export async function runCategorySync(): Promise<CategorySyncSummary & { nichosCriados: number }> {
  const resumo = await harvestCategories();
  // As de nivel 3 nao vem no feed; entram por lista curada.
  await seedCategoriasN3();
  logger.info(resumo, 'catalogo de categorias atualizado');
  const nichosCriados = await seedNichosProntos();
  return { ...resumo, nichosCriados };
}

/**
 * Cria os nichos que vem prontos, uma vez so. Se voce editar um deles depois,
 * a edicao fica: o seed nunca sobrescreve nicho que ja existe.
 */
export async function seedNichosProntos(): Promise<number> {
  let criados = 0;
  for (const pronto of NICHOS_PRONTOS) {
    const existe = await prisma.niche.findUnique({
      where: { platform_name: { platform: pronto.platform, name: pronto.name } },
    });
    if (existe) continue;

    await prisma.niche.create({
      data: {
        platform: pronto.platform,
        name: pronto.name,
        minSales: pronto.minSales,
        excludeTerms: pronto.excludeTerms,
        builtIn: true,
        entries: {
          create: pronto.entries.map((e) => ({
            categoryId: e.categoryId,
            requireTerms: e.requireTerms,
          })),
        },
      },
    });
    criados++;
    logger.info({ nicho: pronto.name }, 'nicho pronto criado');
  }
  return criados;
}

export function startWorkers() {
  const tz = 'America/Sao_Paulo';
  cron.schedule('*/1 * * * *', () => void runScheduler(), { timezone: tz });
  // Disparos: mesmo ritmo do agendador, motivo separado -- QUEUED e
  // DISPATCHING sao filas diferentes de proposito (ver services/disparo.ts).
  cron.schedule('*/1 * * * *', () => void runDisparos(), { timezone: tz });
  cron.schedule('*/5 * * * *', () => void runAutomacoes(), { timezone: tz });
  cron.schedule('7 * * * *', () => void runPriceMonitor(), { timezone: tz });
  cron.schedule('23 */3 * * *', () => void runDiscovery(), { timezone: tz });
  cron.schedule('40 6,18 * * *', () => void runConversionSync(), { timezone: tz });
  cron.schedule('15 4 * * 1', () => void runCategorySync(), { timezone: tz });
  logger.info('workers agendados (fuso America/Sao_Paulo)');
}
