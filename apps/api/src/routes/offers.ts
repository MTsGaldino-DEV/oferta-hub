import { OfferSource, OfferStatus, Platform } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, num } from '../db.js';
import { ingestUrl } from '../services/ingest.js';
import { sendOffer } from '../services/dispatch.js';
import { renderMessage } from '../services/message.js';
import { lowestPrice } from '../services/scoring.js';
import { agruparSimilares } from '../services/similaridade.js';
import { connectors, connectorList } from '../connectors/index.js';
import type { NormalizedProduct } from '../connectors/types.js';
import { ingestProduct } from '../services/ingest.js';
import { env } from '../env.js';

/** Cada item da busca e ou um produto, ou o erro da plataforma que falhou. */
type SearchHit =
  | (NormalizedProduct & { ok: true })
  | { platform: Platform; error: string; ok: false };

const serialize = (o: any) => ({
  id: o.id,
  status: o.status,
  source: o.source,
  score: o.score,
  scoreReasons: o.scoreReasons ?? [],
  price: num(o.price),
  comparePrice: num(o.comparePrice),
  discountPct: num(o.discountPct),
  commissionBrl: num(o.commissionBrl),
  message: o.message,
  couponCode: o.couponCode,
  affiliateUrl: o.affiliateUrl,
  nicheId: o.nicheId,
  nicho: o.niche?.name ?? null,
  shortCode: o.shortLink?.code ?? null,
  clicks: o.shortLink?.clickCount ?? 0,
  scheduledFor: o.scheduledFor,
  sentAt: o.sentAt,
  failReason: o.failReason,
  createdAt: o.createdAt,
  product: {
    id: o.product.id,
    title: o.product.title,
    imageUrl: o.product.imageUrl,
    platform: o.product.platform,
    canonicalUrl: o.product.canonicalUrl,
    rating: num(o.product.rating),
    reviewCount: o.product.reviewCount,
    soldCount: o.product.soldCount,
    commissionPct: num(o.product.commissionPct),
  },
});

