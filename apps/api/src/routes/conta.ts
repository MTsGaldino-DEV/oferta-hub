import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COOKIE } from '../plugins/auth.js';
import { senhaConfere, trocarSenha } from '../plugins/senha.js';

const corpo = z.object({
  atual: z.string().min(1, 'Informe a senha atual.'),
  nova: z.string().min(8, 'A nova senha precisa de pelo menos 8 caracteres.'),
});

export async function contaRoutes(app: FastifyInstance) {
  /**
   * Troca a senha do painel. Derruba a sessao no fim: quem trocou a senha
   * espera que a antiga pare de valer em todo lugar, inclusive nesta aba.
   */
  app.post('/api/senha', async (req, reply) => {
    const { atual, nova } = corpo.parse(req.body);

    if (!(await senhaConfere(atual))) {
      await new Promise((r) => setTimeout(r, 600)); // mesmo freio do login
      return reply.code(401).send({ error: 'Senha atual incorreta.' });
    }

    if (nova === atual) {
      return reply.code(400).send({ error: 'A nova senha precisa ser diferente da atual.' });
    }

    await trocarSenha(nova);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
}
