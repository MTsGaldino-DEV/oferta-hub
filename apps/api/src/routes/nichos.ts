import { Platform } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { buscarPorNicho, carregarNicho } from '../services/nichos.js';
import { runCategorySync } from '../workers/index.js';

const termos = z.array(z.string().max(60)).max(40).default([]);

const corpoNicho = z.object({
  platform: z.nativeEnum(Platform).default(Platform.SHOPEE),
  name: z.string().min(2).max(60),
  minSales: z.number().int().min(0).max(100_000).default(0),
  excludeTerms: termos,
  entries: z
    .array(
      z.object({
        categoryId: z.number().int().positive(),
        requireTerms: termos,
      }),
    )
    .min(1, 'Um nicho precisa de pelo menos uma categoria.')
    .max(40),
});

export async function nichoRoutes(app: FastifyInstance) {
  /** Catalogo de categorias, em arvore. `q` filtra por nome. */
  app.get<{ Querystring: { platform?: Platform; q?: string } }>('/api/categorias', async (req) => {
    const platform = req.query.platform ?? Platform.SHOPEE;
    const todas = await prisma.category.findMany({
      where: { platform },
      orderBy: [{ itemCount: 'desc' }],
    });

    const busca = (req.query.q ?? '').trim().toLowerCase();
    const bate = (c: (typeof todas)[number]) =>
      !busca || c.nameBr.toLowerCase().includes(busca) || c.nameEn.toLowerCase().includes(busca);

    const raizes = todas.filter((c) => c.parentId === null);
    return raizes
      .map((raiz) => {
        const filhas = todas.filter((c) => c.parentId === raiz.externalId);
        // A raiz aparece se ela mesma bate, ou se alguma filha bate.
        const filhasVisiveis = bate(raiz) ? filhas : filhas.filter(bate);
        return {
          id: raiz.externalId,
          nome: raiz.nameBr,
          nomeEn: raiz.nameEn,
          itens: raiz.itemCount,
          filhas: filhasVisiveis.map((f) => ({
            id: f.externalId,
            nome: f.nameBr,
            nomeEn: f.nameEn,
            itens: f.itemCount,
          })),
        };
      })
      .filter((r) => r.filhas.length > 0 || bate({ nameBr: r.nome, nameEn: r.nomeEn } as any));
  });

  /** Recolhe o catalogo na hora, sem esperar o cron de segunda. */
  app.post('/api/categorias/sync', async (_req, reply) => {
    try {
      return { ok: true, ...(await runCategorySync()) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'falha ao colher categorias' });
    }
  });

  app.get('/api/nichos', async () => {
    const nichos = await prisma.niche.findMany({
      include: { entries: true, _count: { select: { rules: true } } },
      orderBy: [{ builtIn: 'desc' }, { name: 'asc' }],
    });

    // Nome das categorias numa consulta so, em vez de uma por entrada.
    const ids = nichos.flatMap((n) => n.entries.map((e) => e.categoryId));
    const cats = await prisma.category.findMany({ where: { externalId: { in: ids } } });
    const nomeDe = new Map(cats.map((c) => [c.externalId, c.nameBr]));

    return nichos.map((n) => ({
      id: n.id,
      platform: n.platform,
      name: n.name,
      minSales: n.minSales,
      excludeTerms: n.excludeTerms,
      builtIn: n.builtIn,
      active: n.active,
      regras: n._count.rules,
      entries: n.entries.map((e) => ({
        categoryId: e.categoryId,
        nome: nomeDe.get(e.categoryId) ?? `Categoria ${e.categoryId}`,
        requireTerms: e.requireTerms,
      })),
    }));
  });

  app.post('/api/nichos', async (req, reply) => {
    const body = corpoNicho.parse(req.body);
    const existe = await prisma.niche.findUnique({
      where: { platform_name: { platform: body.platform, name: body.name } },
    });
    if (existe) return reply.code(409).send({ error: 'Ja existe um nicho com esse nome.' });

    const nicho = await prisma.niche.create({
      data: {
        platform: body.platform,
        name: body.name,
        minSales: body.minSales,
        excludeTerms: body.excludeTerms,
        entries: { create: body.entries },
      },
    });
    return { ok: true, id: nicho.id };
  });

  app.put<{ Params: { id: string } }>('/api/nichos/:id', async (req, reply) => {
    const body = corpoNicho.parse(req.body);
    const nicho = await prisma.niche.findUnique({ where: { id: req.params.id } });
    if (!nicho) return reply.code(404).send({ error: 'Nicho nao encontrado.' });

    // Troca o conjunto inteiro de categorias: e mais simples e mais previsivel
    // do que casar entrada por entrada, e o volume e pequeno.
    await prisma.$transaction([
      prisma.nicheCategory.deleteMany({ where: { nicheId: nicho.id } }),
      prisma.niche.update({
        where: { id: nicho.id },
        data: {
          name: body.name,
          minSales: body.minSales,
          excludeTerms: body.excludeTerms,
          entries: { create: body.entries },
        },
      }),
    ]);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/nichos/:id', async (req, reply) => {
    const nicho = await prisma.niche.findUnique({ where: { id: req.params.id } });
    if (!nicho) return { ok: true };
    if (nicho.builtIn) {
      return reply.code(400).send({ error: 'Nicho que vem pronto nao e apagavel. Voce pode editar ou desativar.' });
    }
    await prisma.niche.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  /**
   * Prova do nicho: roda a busca e devolve o que passou, com o placar por
   * categoria. E aqui que voce ve se o recorte esta pegando lixo antes de
   * deixar uma regra rodando sozinha.
   */
  app.post<{
    Params: { id: string };
    Body: { maxPrice?: number; minCommissionPct?: number; keySeller?: boolean };
  }>('/api/nichos/:id/testar', async (req, reply) => {
    const nicho = await carregarNicho(req.params.id);
    if (!nicho) return reply.code(404).send({ error: 'Nicho nao encontrado.' });

    const { maxPrice, minCommissionPct, keySeller } = z
      .object({
        maxPrice: z.number().positive().optional(),
        minCommissionPct: z.number().min(0).max(100).optional(),
        keySeller: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const { achados, resumo } = await buscarPorNicho(nicho, {
      maxPrice,
      minCommissionPct,
      keySeller,
      porCategoria: 50,
    });

    const cats = await prisma.category.findMany({
      where: { externalId: { in: resumo.porCategoria.map((c) => c.categoryId) } },
    });
    const nomeDe = new Map(cats.map((c) => [c.externalId, c.nameBr]));

    return {
      ok: true,
      bruto: resumo.bruto,
      aceitos: resumo.aceitos,
      repetidos: resumo.repetidos,
      porCategoria: resumo.porCategoria.map((c) => ({
        ...c,
        nome: nomeDe.get(c.categoryId) ?? `Categoria ${c.categoryId}`,
      })),
      produtos: achados.slice(0, 40).map((a) => ({
        externalId: a.produto.externalId,
        platform: a.produto.platform,
        title: a.produto.title,
        imageUrl: a.produto.imageUrl,
        price: a.produto.price,
        listPrice: a.produto.listPrice,
        commissionPct: a.produto.commissionPct,
        sellerCommissionPct: a.produto.sellerCommissionPct ?? null,
        commissionBrl: a.produto.commissionBrl ?? null,
        soldCount: a.produto.soldCount,
        rating: a.produto.rating,
        categoryId: a.categoryId,
        categoria: nomeDe.get(a.categoryId) ?? null,
      })),
    };
  });
}
