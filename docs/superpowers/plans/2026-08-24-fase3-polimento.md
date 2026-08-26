# Fase 3 — Polimento: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar as três telas de uso diário — Fila, Meus Grupos e Desempenho — no formato que o usuário pediu: formulário que não ocupa espaço, botões que respondem, cartões de grupo com indicadores, e uma tabela de ofertas que pagina, ordena e põe o dinheiro pendente no topo.

**Architecture:** Nenhuma alteração de schema Prisma. Dois endpoints ganham dados que já existiam no banco mas nunca foram somados (`Offer.groupJid` e `DisparoItem.groupJid` para envios por grupo; `Conversion.status` para comissão pendente). O resto é frontend: um accordion, CSS de hover, uma grade de cartões, controles de página e um tooltip em SVG.

**Tech Stack:** Node 20+, TypeScript ESM, Fastify 4, Prisma 5, Zod 3, React 18, Vite, Tailwind + CSS custom em `styles.css`.

**Spec:** `docs/superpowers/specs/2026-08-24-fase3-polimento-design.md`

## Global Constraints

- Ambos os workspaces são ESM (`"type": "module"`). Todo import relativo termina em `.js`, mesmo apontando para `.ts`/`.tsx`. Import sem extensão quebra em runtime.
- Validação de entrada da API sempre com Zod.
- Prisma é a única camada de dados. **Nenhuma alteração em `apps/api/prisma/schema.prisma`.**
- Nenhuma dependência nova.
- Todo texto de interface e toda mensagem de erro em português do Brasil.
- Comentários explicam **por quê**, não o quê, e são escritos **sem acentuação** — padrão do repositório. A regra vale **só para comentário**: strings visíveis ao usuário mantêm os acentos.
- O amarelo da marca é `var(--brand)`; ganho é `var(--gain)`, perda/erro é `var(--drop)`. Não inventar cor nova nem trocar a paleta.
- Classes CSS já existentes, a reusar em vez de inventar: `head`, `panel`, `panel__title`, `field`, `row`, `split`, `btn`, `btn--ghost`, `btn--sm`, `btn--alvo`, `chip`, `notice`, `empty`, `tabs`, `tabs__item`, `table`, `num`, `cell-product`, `shelf`, `kpis`, `kpi`.
- Não existe runner de testes. A verificação é `npm run build` mais scripts `.check.ts` rodados com `npx tsx`.
- Commits em português, no formato Conventional Commits.

## Fatos do dado real (medidos, não supostos)

- `Conversion.status` é **texto livre** vindo da Shopee, com caixa inconsistente. No banco do usuário existem hoje `approved` (minúsculo) e `CANCELLED` (maiúsculo); o default do schema é `pending` (minúsculo). Qualquer comparação precisa normalizar a caixa.
- "Comissão pendente" é definido **por exclusão**: não é aprovada nem cancelada. Definir por inclusão perderia rótulos novos que a Shopee venha a usar, e nesse caso o certo é a linha aparecer como pendente, não sumir.
- `Offer.groupJid` e `DisparoItem.groupJid` existem e guardam o grupo de destino. `SendLog` é contador global por dia e **não** serve para contagem por grupo.
- `GET /api/stats/offers` hoje filtra `status: SENT` e ordena por cliques no final, ignorando o `orderBy` do Prisma.
- O card da Fila (`apps/web/src/components/PriceTag.tsx`) **não** exibe a mensagem da oferta.

---

### Task 1: Envios por grupo e indicadores em `/api/groups`

**Files:**
- Modify: `apps/api/src/routes/groups.ts`

**Interfaces:**
- Produces: `GET /api/groups?days=N` passa a devolver, além do que já devolve:
  - cada item de `groups` ganha `sent: number`
  - novo bloco `totais: { grupos: number; membros: number; enviadas: number }`
- Consumes: models `WhatsappGroup`, `GroupMemberEvent`, `Offer`, `DisparoItem` — todos já existentes.

**Depends-on:** none.

- [ ] **Step 1: Somar os envios das duas origens**

Uma mensagem chega a um grupo por dois caminhos, e os dois precisam contar:

- `Offer` com `groupJid` preenchido e `sentAt` dentro do período — é o envio manual da Fila e o do worker.
- `DisparoItem` com `groupJid` preenchido e `sentAt` dentro do período — é o envio em massa.

Antes de escrever, confirme no schema qual o valor de status que marca item de disparo enviado (o enum é `DisparoItemStatus`) e se `Offer` usa `sentAt` como você espera. Não assuma os nomes.

Em `apps/api/src/routes/groups.ts`, acrescentar duas consultas ao `Promise.all` existente:

```ts
      prisma.offer.groupBy({
        by: ['groupJid'],
        where: { groupJid: { not: null }, sentAt: { gte: since } },
        _count: true,
      }),
      prisma.disparoItem.groupBy({
        by: ['groupJid'],
        where: { sentAt: { gte: since } },
        _count: true,
      }),
```

E montar o mapa somando as duas origens:

```ts
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
```

