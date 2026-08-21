import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { executarRodada } from '../services/automacoes.js';

const corpoRegra = z.object({
  name: z.string().min(2, 'O nome precisa de pelo menos 2 letras.').max(60),
  active: z.boolean().default(false),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Escolha ao menos um dia da semana.'),
  windowStart: z.string().regex(/^\d{2}:\d{2}$/, 'Horário inválido.'),
  windowEnd: z.string().regex(/^\d{2}:\d{2}$/, 'Horário inválido.'),
  // O piso e o proprio cron: runAutomacoes confere as regras a cada 5 min
  // (workers/index.ts), entao pedir menos que isso nao muda nada na pratica.
  intervalMinutes: z
    .number()
    .int()
    .min(5, 'O intervalo mínimo é 5 minutos — é de quanto em quanto tempo o sistema confere as regras.')
    .max(24 * 60, 'O intervalo máximo é 24h (1440 minutos).'),
  nicheId: z.string().nullable().optional(),
  batchSize: z.number().int().min(1, 'Pelo menos 1 produto por rodada.').max(10, 'No máximo 10 por rodada.'),
  cooldownHours: z
    .number()
    .int()
    .min(1, 'O cooldown mínimo é 1 hora.')
    .max(24 * 30, 'O cooldown máximo é 30 dias (720 horas).'),
  groupJids: z.array(z.string().min(1)).min(1, 'Escolha ao menos um grupo de destino.'),
});

const serialize = (r: any) => ({
  id: r.id,
  name: r.name,
  active: r.active,
  weekdays: r.weekdays,
  windowStart: r.windowStart,
  windowEnd: r.windowEnd,
  intervalMinutes: r.intervalMinutes,
  nicheId: r.nicheId,
  nicho: r.niche?.name ?? null,
  batchSize: r.batchSize,
  cooldownHours: r.cooldownHours,
  groupJids: r.groupJids,
  runsCount: r.runsCount,
  lastRunAt: r.lastRunAt,
  createdAt: r.createdAt,
});

export async function automacaoRoutes(app: FastifyInstance) {
  app.get('/api/automacoes', async () => {
    const regras = await prisma.automationRule.findMany({
      orderBy: { createdAt: 'desc' },
      include: { niche: true },
    });
    return regras.map(serialize);
  });

  app.post('/api/automacoes', async (req, reply) => {
    const corpo = corpoRegra.parse(req.body);
    const criada = await prisma.automationRule.create({ data: corpo, include: { niche: true } });
    return reply.code(201).send(serialize(criada));
  });

  app.put<{ Params: { id: string } }>('/api/automacoes/:id', async (req) => {
    const corpo = corpoRegra.parse(req.body);
    const atualizada = await prisma.automationRule.update({
      where: { id: req.params.id },
      data: corpo,
      include: { niche: true },
    });
    return serialize(atualizada);
  });

  app.delete<{ Params: { id: string } }>('/api/automacoes/:id', async (req, reply) => {
    await prisma.automationRule.delete({ where: { id: req.params.id } });
    return reply.code(204).send();
  });

  /**
   * Roda a regra agora, ignorando dia/janela/intervalo. Existe para testar
   * uma regra nova sem esperar a hora marcada -- ainda passa pelo cooldown e
   * pelas grades de seguranca do envio, so pula a checagem de "e a hora?".
   */
  app.post<{ Params: { id: string } }>('/api/automacoes/:id/rodar-agora', async (req, reply) => {
    const rule = await prisma.automationRule.findUnique({ where: { id: req.params.id } });
    if (!rule) return reply.code(404).send({ error: 'Regra nao encontrada.' });
    try {
      return await executarRodada(rule);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Falha ao rodar.' });
    }
  });
}
