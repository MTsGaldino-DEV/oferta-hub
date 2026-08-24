import type { FastifyInstance } from 'fastify';
import { DisparoItemStatus } from '@prisma/client';
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

    const [groups, addCounts, removeCounts, oldestEvents, offerSends, disparoSends] =
      await Promise.all([
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
        // Exclui oferta que ja tem item de disparo SENT -- envio em massa
        // grava as duas linhas (Offer.sentAt e DisparoItem.sentAt) para a
        // mesma mensagem, e sem esse exists:false o total dobra.
        prisma.offer.groupBy({
          by: ['groupJid'],
          where: {
            groupJid: { not: null },
            sentAt: { gte: since },
            disparoItems: { none: { status: DisparoItemStatus.SENT } },
          },
          _count: true,
        }),
        prisma.disparoItem.groupBy({
          by: ['groupJid'],
          where: { status: DisparoItemStatus.SENT, sentAt: { gte: since } },
          _count: true,
        }),
      ]);

    const addByJid = new Map(addCounts.map((c) => [c.groupJid, c._count]));
    const removeByJid = new Map(removeCounts.map((c) => [c.groupJid, c._count]));
    const oldestByJid = new Map(oldestEvents.map((c) => [c.groupJid, c._min.occurredAt]));

    // Uma mensagem chega ao grupo por dois caminhos: envio avulso da Fila
    // (Offer.groupJid) e envio em massa (DisparoItem.groupJid). Contar so um
    // deles daria um numero que nao bate com o que o usuario viu no WhatsApp.
    const sentByJid = new Map<string, number>();
    for (const c of offerSends) {
      if (c.groupJid) sentByJid.set(c.groupJid, (sentByJid.get(c.groupJid) ?? 0) + c._count);
    }
    for (const c of disparoSends) {
      sentByJid.set(c.groupJid, (sentByJid.get(c.groupJid) ?? 0) + c._count);
    }

    const linhas = groups.map((g) => ({
      jid: g.jid,
      name: g.name,
      memberCount: g.memberCount,
      joined: addByJid.get(g.jid) ?? 0,
      left: removeByJid.get(g.jid) ?? 0,
      trackingSince: oldestByJid.get(g.jid) ?? null,
      sent: sentByJid.get(g.jid) ?? 0,
    }));

    return {
      days,
      groups: linhas,
      totais: {
        grupos: linhas.length,
        membros: linhas.reduce((n, g) => n + (g.memberCount ?? 0), 0),
        // Soma o que foi para os grupos conhecidos. Envio para um grupo que
        // saiu da lista nao entra na conta -- o numero e "o que os seus grupos
        // receberam", nao "o que a instalacao disparou".
        enviadas: linhas.reduce((n, g) => n + g.sent, 0),
      },
    };
  });
}
