# Aba Manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extensão escaneia páginas de ofertas (ML, Amazon, Shopee) e manda pra uma aba "Manual" nova no app, onde cada oferta é revisada uma por uma antes de entrar na Fila normal; toda oferta que chega a ser enviada ao grupo grava um snapshot permanente pra alimentar aprendizado futuro de palavra-chave.

**Architecture:** Um valor novo em `OfferStatus` (`SCANNED`) separa captura crua de extensão da Fila já pontuada (`PENDING`). A aba Manual lista `SCANNED`; "Mandar pra fila" promove pra `PENDING` (endpoint novo), "Descartar" reusa o `/skip` existente (`SKIPPED`). `sendOffer()` — ponto único por onde passa todo envio ao grupo — grava um `ManualSelection` (snapshot de título/preço/comissão no instante do envio) depois de marcar `SENT`. Frontend reaproveita o card `PriceTag` da Fila com rótulos trocáveis, zero componente novo. Extensão ganha um terceiro content script (`shopee.js`), mesmo padrão de `amazon.js`.

**Tech Stack:** Fastify + Prisma + Zod (API), React 18 + TypeScript + Vite (web), JS puro Manifest V3 (extensão). Sem framework de teste configurado — convenção do repo é `.check.ts`/`.check.mjs` rodável via `node`/`tsx`, sem dependência nova (ver `garimpar-merge.check.ts`, `shared.check.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-25-aba-manual-design.md`

## Global Constraints

- TypeScript com `"type": "module"` em `apps/api` e `apps/web` — imports sempre com sufixo `.js`, mesmo apontando pra um `.ts` (ex.: `from './ingest.js'`).
- `extensao/` é JS puro, sem bundler, sem TypeScript — compatível com content script Manifest V3 (nada de `import`/`export` fora de `service-worker.js`, que é `type: module`).
- Prisma é a única camada de acesso a dados — sem SQL cru fora de migrations. Mudança de schema aplica via `npm run db:push --workspace=apps/api` (repo não usa `prisma migrate`).
- Textos de UI em português, tom direto (ver copy existente da Fila/Garimpar).
- Sem dependência nova — tudo cabe no que já está instalado.
- Todo teste novo segue o padrão `.check.ts`/`.check.mjs` já usado no repo: `assert` puro do Node, sem framework, roda com `npx tsx caminho.check.ts` (API) ou `node caminho.check.mjs` (extensão).

---

## Task 1: Schema Prisma — `OfferStatus.SCANNED`, `OfferSource.SCAN`, `ManualSelection`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Depends-on:** none

**Interfaces:**
- Produces: enum values `OfferStatus.SCANNED`, `OfferSource.SCAN`; model `ManualSelection` com campos `offerId, platform, externalId, title, category, price, commissionPct, commissionBrl, source, sentAt`; relação inversa `Offer.manualSelections`.

- [ ] **Step 1: Editar o enum `OfferStatus`**

Arquivo `apps/api/prisma/schema.prisma`, linhas 19-26. Trocar:

```prisma
enum OfferStatus {
  PENDING // esperando sua analise na fila
  QUEUED // aprovada, aguardando horario (Agenda)
  DISPATCHING // reservada por um Disparo -- fora da fila ate ele terminar ou ser cancelado
  SENT
  SKIPPED
  FAILED
}
```

Por:

```prisma
enum OfferStatus {
  SCANNED // capturado por scan de extensao, aguardando revisao na aba Manual
  PENDING // esperando sua analise na fila
  QUEUED // aprovada, aguardando horario (Agenda)
  DISPATCHING // reservada por um Disparo -- fora da fila ate ele terminar ou ser cancelado
  SENT
  SKIPPED
  FAILED
}
```

- [ ] **Step 2: Editar o enum `OfferSource`**

Mesmo arquivo, linhas 28-32. Trocar:

```prisma
enum OfferSource {
  MANUAL // voce colou o link
  WATCHLIST // caiu de preco em um produto vigiado
  DISCOVERY // garimpo automatico
}
```

Por:

```prisma
enum OfferSource {
  MANUAL // voce colou o link
  SCAN // capturado por scan de extensao (ML/Amazon/Shopee)
  WATCHLIST // caiu de preco em um produto vigiado
  DISCOVERY // garimpo automatico
}
```

- [ ] **Step 3: Somar a relação inversa em `model Offer`**

Mesmo arquivo, dentro de `model Offer` (linhas 90-130), no bloco de relações. Trocar:

```prisma
  product     Product      @relation(fields: [productId], references: [id], onDelete: Cascade)
  niche       Niche?       @relation(fields: [nicheId], references: [id], onDelete: SetNull)
  shortLink   ShortLink?
  conversions Conversion[]
  disparoItems DisparoItem[]
```

Por:

```prisma
  product     Product      @relation(fields: [productId], references: [id], onDelete: Cascade)
  niche       Niche?       @relation(fields: [nicheId], references: [id], onDelete: SetNull)
  shortLink   ShortLink?
  conversions Conversion[]
  disparoItems DisparoItem[]
  manualSelections ManualSelection[]
```

- [ ] **Step 4: Criar `model ManualSelection`**

Mesmo arquivo, logo depois do fechamento de `model Conversion` (depois da linha `@@index([occurredAt])` seguida de `}`, antes de `/// Produto que voce escolheu vigiar...` / `model WatchItem`). Inserir:

```prisma
/// Foto de toda oferta que chegou a ser ENVIADA ao grupo, capturada no
/// instante do envio. Existe pra sobreviver ao Product mudando de preco com
/// o tempo -- sem isso, consultar essa base depois mostraria o preco de
/// HOJE, nao o que convenceu o envio. Alimenta a automacao futura de
/// palavra-chave/categoria (nao construida nesta fase).
model ManualSelection {
  id            String      @id @default(cuid())
  offerId       String
  platform      Platform
  externalId    String
  title         String
  category      String?
  price         Decimal     @db.Decimal(12, 2)
  commissionPct Decimal?    @db.Decimal(6, 3)
  commissionBrl Decimal?    @db.Decimal(12, 2)
  source        OfferSource
  sentAt        DateTime    @default(now())

  offer Offer @relation(fields: [offerId], references: [id])

  @@index([platform])
  @@index([sentAt])
}
```

- [ ] **Step 5: Validar e aplicar o schema**

Run: `npx prisma validate --schema apps/api/prisma/schema.prisma`
Expected: `The schema at apps/api/prisma/schema.prisma is valid 🚀`

Run: `npm run db:push --workspace=apps/api`
Expected: termina com `Your database is now in sync with your Prisma schema.` (precisa do Postgres do `docker-compose.yml` rodando — `docker compose up -d db` se não estiver).

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat(api): SCANNED/SCAN e ManualSelection no schema"
```

---

## Task 2: `ingest.ts` + `extensao.ts` — status inicial `SCANNED` e dedupe ampliado

**Files:**
- Modify: `apps/api/src/services/ingest.ts:100-160`
- Modify: `apps/api/src/routes/extensao.ts`

**Depends-on:** Task 1

**Interfaces:**
- Consumes: `OfferStatus.SCANNED`, `OfferSource.SCAN` (Task 1).
- Produces: `IngestOptions.status?: OfferStatus` — quem chama `ingestProduct`/`ingestUrl` sem passar `status` continua ganhando `PENDING`, comportamento inalterado pros outros chamadores (`ingestUrl` da Fila, `/api/offers/from-product`, garimpo).

- [ ] **Step 1: Somar `status` opcional em `IngestOptions` e usar no `create`**

Arquivo `apps/api/src/services/ingest.ts`, linhas 100-107. Trocar:

```ts
export interface IngestOptions {
  /** Texto livre que voce digita antes de enviar. */
  note?: string;
  /** Link ja encurtado pela loja, quando o operador colou um. Tem precedencia. */
  linkPronto?: string;
  /** Nicho que produziu a oferta. Deixa a fila separada por prateleira. */
  nicheId?: string;
}
```

Por:

```ts
export interface IngestOptions {
  /** Texto livre que voce digita antes de enviar. */
  note?: string;
  /** Link ja encurtado pela loja, quando o operador colou um. Tem precedencia. */
  linkPronto?: string;
  /** Nicho que produziu a oferta. Deixa a fila separada por prateleira. */
  nicheId?: string;
  /** Status inicial da oferta. Default PENDING -- a extensao usa SCANNED. */
  status?: OfferStatus;
}
```

- [ ] **Step 2: Ampliar o dedupe e passar o status pro `create`**

Mesmo arquivo, linhas 109-160 (função `ingestProduct`). Trocar:

```ts
export async function ingestProduct(
  found: NormalizedProduct,
  source: OfferSource,
  opcoes: IngestOptions = {},
): Promise<Offer> {
  const { note, linkPronto, nicheId } = opcoes;
  const connector = connectors[found.platform];
  const product = await upsertProduct(found);

  // A fila nao ganha nada com duas ofertas pendentes do mesmo produto -- so
  // duplica trabalho de revisao. So PENDING bloqueia: uma oferta ja enviada,
  // pulada ou falhada nao impede nascer uma nova (o preco pode ter caido de
  // novo). Confere antes do link de afiliado pra nao gastar chamada de API
  // da loja num clique repetido.
  const pendente = await prisma.offer.findFirst({
    where: { productId: product.id, status: OfferStatus.PENDING },
  });
  if (pendente) return pendente;
```

Por:

```ts
export async function ingestProduct(
  found: NormalizedProduct,
  source: OfferSource,
  opcoes: IngestOptions = {},
): Promise<Offer> {
  const { note, linkPronto, nicheId, status = OfferStatus.PENDING } = opcoes;
  const connector = connectors[found.platform];
  const product = await upsertProduct(found);

  // A fila nao ganha nada com duas ofertas do mesmo produto esperando
  // decisao -- so duplica trabalho de revisao. SCANNED (aguardando a aba
  // Manual) conta junto de PENDING (aguardando a Fila): os dois sao "ja tem
  // alguem revisando isso". Uma oferta ja enviada, pulada ou falhada nao
  // impede nascer uma nova (o preco pode ter caido de novo). Confere antes
  // do link de afiliado pra nao gastar chamada de API da loja num repetido.
  const pendente = await prisma.offer.findFirst({
    where: { productId: product.id, status: { in: [OfferStatus.PENDING, OfferStatus.SCANNED] } },
  });
  if (pendente) return pendente;
```

Ainda na mesma função, no `prisma.offer.create` (por volta da linha 145-160). Trocar:

```ts
  const offer = await prisma.offer.create({
    data: {
      productId: product.id,
      source,
      price,
```

Por:

```ts
  const offer = await prisma.offer.create({
    data: {
      productId: product.id,
      source,
      status,
      price,
```

- [ ] **Step 3: `extensao.ts` — importar `OfferStatus`, ampliar o dedupe, mudar source/status**

Arquivo `apps/api/src/routes/extensao.ts`, linha 2. Trocar:

```ts
import { OfferSource, Platform } from '@prisma/client';
```

Por:

```ts
import { OfferSource, OfferStatus, Platform } from '@prisma/client';
```

Mesmo arquivo, dentro do loop de `/api/extensao/produtos` (por volta das linhas 116-139). Trocar:

```ts
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
```

Por:

```ts
          const jaTem = await prisma.product.findUnique({
            where: {
              platform_externalId: { platform: bruto.platform, externalId: bruto.externalId },
            },
            include: {
              // SCANNED entra pra nao recapturar um produto ja esperando
              // revisao na aba Manual. DISPATCHING entra pra nao recapturar
              // um produto no meio de um Disparo (a oferta ainda nao saiu,
              // so ja foi reservada) -- sem isso a extensao criava uma
              // segunda oferta pro mesmo produto enquanto o disparo rodava.
              offers: { where: { status: { in: ['SCANNED', 'PENDING', 'QUEUED', 'DISPATCHING'] } }, take: 1 },
            },
          });
          if (jaTem?.offers.length) {
            resultado.repetidos++;
            continue;
          }

          await ingestProduct(normalizar(bruto), OfferSource.SCAN, {
            // O meli.la do painel tem precedencia: e o unico link do ML que
            // atribui comissao de verdade. Sem ele o connector monta um com
            // matt_tool, que e o que da pra fazer sem a sessao do navegador.
            linkPronto: bruto.affiliateUrl,
            // Nasce esperando revisao na aba Manual, nao direto na Fila --
            // e o que separa captura crua de scan de curadoria ja aprovada.
            status: OfferStatus.SCANNED,
          });
          resultado.criados++;
```

- [ ] **Step 4: Checar tipos**

Run: `npx tsc -b --pretty false` (a partir de `apps/api`, ou `cd apps/api && npx tsc -p tsconfig.json --noEmit`)
Expected: sem erro.

- [ ] **Step 5: Verificação manual do dedupe**

Com a API rodando (`npm run dev:api`) e o token da extensão em mãos (`GET /api/extensao/token`), chamar duas vezes o mesmo produto:

```bash
curl -s -X POST http://localhost:3333/api/extensao/produtos \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  --data-binary '{"produtos":[{"platform":"MERCADO_LIVRE","externalId":"teste123","title":"Produto teste","canonicalUrl":"https://produto.mercadolivre.com.br/MLB-teste123","price":99.9}]}'
```

Expected na primeira chamada: `"criados":1`. Rodando o mesmo `curl` de novo: `"repetidos":1`. Conferir no banco (`npm run db:studio --workspace=apps/api`) que a oferta criada está com `status = SCANNED` e `source = SCAN`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/ingest.ts apps/api/src/routes/extensao.ts
git commit -m "feat(api): captura de extensao nasce em SCANNED/SCAN, nao direto na fila"
```

---

## Task 3: `offers.ts` — remover hack de reordenação e somar `/promover`

**Files:**
- Modify: `apps/api/src/routes/offers.ts:56-96` (handler `GET /api/offers`)
- Modify: `apps/api/src/routes/offers.ts:307-311` (fim do arquivo, perto do `/skip`)

**Depends-on:** Task 1

**Interfaces:**
- Produces: `POST /api/offers/:id/promover` — 200 `{ ok: true }` se a oferta estava `SCANNED` (vira `PENDING`); 400 `{ error }` caso contrário; 404 se o id não existe.

- [ ] **Step 1: Simplificar `GET /api/offers`, removendo o caso especial de captura de ML**

Arquivo `apps/api/src/routes/offers.ts`, linhas 56-96. Trocar:

```ts
  /** Fila de curadoria, ordenada pela nota -- exceto captura do ML pela extensao. */
  app.get<{ Querystring: { status?: OfferStatus; limit?: string; nicheId?: string } }>(
    '/api/offers',
    async (req) => {
    const status = req.query.status ?? OfferStatus.PENDING;
    // "sem-nicho" pega o que foi colado na mao ou veio de regra por palavra.
    const nicheId = req.query.nicheId;
    const where = {
      status,
      ...(nicheId === 'sem-nicho' ? { nicheId: null } : nicheId ? { nicheId } : {}),
    };
    const include = { product: true, shortLink: true, niche: true };
    const take = Number(req.query.limit ?? 60);

    if (status !== OfferStatus.PENDING) {
      const offers = await prisma.offer.findMany({ where, include, orderBy: { createdAt: 'desc' }, take });
      return offers.map(serialize);
    }

    // A extensao ja captura na ordem de relevancia do ML -- reordenar pela
    // nota so embaralha o que ja veio pronto. Essas ficam por ordem de
    // captura, no topo; o resto da fila continua pela nota.
    const [capturaExtensao, resto] = await Promise.all([
      prisma.offer.findMany({
        where: { ...where, source: OfferSource.MANUAL, product: { platform: Platform.MERCADO_LIVRE } },
        include,
        orderBy: { createdAt: 'asc' },
        take,
      }),
      prisma.offer.findMany({
        where: {
          ...where,
          NOT: { source: OfferSource.MANUAL, product: { platform: Platform.MERCADO_LIVRE } },
        },
        include,
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take,
      }),
    ]);
    return [...capturaExtensao, ...resto].slice(0, take).map(serialize);
    },
  );
```

Por:

```ts
  /** Fila de curadoria, ordenada pela nota. */
  app.get<{ Querystring: { status?: OfferStatus; limit?: string; nicheId?: string } }>(
    '/api/offers',
    async (req) => {
    const status = req.query.status ?? OfferStatus.PENDING;
    // "sem-nicho" pega o que foi colado na mao ou veio de regra por palavra.
    const nicheId = req.query.nicheId;
    const where = {
      status,
      ...(nicheId === 'sem-nicho' ? { nicheId: null } : nicheId ? { nicheId } : {}),
    };
    const include = { product: true, shortLink: true, niche: true };
    const take = Number(req.query.limit ?? 60);

    if (status !== OfferStatus.PENDING) {
      const offers = await prisma.offer.findMany({ where, include, orderBy: { createdAt: 'desc' }, take });
      return offers.map(serialize);
    }

    const offers = await prisma.offer.findMany({
      where,
      include,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take,
    });
    return offers.map(serialize);
    },
  );
```

- [ ] **Step 2: Somar o endpoint `/promover`**

Mesmo arquivo, linhas 307-311 (fim do arquivo). Trocar:

```ts
  app.post<{ Params: { id: string } }>('/api/offers/:id/skip', async (req) => {
    await prisma.offer.update({ where: { id: req.params.id }, data: { status: OfferStatus.SKIPPED } });
    return { ok: true };
  });
}
```

Por:

```ts
  app.post<{ Params: { id: string } }>('/api/offers/:id/skip', async (req) => {
    await prisma.offer.update({ where: { id: req.params.id }, data: { status: OfferStatus.SKIPPED } });
    return { ok: true };
  });

  /** Promove da revisao da aba Manual (SCANNED) pra Fila normal (PENDING). */
  app.post<{ Params: { id: string } }>('/api/offers/:id/promover', async (req, reply) => {
    const offer = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!offer) return reply.code(404).send({ error: 'Oferta nao encontrada.' });
    if (offer.status !== OfferStatus.SCANNED) {
      return reply.code(400).send({ error: 'Essa oferta ja saiu da revisao da aba Manual.' });
    }
    await prisma.offer.update({ where: { id: offer.id }, data: { status: OfferStatus.PENDING } });
    return { ok: true };
  });
}
```

- [ ] **Step 3: Checar tipos**

Run: `cd apps/api && npx tsc -p tsconfig.json --noEmit`
Expected: sem erro. (`Platform` pode sobrar sem uso nessa rota — se o compilador reclamar de import não usado, conferir se `Platform` ainda é usado em outro handler do arquivo antes de remover o import; a busca em `offers.ts` já mostrou outros usos de `OfferSource`, então normalmente `Platform` também segue em uso no restante do arquivo.)

- [ ] **Step 4: Verificação manual**

Com a API rodando e uma oferta `SCANNED` no banco (criada no Step 5 da Task 2):

```bash
curl -s -X POST http://localhost:3333/api/offers/<id>/promover -H "Cookie: <sessao>"
```

Expected: `{"ok":true}`, e no Prisma Studio a oferta passa a `status = PENDING`. Chamar de novo no mesmo id: `400` com a mensagem de erro.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/offers.ts
git commit -m "feat(api): remove hack de reordenacao da fila, soma POST /offers/:id/promover"
```

---

## Task 4: `manual-selection.ts` — snapshot gravado no envio

**Files:**
- Create: `apps/api/src/services/manual-selection.ts`
- Create: `apps/api/src/services/manual-selection.check.ts`
- Modify: `apps/api/src/services/dispatch.ts:1-62`

**Depends-on:** Task 1

**Interfaces:**
- Produces: `buildManualSelectionData(offer: Offer, product: Product): Prisma.ManualSelectionCreateInput` — usado por `dispatch.ts`.

- [ ] **Step 1: Escrever o check (falha primeiro, arquivo ainda não existe)**

Create `apps/api/src/services/manual-selection.check.ts`:

```ts
/**
 * Self-check de buildManualSelectionData. Roda sem rede e sem banco:
 *   npx tsx apps/api/src/services/manual-selection.check.ts
 */
import assert from 'node:assert/strict';
import { OfferSource, Platform } from '@prisma/client';
import { buildManualSelectionData } from './manual-selection.js';

const offer = {
  id: 'offer_1',
  price: 129.9,
  commissionBrl: 12.5,
  source: OfferSource.SCAN,
} as any;

const product = {
  platform: Platform.SHOPEE,
  externalId: '111_222',
  title: 'Fone bluetooth',
  category: 'Eletronicos',
  commissionPct: 18.5,
} as any;

const data = buildManualSelectionData(offer, product);

assert.deepEqual(data.offer, { connect: { id: 'offer_1' } });
assert.equal(data.platform, Platform.SHOPEE);
assert.equal(data.externalId, '111_222');
assert.equal(data.title, 'Fone bluetooth');
assert.equal(data.category, 'Eletronicos');
assert.equal(data.price, 129.9);
assert.equal(data.commissionPct, 18.5);
assert.equal(data.commissionBrl, 12.5);
assert.equal(data.source, OfferSource.SCAN);

// category nula do produto (ML/Amazon nao mandam categoria) passa nula, nao quebra.
const semCategoria = buildManualSelectionData(offer, { ...product, category: null } as any);
assert.equal(semCategoria.category, null);

console.log('manual-selection.check: ok');
```

- [ ] **Step 2: Rodar o check e confirmar que falha (módulo não existe ainda)**

Run: `npx tsx apps/api/src/services/manual-selection.check.ts`
Expected: erro de módulo não encontrado (`Cannot find module './manual-selection.js'`).

- [ ] **Step 3: Criar `manual-selection.ts`**

Create `apps/api/src/services/manual-selection.ts`:

```ts
import type { Offer, Prisma, Product } from '@prisma/client';

/**
 * Foto do momento do envio, pra ManualSelection. Product muda de preco com o
 * tempo (o monitor reescreve currentPrice a cada ciclo) -- sem essa foto,
 * consultar essa base depois mostraria o preco de HOJE, nao o que convenceu
 * o envio.
 */
export function buildManualSelectionData(
  offer: Offer,
  product: Product,
): Prisma.ManualSelectionCreateInput {
  return {
    offer: { connect: { id: offer.id } },
    platform: product.platform,
    externalId: product.externalId,
    title: product.title,
    category: product.category,
    price: offer.price,
    commissionPct: product.commissionPct,
    commissionBrl: offer.commissionBrl,
    source: offer.source,
  };
}
```

- [ ] **Step 4: Rodar o check e confirmar que passa**

Run: `npx tsx apps/api/src/services/manual-selection.check.ts`
Expected: `manual-selection.check: ok`

- [ ] **Step 5: Gravar o snapshot dentro de `sendOffer()`**

Arquivo `apps/api/src/services/dispatch.ts`, linha 1-4. Trocar:

```ts
import { OfferStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { whatsapp } from '../whatsapp/baileys.js';
```

Por:

```ts
import { OfferStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';
import { whatsapp } from '../whatsapp/baileys.js';
import { buildManualSelectionData } from './manual-selection.js';
```

Mesmo arquivo, dentro de `sendOffer()` (linhas 45-56). Trocar:

```ts
  try {
    await whatsapp.sendOffer(jid, message, {
      title: offer.product.title,
      link: offer.affiliateUrl,
      imageUrl: offer.product.imageUrl,
    });
    logger.info({ offerId, jid }, 'oferta enviada');
    return prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.SENT, sentAt: new Date(), groupJid: jid, failReason: null },
    });
  } catch (err) {
```

Por:

```ts
  try {
    await whatsapp.sendOffer(jid, message, {
      title: offer.product.title,
      link: offer.affiliateUrl,
      imageUrl: offer.product.imageUrl,
    });
    logger.info({ offerId, jid }, 'oferta enviada');
    const sent = await prisma.offer.update({
      where: { id: offerId },
      data: { status: OfferStatus.SENT, sentAt: new Date(), groupJid: jid, failReason: null },
    });
    await prisma.manualSelection.create({ data: buildManualSelectionData(offer, offer.product) });
    return sent;
  } catch (err) {
```

- [ ] **Step 6: Checar tipos**

Run: `cd apps/api && npx tsc -p tsconfig.json --noEmit`
Expected: sem erro.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/manual-selection.ts apps/api/src/services/manual-selection.check.ts apps/api/src/services/dispatch.ts
git commit -m "feat(api): grava ManualSelection no instante do envio ao grupo"
```

---

## Task 5: `PriceTag.tsx` — rótulos trocáveis, editor opcional

**Files:**
- Modify: `apps/web/src/components/PriceTag.tsx`

**Depends-on:** none

**Interfaces:**
- Produces: prop nova `rotulos?: { skip: string; send: string; sendBusy: string }` (default `{ skip: 'Pular', send: 'Enviar ao grupo', sendBusy: 'Enviando...' }`); `onEdit` vira opcional — ausente, o card não abre editor (classe `card--estatico`, já existe em `styles.css` desde a aba Garimpar) e o título vira texto estático (classe `card__titulo-txt`, idem).

- [ ] **Step 1: Tornar `onEdit` opcional e somar `rotulos`**

Arquivo `apps/web/src/components/PriceTag.tsx`, linhas 1-11. Trocar:

```tsx
import { useState } from 'react';
import { brl, STORE, type Offer } from '../api.js';

interface Props {
  offer: Offer;
  /** Posicao dessa oferta na fila atual (1 = proxima a sair). */
  posicao: number;
  onSend: (id: string) => Promise<void>;
  onSkip: (id: string) => Promise<void>;
  onEdit: (offer: Offer) => void;
}
```

Por:

```tsx
import { useState } from 'react';
import { brl, STORE, type Offer } from '../api.js';

interface Rotulos {
  skip: string;
  send: string;
  sendBusy: string;
}

const ROTULOS_PADRAO: Rotulos = { skip: 'Pular', send: 'Enviar ao grupo', sendBusy: 'Enviando...' };

interface Props {
  offer: Offer;
  /** Posicao dessa oferta na fila atual (1 = proxima a sair). */
  posicao: number;
  onSend: (id: string) => Promise<void>;
  onSkip: (id: string) => Promise<void>;
  /** Sem isso o card nao abre editor de mensagem -- usado na aba Manual, onde
   *  a decisao e so mandar pra fila ou descartar. */
  onEdit?: (offer: Offer) => void;
  /** Troca o texto dos dois botoes de acao. Default e o vocabulario da Fila. */
  rotulos?: Rotulos;
}
```

- [ ] **Step 2: Desestruturar `rotulos` e usar no `article`/título**

Mesmo arquivo, na assinatura do componente e no JSX do `article`/título (por volta das linhas 28-90). Trocar:

```tsx
export function PriceTag({ offer, posicao, onSend, onSkip, onEdit }: Props) {
  const [busy, setBusy] = useState<'send' | 'skip' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [porque, setPorque] = useState(false);
```

Por:

```tsx
export function PriceTag({ offer, posicao, onSend, onSkip, onEdit, rotulos = ROTULOS_PADRAO }: Props) {
  const [busy, setBusy] = useState<'send' | 'skip' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [porque, setPorque] = useState(false);
```

Trocar o `<article>` e o bloco de título:

```tsx
    <article
      className="card"
      data-leaving={leaving}
      onClick={() => onEdit(offer)}
    >
```

Por:

```tsx
    <article
      className={`card${onEdit ? '' : ' card--estatico'}`}
      data-leaving={leaving}
      onClick={onEdit ? () => onEdit(offer) : undefined}
    >
```

Trocar:

```tsx
        <h3 className="card__titulo">
          <button
            type="button"
            className="card__titulo-btn"
            title="Ver e editar o texto da mensagem"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(offer);
            }}
          >
            {offer.product.title}
          </button>
        </h3>
```

Por:

```tsx
        <h3 className="card__titulo">
          {onEdit ? (
            <button
              type="button"
              className="card__titulo-btn"
              title="Ver e editar o texto da mensagem"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(offer);
              }}
            >
              {offer.product.title}
            </button>
          ) : (
            <span className="card__titulo-txt" title={offer.product.title}>
              {offer.product.title}
            </span>
          )}
        </h3>
```

- [ ] **Step 3: Usar `rotulos` nos dois botões de ação**

Mesmo arquivo, no bloco `card__botoes`. Trocar:

```tsx
            <button
              className="btn btn--ghost btn--alvo"
              disabled={busy !== null}
              onClick={(e) => {
                e.stopPropagation();
                void act('skip');
              }}
            >
              {busy === 'skip' ? '...' : 'Pular'}
            </button>
            <button
              className="btn btn--alvo card__enviar"
              disabled={busy !== null}
              onClick={(e) => {
                e.stopPropagation();
                void act('send');
              }}
            >
              {busy === 'send' ? 'Enviando...' : 'Enviar ao grupo'}
            </button>
```

Por:

```tsx
            <button
              className="btn btn--ghost btn--alvo"
              disabled={busy !== null}
              onClick={(e) => {
                e.stopPropagation();
                void act('skip');
              }}
            >
              {busy === 'skip' ? '...' : rotulos.skip}
            </button>
            <button
              className="btn btn--alvo card__enviar"
              disabled={busy !== null}
              onClick={(e) => {
                e.stopPropagation();
                void act('send');
              }}
            >
              {busy === 'send' ? rotulos.sendBusy : rotulos.send}
            </button>
```

- [ ] **Step 4: Checar tipos**

Run: `cd apps/web && npx tsc -b --pretty false`
Expected: sem erro.

- [ ] **Step 5: Verificar que a Fila não regrediu**

Run: `npm run dev:web` (ou `npm run dev`), abrir `/fila` no navegador com pelo menos uma oferta pendente.
Expected: cards continuam com "Pular"/"Enviar ao grupo", clique no título ainda abre o editor de mensagem (comportamento idêntico a antes).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/PriceTag.tsx
git commit -m "refactor(web): PriceTag aceita rotulos trocaveis e editor opcional"
```

---

## Task 6: Aba Manual — página, rota e menu

**Files:**
- Create: `apps/web/src/pages/Manual.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx`

**Depends-on:** Task 3, Task 5

**Interfaces:**
- Consumes: `GET /api/offers?status=SCANNED` (Task 3), `POST /api/offers/:id/promover` (Task 3), `POST /api/offers/:id/skip` (já existente), `PriceTag` com `rotulos`/`onEdit` opcional (Task 5), `Offer` de `../api.js` (já existe).

- [ ] **Step 1: Criar a página**

Create `apps/web/src/pages/Manual.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api, type Offer } from '../api.js';
import { PriceTag } from '../components/PriceTag.js';

const ROTULOS = { skip: 'Descartar', send: 'Mandar pra fila', sendBusy: 'Movendo...' };

export function Manual() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setOffers(await api.get<Offer[]>('/api/offers?status=SCANNED'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  /** Tira o card da lista depois da animacao de saida (ver .card[data-leaving]). */
  function retirar(id: string) {
    setTimeout(() => {
      setOffers((prev) => prev.filter((o) => o.id !== id));
    }, 220);
  }

  async function promover(id: string) {
    await api.post(`/api/offers/${id}/promover`);
    retirar(id);
  }

  async function descartar(id: string) {
    await api.post(`/api/offers/${id}/skip`);
    retirar(id);
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Manual</h1>
          <p>Capturas da extensão (Shopee, Amazon, Mercado Livre) esperando sua decisão, uma por uma.</p>
        </div>
        <button className="btn btn--ghost" onClick={() => void load()}>
          Atualizar
        </button>
      </div>

      {loading ? null : offers.length === 0 ? (
        <div className="empty">
          <strong>Nada pra revisar</strong>
          Escaneie uma página de ofertas com a extensão — o que ela capturar aparece aqui pra você decidir.
        </div>
      ) : (
        <div className="shelf">
          {offers.map((offer, i) => (
            <PriceTag
              key={offer.id}
              offer={offer}
              posicao={i + 1}
              onSend={promover}
              onSkip={descartar}
              rotulos={ROTULOS}
            />
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Registrar a rota**

Arquivo `apps/web/src/App.tsx`. Trocar o bloco de imports de páginas:

```tsx
import { VisaoGeral } from './pages/VisaoGeral.js';
import { Fila } from './pages/Fila.js';
import { Desempenho } from './pages/Desempenho.js';
import { MeusGrupos } from './pages/MeusGrupos.js';
import { Garimpar } from './pages/Garimpar.js';
import { Automacoes } from './pages/Automacoes.js';
import { Configuracoes } from './pages/Configuracoes.js';
```

Por:

```tsx
import { VisaoGeral } from './pages/VisaoGeral.js';
import { Fila } from './pages/Fila.js';
import { Manual } from './pages/Manual.js';
import { Desempenho } from './pages/Desempenho.js';
import { MeusGrupos } from './pages/MeusGrupos.js';
import { Garimpar } from './pages/Garimpar.js';
import { Automacoes } from './pages/Automacoes.js';
import { Configuracoes } from './pages/Configuracoes.js';
```

E o bloco de `<Routes>`. Trocar:

```tsx
        <Routes>
          <Route path="/" element={<VisaoGeral />} />
          <Route path="/fila" element={<Fila />} />
          <Route path="/desempenho" element={<Desempenho />} />
```

Por:

```tsx
        <Routes>
          <Route path="/" element={<VisaoGeral />} />
          <Route path="/fila" element={<Fila />} />
          <Route path="/manual" element={<Manual />} />
          <Route path="/desempenho" element={<Desempenho />} />
```

- [ ] **Step 3: Somar item no menu lateral**

Arquivo `apps/web/src/components/app-sidebar.tsx`, linhas 3-13 (import de ícones). Trocar:

```tsx
import {
  BarChart3,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Search,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
```

Por:

```tsx
import {
  BarChart3,
  LayoutDashboard,
  ListChecks,
  LogOut,
  ScanLine,
  Search,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
```

Linhas 34-38 (primeiro grupo de `GROUPS`). Trocar:

```tsx
  [
    { to: '/', label: 'Visão geral', end: true, icon: LayoutDashboard },
    { to: '/fila', label: 'Fila', icon: ListChecks },
  ],
```

Por:

```tsx
  [
    { to: '/', label: 'Visão geral', end: true, icon: LayoutDashboard },
    { to: '/fila', label: 'Fila', icon: ListChecks },
    { to: '/manual', label: 'Manual', icon: ScanLine },
  ],
```

- [ ] **Step 4: Checar tipos**

Run: `cd apps/web && npx tsc -b --pretty false`
Expected: sem erro.

- [ ] **Step 5: Build**

Run: `cd apps/web && npx vite build`
Expected: build termina sem erro.

- [ ] **Step 6: Verificação manual**

Com API e web rodando (`npm run dev`), abrir `/manual` no navegador.
Expected: menu lateral mostra "Manual" entre "Fila" e o resto; sem oferta `SCANNED`, mostra o estado vazio "Nada pra revisar"; com uma oferta `SCANNED` (criada na Task 2), aparece como card com botões "Descartar"/"Mandar pra fila"; clicar em "Mandar pra fila" some o card (some da aba Manual, aparece em `/fila`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/Manual.tsx apps/web/src/App.tsx apps/web/src/components/app-sidebar.tsx
git commit -m "feat(web): aba Manual pra revisar capturas de scan antes da fila"
```

---

## Task 7: `manifest.json` — permissões e content script da Shopee

**Files:**
- Modify: `extensao/manifest.json`

**Depends-on:** none

- [ ] **Step 1: Somar domínio da Shopee em `host_permissions` e `content_scripts`**

Arquivo `extensao/manifest.json`. Trocar:

```json
  "host_permissions": [
    "https://*.mercadolivre.com.br/*",
    "https://*.mercadolibre.com/*",
    "https://*.amazon.com.br/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "content_scripts": [
    {
      "matches": [
        "https://*.mercadolivre.com.br/*",
        "https://*.mercadolibre.com/*",
        "https://*.amazon.com.br/*"
      ],
      "js": ["content/shared.js", "content/ml.js", "content/amazon.js"],
      "css": ["content/ml.css"],
      "run_at": "document_idle"
    }
  ],
```

Por:

```json
  "host_permissions": [
    "https://*.mercadolivre.com.br/*",
    "https://*.mercadolibre.com/*",
    "https://*.amazon.com.br/*",
    "https://*.shopee.com.br/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "content_scripts": [
    {
      "matches": [
        "https://*.mercadolivre.com.br/*",
        "https://*.mercadolibre.com/*",
        "https://*.amazon.com.br/*",
        "https://*.shopee.com.br/*"
      ],
      "js": ["content/shared.js", "content/ml.js", "content/amazon.js", "content/shopee.js"],
      "css": ["content/ml.css"],
      "run_at": "document_idle"
    }
  ],
```

- [ ] **Step 2: Commit**

```bash
git add extensao/manifest.json
git commit -m "feat(extensao): host permission e content script da Shopee no manifest"
```

(O commit fica com `content/shopee.js` ainda não existindo até a Task 8 — sem problema: Manifest V3 só carrega o arquivo quando a extensão for recarregada, e a Task 8 é o próximo passo do mesmo plano.)

---

## Task 8: `content/shopee.js` — captura de listagem e produto

**Files:**
- Create: `extensao/content/shopee.js`
- Create: `extensao/content/shopee.check.mjs`

**Depends-on:** Task 7

**Interfaces:**
- Produces: `window.__HUB_SHOPEE = { extrairIdShopee, canonicaDeShopee }` (funções puras, testadas por `shopee.check.mjs`); ao capturar, produz objetos `{ platform: 'SHOPEE', externalId, title, canonicalUrl, imageUrl, price, listPrice, origem }` no mesmo formato que `amazon.js`/`ml.js` já produzem, consumido por `ui/panel.js` sem mudança de contrato.
- **Risco conhecido:** seletores (`CARDS`, `LINK_PRODUTO`) são a melhor aposta sem acesso a uma página real da Shopee — ver comentário no topo do arquivo. Se o widget não achar produto numa página que claramente tem, o próximo passo é inspecionar o DOM real e ajustar essas constantes.

- [ ] **Step 1: Escrever o check (falha primeiro, arquivo ainda não existe)**

Create `extensao/content/shopee.check.mjs`:

```js
// Self-check das funcoes puras de shopee.js. Roda com `node shopee.check.mjs`.
// shopee.js le window.__HUB no topo -- por isso shared.js roda primeiro,
// dentro do MESMO objeto window falso, antes de shopee.js.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const aqui = dirname(fileURLToPath(import.meta.url));
const shared = readFileSync(join(aqui, 'shared.js'), 'utf8');
const shopee = readFileSync(join(aqui, 'shopee.js'), 'utf8');

const janela = { location: { hostname: 'shopee.com.br' } };
new Function('window', shared)(janela);
new Function('window', 'document', shopee)(janela, {});
const S = janela.__HUB_SHOPEE;

// extrairIdShopee: forma com slug (-i.<shopId>.<itemId>).
assert.equal(
  S.extrairIdShopee('https://shopee.com.br/Fone-Bluetooth-i.123456.789'),
  '123456_789',
  'forma com slug',
);
// forma /product/<shopId>/<itemId>.
assert.equal(
  S.extrairIdShopee('https://shopee.com.br/product/123456/789'),
  '123456_789',
  'forma /product/',
);
// dominio errado nao casa.
assert.equal(S.extrairIdShopee('https://amazon.com.br/produto-i.1.2'), null, 'dominio errado');
// sem padrao reconhecido.
assert.equal(S.extrairIdShopee('https://shopee.com.br/busca?keyword=fone'), null, 'sem id na url');

// canonicaDeShopee: reconstroi limpo, ignora slug e query de tracking.
assert.equal(
  S.canonicaDeShopee('https://shopee.com.br/Fone-i.123456.789?sp_atk=xyz'),
  'https://shopee.com.br/product/123456/789',
  'reconstroi sem slug nem tracking',
);
assert.equal(S.canonicaDeShopee('https://shopee.com.br/busca'), null, 'sem id vira null');

console.log('shopee.check: ok');
```

- [ ] **Step 2: Rodar o check e confirmar que falha (arquivo shopee.js não existe ainda)**

Run: `node extensao/content/shopee.check.mjs`
Expected: erro (`ENOENT`, arquivo `shopee.js` não encontrado).

- [ ] **Step 3: Criar `content/shopee.js`**

Create `extensao/content/shopee.js`:

```js
/**
 * Captura de produtos da Shopee.
 *
 * SPA React com classe muitas vezes hasheada -- sem gancho semantico
 * estavel de preco/preco "de" como o ML tem. `lerPrecos` cai no fallback por
 * ESTILO (line-through computado, ver shared.js) pra achar o preco riscado;
 * o preco atual sai do fallback por TEXTO (primeiro "R$" fora do riscado).
 *
 * externalId sai como "<shopId>_<itemId>", MESMO formato que o conector
 * oficial (apps/api/src/connectors/shopee.ts) usa pra gravar Product -- sem
 * isso, um produto capturado aqui e o mesmo produto que a API oficial ja
 * trouxe pelo garimpo automatico virariam DOIS registros em vez de um.
 *
 * PRIMEIRA VERSAO SEM VALIDACAO AO VIVO: os seletores abaixo (CARDS,
 * LINK_PRODUTO, RUIDO_SHOPEE) sao a melhor aposta com base em atributos
 * conhecidos da Shopee (data-sqe), mas essa loja troca marcacao com
 * frequencia. Se o widget disser "nao encontrei produto" numa pagina que
 * claramente tem produto, o proximo passo e abrir o DevTools na pagina real
 * e ajustar essas constantes.
 */
(function (window, document) {
  'use strict';

  const H = window.__HUB;
  if (!H) return;

  const { texto, lerPrecos, extrairMelhorImagem, registrar } = H;

  function extrairIdShopee(url) {
    let u;
    try { u = new URL(String(url), 'https://shopee.com.br'); } catch { return null; }
    if (!/(^|\.)shopee\.com\.br$/i.test(u.hostname)) return null;
    let m = u.pathname.match(/-i\.(\d+)\.(\d+)/);
    if (!m) m = u.pathname.match(/\/product\/(\d+)\/(\d+)/);
    return m ? `${m[1]}_${m[2]}` : null;
  }

  /** URL limpa do produto, reconstruida do id -- ignora slug e query de tracking. */
  function canonicaDeShopee(url) {
    const id = extrairIdShopee(url);
    if (!id) return null;
    const [shopId, itemId] = id.split('_');
    return `https://shopee.com.br/product/${shopId}/${itemId}`;
  }

  // Publicado ANTES do guard de hostname, mesmo motivo do amazon.js: deixa o
  // self-check (shopee.check.mjs) testar as funcoes puras sem DOM real.
  window.__HUB_SHOPEE = { extrairIdShopee, canonicaDeShopee };

  // Este arquivo carrega em todos os dominios do manifest; daqui pra baixo
  // so roda na Shopee.
  if (!/(^|\.)shopee\.com\.br$/i.test(window.location.hostname)) return;

  /** Container de cada card na grade de listagem/busca. */
  const CARDS = '[data-sqe="item"]';
  const LINK_PRODUTO = 'a[href*="-i."], a[href*="/product/"]';
  const RUIDO_SHOPEE = ['[class*="badge" i]', '[class*="label" i]', '[class*="voucher" i]'].join(', ');

  function achaLink(card) {
    return card.querySelector(LINK_PRODUTO) || (card.matches(LINK_PRODUTO) ? card : null);
  }

  /** Titulo do card: alt da imagem primeiro, aria-label do link como reserva. */
  function extrairTitulo(card) {
    const img = card.querySelector('img[alt]');
    const alt = (img?.getAttribute('alt') || '').trim();
    if (alt.length >= 6) return alt.slice(0, 200);
    const link = achaLink(card);
    return (link?.getAttribute('aria-label') || '').trim().slice(0, 200);
  }

  const OPCOES_PRECO = { seletoresRuido: RUIDO_SHOPEE, blocos: null };

  const ehProduto = () => !!canonicaDeShopee(location.href);

  function capturarProduto() {
    const canonicalUrl = canonicaDeShopee(location.href);
    if (!canonicalUrl) return null;
    const { price, listPrice } = lerPrecos(document.body, OPCOES_PRECO);
    const titulo = texto(document.querySelector('h1')) || document.title.split('|')[0].trim();
    return {
      platform: 'SHOPEE',
      externalId: extrairIdShopee(canonicalUrl),
      title: titulo,
      canonicalUrl,
      imageUrl: extrairMelhorImagem(document.body),
      price,
      listPrice,
      origem: 'produto',
    };
  }

  /** Le os cards que estao no DOM AGORA. Chamada a cada parada do autoscroll. */
  function varrerListagem(acc) {
    for (const card of document.querySelectorAll(CARDS)) {
      const link = achaLink(card);
      const canonicalUrl = link ? canonicaDeShopee(link.getAttribute('href')) : null;
      if (!canonicalUrl) continue;
      const id = extrairIdShopee(canonicalUrl);

      registrar(acc, id, () => {
        const { price, listPrice } = lerPrecos(card, OPCOES_PRECO);
        return {
          platform: 'SHOPEE',
          externalId: id,
          title: extrairTitulo(card),
          canonicalUrl,
          imageUrl: extrairMelhorImagem(card),
          price,
          listPrice,
          origem: 'listagem',
        };
      });
    }
    return acc.produtos.size;
  }

  /**
   * Mesmo formato/chave do lib/log.js (service worker e painel), mas
   * duplicado aqui: content script nao roda como modulo ES.
   */
  async function registrarLog(nivel, mensagem) {
    try {
      const { logs = [] } = await chrome.storage.local.get('logs');
      logs.push({ ts: Date.now(), origem: 'pagina', nivel, texto: String(mensagem) });
      if (logs.length > 300) logs.splice(0, logs.length - 300);
      await chrome.storage.local.set({ logs });
    } catch { /* sem storage, so nao aparece no painel */ }
  }

  function montar() {
    if (document.getElementById('hubofertas-widget')) return;
    const produto = ehProduto();
    if (!produto && !document.querySelector(CARDS)) return;

    H.montarWidget({
      loja: 'Shopee',
      rotulo: produto ? 'Capturar produto' : 'Capturar esta busca',
      async aoCapturar({ progresso, pronto, erro }) {
        const produtos = produto
          ? [capturarProduto()].filter((p) => p && p.title)
          : await H.rolarAcumulando(varrerListagem, { aoProgredir: progresso });

        if (!produtos.length) {
          erro('Não encontrei produto nesta página.');
          return;
        }
        await chrome.storage.local.set({ captura_pendente: { produtos, criadoEm: Date.now() } });
        void registrarLog('info', `${produtos.length} produto(s) capturado(s) da Shopee -- nada foi enviado ainda.`);
        pronto(produtos.length);
      },
    });
  }

  // A Shopee e SPA e troca a grade sem recarregar (filtro, paginacao,
  // navegacao entre categorias) -- o widget e remontado quando o DOM muda.
  montar();
  new MutationObserver(montar).observe(document.documentElement, { childList: true, subtree: true });

  // O painel lateral pede essa leitura sozinho ao trocar de aba e a cada
  // "Atualizar". Leitura PASSIVA do que ja esta na tela.
  chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
    if (msg?.tipo !== 'raspar') return;
    if (ehProduto()) {
      responder({ ok: true, produtos: [capturarProduto()].filter((p) => p && p.title) });
    } else {
      const acc = H.novoAcumulador();
      varrerListagem(acc);
      responder({ ok: true, produtos: [...acc.produtos.values()] });
    }
    return true;
  });
})(window, document);
```

- [ ] **Step 4: Rodar o check e confirmar que passa**

Run: `node extensao/content/shopee.check.mjs`
Expected: `shopee.check: ok`

- [ ] **Step 5: Verificação manual (com iteração de seletor esperada)**

Recarregar a extensão em `chrome://extensions`, abrir a página de "ofertas relâmpago" da Shopee, verificar se o widget aparece no canto e se "Capturar esta busca" traz produtos no painel lateral.
Expected — dois cenários possíveis, ambos aceitáveis nesta task: (a) captura funciona de primeira; (b) widget mostra "Não encontrei produto nesta página" — nesse caso, abrir o DevTools na página real, achar o atributo/classe atual do card e do preço, e ajustar `CARDS`/`LINK_PRODUTO`/`OPCOES_PRECO` neste arquivo antes do commit final desta task.

- [ ] **Step 6: Commit**

```bash
git add extensao/content/shopee.js extensao/content/shopee.check.mjs
git commit -m "feat(extensao): captura da Shopee (ofertas relampago)"
```

---

## Task 9: `ui/panel.js` + `ui/panel.html` — Shopee na lista de lojas suportadas

**Files:**
- Modify: `extensao/ui/panel.js`
- Modify: `extensao/ui/panel.html`

**Depends-on:** Task 8

- [ ] **Step 1: Somar Shopee em `LOJAS` e `NOME_LOJA`**

Arquivo `extensao/ui/panel.js`, linhas 71-79. Trocar:

```js
const LOJAS = [
  { teste: /(^|\/\/)([^/]*\.)?mercadoli(vre|bre)\.com(\.br)?\//i, nome: 'Mercado Livre' },
  { teste: /(^|\/\/)([^/]*\.)?amazon\.com\.br\//i, nome: 'Amazon' },
];

const ehPaginaSuportada = (url) => LOJAS.some((l) => l.teste.test(url || ''));

/** Enum do backend -> nome que o humano reconhece. */
const NOME_LOJA = { MERCADO_LIVRE: 'Mercado Livre', AMAZON: 'Amazon' };
```

Por:

```js
const LOJAS = [
  { teste: /(^|\/\/)([^/]*\.)?mercadoli(vre|bre)\.com(\.br)?\//i, nome: 'Mercado Livre' },
  { teste: /(^|\/\/)([^/]*\.)?amazon\.com\.br\//i, nome: 'Amazon' },
  { teste: /(^|\/\/)([^/]*\.)?shopee\.com\.br\//i, nome: 'Shopee' },
];

const ehPaginaSuportada = (url) => LOJAS.some((l) => l.teste.test(url || ''));

/** Enum do backend -> nome que o humano reconhece. */
const NOME_LOJA = { MERCADO_LIVRE: 'Mercado Livre', AMAZON: 'Amazon', SHOPEE: 'Shopee' };
```

- [ ] **Step 2: Atualizar a mensagem de "fora da loja"**

Arquivo `extensao/ui/panel.html`, linha 19. Trocar:

```html
    Abra um produto ou uma busca do Mercado Livre ou da Amazon nesta aba para capturar.
```

Por:

```html
    Abra um produto ou uma busca do Mercado Livre, da Amazon ou da Shopee nesta aba para capturar.
```

- [ ] **Step 3: Verificação manual**

Recarregar a extensão, abrir uma página da Shopee, clicar no ícone da extensão pra abrir o painel lateral.
Expected: painel mostra a área de captura (não a mensagem de "fora da loja"); item capturado da Shopee aparece na lista com o selo "Shopee".

- [ ] **Step 4: Commit**

```bash
git add extensao/ui/panel.js extensao/ui/panel.html
git commit -m "feat(extensao): Shopee reconhecida no painel lateral"
```

---

## Verificação de ponta a ponta (depois de todas as tasks)

1. `npm run build` na raiz — API e web compilam sem erro.
2. Escanear uma busca de Mercado Livre ou Amazon com a extensão, enviar pro Hub, conferir que a oferta aparece em `/manual` (não em `/fila`).
3. Clicar "Mandar pra fila" num card do Manual — card some do Manual, aparece em `/fila` com `status=PENDING`.
4. Na Fila, clicar "Enviar ao grupo" nessa oferta (precisa de WhatsApp conectado) — conferir no Prisma Studio que surgiu uma linha em `ManualSelection` com o título/preço daquele produto.
5. Escanear a mesma página de novo — produto já capturado não duplica no Manual (`repetidos` no retorno do painel).