O `if (c.groupJid)` existe porque `Offer.groupJid` é anulável e o `groupBy` o tipa como `string | null`, mesmo com o `where` filtrando nulos.

- [ ] **Step 2: Acrescentar `sent` e `totais` à resposta**

```ts
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
```

- [ ] **Step 3: Compilar**

Run: `npm run build --workspace @oferta-hub/api`
Expected: sem erro de tipo. Se `groupBy` reclamar do tipo de `groupJid`, é o caso anulável do Step 1.

- [ ] **Step 4: Conferir contra o banco real**

Rebuild da API no Docker (`docker compose build api && docker compose up -d api`, esperando `curl -s http://127.0.0.1:3333/health`).

Compare o que a rota devolve com uma contagem feita direto no banco:

```bash
docker compose exec -T db psql -U oferta -d ofertahub -t -A -F' | ' -c "
select g.name,
  (select count(*) from \"Offer\" o where o.\"groupJid\" = g.jid and o.\"sentAt\" > now() - interval '30 days') as por_offer,
  (select count(*) from \"DisparoItem\" d where d.\"groupJid\" = g.jid and d.\"sentAt\" > now() - interval '30 days') as por_disparo
from \"WhatsappGroup\" g;"
```

A soma das duas colunas por grupo tem que bater com o `sent` da rota. Se não bater, o `where` está diferente do que a consulta acima assume — investigue antes de seguir.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/groups.ts
git commit -m "feat(api): /api/groups devolve envios por grupo e totais do periodo"
```

---

### Task 2: Ordenação, paginação e comissão pendente em `/api/stats/offers`

**Files:**
- Create: `apps/api/src/routes/stats-offers.ts`
- Create: `apps/api/src/routes/stats-offers.check.ts`
- Modify: `apps/api/src/routes/stats.ts`

**Interfaces:**
- Produces:
  - `type LinhaOferta` — a linha serializada, com o campo novo `pendente: boolean`.
  - `ordenar(linhas: LinhaOferta[], coluna: Coluna, direcao: 'asc' | 'desc'): LinhaOferta[]`
  - `type Coluna = 'pendente' | 'sentAt' | 'clicks' | 'orders' | 'revenue' | 'price' | 'score'`
  - `GET /api/stats/offers?days=&page=&sort=&dir=` devolvendo `{ linhas, total, pageInfo: { page, porPagina, hasNextPage } }`
- Consumes: models `Offer`, `Product`, `ShortLink`, `Conversion`.

**Depends-on:** none. (Não conflita com a Task 1: arquivos diferentes.)

- [ ] **Step 1: Escrever o self-check que falha**

A ordenação é a única lógica nova com risco real, e é pura — testa sem banco.

Criar `apps/api/src/routes/stats-offers.check.ts`:

```ts
/**
 * Self-check da ordenacao das ofertas enviadas. Roda sem banco e sem rede:
 *   npx tsx apps/api/src/routes/stats-offers.check.ts
 *
 * O que precisa valer: pendente vem primeiro no modo padrao, cada coluna
 * ordena nos dois sentidos, e linha sem dado nao sobe artificialmente na
 * lista. A regra de "pendente" e por exclusao, entao um status que a Shopee
 * inventar amanha tem que continuar caindo em pendente.
 */
import assert from 'node:assert/strict';
import { ehPendente, ordenar, type LinhaOferta } from './stats-offers.js';

const l = (id: string, extra: Partial<LinhaOferta> = {}): LinhaOferta => ({
  id,
  title: id,
  imageUrl: null,
  platform: 'SHOPEE',
  price: 0,
  discountPct: 0,
  score: 0,
  sentAt: new Date('2026-01-01'),
  clicks: 0,
  orders: 0,
  revenue: 0,
  conversionRate: 0,
  pendente: false,
  ...extra,
});

// "Pendente" e por exclusao, e ignora a caixa: o banco real tem `approved`
// minusculo e `CANCELLED` maiusculo vindos da mesma API.
assert.equal(ehPendente(['approved']), false);
assert.equal(ehPendente(['APPROVED']), false);
assert.equal(ehPendente(['CANCELLED']), false);
assert.equal(ehPendente(['cancelled']), false);
assert.equal(ehPendente(['pending']), true);
assert.equal(ehPendente(['PENDING']), true);
assert.equal(ehPendente(['algo_que_a_shopee_inventou']), true, 'status novo conta como pendente');
assert.equal(ehPendente([]), false, 'sem venda nenhuma nao e comissao pendente');
assert.equal(ehPendente(['approved', 'pending']), true, 'basta uma pendente');

// Padrao: pendente primeiro, e dentro do grupo o mais recente na frente.
const porPadrao = ordenar(
  [
    l('velha-ok', { sentAt: new Date('2026-01-10') }),
    l('nova-pendente', { sentAt: new Date('2026-01-20'), pendente: true }),
    l('velha-pendente', { sentAt: new Date('2026-01-05'), pendente: true }),
  ],
  'pendente',
  'desc',
);
assert.deepEqual(porPadrao.map((x) => x.id), ['nova-pendente', 'velha-pendente', 'velha-ok']);