export async function offerRoutes(app: FastifyInstance) {
  /** Fila de curadoria, ordenada pela nota. */
  app.get<{ Querystring: { status?: OfferStatus; limit?: string; nicheId?: string } }>(
    '/api/offers',
    async (req) => {
    const status = req.query.status ?? OfferStatus.PENDING;
    // "sem-nicho" pega o que foi colado na mao ou veio de regra por palavra.
    const nicheId = req.query.nicheId;
    const offers = await prisma.offer.findMany({
      where: {
        status,
        ...(nicheId === 'sem-nicho' ? { nicheId: null } : nicheId ? { nicheId } : {}),
      },
      include: { product: true, shortLink: true, niche: true },
      orderBy: status === OfferStatus.PENDING ? [{ score: 'desc' }, { createdAt: 'desc' }] : { createdAt: 'desc' },
      take: Number(req.query.limit ?? 60),
    });
    return offers.map(serialize);
    },
  );

  /** Quantas ofertas cada nicho tem parada na fila. Alimenta as abas. */
  app.get<{ Querystring: { status?: OfferStatus } }>('/api/offers/por-nicho', async (req) => {
    const status = req.query.status ?? OfferStatus.PENDING;
    const grupos = await prisma.offer.groupBy({
      by: ['nicheId'],
      where: { status },
      _count: { _all: true },
    });

    const ids = grupos.map((g) => g.nicheId).filter((id): id is string => Boolean(id));
    const nichos = await prisma.niche.findMany({ where: { id: { in: ids } } });
    const nomeDe = new Map(nichos.map((n) => [n.id, n.name]));

    return grupos
      .map((g) => ({
        nicheId: g.nicheId ?? 'sem-nicho',
        nome: g.nicheId ? (nomeDe.get(g.nicheId) ?? 'Nicho apagado') : 'Sem nicho',
        total: g._count._all,
      }))
      .sort((a, b) => b.total - a.total);
  });

  /**
   * Colapsa anuncios repetidos que ja estao na fila, ficando com o mais barato
   * de cada produto. O resto vai pra SKIPPED -- nao apaga, so tira da frente.
   *
   * Existe porque o dedup entrou depois: a fila acumulou seis "Pen Drives
   * Cruzer" e quatro "Mini Game Retro" antes dele.
   */
  app.post<{ Body: { limiar?: number } }>('/api/offers/limpar-duplicados', async (req) => {
    const { limiar } = z.object({ limiar: z.number().min(0.4).max(1).optional() }).parse(req.body ?? {});

    const pendentes = await prisma.offer.findMany({
      where: { status: OfferStatus.PENDING },
      include: { product: true },
    });

    const grupos = agruparSimilares(
      pendentes.map((o) => ({ id: o.id, title: o.product.title, price: Number(o.price) })),
      limiar,
    );

    const cortar = grupos.flatMap((g) => g.repetidos.map((r) => r.id));
    if (cortar.length) {
      await prisma.offer.updateMany({
        where: { id: { in: cortar } },
        data: { status: OfferStatus.SKIPPED },
      });
    }

    return {
      ok: true,
      antes: pendentes.length,
      depois: pendentes.length - cortar.length,
      cortadas: cortar.length,
      exemplos: grupos
        .filter((g) => g.repetidos.length > 0)
        .slice(0, 8)
        .map((g) => ({
          ficou: g.escolhido.title,
          preco: g.escolhido.price,
          repetidos: g.repetidos.length,
        })),
    };
  });

  /** Modo manual: voce cola o link, o sistema faz o resto. */
  app.post<{ Body: { url: string; note?: string } }>('/api/offers', async (req, reply) => {
    const { url, note } = z.object({ url: z.string().url(), note: z.string().max(400).optional() }).parse(req.body);
    try {
      const offer = await ingestUrl(url, OfferSource.MANUAL, { note });
      const full = await prisma.offer.findUnique({
        where: { id: offer.id },
        include: { product: true, shortLink: true, niche: true },
      });
      return serialize(full);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'falha ao capturar a oferta' });
    }
  });

  /** Busca direta nas plataformas conectadas, pra garimpar na hora. */
  app.get<{ Querystring: { q: string; platform?: Platform } }>('/api/search', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return reply.code(400).send({ error: 'Digite pelo menos 2 caracteres.' });

    const targets = req.query.platform ? [connectors[req.query.platform]] : connectorList;
    const results = await Promise.allSettled(targets.map((c) => c.search({ keyword: q, limit: 8 })));

    return results.flatMap<SearchHit>((r, i) =>
      r.status === 'fulfilled'
        ? r.value.map((p) => ({ ...p, ok: true as const }))
        : [{ platform: targets[i].platform, error: String(r.reason?.message ?? r.reason), ok: false as const }],
    );
  });

  /** Transforma um resultado de busca em oferta na fila. */
  app.post<{ Body: { platform: Platform; externalId: string } }>('/api/offers/from-product', async (req, reply) => {
    const { platform, externalId } = z
      .object({ platform: z.nativeEnum(Platform), externalId: z.string() })
      .parse(req.body);
    const found = await connectors[platform].getProduct(externalId);
    if (!found) return reply.code(404).send({ error: 'Produto nao encontrado na API da loja.' });
    const offer = await ingestProduct(found, OfferSource.MANUAL);
    const full = await prisma.offer.findUnique({
      where: { id: offer.id },
      include: { product: true, shortLink: true },
    });
    return serialize(full);
  });

  /** Editar o texto antes de mandar. */
  app.patch<{ Params: { id: string }; Body: { message?: string; couponCode?: string } }>(
    '/api/offers/:id',
    async (req) => {
      const body = z
        .object({ message: z.string().max(4000).optional(), couponCode: z.string().max(40).nullish() })
        .parse(req.body);
      const offer = await prisma.offer.update({
        where: { id: req.params.id },
        data: { message: body.message, couponCode: body.couponCode ?? undefined },
        include: { product: true, shortLink: true, niche: true },
      });
      return serialize(offer);
    },
  );

  /** Regenerar o texto a partir do template, se voce editou demais e quer voltar. */
  app.post<{ Params: { id: string }; Body: { note?: string; anuncio?: boolean } }>(
    '/api/offers/:id/rebuild',
    async (req) => {
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { product: true, shortLink: true, niche: true },
    });
    const message = renderMessage({
      platform: offer.product.platform,
      title: offer.product.title,
      price: Number(offer.price),
      comparePrice: num(offer.comparePrice),
      discountPct: num(offer.discountPct),
      lowest: await lowestPrice(offer.productId),
      couponCode: offer.couponCode,
      link: offer.affiliateUrl,
      note: req.body?.note,
      anuncio: req.body?.anuncio ?? false,
    });
    const updated = await prisma.offer.update({
      where: { id: offer.id },
      data: { message },
      include: { product: true, shortLink: true, niche: true },
    });
    return serialize(updated);
    },
  );

  app.post<{ Params: { id: string }; Body: { groupJid?: string } }>('/api/offers/:id/send', async (req, reply) => {
    try {
      const offer = await sendOffer(req.params.id, req.body?.groupJid);
      return { ok: true, sentAt: offer.sentAt };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'falha no envio' });
    }
  });

  app.post<{ Params: { id: string }; Body: { when: string; groupJid?: string } }>(
    '/api/offers/:id/schedule',
    async (req) => {
      const { when, groupJid } = z.object({ when: z.string(), groupJid: z.string().optional() }).parse(req.body);
      await prisma.offer.update({
        where: { id: req.params.id },
        data: { status: OfferStatus.QUEUED, scheduledFor: new Date(when), groupJid },
      });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>('/api/offers/:id/skip', async (req) => {
    await prisma.offer.update({ where: { id: req.params.id }, data: { status: OfferStatus.SKIPPED } });
    return { ok: true };
  });
}
