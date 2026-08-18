import { Platform } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, num } from '../db.js';
import { detectPlatform } from '../connectors/index.js';
import { NICHOS_SHOPEE } from '../connectors/nichos.js';
import { upsertProduct } from '../services/ingest.js';

export async function watchRoutes(app: FastifyInstance) {
  /** Produtos vigiados + historico recente pro grafico. */
  app.get('/api/watch', async () => {
    const items = await prisma.watchItem.findMany({
      include: {
        product: {
          include: {
            snapshots: { orderBy: { takenAt: 'desc' }, take: 90 },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return items.map((w) => ({
      id: w.id,
      active: w.active,
      targetPrice: num(w.targetPrice),
      minDropPct: num(w.minDropPct),
      lastFiredAt: w.lastFiredAt,
      product: {
        id: w.product.id,
        title: w.product.title,
        imageUrl: w.product.imageUrl,
        platform: w.product.platform,
        canonicalUrl: w.product.canonicalUrl,
        currentPrice: num(w.product.currentPrice),
      },
      history: w.product.snapshots
        .map((s) => ({ price: num(s.price), at: s.takenAt }))
        .reverse(),
    }));
  });

  /** Adicionar produto a vigilancia colando a URL. */
  app.post<{ Body: { url: string; targetPrice?: number; minDropPct?: number } }>(
    '/api/watch',
    async (req, reply) => {
      const body = z
        .object({
          url: z.string().url(),
          targetPrice: z.number().positive().optional(),
          minDropPct: z.number().min(1).max(90).default(10),
        })
        .parse(req.body);

      const connector = detectPlatform(body.url);
      if (!connector) return reply.code(400).send({ error: 'Loja nao reconhecida nesse link.' });

      const externalId = connector.parseId(body.url);
      if (!externalId) return reply.code(400).send({ error: 'Nao achei o codigo do produto na URL.' });

      const found = await connector.getProduct(externalId);
      if (!found) return reply.code(404).send({ error: 'Produto nao encontrado na API da loja.' });

      const product = await upsertProduct(found);
      const watch = await prisma.watchItem.upsert({
        where: { productId: product.id },
        create: { productId: product.id, targetPrice: body.targetPrice, minDropPct: body.minDropPct },
        update: { targetPrice: body.targetPrice, minDropPct: body.minDropPct, active: true },
      });
      return { ok: true, id: watch.id };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/watch/:id', async (req) => {
    await prisma.watchItem.delete({ where: { id: req.params.id } }).catch(() => undefined);
    return { ok: true };
  });

  /** Regras do garimpo automatico. */
  app.get('/api/discovery', async () => {
    const rules = await prisma.discoveryRule.findMany({
      orderBy: { createdAt: 'desc' },
      include: { niche: true },
    });
    return rules.map((r) => ({
      ...r,
      niche: undefined,
      nicho: r.niche?.name ?? NICHOS_SHOPEE.find((n) => n.id === r.categoryId)?.label ?? null,
      maxPrice: num(r.maxPrice),
      minDiscount: num(r.minDiscount),
      minCommission: num(r.minCommission),
    }));
  });

  /** Nichos que o seletor da tela oferece, por plataforma. */
  app.get('/api/discovery/nichos', async () => NICHOS_SHOPEE);

  app.post<{
    Body: {
      platform: Platform;
      categoryId?: number;
      keyword?: string;
      maxPrice?: number;
      minDiscount?: number;
      minCommission?: number;
    };
  }>('/api/discovery', async (req, reply) => {
    const body = z
      .object({
        platform: z.nativeEnum(Platform),
        nicheId: z.string().optional(),
        categoryId: z.number().int().positive().optional(),
        keyword: z.string().min(2).max(80).optional(),
        maxPrice: z.number().positive().optional(),
        minDiscount: z.number().min(0).max(95).default(20),
        minCommission: z.number().min(0).max(50).default(0),
      })
      .parse(req.body);

    // Uma regra sem nicho, sem categoria e sem palavra nao tem o que buscar.
    if (!body.nicheId && !body.categoryId && !body.keyword) {
      return reply.code(400).send({ error: 'Escolha um nicho ou digite uma palavra-chave.' });
    }

    const rule = await prisma.discoveryRule.create({ data: body });
    return { ok: true, id: rule.id };
  });

  app.delete<{ Params: { id: string } }>('/api/discovery/:id', async (req) => {
    await prisma.discoveryRule.delete({ where: { id: req.params.id } }).catch(() => undefined);
    return { ok: true };
  });
}
