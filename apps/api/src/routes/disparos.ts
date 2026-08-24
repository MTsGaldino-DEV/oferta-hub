import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { criarDisparo, cancelarDisparo } from '../services/disparo.js';

const corpoDisparo = z
  .object({
    // Dedupe aqui, nao so na UI: ["G1","G1"] geraria dois pares (oferta,
    // grupo) identicos e mandaria a mesma mensagem duas vezes pro mesmo
    // grupo. Simetrico pra offerIds pelo mesmo motivo.
    offerIds: z
      .array(z.string().min(1))
      .min(1, 'Escolha ao menos uma oferta.')
      .transform((a) => [...new Set(a)]),
    templateId: z.string().min(1, 'Escolha um modelo de mensagem.'),
    groupJids: z
      .array(z.string().min(1))
      .min(1, 'Escolha ao menos um grupo de destino.')
      .transform((a) => [...new Set(a)]),
    startNow: z.boolean(),
    scheduledFor: z.string().datetime().optional(),
    // Piso de 5min e regra de negocio, nao so de UI -- e o que impede um
    // disparo de virar rajada mesmo se alguem forcar a chamada da API.
    intervalMinutes: z.number().int().min(5, 'O intervalo minimo e 5 minutos.'),
    avoidNightHours: z.boolean().default(true),
    avoidWeekends: z.boolean().default(false),
    skipExpiredOffers: z.boolean().default(false),
  })
  .refine((b) => b.startNow || b.scheduledFor, {
    message: 'Escolha "Agora" ou uma data para agendar.',
    path: ['scheduledFor'],
  })
  .refine((b) => b.startNow || new Date(b.scheduledFor!).getTime() > Date.now(), {
    // Uma data no passado faz todo item nascer "vencido" e o disparo drenar
    // a fila inteira de uma vez -- ver o gate de intervalMinutes em disparo.ts.
    message: 'A data agendada precisa ser no futuro.',
    path: ['scheduledFor'],
  });

function progresso(items: { status: string }[]) {
  const total = items.length;
  const enviados = items.filter((i) => i.status === 'SENT').length;
  const falharam = items.filter((i) => i.status === 'FAILED').length;
  return { total, enviados, falharam, pendentes: total - enviados - falharam };
}

/** Ultimo horario ainda pendente -- serve de estimativa de termino. */
function estimativaFim(items: { status: string; scheduledFor: Date }[]) {
  const pendentes = items.filter((i) => i.status === 'PENDING');
  if (!pendentes.length) return null;
  return pendentes.reduce((max, i) => (i.scheduledFor > max ? i.scheduledFor : max), pendentes[0].scheduledFor);
}

const serialize = (d: any) => ({
  id: d.id,
  status: d.status,
  templateId: d.templateId,
  templateName: d.template?.name ?? null,
  groupJids: d.groupJids,
  startAt: d.startAt,
  intervalMinutes: d.intervalMinutes,
  avoidNightHours: d.avoidNightHours,
  avoidWeekends: d.avoidWeekends,
  skipExpiredOffers: d.skipExpiredOffers,
  createdAt: d.createdAt,
  cancelledAt: d.cancelledAt,
  ...progresso(d.items),
  estimatedFinish: estimativaFim(d.items),
});

const serializeItem = (i: any) => ({
  id: i.id,
  offerId: i.offerId,
  offerTitle: i.offer?.product?.title ?? null,
  groupJid: i.groupJid,
  status: i.status,
  scheduledFor: i.scheduledFor,
  sentAt: i.sentAt,
  failReason: i.failReason,
});

export async function disparoRoutes(app: FastifyInstance) {
  app.get('/api/disparos', async () => {
    const disparos = await prisma.disparo.findMany({
      orderBy: { createdAt: 'desc' },
      include: { template: true, items: true },
    });
    return disparos.map(serialize);
  });

  app.get<{ Params: { id: string } }>('/api/disparos/:id', async (req, reply) => {
    const disparo = await prisma.disparo.findUnique({
      where: { id: req.params.id },
      include: {
        template: true,
        items: { include: { offer: { include: { product: true } } }, orderBy: { scheduledFor: 'asc' } },
      },
    });
    if (!disparo) return reply.code(404).send({ error: 'Disparo nao encontrado.' });
    return { ...serialize(disparo), items: disparo.items.map(serializeItem) };
  });

  app.post('/api/disparos', async (req, reply) => {
    const body = corpoDisparo.parse(req.body);
    try {
      const disparo = await criarDisparo(body);
      return reply.code(201).send(serialize(disparo));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Falha ao criar o disparo.' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/disparos/:id/cancelar', async (req, reply) => {
    try {
      await cancelarDisparo(req.params.id);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Falha ao cancelar.' });
    }
  });
}
