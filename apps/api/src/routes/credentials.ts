import { Platform } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { decrypt, maskSecret } from '../lib/crypto.js';
import { connectorList, connectors, saveCredentials, invalidateCache } from '../connectors/index.js';

export async function credentialRoutes(app: FastifyInstance) {
  /** Catalogo de plataformas + estado atual de cada credencial. */
  app.get('/api/platforms', async () => {
    const saved = await prisma.credential.findMany();

    return connectorList.map((c) => {
      const row = saved.find((s) => s.platform === c.platform);
      let preview: Record<string, string> = {};

      if (row) {
        const bag = JSON.parse(decrypt(row.payload)) as Record<string, string>;
        preview = Object.fromEntries(
          c.fields.map((f) => [f.name, bag[f.name] ? (f.secret ? maskSecret(bag[f.name]) : bag[f.name]) : '']),
        );
      }

      return {
        platform: c.platform,
        label: c.label,
        fields: c.fields,
        connected: Boolean(row?.active),
        lastCheck: row?.lastCheck ?? null,
        lastError: row?.lastError ?? null,
        preview,
      };
    });
  });

  app.put<{ Params: { platform: Platform }; Body: Record<string, string> }>(
    '/api/platforms/:platform',
    async (req, reply) => {
      const platform = z.nativeEnum(Platform).parse(req.params.platform);
      const connector = connectors[platform];

      const bag: Record<string, string> = {};
      for (const field of connector.fields) {
        const value = req.body?.[field.name];
        // Campo secreto em branco = manter o valor que ja esta salvo.
        if (typeof value === 'string' && value.trim()) bag[field.name] = value.trim();
      }

      const existing = await prisma.credential.findUnique({ where: { platform } });
      const merged = existing ? { ...(JSON.parse(decrypt(existing.payload)) as object), ...bag } : bag;

      await saveCredentials(platform, merged as Record<string, string>, connector.label);
      invalidateCache(platform);
      return reply.send({ ok: true });
    },
  );

  /** Bate na API de verdade e guarda o resultado, pra voce ver o que esta quebrado. */
  app.post<{ Params: { platform: Platform } }>('/api/platforms/:platform/test', async (req, reply) => {
    const platform = z.nativeEnum(Platform).parse(req.params.platform);
    try {
      await connectors[platform].testCredentials();
      await prisma.credential.update({
        where: { platform },
        data: { lastCheck: new Date(), lastError: null },
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erro desconhecido';
      await prisma.credential
        .update({ where: { platform }, data: { lastCheck: new Date(), lastError: message } })
        .catch(() => undefined);
      return reply.code(400).send({ ok: false, error: message });
    }
  });

  app.delete<{ Params: { platform: Platform } }>('/api/platforms/:platform', async (req) => {
    const platform = z.nativeEnum(Platform).parse(req.params.platform);
    await prisma.credential.delete({ where: { platform } }).catch(() => undefined);
    invalidateCache(platform);
    return { ok: true };
  });
}
