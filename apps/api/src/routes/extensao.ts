import crypto from 'node:crypto';
import { OfferSource, Platform } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { ingestProduct } from '../services/ingest.js';
import type { NormalizedProduct } from '../connectors/types.js';

/**
 * Canal da extensao do navegador.
 *
 * Existe porque o Mercado Livre nao tem API de afiliados e bloqueia leitura de
 * fora: buscar pelo servidor devolve 39 KB de casca, sem um produto. Medido
 * tambem com Chrome headless -- 2,6 KB. Só o navegador do operador, com a
 * sessao dele, ve a pagina montada.
 *
 * Autentica por token no header, nao por cookie de sessao: a extensao fala de
 * outra origem (chrome-extension://) e nao carrega o cookie do painel.
 */

const CHAVE_TOKEN = 'extensao.token';

/** Cria o token na primeira chamada e reusa dali em diante. */
export async function tokenDaExtensao(): Promise<string> {
  const existente = await prisma.appSetting.findUnique({ where: { key: CHAVE_TOKEN } });
  if (existente) return existente.value;

  const token = crypto.randomBytes(24).toString('base64url');
  await prisma.appSetting.create({ data: { key: CHAVE_TOKEN, value: token } });
  logger.info('token da extensao gerado');
  return token;
}

async function exigeToken(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization ?? '';
  const enviado = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const esperado = await tokenDaExtensao();

  // timingSafeEqual exige buffers do mesmo tamanho.
  const a = Buffer.from(enviado);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return reply.code(401).send({ error: 'Token da extensão inválido. Copie de novo em Conexões.' });
  }
}

/**
 * O que a extensao raspa da pagina. Tudo opcional menos o essencial: pagina de
 * marketplace muda, e e melhor gravar produto com meio dado do que recusar.
 */
const produtoRaspado = z.object({
  platform: z.nativeEnum(Platform).default(Platform.MERCADO_LIVRE),
  externalId: z.string().min(3).max(40),
  title: z.string().min(3).max(400),
  canonicalUrl: z.string().url(),
  imageUrl: z.string().url().optional(),
  price: z.number().nonnegative().optional(),
  listPrice: z.number().nonnegative().optional(),
  soldCount: z.number().int().nonnegative().optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  shopName: z.string().max(160).optional(),
  couponCode: z.string().max(40).optional(),
  /** Link meli.la gerado pelo painel de afiliados, quando a extensao conseguiu. */
  affiliateUrl: z.string().url().optional(),
  /** De onde veio: pagina do produto, listagem de busca ou painel. */
  origem: z.enum(['produto', 'listagem', 'painel']).default('produto'),
});

export type ProdutoRaspado = z.infer<typeof produtoRaspado>;

function normalizar(p: ProdutoRaspado): NormalizedProduct {
  return {
    platform: p.platform,
    externalId: p.externalId,
    title: p.title,
    canonicalUrl: p.canonicalUrl,
    imageUrl: p.imageUrl,
    price: p.price,
    // Preco cheio so vale se for maior que o atual -- vendedor as vezes repete
    // o mesmo numero nos dois campos e isso viraria "0% de desconto".
    listPrice: p.listPrice && p.price && p.listPrice > p.price ? p.listPrice : undefined,
    soldCount: p.soldCount,
    rating: p.rating,
    reviewCount: p.reviewCount,
    shopName: p.shopName,
    couponCode: p.couponCode,
    available: true,
  };
}

