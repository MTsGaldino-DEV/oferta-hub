import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../env.js';
import { senhaConfere } from './senha.js';

// Exportado: conta.ts precisa limpar o mesmo cookie ao trocar a senha, e uma
// segunda constante la seria uma segunda fonte da verdade pro nome do cookie.
export const COOKIE = 'oh_session';

function signToken(): string {
  const issuedAt = Date.now();
  const mac = crypto.createHmac('sha256', env.sessionSecret).update(String(issuedAt)).digest('hex');
  return `${issuedAt}.${mac}`;
}

function verifyToken(token?: string): boolean {
  if (!token) return false;
  const [issuedAt, mac] = token.split('.');
  if (!issuedAt || !mac) return false;
  const expected = crypto.createHmac('sha256', env.sessionSecret).update(issuedAt).digest('hex');
  // timingSafeEqual explode se os buffers tiverem tamanhos diferentes.
  if (mac.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  // Sessao de 30 dias.
  return Date.now() - Number(issuedAt) < 30 * 24 * 60 * 60 * 1000;
}

/** Uma senha so, cookie httpOnly. E uma ferramenta de um usuario; nao precisa de mais. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!verifyToken(req.cookies[COOKIE])) {
    return reply.code(401).send({ error: 'Sessao expirada. Entre de novo.' });
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { password?: string } }>('/api/login', async (req, reply) => {
    const given = req.body?.password ?? '';
    const ok = await senhaConfere(given);

    if (!ok) {
      await new Promise((r) => setTimeout(r, 600)); // freia tentativa em forca bruta
      return reply.code(401).send({ error: 'Senha incorreta.' });
    }

    reply.setCookie(COOKIE, signToken(), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: env.publicUrl.startsWith('https'),
      maxAge: 30 * 24 * 60 * 60,
    });
    return { ok: true };
  });

  app.post('/api/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => ({ authenticated: verifyToken(req.cookies[COOKIE]) }));
}
