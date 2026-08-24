import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { env } from './env.js';
import { prisma } from './db.js';
import { logger } from './lib/logger.js';
import { authRoutes, requireAuth } from './plugins/auth.js';
import { automacaoRoutes } from './routes/automacoes.js';
import { contaRoutes } from './routes/conta.js';
import { credentialRoutes } from './routes/credentials.js';
import { disparoRoutes } from './routes/disparos.js';
import { extensaoRoutes, extensaoAdminRoutes } from './routes/extensao.js';
import { garimparRoutes } from './routes/garimpar.js';
import { groupRoutes } from './routes/groups.js';
import { nichoRoutes } from './routes/nichos.js';
import { offerRoutes } from './routes/offers.js';
import { redirectRoutes } from './routes/redirect.js';
import { statsRoutes } from './routes/stats.js';
import { templateRoutes } from './routes/templates.js';
import { watchRoutes } from './routes/watch.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { semearTemplates } from './services/templates-prontos.js';
import { startWorkers, runCategorySync, runDiscovery, runPriceMonitor } from './workers/index.js';
import { whatsapp } from './whatsapp/baileys.js';

const app = Fastify({ logger: false, trustProxy: true });

// Precisa vir ANTES de qualquer plugin/rota: o Fastify amarra o handler de
// erro a cada rota no momento em que ela e registrada, nao dinamicamente --
// declarado depois (como estava), nenhuma rota do app usava esse handler, e
// todo erro sempre caia no formato cru do Fastify (500, corpo com o dump
// interno do Zod ou do Prisma). Confirmado isolando com uma rota que so
// lanca erro: so passou a cair aqui depois de mover para cima do register().
app.setErrorHandler((error, _req, reply) => {
  if (error instanceof ZodError) {
    const primeira = error.issues[0];
    const campo = primeira?.path.join('.');
    const msg = campo ? `${campo}: ${primeira.message}` : primeira?.message ?? 'Dados invalidos.';
    return reply.code(400).send({ error: msg });
  }

  logger.error({ err: error.message, stack: error.stack }, 'erro na requisicao');
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply.code(status).send({ error: status === 500 ? 'Algo quebrou no servidor. Veja os logs.' : error.message });
});

await app.register(cookie);
await app.register(cors, {
  // A extensao do navegador fala de chrome-extension://<id>, que muda a cada
  // instalacao -- por isso o esquema e liberado inteiro. Ela nao usa cookie:
  // autentica por token no header, entao liberar a origem nao abre sessao.
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl, healthcheck, mesma origem
    if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
      return cb(null, true);
    }
    const permitidas =
      process.env.NODE_ENV === 'production' ? [env.publicUrl] : ['http://localhost:5173'];
    cb(null, permitidas.includes(origin));
  },
  credentials: true,
});

app.get('/health', async () => ({ ok: true, whatsapp: whatsapp.status }));

// Publico: o link curto precisa abrir sem login.
await app.register(redirectRoutes);
await app.register(authRoutes);

// A extensao autentica por token no header, nao por cookie -- fica fora do
// bloco de sessao.
await app.register(extensaoRoutes);

// Tudo abaixo exige sessao.
await app.register(async (instance) => {
  instance.addHook('onRequest', requireAuth);
  await instance.register(automacaoRoutes);
  await instance.register(contaRoutes);
  await instance.register(credentialRoutes);
  await instance.register(disparoRoutes);
  await instance.register(extensaoAdminRoutes);
  await instance.register(garimparRoutes);
  await instance.register(groupRoutes);
  await instance.register(nichoRoutes);
  await instance.register(offerRoutes);
  await instance.register(statsRoutes);
  await instance.register(templateRoutes);
  await instance.register(watchRoutes);
  await instance.register(whatsappRoutes);

  // Disparo manual dos workers, pra testar sem esperar o cron.
  // Espera terminar e devolve o resumo: sem isso o clique e indistinguivel de
  // nada acontecer quando a lista esta vazia ou a plataforma recusa.
  instance.post('/api/jobs/price-monitor', async () => ({ ok: true, ...(await runPriceMonitor()) }));
  instance.post('/api/jobs/discovery', async () => ({ ok: true, ...(await runDiscovery()) }));
  instance.post('/api/jobs/category-sync', async () => ({ ok: true, ...(await runCategorySync()) }));
});

async function main() {
  await prisma.$connect();
  await semearTemplates();
  await app.listen({ port: env.port, host: '0.0.0.0' });
  logger.info(`API no ar em ${env.publicUrl} (porta ${env.port})`);

  startWorkers();

  // Se ja existe sessao salva em disco, reconecta o WhatsApp sozinho no boot.
  void whatsapp.connect().catch((err) => logger.warn({ err: String(err) }, 'WhatsApp nao reconectou'));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    logger.info('encerrando...');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error({ err }, 'falha ao subir a API');
  process.exit(1);
});
