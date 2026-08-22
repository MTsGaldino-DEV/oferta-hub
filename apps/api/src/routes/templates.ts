import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { renderTemplate } from '../services/template.js';

const corpoTemplate = z.object({
  name: z.string().min(2, 'O nome precisa de pelo menos 2 letras.').max(60),
  body: z.string().min(1, 'O texto não pode ficar vazio.'),
  ctas: z.array(z.string().min(1).max(120)).max(20).default([]),
  showImage: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

const serialize = (t: any) => ({
  id: t.id,
  name: t.name,
  body: t.body,
  ctas: t.ctas,
  showImage: t.showImage,
  isDefault: t.isDefault,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

/** Oferta de mentira, só pra pré-visualização renderizar sem precisar de oferta real. */
const OFERTA_EXEMPLO = {
  title: 'Fone de Ouvido Bluetooth XYZ Pro',
  price: 89.9,
  comparePrice: 149.9,
  couponCode: 'PROMO10',
  link: 'https://oferta.hub/r/exemplo',
};

export async function templateRoutes(app: FastifyInstance) {
  app.get('/api/templates', async () => {
    const templates = await prisma.messageTemplate.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return templates.map(serialize);
  });

  app.post('/api/templates', async (req, reply) => {
    const body = corpoTemplate.parse(req.body);
    const existe = await prisma.messageTemplate.findUnique({ where: { name: body.name } });
    if (existe) return reply.code(409).send({ error: 'Já existe um modelo com esse nome.' });

    // Primeiro modelo do zero: já nasce padrão, senão a lista fica sem
    // nenhum pré-selecionado.
    const total = await prisma.messageTemplate.count();
    const isDefault = body.isDefault || total === 0;

    if (isDefault) {
      await prisma.messageTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    const criado = await prisma.messageTemplate.create({ data: { ...body, isDefault } });
    return reply.code(201).send(serialize(criado));
  });

  app.put<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    const body = corpoTemplate.parse(req.body);
    const atual = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } });
    if (!atual) return reply.code(404).send({ error: 'Modelo não encontrado.' });

    const outroComMesmoNome = await prisma.messageTemplate.findUnique({ where: { name: body.name } });
    if (outroComMesmoNome && outroComMesmoNome.id !== req.params.id) {
      return reply.code(409).send({ error: 'Já existe um modelo com esse nome.' });
    }

    if (body.isDefault) {
      await prisma.messageTemplate.updateMany({
        where: { isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false },
      });
    }
    const atualizado = await prisma.messageTemplate.update({ where: { id: req.params.id }, data: body });
    return serialize(atualizado);
  });

  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (req, reply) => {
    const t = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } });
    if (!t) return { ok: true };

    const emUso = await prisma.disparo.count({ where: { templateId: req.params.id } });
    if (emUso > 0) {
      return reply.code(409).send({ error: 'Esse modelo já foi usado em algum disparo e não pode ser apagado.' });
    }

    await prisma.messageTemplate.delete({ where: { id: req.params.id } });

    // Apagou o padrão: promove o mais recente que sobrou, pra sempre existir
    // um pré-selecionado enquanto houver ao menos um modelo.
    if (t.isDefault) {
      const proximo = await prisma.messageTemplate.findFirst({ orderBy: { createdAt: 'desc' } });
      if (proximo) await prisma.messageTemplate.update({ where: { id: proximo.id }, data: { isDefault: true } });
    }
    return { ok: true };
  });

  /** Renderiza um corpo (ainda não salvo) contra uma oferta de mentira, pra UI mostrar o resultado sem precisar de oferta real. */
  app.post('/api/templates/preview', async (req, reply) => {
    const body = z
      .object({ body: z.string(), ctas: z.array(z.string()).default([]) })
      .parse(req.body);
    try {
      return { text: renderTemplate(body.body, OFERTA_EXEMPLO, body.ctas) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Falha ao renderizar.' });
    }
  });
}
