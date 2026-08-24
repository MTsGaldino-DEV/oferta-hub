import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function groupRoutes(app: FastifyInstance) {
  /**
   * Contagem atual de membros + entradas/saidas no periodo, por grupo.
   *
   * `trackingSince`: data do evento mais antigo logado pro grupo (todo o
   * historico, nao so o periodo pedido), ou null se nunca logou nada. O log
   * de GroupMemberEvent so comeca a acumular a partir do deploy dessa
   * feature -- entrada/saida antes disso e desconhecida, nao zero. O front
   * usa esse campo pra avisar isso em vez de mostrar "0 entradas" como se
   * fosse um fato sobre um periodo que a gente nunca mediu.
   */
  app.get<{ Querystring: { days?: string } }>('/api/groups', async (req) => {
    const days = Math.min(180, Math.max(1, Number(req.query.days ?? 30)));
    const since = new Date(Date.now() - days * DAY_MS);

    const [groups, addCounts, removeCounts, oldestEvents] = await Promise.all([
      prisma.whatsappGroup.findMany({ orderBy: { name: 'asc' } }),
      prisma.groupMemberEvent.groupBy({
        by: ['groupJid'],
        where: { action: 'ADD', occurredAt: { gte: since } },
        _count: true,
      }),
      prisma.groupMemberEvent.groupBy({
        by: ['groupJid'],
        where: { action: 'REMOVE', occurredAt: { gte: since } },
        _count: true,
      }),
      prisma.groupMemberEvent.groupBy({
        by: ['groupJid'],
        _min: { occurredAt: true },
      }),
    ]);

    const addByJid = new Map(addCounts.map((c) => [c.groupJid, c._count]));
    const removeByJid = new Map(removeCounts.map((c) => [c.groupJid, c._count]));
    const oldestByJid = new Map(oldestEvents.map((c) => [c.groupJid, c._min.occurredAt]));

    return {
      days,
      groups: groups.map((g) => ({
        jid: g.jid,
        name: g.name,
        memberCount: g.memberCount,
        joined: addByJid.get(g.jid) ?? 0,
        left: removeByJid.get(g.jid) ?? 0,
        trackingSince: oldestByJid.get(g.jid) ?? null,
      })),
    };
  });
}
