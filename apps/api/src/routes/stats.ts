import { OfferStatus, Platform } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { prisma, num } from '../db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function statsRoutes(app: FastifyInstance) {
  /**
   * Painel principal. Tudo recortado pela janela de dias escolhida,
   * porque desempenho de grupo de oferta so faz sentido comparado com
   * o periodo anterior -- numero absoluto sozinho nao diz nada.
   */
  app.get<{ Querystring: { days?: string } }>('/api/stats/overview', async (req) => {
    const days = Math.min(180, Math.max(1, Number(req.query.days ?? 30)));
    const since = new Date(Date.now() - days * DAY_MS);
    const previousSince = new Date(Date.now() - 2 * days * DAY_MS);

    const [sent, prevSent, clicks, prevClicks, conversions, prevConversions, pending, queued, dispatching] =
      await Promise.all([
        prisma.offer.count({ where: { status: OfferStatus.SENT, sentAt: { gte: since } } }),
        prisma.offer.count({
          where: { status: OfferStatus.SENT, sentAt: { gte: previousSince, lt: since } },
        }),
        prisma.click.count({ where: { clickedAt: { gte: since } } }),
        prisma.click.count({ where: { clickedAt: { gte: previousSince, lt: since } } }),
        prisma.conversion.aggregate({
          where: { occurredAt: { gte: since } },
          _sum: { commissionBrl: true, orderValue: true },
          _count: true,
        }),
        prisma.conversion.aggregate({
          where: { occurredAt: { gte: previousSince, lt: since } },
          _sum: { commissionBrl: true },
          _count: true,
        }),
        prisma.offer.count({ where: { status: OfferStatus.PENDING } }),
        prisma.offer.count({ where: { status: OfferStatus.QUEUED } }),
        prisma.offer.count({ where: { status: OfferStatus.DISPATCHING } }),
      ]);

    const revenue = num(conversions._sum.commissionBrl) ?? 0;
    const prevRevenue = num(prevConversions._sum.commissionBrl) ?? 0;

    return {
      days,
      sent: { value: sent, previous: prevSent },
      clicks: { value: clicks, previous: prevClicks },
      orders: { value: conversions._count, previous: prevConversions._count },
      revenue: { value: revenue, previous: prevRevenue },
      gmv: num(conversions._sum.orderValue) ?? 0,
      clicksPerOffer: sent ? Number((clicks / sent).toFixed(1)) : 0,
      conversionRate: clicks ? Number(((conversions._count / clicks) * 100).toFixed(2)) : 0,
      pending,
      queued,
      dispatching,
    };
  });

  /** Serie diaria pro grafico de cliques x comissao. */
  app.get<{ Querystring: { days?: string } }>('/api/stats/timeseries', async (req) => {
    const days = Math.min(180, Math.max(7, Number(req.query.days ?? 30)));
    const since = new Date(Date.now() - days * DAY_MS);

    const [clicks, conversions] = await Promise.all([
      prisma.click.findMany({ where: { clickedAt: { gte: since } }, select: { clickedAt: true } }),
      prisma.conversion.findMany({
        where: { occurredAt: { gte: since } },
        select: { occurredAt: true, commissionBrl: true },
      }),
    ]);

    const buckets = new Map<string, { day: string; clicks: number; revenue: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
      buckets.set(day, { day, clicks: 0, revenue: 0 });
    }

    for (const c of clicks) {
      const key = c.clickedAt.toISOString().slice(0, 10);
      const b = buckets.get(key);
      if (b) b.clicks++;
    }
    for (const c of conversions) {
      const key = c.occurredAt.toISOString().slice(0, 10);
      const b = buckets.get(key);
      if (b) b.revenue += Number(c.commissionBrl);
    }

    return [...buckets.values()].map((b) => ({ ...b, revenue: Number(b.revenue.toFixed(2)) }));
  });

  /** Ranking das ofertas enviadas: cliques e comissao por oferta. */
  app.get<{ Querystring: { days?: string; limit?: string } }>('/api/stats/offers', async (req) => {
    const days = Math.min(180, Math.max(1, Number(req.query.days ?? 30)));
    const since = new Date(Date.now() - days * DAY_MS);

    const offers = await prisma.offer.findMany({
      where: { status: OfferStatus.SENT, sentAt: { gte: since } },
      include: { product: true, shortLink: true, conversions: true },
      orderBy: { sentAt: 'desc' },
      take: Number(req.query.limit ?? 100),
    });

    return offers
      .map((o) => {
        const revenue = o.conversions.reduce((sum, c) => sum + Number(c.commissionBrl), 0);
        const clicks = o.shortLink?.clickCount ?? 0;
        return {
          id: o.id,
          title: o.product.title,
          imageUrl: o.product.imageUrl,
          platform: o.product.platform,
          price: num(o.price),
          discountPct: num(o.discountPct),
          score: o.score,
          sentAt: o.sentAt,
          clicks,
          orders: o.conversions.length,
          revenue: Number(revenue.toFixed(2)),
          conversionRate: clicks ? Number(((o.conversions.length / clicks) * 100).toFixed(1)) : 0,
        };
      })
      .sort((a, b) => b.clicks - a.clicks);
  });

  /**
   * Comparativo entre plataformas: qual rede realmente paga.
   * Compara comissao por clique, nao so o percentual anunciado -- uma rede
   * com 8% que ninguem clica rende menos que uma de 3% com bom volume.
   */
  app.get<{ Querystring: { days?: string } }>('/api/stats/platforms', async (req) => {
    const days = Math.min(365, Math.max(7, Number(req.query.days ?? 30)));
    const since = new Date(Date.now() - days * DAY_MS);

    const offers = await prisma.offer.findMany({
      where: { status: OfferStatus.SENT, sentAt: { gte: since } },
      include: { product: { select: { platform: true } }, shortLink: true, conversions: true },
    });

    const rows = new Map<
      Platform,
      { platform: Platform; sent: number; clicks: number; orders: number; revenue: number; gmv: number }
    >();

    for (const o of offers) {
      const key = o.product.platform;
      const row = rows.get(key) ?? { platform: key, sent: 0, clicks: 0, orders: 0, revenue: 0, gmv: 0 };
      row.sent++;
      row.clicks += o.shortLink?.clickCount ?? 0;
      row.orders += o.conversions.length;
      row.revenue += o.conversions.reduce((s, c) => s + Number(c.commissionBrl), 0);
      row.gmv += o.conversions.reduce((s, c) => s + Number(c.orderValue), 0);
      rows.set(key, row);
    }

    return [...rows.values()]
      .map((r) => ({
        ...r,
        revenue: Number(r.revenue.toFixed(2)),
        gmv: Number(r.gmv.toFixed(2)),
        revenuePerClick: r.clicks ? Number((r.revenue / r.clicks).toFixed(3)) : 0,
        revenuePerOffer: r.sent ? Number((r.revenue / r.sent).toFixed(2)) : 0,
        conversionRate: r.clicks ? Number(((r.orders / r.clicks) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  });

  /** Lancamento manual de venda, pra plataformas sem API de relatorio. */
  app.post<{
    Body: {
      platform: Platform;
      externalId: string;
      offerId?: string;
      orderValue: number;
      commissionBrl: number;
      occurredAt?: string;
      status?: string;
    };
  }>('/api/conversions', async (req) => {
    const b = req.body;
    const conversion = await prisma.conversion.upsert({
      where: { platform_externalId: { platform: b.platform, externalId: b.externalId } },
      create: {
        platform: b.platform,
        externalId: b.externalId,
        offerId: b.offerId,
        orderValue: b.orderValue,
        commissionBrl: b.commissionBrl,
        status: b.status ?? 'pending',
        occurredAt: b.occurredAt ? new Date(b.occurredAt) : new Date(),
      },
      update: {
        orderValue: b.orderValue,
        commissionBrl: b.commissionBrl,
        status: b.status ?? 'pending',
      },
    });
    return { ok: true, id: conversion.id };
  });
}
