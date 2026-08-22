import { Platform } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { connectors } from '../connectors/index.js';

const query = z.object({
  categoryId: z.coerce.number().int().positive(),
  sort: z.enum(['relevancia', 'vendas', 'comissao', 'menor-preco', 'desconto']).default('vendas'),
  limit: z.coerce.number().int().min(1).max(60).default(40),
});

export async function garimparRoutes(app: FastifyInstance) {
  /** Navega os produtos de uma categoria da Shopee, direto na API de busca ao vivo. */
  app.get<{ Querystring: { categoryId?: string; sort?: string; limit?: string } }>(
    '/api/garimpar/produtos',
    async (req, reply) => {
      const { categoryId, sort, limit } = query.parse(req.query);

      try {
        const produtos = await connectors[Platform.SHOPEE].search({ categoryId, sort, limit });

        const cat = await prisma.category.findUnique({
          where: { platform_externalId: { platform: Platform.SHOPEE, externalId: categoryId } },
        });

        return {
          ok: true,
          categoria: cat?.nameBr ?? null,
          produtos: produtos.map((p) => ({
            externalId: p.externalId,
            platform: p.platform,
            title: p.title,
            imageUrl: p.imageUrl,
            price: p.price,
            listPrice: p.listPrice,
            commissionPct: p.commissionPct,
            soldCount: p.soldCount,
            rating: p.rating,
          })),
        };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Busca falhou.' });
      }
    },
  );
}