export async function extensaoRoutes(app: FastifyInstance) {
  /** Confere token e versao. A extensao chama isso pra dizer se esta ligada. */
  app.get('/api/extensao/ping', { preHandler: exigeToken }, async () => ({
    ok: true,
    app: 'Hub Ofertas',
  }));

  /**
   * Recebe o que a extensao raspou e joga na fila de curadoria, do mesmo jeito
   * que o garimpo: nada e enviado sozinho.
   */
  app.post<{ Body: { produtos: ProdutoRaspado[] } }>(
    '/api/extensao/produtos',
    { preHandler: exigeToken },
    async (req, reply) => {
      const { produtos } = z
        .object({ produtos: z.array(produtoRaspado).min(1).max(100) })
        .parse(req.body);

      const resultado = { recebidos: produtos.length, criados: 0, repetidos: 0, falhas: [] as string[] };

      for (const bruto of produtos) {
        try {
          // Ja existe oferta aberta desse produto? Nao duplica.
          const jaTem = await prisma.product.findUnique({
            where: {
              platform_externalId: { platform: bruto.platform, externalId: bruto.externalId },
            },
            include: {
              // DISPATCHING entra pra nao recapturar um produto que esta no
              // meio de um Disparo (a oferta ainda nao saiu, so ja foi
              // reservada) -- sem isso a extensao criava uma segunda oferta
              // pro mesmo produto enquanto o disparo estava rodando.
              offers: { where: { status: { in: ['PENDING', 'QUEUED', 'DISPATCHING'] } }, take: 1 },
            },
          });
          if (jaTem?.offers.length) {
            resultado.repetidos++;
            continue;
          }

          await ingestProduct(normalizar(bruto), OfferSource.MANUAL, {
            // O meli.la do painel tem precedencia: e o unico link do ML que
            // atribui comissao de verdade. Sem ele o connector monta um com
            // matt_tool, que e o que da pra fazer sem a sessao do navegador.
            linkPronto: bruto.affiliateUrl,
          });
          resultado.criados++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ externalId: bruto.externalId, err: msg }, 'falha ao ingerir da extensao');
          resultado.falhas.push(`${bruto.externalId}: ${msg}`);
        }
      }

      logger.info(resultado, 'produtos recebidos da extensao');
      return reply.send({ ok: true, ...resultado });
    },
  );

  /**
   * Vendas confirmadas lidas do painel do ML. E o unico caminho: o programa de
   * afiliados deles nao expoe relatorio por API -- sondei nove rotas, todas 404.
   */
  app.post<{ Body: unknown }>(
    '/api/extensao/conversoes',
    { preHandler: exigeToken },
    async (req, reply) => {
      const { conversoes } = z
        .object({
          conversoes: z
            .array(
              z.object({
                externalId: z.string().min(1).max(64),
                orderValue: z.number().nonnegative(),
                commissionBrl: z.number().nonnegative(),
                status: z.string().max(40).default('pending'),
                occurredAt: z.coerce.date(),
                /** Codigo do nosso ShortLink, quando o painel mostra o sub_id. */
                clickRef: z.string().max(64).optional(),
              }),
            )
            .min(1)
            .max(500),
        })
        .parse(req.body);

      let gravadas = 0;
      for (const c of conversoes) {
        const link = c.clickRef
          ? await prisma.shortLink.findUnique({ where: { code: c.clickRef } })
          : null;

        await prisma.conversion.upsert({
          where: {
            platform_externalId: { platform: Platform.MERCADO_LIVRE, externalId: c.externalId },
          },
          create: {
            platform: Platform.MERCADO_LIVRE,
            externalId: c.externalId,
            offerId: link?.offerId ?? null,
            orderValue: c.orderValue,
            commissionBrl: c.commissionBrl,
            status: c.status,
            occurredAt: c.occurredAt,
          },
          update: { commissionBrl: c.commissionBrl, status: c.status },
        });
        gravadas++;
      }

      logger.info({ gravadas }, 'conversoes do ML recebidas da extensao');
      return reply.send({ ok: true, gravadas });
    },
  );
}

/** Rota do painel (sessao normal) que mostra o token pra colar na extensao. */
export async function extensaoAdminRoutes(app: FastifyInstance) {
  app.get('/api/extensao/token', async () => ({ token: await tokenDaExtensao() }));

  app.post('/api/extensao/token/regerar', async () => {
    const token = crypto.randomBytes(24).toString('base64url');
    await prisma.appSetting.upsert({
      where: { key: CHAVE_TOKEN },
      create: { key: CHAVE_TOKEN, value: token },
      update: { value: token },
    });
    logger.warn('token da extensao regerado -- a extensao precisa ser reconfigurada');
    return { token };
  });
}