// Cada coluna ordena nos dois sentidos.
const cliques = [l('a', { clicks: 5 }), l('b', { clicks: 90 }), l('c', { clicks: 40 })];
assert.deepEqual(ordenar(cliques, 'clicks', 'desc').map((x) => x.id), ['b', 'c', 'a']);
assert.deepEqual(ordenar(cliques, 'clicks', 'asc').map((x) => x.id), ['a', 'c', 'b']);

const receita = [l('x', { revenue: 1.5 }), l('y', { revenue: 30 })];
assert.deepEqual(ordenar(receita, 'revenue', 'desc').map((x) => x.id), ['y', 'x']);
assert.deepEqual(ordenar(receita, 'revenue', 'asc').map((x) => x.id), ['x', 'y']);

const datas = [l('antiga', { sentAt: new Date('2026-01-01') }), l('recente', { sentAt: new Date('2026-02-01') })];
assert.deepEqual(ordenar(datas, 'sentAt', 'desc').map((x) => x.id), ['recente', 'antiga']);
assert.deepEqual(ordenar(datas, 'sentAt', 'asc').map((x) => x.id), ['antiga', 'recente']);

// sentAt nulo nao pode ir pro topo de uma ordem decrescente.
const comNulo = ordenar(
  [l('sem-data', { sentAt: null }), l('com-data', { sentAt: new Date('2026-01-01') })],
  'sentAt',
  'desc',
);
assert.deepEqual(comNulo.map((x) => x.id), ['com-data', 'sem-data']);

// Ordenar nao muda o tamanho da lista nem perde item.
assert.equal(ordenar(cliques, 'orders', 'desc').length, 3);
assert.deepEqual(ordenar([], 'clicks', 'desc'), []);

console.log('stats-offers.check: ok');
```

- [ ] **Step 2: Rodar o check e ver falhar**

Run: `npx tsx apps/api/src/routes/stats-offers.check.ts`
Expected: FALHA com `Cannot find module` apontando para `./stats-offers.js`.

- [ ] **Step 3: Escrever o módulo**

Criar `apps/api/src/routes/stats-offers.ts`:

```ts
export interface LinhaOferta {
  id: string;
  title: string;
  imageUrl: string | null;
  platform: string;
  price: number;
  discountPct: number;
  score: number;
  sentAt: Date | null;
  clicks: number;
  orders: number;
  revenue: number;
  conversionRate: number;
  /** Tem venda cuja comissao a loja ainda nao liberou. */
  pendente: boolean;
}

export type Coluna = 'pendente' | 'sentAt' | 'clicks' | 'orders' | 'revenue' | 'price' | 'score';
export type Direcao = 'asc' | 'desc';

/** Status que a loja ja resolveu. Comparado sem caixa: a Shopee mistura. */
const RESOLVIDOS = new Set(['approved', 'cancelled']);

/**
 * Pendente por exclusao, nao por inclusao: se a Shopee inventar um rotulo
 * novo, a linha tem que aparecer como pendente em vez de sumir da conta.
 */
export function ehPendente(statusDasVendas: string[]): boolean {
  return statusDasVendas.some((s) => !RESOLVIDOS.has(s.trim().toLowerCase()));
}

const tempo = (d: Date | null) => (d ? d.getTime() : Number.NEGATIVE_INFINITY);

/** Nota de cada coluna: maior nota primeiro quando a direcao e `desc`. */
const NOTA: Record<Coluna, (l: LinhaOferta) => number> = {
  pendente: (l) => (l.pendente ? 1 : 0),
  sentAt: (l) => tempo(l.sentAt),
  clicks: (l) => l.clicks,
  orders: (l) => l.orders,
  revenue: (l) => l.revenue,
  price: (l) => l.price,
  score: (l) => l.score,
};

/**
 * Ordena a lista inteira. Precisa ser sobre o conjunto todo, nao sobre a
 * pagina: ordenar so o que esta na tela responderia a pergunta errada.
 *
 * Na coluna `pendente` o desempate e pela data mais recente -- duas linhas
 * pendentes tem a mesma nota, e sem desempate a ordem viria do banco.
 */
export function ordenar(linhas: LinhaOferta[], coluna: Coluna, direcao: Direcao): LinhaOferta[] {
  const nota = NOTA[coluna];
  const sinal = direcao === 'asc' ? -1 : 1;

  return [...linhas].sort((a, b) => {
    const diff = (nota(b) - nota(a)) * sinal;
    if (diff !== 0) return diff;
    return tempo(b.sentAt) - tempo(a.sentAt);
  });
}
```

- [ ] **Step 4: Rodar o check e ver passar**

Run: `npx tsx apps/api/src/routes/stats-offers.check.ts`
Expected: imprime `stats-offers.check: ok`.

- [ ] **Step 5: Reescrever a rota**

Em `apps/api/src/routes/stats.ts`, substituir o handler de `/api/stats/offers`. Ele passa a validar com Zod, marcar `pendente`, ordenar e paginar.

```ts
const POR_PAGINA = 25;

