import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { whatsapp } from '../whatsapp/baileys.js';

export async function whatsappRoutes(app: FastifyInstance) {
  app.get('/api/whatsapp/status', async () => {
    const groups = await prisma.whatsappGroup.findMany({ orderBy: { name: 'asc' } });
    return {
      status: whatsapp.status,
      qr: whatsapp.qrDataUrl,
      me: whatsapp.me,
      quota: await whatsapp.quotaToday(),
      groups,
    };
  });

  app.post('/api/whatsapp/connect', async () => {
    await whatsapp.connect();
    return { status: whatsapp.status };
  });

  app.post('/api/whatsapp/logout', async () => {
    await whatsapp.logout();
    return { ok: true };
  });

  app.post('/api/whatsapp/sync-groups', async (_req, reply) => {
    try {
      await whatsapp.syncGroups();
      return { ok: true, groups: await prisma.whatsappGroup.findMany({ orderBy: { name: 'asc' } }) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'falha ao sincronizar' });
    }
  });

  app.post<{ Body: { jid: string } }>('/api/whatsapp/default-group', async (req) => {
    const { jid } = z.object({ jid: z.string() }).parse(req.body);
    await prisma.whatsappGroup.updateMany({ data: { isDefault: false } });
    await prisma.whatsappGroup.update({ where: { jid }, data: { isDefault: true } });
    return { ok: true };
  });
}
