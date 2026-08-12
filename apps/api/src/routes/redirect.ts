import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { hashIp } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

/**
 * Rota publica de redirecionamento. E ela que mede cliques por oferta --
 * a metrica numero 1 do dashboard. Fica fora do /api de proposito: sem
 * autenticacao e sem cookie de sessao.
 */
export async function redirectRoutes(app: FastifyInstance) {
  app.get<{ Params: { code: string } }>('/r/:code', async (req, reply) => {
    const link = await prisma.shortLink.findUnique({ where: { code: req.params.code } });

    if (!link) {
      return reply.code(404).type('text/html').send('<h1>Link expirado</h1><p>Essa oferta saiu do ar.</p>');
    }

    // Redireciona primeiro, contabiliza depois: o clique nunca deve esperar o banco.
    reply.redirect(302, link.targetUrl);

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip;
    void prisma
      .$transaction([
        prisma.click.create({
          data: {
            shortLinkId: link.id,
            ipHash: ip ? hashIp(ip) : null,
            userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
            referer: String(req.headers.referer ?? '').slice(0, 300) || null,
          },
        }),
        prisma.shortLink.update({ where: { id: link.id }, data: { clickCount: { increment: 1 } } }),
      ])
      .catch((err) => logger.error({ err }, 'falha ao registrar clique'));
  });
}