const queryOffers = z.object({
  days: z.coerce.number().int().min(1).max(180).default(30),
  page: z.coerce.number().int().min(1, 'A página começa em 1.').default(1),
  sort: z.enum(['pendente', 'sentAt', 'clicks', 'orders', 'revenue', 'price', 'score']).default('pendente'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
```

E o handler:

```ts
  app.get('/api/stats/offers', async (req) => {
    const { days, page, sort, dir } = queryOffers.parse(req.query);
    const since = new Date(Date.now() - days * DAY_MS);

    const offers = await prisma.offer.findMany({
      where: { status: OfferStatus.SENT, sentAt: { gte: since } },
      include: { product: true, shortLink: true, conversions: true },
    });

    const linhas: LinhaOferta[] = offers.map((o) => {
      const revenue = o.conversions.reduce((sum, c) => sum + Number(c.commissionBrl), 0);
      const clicks = o.shortLink?.clickCount ?? 0;
      return {
        id: o.id,
        title: o.product.title,
        imageUrl: o.product.imageUrl,
        platform: o.product.platform,
        price: num(o.price),
        discountPct: num(o.discountPct),
        score: o.score,
        sentAt: o.sentAt,
        clicks,
        orders: o.conversions.length,
        revenue: Number(revenue.toFixed(2)),
        conversionRate: clicks ? Number(((o.conversions.length / clicks) * 100).toFixed(1)) : 0,
        pendente: ehPendente(o.conversions.map((c) => c.status)),
      };
    });

    // Ordena o conjunto todo antes de fatiar: paginar primeiro daria a
    // primeira pagina de uma ordem que ninguem pediu.
    const ordenadas = ordenar(linhas, sort, dir);
    const inicio = (page - 1) * POR_PAGINA;

    return {
      linhas: ordenadas.slice(inicio, inicio + POR_PAGINA),
      total: ordenadas.length,
      pageInfo: { page, porPagina: POR_PAGINA, hasNextPage: inicio + POR_PAGINA < ordenadas.length },
    };
  });
```

Acrescentar o import no topo do arquivo:

```ts
import { ehPendente, ordenar, type LinhaOferta } from './stats-offers.js';
```

Confirme que `z` e `OfferStatus` já estão importados em `stats.ts`; se não, importe (`zod` e `@prisma/client`).

**Atenção:** isso muda o formato da resposta de array para objeto. `apps/web/src/pages/Desempenho.tsx` faz `api.get<OfferRow[]>('/api/stats/offers...')` e quebra até a Task 5 ser feita. Isso é esperado — as duas tarefas fecham o par. Não tente manter compatibilidade com o formato antigo.

- [ ] **Step 6: Compilar e rodar o check**

Run: `npm run build --workspace @oferta-hub/api && npx tsx apps/api/src/routes/stats-offers.check.ts`
Expected: build limpo e `stats-offers.check: ok`.

- [ ] **Step 7: Conferir contra o banco real**

Rebuild da API no Docker. Confirme que o número de linhas com `pendente: true` bate com o banco:

```bash
docker compose exec -T db psql -U oferta -d ofertahub -t -A -c "
select count(distinct o.id) from \"Offer\" o
join \"Conversion\" c on c.\"offerId\" = o.id
where o.status = 'SENT' and lower(c.status) not in ('approved','cancelled');"
```

O banco do usuário tem hoje `approved` e `CANCELLED` — então esse número pode ser zero, o que é um resultado válido. Se for zero, confirme ao menos que a rota responde com o formato novo e que `total` bate com a contagem de ofertas enviadas no período.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/stats.ts apps/api/src/routes/stats-offers.ts apps/api/src/routes/stats-offers.check.ts
git commit -m "feat(api): ofertas enviadas com ordenacao, paginacao e marca de comissao pendente"
```

---

### Task 3: Fila — accordion, hover dos botões e clique para editar

**Files:**
- Modify: `apps/web/src/pages/Fila.tsx`
- Modify: `apps/web/src/components/PriceTag.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: nenhuma interface nova; mudanças são locais às três telas.

**Depends-on:** none. (Não conflita com as tarefas 1 e 2: só frontend.)

- [ ] **Step 1: O formulário vira accordion**

Em `apps/web/src/pages/Fila.tsx`, o bloco `<div className="panel">` com `<h2 className="panel__title">Adicionar oferta</h2>` (por volta da linha 249) passa a ser colapsável.

Acrescentar o estado, junto dos outros `useState` do componente:

```tsx
  // Fechado por padrao: adicionar a mao e a excecao, ver a fila e a regra.
  const [abrindoForm, setAbrindoForm] = useState(false);
```

E envolver o conteúdo. O cabeçalho vira um botão que alterna:

```tsx
      <div className="panel">
        <button
          type="button"
          className="acordeao"
          aria-expanded={abrindoForm}
          onClick={() => setAbrindoForm((v) => !v)}
        >
          <span className="acordeao__seta" data-aberto={abrindoForm} aria-hidden="true">
            ▸
          </span>
          Adicionar oferta
        </button>

        {abrindoForm && (
          <div className="acordeao__corpo">
            {/* todo o conteudo que hoje esta dentro do panel, sem o h2 */}
          </div>
        )}
      </div>
```

Mova para dentro de `acordeao__corpo` exatamente o que já existe hoje no painel — campos de URL, nota, busca por termo, resultados, botões. Não altere a lógica de nenhum deles.

O `aria-expanded` não é enfeite: sem ele, um leitor de tela não sabe que o botão abre algo.

- [ ] **Step 2: CSS do accordion**

Em `apps/web/src/styles.css`, acrescentar perto das outras regras de `.panel`:

```css
/* Cabecalho do formulario colapsavel: mesmo peso visual de um controle
   qualquer. O amarelo da marca fica reservado pra acao principal, que e
   enviar -- nao pra abrir um formulario. */
.acordeao {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  color: var(--text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
}

.acordeao:hover {
  color: var(--brand);
}

.acordeao__seta {
  display: inline-block;
  transition: transform 0.15s ease;
  color: var(--muted);
}

.acordeao__seta[data-aberto='true'] {
  transform: rotate(90deg);
}

.acordeao__corpo {
  margin-top: 14px;
}
```

Confirme o nome real da variável de cor do texto (`--text`) em `styles.css` antes de usar; se for outro, use o real.

- [ ] **Step 3: Hover dos botões de ação**

Ainda em `styles.css`, procure `.card__enviar` (por volta da linha 1337) e as regras de `.card__botoes`. Acrescentar o hover dos dois botões:

```css
/* A cor no hover carrega significado: amarelo leva a oferta adiante, vermelho
   descarta. Sem isso os dois botoes reagem igual e a mao erra sem aviso. */
.card__enviar:hover:not(:disabled) {
  background: var(--brand);
  border-color: var(--brand);
  color: #000;
}

.card__botoes .btn--ghost:hover:not(:disabled) {
  background: var(--drop);
  border-color: var(--drop);
  color: #000;
}
```

O `:not(:disabled)` importa: enquanto o envio está em andamento os botões ficam desabilitados, e um botão desabilitado que muda de cor no hover promete uma ação que não vai acontecer.

Confirme que `.card__botoes .btn--ghost` casa **só** com o "Pular". Se houver outro `btn--ghost` dentro de `card__botoes`, use um seletor mais específico ou dê uma classe própria ao Pular em `PriceTag.tsx`.

- [ ] **Step 4: "Ver texto" sai; o card vira o alvo**

Em `apps/web/src/components/PriceTag.tsx`, remover o botão:

```tsx
            <button onClick={() => onEdit(offer)}>Ver texto</button>
```

O `<div className="card__links">` continua, agora só com o "Por quê?".

O card em si passa a abrir o editor. Encontre o elemento raiz do card (o que tem a classe `card` ou `tag`) e acrescente:

```tsx
      role="button"
      tabIndex={0}
      title="Clique para ver e editar o texto da mensagem"
      aria-label={`Ver e editar o texto de ${offer.product.title}`}
      onClick={() => onEdit(offer)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit(offer);
        }
      }}
```

E impedir que o clique nos botões internos suba até o card. Nos handlers de "Pular", "Enviar ao grupo" e "Por quê?", chamar `e.stopPropagation()` antes da ação. Exemplo para o Pular:

```tsx
            <button
              className="btn btn--ghost btn--alvo"
              disabled={busy !== null}
              onClick={(e) => {
                e.stopPropagation();
                void act('skip');
              }}
            >
```

Fazer o mesmo nos outros dois. **Sem isso, clicar em "Enviar ao grupo" também abriria o editor** — e pior, um clique em Pular dispararia as duas coisas.

No CSS, dar ao card o cursor que indica a ação:

```css
.card[role='button'] {
  cursor: pointer;
}
```

Ajuste o seletor para a classe real do card.

- [ ] **Step 5: Compilar**

Run: `npm run build --workspace @oferta-hub/web`
Expected: sem erro de tipo.

- [ ] **Step 6: Verificar na tela**

`cd apps/web && npx vite --port 5199 --strictPort`, abrir `http://localhost:5199/fila`.

- O formulário começa **fechado**; a fila aparece logo abaixo do cabeçalho.
- Clicar em "Adicionar oferta" expande; clicar de novo fecha. A seta gira.
- Com o formulário aberto, colar uma URL e adicionar continua funcionando.
- Passar o mouse em "Enviar ao grupo": fundo amarelo, texto preto.
- Passar o mouse em "Pular": fundo vermelho, texto preto.
- "Ver texto" não existe mais.
- Clicar no corpo do card abre o editor de mensagem.
- Clicar em "Pular" **não** abre o editor. Clicar em "Por quê?" **não** abre o editor.
- Tab até o card e Enter abre o editor.

**Não clique em "Enviar ao grupo" durante o teste** — isso manda a mensagem de verdade para o grupo do usuário. Para verificar o hover, basta passar o mouse. Se precisar confirmar que o clique não abre o editor, use o Pular numa oferta que você mesmo tenha adicionado, e diga qual no relatório.

Derrube o Vite ao terminar.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/Fila.tsx apps/web/src/components/PriceTag.tsx apps/web/src/styles.css
git commit -m "feat(web): Fila com formulario colapsavel, hover nas acoes e card clicavel"
```

---

### Task 4: Meus Grupos em cartões, com indicadores

**Files:**
- Rewrite: `apps/web/src/pages/MeusGrupos.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: da Task 1 — `GET /api/groups?days=N` devolvendo `groups[].sent` e `totais: { grupos, membros, enviadas }`.

**Depends-on:** Task 1.

- [ ] **Step 1: Reescrever a tela**

Substituir `apps/web/src/pages/MeusGrupos.tsx` inteiro:

```tsx
import { useEffect, useState } from 'react';
import { api, int } from '../api.js';

interface GroupRow {
  jid: string;
  name: string;
  memberCount: number | null;
  joined: number;
  left: number;
  trackingSince: string | null;
  sent: number;
}

interface GroupsResponse {
  days: number;
  groups: GroupRow[];
  totais: { grupos: number; membros: number; enviadas: number };
}

export function MeusGrupos() {
  const [days, setDays] = useState(30);
  const [dados, setDados] = useState<GroupsResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setErro(null);
    void api
      .get<GroupsResponse>(`/api/groups?days=${days}`)
      .then(setDados)
      .catch((e) => setErro(e instanceof Error ? e.message : 'Não consegui carregar os grupos.'));
  }, [days]);

  const grupos = dados?.groups ?? [];

  return (
    <>
      <div className="head">
        <div>
          <h1>Meus Grupos</h1>
          <p>Acompanhe a saúde dos seus grupos e o alcance de cada envio.</p>
        </div>
        <div className="field" style={{ width: 180 }}>
          <label htmlFor="days">Período</label>
          <select id="days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </div>
      </div>

      {erro && <div className="notice">{erro}</div>}

      {dados && (
        <div className="kpis">
          <div className="kpi">
            <span className="kpi__label">Grupos ativos</span>
            <strong className="kpi__valor">{int(dados.totais.grupos)}</strong>
          </div>
          <div className="kpi">
            <span className="kpi__label">Membros alcançados</span>
            <strong className="kpi__valor">{int(dados.totais.membros)}</strong>
          </div>
          <div className="kpi">
            <span className="kpi__label">Mensagens enviadas</span>
            <strong className="kpi__valor">{int(dados.totais.enviadas)}</strong>
          </div>
        </div>
      )}

      {dados && grupos.length === 0 && (
        <div className="empty">
          <strong>Nenhum grupo sincronizado</strong>
          Conecte o WhatsApp e sincronize os grupos em Configurações › Canais para ver as métricas aqui.
        </div>
      )}

      <div className="grupos">
        {grupos.map((g) => (
          <div key={g.jid} className="grupo">
            <h2 className="grupo__nome">{g.name}</h2>

            <div className="grupo__linha">
              <div>
                <strong className="grupo__membros">{g.memberCount ?? '—'}</strong>
                <span className="grupo__unidade">membros</span>
              </div>
              <div className="grupo__delta">
                <span style={{ color: g.joined ? 'var(--gain)' : 'var(--muted)' }}>
                  ↑ {int(g.joined)} em {days}d
                </span>
                <span style={{ color: g.left ? 'var(--drop)' : 'var(--muted)' }}>
                  ↓ {int(g.left)} em {days}d
                </span>
              </div>
            </div>

            <div className="grupo__rodape">
              {g.sent > 0 ? (
                <span>
                  Enviadas: <strong>{int(g.sent)}</strong>
                </span>
              ) : (
                <span style={{ color: 'var(--muted)' }}>Sem envios ainda</span>
              )}
              {!g.trackingSince && (
                <span style={{ color: 'var(--muted)' }} title="Entradas e saídas só contam a partir do primeiro registro">
                  sem histórico de entradas
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {grupos.length > 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 12 }}>
          Entradas e saídas só contam a partir de quando a métrica passou a ser registrada em cada grupo —
          período anterior a isso não é zero, é desconhecido.
        </p>
      )}
    </>
  );
}
```

O aviso sobre `trackingSince` continua, agora em dois lugares: marcado no próprio cartão quando falta histórico, e explicado no rodapé. A spec exige isso — a mudança visual não pode engolir a informação honesta.

- [ ] **Step 2: CSS dos cartões**

Antes de escrever, **procure em `styles.css` se `.kpis` e `.kpi` já existem** — `Desempenho.tsx` usa um componente `Kpi`, então pode já haver estilo pronto para reusar. Se existir, use o que existe e escreva só o que falta.

O que falta, no mínimo:

```css
/* Cartao por grupo: o numero de membros e o dado que o usuario procura
   primeiro, entao ele domina o cartao e o resto orbita. */
.grupos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.grupo {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
  background: var(--panel);
}

.grupo__nome {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 700;
}

.grupo__linha {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.grupo__membros {
  display: block;
  font-size: 30px;
  line-height: 1;
  font-weight: 800;
}

.grupo__unidade {
  color: var(--muted);
  font-size: 13px;
}

.grupo__delta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  font-size: 12px;
}

.grupo__rodape {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: 13px;
}
```

Confirme os nomes reais de `--line`, `--panel` e `--muted` em `styles.css` antes de usar. Se algum não existir, use o que o arquivo já usa para borda e fundo de painel — não invente token novo.

- [ ] **Step 3: Compilar**

Run: `npm run build --workspace @oferta-hub/web`
Expected: sem erro de tipo.

- [ ] **Step 4: Verificar na tela**

Com o Vite em 5199 e a API do Docker (que precisa ter a Task 1 buildada), abrir `http://localhost:5199/grupos`.

- Os três indicadores aparecem no topo.
- "Grupos ativos" bate com o número de cartões.
- "Membros alcançados" bate com a soma dos membros dos cartões.
- Cada cartão mostra nome, membros, as duas variações e o rodapé.
- Grupo sem envio mostra "Sem envios ainda", não zero.
- Trocar o período muda os números e o texto "em Nd" dos cartões.
- Grupo sem `memberCount` mostra "—".

Derrube o Vite ao terminar.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/MeusGrupos.tsx apps/web/src/styles.css
git commit -m "feat(web): Meus Grupos em cartoes, com indicadores do periodo"
```

---

### Task 5: Desempenho — tabela paginada, ordenável, e tooltip no gráfico

**Files:**
- Modify: `apps/web/src/pages/Desempenho.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: da Task 2 — `GET /api/stats/offers?days=&page=&sort=&dir=` devolvendo `{ linhas, total, pageInfo: { page, porPagina, hasNextPage } }`, com `pendente: boolean` em cada linha.

**Depends-on:** Task 2.

- [ ] **Step 1: Consumir o formato novo**

Em `apps/web/src/pages/Desempenho.tsx`, a interface `OfferRow` ganha `pendente: boolean`, e a chamada muda de array para objeto:

```tsx
type Coluna = 'pendente' | 'sentAt' | 'clicks' | 'orders' | 'revenue' | 'price' | 'score';

interface RespostaOfertas {
  linhas: OfferRow[];
  total: number;
  pageInfo: { page: number; porPagina: number; hasNextPage: boolean };
}
```

Acrescentar o estado da ordenação e da página:

```tsx
  const [ofertas, setOfertas] = useState<RespostaOfertas | null>(null);
  const [sort, setSort] = useState<Coluna>('pendente');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [pagina, setPagina] = useState(1);
```

A busca das ofertas passa a depender também de `sort`, `dir` e `pagina`. Cuidado com o `useEffect` existente: hoje ele carrega as quatro chamadas juntas, dependendo só de `days`. Separe a chamada de ofertas num efeito próprio, com as dependências certas — senão trocar de página refaz as outras três chamadas à toa.

Trocar de período (`days`) deve voltar para a página 1. Sem isso, o usuário na página 4 troca o período e vê uma página vazia.

- [ ] **Step 2: Cabeçalhos ordenáveis**

Cada `<th>` ordenável vira um botão. Clicar na coluna já ativa inverte a direção; clicar em outra ordena por ela em ordem decrescente.

```tsx
  function ordenarPor(coluna: Coluna) {
    if (sort === coluna) {
      setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(coluna);
      setDir('desc');
    }
    setPagina(1);
  }

  function Cabecalho({ coluna, children }: { coluna: Coluna; children: React.ReactNode }) {
    const ativa = sort === coluna;
    return (
      <th className="num">
        <button
          type="button"
          className="th-ordenavel"
          data-ativa={ativa}
          aria-sort={ativa ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
          onClick={() => ordenarPor(coluna)}
        >
          {children}
          <span aria-hidden="true">{ativa ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
        </button>
      </th>
    );
  }
```

`aria-sort` é o que comunica a ordenação a quem usa leitor de tela — a seta sozinha é só pixel.

Voltar para a página 1 ao reordenar não é detalhe: continuar na página 5 de uma ordem nova mostra linhas sem relação com o que o usuário acabou de pedir.

- [ ] **Step 3: Marcar a linha pendente e paginar**

Na linha da tabela, marcar visualmente as pendentes — um `chip` antes do título, reusando a classe existente:

```tsx
                  {o.pendente && (
                    <span className="chip" title="A loja ainda não confirmou a comissão desta venda">
                      pendente
                    </span>
                  )}
```

Abaixo da tabela, os controles de página, no mesmo padrão que `ResultadoBusca` já usa em Garimpar: "Anterior" desabilitado na página 1, "Próxima" desabilitado quando `hasNextPage` é falso, e o número da página no meio. Mostre também o total (`{total} ofertas no período`), que é a informação que dá sentido à paginação.

- [ ] **Step 4: Tooltip no gráfico**

O componente `Chart` (por volta da linha 46 de `Desempenho.tsx`) desenha SVG. Acrescentar o ponto sob o cursor.

Guardar o índice ativo em estado, e descobri-lo pela posição do mouse dentro do SVG:

```tsx
  const [ativo, setAtivo] = useState<number | null>(null);

  function aoMover(e: React.MouseEvent<SVGSVGElement>) {
    const caixa = e.currentTarget.getBoundingClientRect();
    if (!caixa.width || data.length === 0) return;
    const fracao = (e.clientX - caixa.left) / caixa.width;
    const i = Math.round(fracao * (data.length - 1));
    setAtivo(Math.min(data.length - 1, Math.max(0, i)));
  }
```

No `<svg>`, ligar `onMouseMove={aoMover}`, `onMouseLeave={() => setAtivo(null)}` e `onTouchStart`/`onTouchMove` equivalentes para telas de toque.

Quando `ativo` não for nulo, desenhar uma linha vertical na posição do ponto e mostrar um bloco com a data, os cliques e a comissão daquele dia. O bloco pode ser um `<div>` posicionado sobre o gráfico (mais simples de estilizar) ou um `<text>` dentro do SVG — escolha e diga qual no relatório.

**Casos de borda que não podem quebrar:** `data.length === 0` (não desenhar nada), `data.length === 1` (a divisão por `length - 1` daria divisão por zero — trate), e todos os valores zerados (a escala não pode dividir por zero). Confira como o `Chart` atual calcula a escala e proteja o mesmo ponto.

Formate os valores com os helpers que o arquivo já usa (`brl`, `int`), e a data em `pt-BR`.

- [ ] **Step 5: CSS do cabeçalho ordenável**

```css
/* Cabecalho que ordena: parece cabecalho, age como botao. A coluna ativa
   fica em destaque pra nao restar duvida sobre o que manda na ordem. */
.th-ordenavel {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.th-ordenavel:hover {
  color: var(--brand);
}

.th-ordenavel[data-ativa='true'] {
  color: var(--brand);
  font-weight: 700;
}
```

- [ ] **Step 6: Compilar**

Run: `npm run build --workspace @oferta-hub/web`
Expected: sem erro de tipo.

- [ ] **Step 7: Verificar na tela**

Com o Vite em 5199 e a API do Docker com a Task 2 buildada, abrir `http://localhost:5199/desempenho`.

- A tabela carrega e mostra o total de ofertas do período.
- Clicar em "Cliques" ordena por cliques decrescente; clicar de novo inverte; a seta acompanha.
- Trocar de coluna volta para a página 1.
- "Próxima" traz linhas diferentes; na página 1 o "Anterior" está desabilitado.
- Trocar o período volta para a página 1.
- Se houver oferta com comissão pendente, ela aparece marcada e no topo na ordem padrão. **Se o banco não tiver nenhuma**, diga isso no relatório — é resultado válido, não falha.
- Passar o mouse sobre o gráfico mostra data, cliques e comissão daquele dia, com a linha vertical acompanhando.
- Sair do gráfico com o mouse esconde o tooltip.

Derrube o Vite ao terminar.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/Desempenho.tsx apps/web/src/styles.css
git commit -m "feat(web): Desempenho com tabela paginada, ordenavel e tooltip no grafico"
```

---

## Ordem de execução

Conflito de arquivo respeitado — três tarefas tocam `styles.css`, então nunca podem correr juntas:

- **Onda 1:** Task 1 (api) e Task 2 (api) — arquivos disjuntos entre si.
- **Onda 2:** Task 3 (Fila).
- **Onda 3:** Task 4 (Meus Grupos) — depende da Task 1 e toca `styles.css`.
- **Onda 4:** Task 5 (Desempenho) — depende da Task 2 e toca `styles.css`.

As tarefas 3, 4 e 5 são serializadas entre si pelo `styles.css`, mesmo sendo independentes em lógica.

## Verificação final da fase

- [ ] `npm run build` limpo na raiz.
- [ ] `npx tsx apps/api/src/routes/stats-offers.check.ts` → `stats-offers.check: ok`
- [ ] `npx tsx apps/api/src/routes/garimpar-merge.check.ts` → `garimpar-merge.check: ok` (não deve ter sido afetado)
- [ ] `npx tsx apps/api/src/plugins/senha.check.ts` → `senha.check: ok` (idem)
- [ ] Fila: formulário fechado por padrão, abre e fecha, adicionar oferta funciona.
- [ ] Fila: hover amarelo no "Enviar ao grupo", vermelho no "Pular", ambos com texto preto.
- [ ] Fila: "Ver texto" não existe; clicar no card abre o editor; clicar em Pular não abre.
- [ ] Meus Grupos: três indicadores batendo com os cartões, período mudando os números.
- [ ] Desempenho: ordenação por coluna sobre o conjunto todo, paginação funcionando, tooltip no gráfico.
- [ ] Nenhuma alteração em `apps/api/prisma/schema.prisma`.
