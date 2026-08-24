# Fase 1 — Navegação e Configurações: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar a navegação em cinco seções e transformar Configurações em cinco abas, com troca de senha funcional e cinco modelos de mensagem prontos.

**Architecture:** Nenhuma alteração de schema Prisma. A senha passa a viver em `AppSetting` com hash `scrypt`, mantendo o `.env` como origem enquanto ninguém trocou. No frontend, páginas de primeiro nível viram abas dentro de páginas-casca, seguindo o padrão que `Configuracoes.tsx` já usa hoje. A maior parte do trabalho é mover blocos existentes, não escrever lógica nova.

**Tech Stack:** Node 20+, TypeScript ESM, Fastify 4, Prisma 5, Zod 3, React 18, React Router, Vite, Tailwind + CSS custom em `styles.css`.

**Spec:** `docs/superpowers/specs/2026-08-23-fase1-navegacao-configuracoes-design.md`

## Global Constraints

- Ambos os workspaces são ESM (`"type": "module"`). Todo import relativo termina em `.js`, mesmo apontando para um arquivo `.ts`. Import sem extensão quebra em runtime.
- Validação de entrada da API sempre com Zod.
- Nenhuma dependência nova. `scrypt` e `timingSafeEqual` vêm de `node:crypto`.
- Nenhuma alteração em `apps/api/prisma/schema.prisma`.
- Todo texto de interface e toda mensagem de erro em português do Brasil.
- Não existe runner de testes no projeto. A verificação de cada tarefa é `npm run build` mais um script `.check.ts` executado com `npx tsx`, no estilo de `apps/web/src/protocol-sound.check.ts`.
- Comentários no código explicam **por quê**, não o quê — é o padrão do repositório.
- Classes de CSS já existentes, a reusar em vez de inventar: `head`, `panel`, `panel__title`, `field`, `row`, `split`, `btn`, `btn--ghost`, `btn--sm`, `chip`, `notice`, `empty`, `tabs`, `tabs__item`, `taglist`.
- Commits em português, no formato Conventional Commits.

---

### Task 1: Senha trocável em `AppSetting`

**Files:**
- Create: `apps/api/src/plugins/senha.ts`
- Create: `apps/api/src/plugins/senha.check.ts`
- Create: `apps/api/src/routes/conta.ts`
- Modify: `apps/api/src/plugins/auth.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `prisma` de `../db.js`, `env.dashboardPassword` de `../env.js`, `AppSetting` (model já existente: `key String @id`, `value String`, `updatedAt`).
- Produces:
  - `CHAVE_SENHA: string` — a constante `'dashboard_password_hash'`.
  - `derivar(senha: string, salt?: string): Promise<string>` — devolve `"<salt>:<hashHex>"`.
  - `confere(senha: string, guardado: string): Promise<boolean>` — compara contra um valor no formato acima.
  - `senhaConfere(dada: string): Promise<boolean>` — verifica contra o banco, com queda para o `.env`.
  - `trocarSenha(nova: string): Promise<void>` — grava o hash.
  - `contaRoutes(app: FastifyInstance): Promise<void>` — registra `POST /api/senha`.

- [ ] **Step 1: Escrever o self-check que falha**

Criar `apps/api/src/plugins/senha.check.ts`. Ele testa só a derivação e a comparação — a parte que tem lógica de verdade. `senhaConfere` e `trocarSenha` tocam o banco e ficam de fora.

```ts
/**
 * Self-check da derivacao de senha. Roda sem banco:
 *   npx tsx apps/api/src/plugins/senha.check.ts
 *
 * O que precisa valer: mesma senha confere, senha errada nao confere, dois
 * hashes da MESMA senha saem diferentes (salt aleatorio), e valor corrompido
 * devolve false em vez de explodir -- um throw aqui viraria 500 no login.
 */
import assert from 'node:assert/strict';
import { confere, derivar } from './senha.js';

const guardado = await derivar('senha-de-teste');

assert.match(guardado, /^[0-9a-f]{32}:[0-9a-f]{128}$/, 'formato esperado: salt:hash em hex');
assert.equal(await confere('senha-de-teste', guardado), true, 'senha certa tem que conferir');
assert.equal(await confere('senha-errada', guardado), false, 'senha errada nao pode conferir');
assert.equal(await confere('', guardado), false, 'senha vazia nao pode conferir');

const outro = await derivar('senha-de-teste');
assert.notEqual(guardado, outro, 'salt aleatorio: dois hashes da mesma senha diferem');
assert.equal(await confere('senha-de-teste', outro), true, 'o segundo hash tambem confere');

// Valor corrompido no banco nao pode derrubar o login.
assert.equal(await confere('x', 'lixo-sem-dois-pontos'), false);
assert.equal(await confere('x', ':'), false);
assert.equal(await confere('x', 'abc:naohex'), false);
assert.equal(await confere('x', 'abc:ff'), false, 'hash de tamanho errado devolve false');

console.log('senha.check: ok');
```

- [ ] **Step 2: Rodar o check e ver falhar**

Run: `npx tsx apps/api/src/plugins/senha.check.ts`
Expected: FALHA com `Cannot find module` apontando para `./senha.js`.

- [ ] **Step 3: Escrever `senha.ts`**

Criar `apps/api/src/plugins/senha.ts`:

```ts
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { prisma } from '../db.js';
import { env } from '../env.js';

const scrypt = promisify(crypto.scrypt) as (senha: string, salt: string, tamanho: number) => Promise<Buffer>;

/** Chave da senha em AppSetting. Enquanto ela nao existe, vale a do .env. */
export const CHAVE_SENHA = 'dashboard_password_hash';

const TAMANHO_HASH = 64;

export async function derivar(senha: string, salt = crypto.randomBytes(16).toString('hex')): Promise<string> {
  const hash = await scrypt(senha, salt, TAMANHO_HASH);
  return `${salt}:${hash.toString('hex')}`;
}

/**
 * Nao lanca: valor corrompido em AppSetting viraria 500 no login, e a saida
 * util nesse caso e "nao confere", nao um erro de servidor.
 */
export async function confere(senha: string, guardado: string): Promise<boolean> {
  const [salt, hex] = guardado.split(':');
  if (!salt || !hex || !/^[0-9a-f]+$/.test(hex)) return false;
  const esperado = Buffer.from(hex, 'hex');
  if (esperado.length !== TAMANHO_HASH) return false;
  const hash = await scrypt(senha, salt, TAMANHO_HASH);
  return crypto.timingSafeEqual(hash, esperado);
}

/**
 * Senha do painel: a do banco quando alguem ja trocou, senao a do .env.
 * Isso e o que deixa instalacao existente continuar entrando sem migracao.
 */
export async function senhaConfere(dada: string): Promise<boolean> {
  const linha = await prisma.appSetting.findUnique({ where: { key: CHAVE_SENHA } });
  if (linha) return confere(dada, linha.value);

  const esperada = env.dashboardPassword;
  // timingSafeEqual explode se os buffers tiverem tamanhos diferentes.
  if (dada.length !== esperada.length) return false;
  return crypto.timingSafeEqual(Buffer.from(dada), Buffer.from(esperada));
}

export async function trocarSenha(nova: string): Promise<void> {
  const value = await derivar(nova);
  await prisma.appSetting.upsert({
    where: { key: CHAVE_SENHA },
    create: { key: CHAVE_SENHA, value },
    update: { value },
  });
}
```

- [ ] **Step 4: Rodar o check e ver passar**

Run: `npx tsx apps/api/src/plugins/senha.check.ts`
Expected: imprime `senha.check: ok`, sai com código 0.

- [ ] **Step 5: Fazer o login usar `senhaConfere`**

Em `apps/api/src/plugins/auth.ts`, adicionar ao topo:

```ts
import { senhaConfere } from './senha.js';
```

E substituir o bloco de comparação dentro de `POST /api/login`:

```ts
    const given = req.body?.password ?? '';
    const ok =
      given.length === env.dashboardPassword.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(env.dashboardPassword));
```

por:

```ts
    const given = req.body?.password ?? '';
    const ok = await senhaConfere(given);
```

`env` continua importado no arquivo — `signToken`/`verifyToken` usam `env.sessionSecret` e o cookie usa `env.publicUrl`.

- [ ] **Step 6: Criar a rota de troca de senha**

Criar `apps/api/src/routes/conta.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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
    reply.clearCookie('oh_session', { path: '/' });
    return { ok: true };
  });
}
```

- [ ] **Step 7: Registrar a rota no servidor**

Em `apps/api/src/server.ts`, adicionar o import junto dos outros de `./routes/`:

```ts
import { contaRoutes } from './routes/conta.js';
```

E dentro do bloco `await app.register(async (instance) => { ... })`, logo depois de `await instance.register(automacaoRoutes);`:

```ts
  await instance.register(contaRoutes);
```

A rota tem que ficar **dentro** desse bloco: é ele que aplica o hook `requireAuth`. Registrada fora, qualquer um trocaria a senha sem estar logado.

- [ ] **Step 8: Compilar**

Run: `npm run build --workspace @oferta-hub/api`
Expected: termina sem erro de tipo.

- [ ] **Step 9: Verificar o caminho completo à mão**

Com a API no ar (`npm run dev:api`) e o painel aberto:

1. Entrar com a senha do `.env` — funciona como antes.
2. `POST /api/senha` com `{ "atual": "<a do .env>", "nova": "12345678" }` — responde `{ ok: true }`.
3. A sessão cai; entrar de novo com `12345678` funciona.
4. Entrar com a senha antiga do `.env` agora falha.
5. `POST /api/senha` com `nova` de 5 caracteres — responde 400 com a mensagem em português.

Para desfazer o teste: apague a linha em `AppSetting` com `key = 'dashboard_password_hash'` (via `npm run db:studio --workspace @oferta-hub/api`) e a senha volta a ser a do `.env`.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/plugins/senha.ts apps/api/src/plugins/senha.check.ts apps/api/src/plugins/auth.ts apps/api/src/routes/conta.ts apps/api/src/server.ts
git commit -m "feat(api): senha do painel trocavel, guardada em AppSetting"
```

---

### Task 2: Cinco modelos de mensagem prontos

**Files:**
- Create: `apps/api/src/services/templates-prontos.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `prisma` de `../db.js`, `logger` de `../lib/logger.js`, model `MessageTemplate` (`name` é `@unique`).
- Produces:
  - `TEMPLATES_PRONTOS: { name: string; body: string; isDefault: boolean }[]`
  - `semearTemplates(): Promise<void>` — chamada no boot.

**Depends-on:** Task 1 (as duas mexem em `server.ts`).

**Nota de decisão:** a lista de Mensagens já ordena por `isDefault desc, name asc` e cada item já tem botão "Editar". Semeados no banco, os cinco modelos aparecem lá clicáveis sem nenhuma faixa de presets separada no frontend. Uma faixa extra duplicaria a lista, então esta tarefa não mexe em `Templates.tsx`.

- [ ] **Step 1: Escrever o módulo dos modelos**

Criar `apps/api/src/services/templates-prontos.ts`. Os tokens são exatamente os que `services/template.ts` reconhece (`TITULO`, `PRECO`, `PRECO_ANTIGO`, `LINK`, `CUPOM`) — confirmado na linha 12 daquele arquivo.

```ts
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';

/**
 * Modelos que ja vem montados no sistema, pra ninguem comecar de textarea
 * vazia. Semeados por `upsert` na chave `name`, entao o texto que o usuario
 * editar depois nao e sobrescrito no boot seguinte.
 *
 * `{PRECO_ANTIGO}` some sozinho quando o produto nao tem preco de comparacao
 * -- ver services/template.ts. Por isso o "de/por" pode aparecer solto aqui.
 */
export const TEMPLATES_PRONTOS: { name: string; body: string; isDefault: boolean }[] = [
  {
    name: 'Direto e agressivo',
    isDefault: true,
    body: `🚨 *BAIXOU AGORA*

*{TITULO}*

~{PRECO_ANTIGO}~ ➡️ *{PRECO}*

{LINK}`,
  },
  {
    name: 'Curto (volume)',
    isDefault: false,
    body: `🔥 *ACHADINHO DO DIA*

*{TITULO}*

~{PRECO_ANTIGO}~ ➡️ *{PRECO}* 🤯

👉 {LINK}`,
  },
  {
    name: 'Vendedor e humanizado',
    isDefault: false,
    body: `💛 *Esse achado vale a pena conferir!*

📦 *{TITULO}*

O preço caiu de ~{PRECO_ANTIGO}~ para apenas *{PRECO}* 🔥

Pra quem já estava querendo comprar, essa pode ser uma boa hora 👀

👉 Veja a oferta:
{LINK}`,
  },
  {
    name: 'Urgência e escassez',
    isDefault: false,
    body: `⚠️ *PREÇO BAIXOU!*

🔥 *{TITULO}*

Era ~{PRECO_ANTIGO}~
Agora está saindo por apenas *{PRECO}* 😱

⏳ Não sei até quando esse preço fica disponível.

👉 Pegue aqui:
{LINK}`,
  },
  {
    name: 'Sensação de achado',
    isDefault: false,
    body: `👀 *OLHA O QUE EU ACHEI!*

*{TITULO}*

❌ De: ~{PRECO_ANTIGO}~
✅ Agora por: *{PRECO}*

Tá com um preço muito bom! 🔥

🛒 Corre pra ver:
{LINK}`,
  },
];

/**
 * `update: {}` de proposito: o upsert existe pra CRIAR o que falta, nunca pra
 * desfazer edicao do usuario. Se o modelo ja existe, nada muda.
 *
 * `isDefault` so entra na criacao, e so quando ainda nao ha nenhum padrao --
 * caso contrario o boot roubaria o padrao que o usuario escolheu.
 */
export async function semearTemplates(): Promise<void> {
  try {
    const jaTemPadrao = (await prisma.messageTemplate.count({ where: { isDefault: true } })) > 0;

    for (const t of TEMPLATES_PRONTOS) {
      await prisma.messageTemplate.upsert({
        where: { name: t.name },
        create: { name: t.name, body: t.body, isDefault: t.isDefault && !jaTemPadrao },
        update: {},
      });
    }
  } catch (err) {
    // Conteudo de exemplo nao pode impedir a API de subir.
    logger.warn({ err: String(err) }, 'nao consegui semear os modelos de mensagem');
  }
}
```

- [ ] **Step 2: Chamar no boot**

Em `apps/api/src/server.ts`, adicionar o import junto dos outros de `./services/` ou logo abaixo dos de `./routes/`:

```ts
import { semearTemplates } from './services/templates-prontos.js';
```

E dentro de `async function main()`, entre `await prisma.$connect();` e `await app.listen(...)`:

```ts
  await semearTemplates();
```

Vem depois do `$connect` porque precisa do banco, e antes do `listen` porque o painel pode pedir a lista de modelos no primeiro request.

- [ ] **Step 3: Compilar**

Run: `npm run build --workspace @oferta-hub/api`
Expected: termina sem erro de tipo.

- [ ] **Step 4: Verificar à mão**

1. Subir a API: `npm run dev:api`.
2. Abrir Configurações → Modelos de mensagem. Os cinco aparecem, com "Direto e agressivo" marcado como padrão no topo (a lista ordena por `isDefault desc, name asc`).
3. Editar o corpo de "Curto (volume)", salvar, reiniciar a API. O texto editado continua lá — o `update: {}` não sobrescreveu.
4. Marcar outro modelo como padrão e reiniciar. O padrão escolhido continua sendo o seu.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/templates-prontos.ts apps/api/src/server.ts
git commit -m "feat(api): semeia cinco modelos de mensagem prontos no boot"
```

---

### Task 3: Navegação — cinco seções e Automações com três abas

**Files:**
- Modify: `apps/web/src/components/app-sidebar.tsx:33-64` (constante `GROUPS`)
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/automacoes/AutomacoesLista.tsx`
- Create: `apps/web/src/pages/automacoes/Vigiar.tsx`
- Rewrite: `apps/web/src/pages/Automacoes.tsx`
- Delete: `apps/web/src/pages/Agenda.tsx`
- Delete: `apps/web/src/pages/Produtos.tsx`

**Interfaces:**
- Consumes: `Sidebar*` de `./ui/sidebar.js`, `NavLink`/`useLocation` de `react-router-dom`, ícones de `lucide-react`.
- Produces:
  - `AutomacoesLista(): JSX.Element` — o conteúdo que hoje é `Automacoes.tsx`.
  - `Vigiar(): JSX.Element` — o conteúdo que hoje é `Produtos.tsx`.
  - `Automacoes(): JSX.Element` — casca com as abas Disparos, Automatizar e Vigiar.

**Depends-on:** none (independente das tarefas de backend).

- [ ] **Step 1: Extrair `AutomacoesLista`**

`git mv apps/web/src/pages/Automacoes.tsx apps/web/src/pages/automacoes/AutomacoesLista.tsx` (criando o diretório antes, se preciso).

No arquivo movido:
- Renomear a função exportada de `export function Automacoes()` para `export function AutomacoesLista()`.
- Corrigir os imports relativos: o arquivo desceu um nível, então `from '../api.js'` vira `from '../../api.js'`. Fazer isso em **todo** import que comece com `../`.

Nada mais muda no corpo.

- [ ] **Step 2: Mover `Produtos` para `Vigiar`**

`git mv apps/web/src/pages/Produtos.tsx apps/web/src/pages/automacoes/Vigiar.tsx`

No arquivo movido:
- Renomear `export function Produtos()` para `export function Vigiar()`.
- Corrigir os imports `../` para `../../`, como no passo anterior.
- No bloco `<div className="head">` (por volta da linha 150 do arquivo original), trocar o `<h1>` de "Preços vigiados" para "Vigiar". O texto de apoio abaixo dele pode ficar como está.

- [ ] **Step 3: Escrever a casca de Automações**

Criar `apps/web/src/pages/Automacoes.tsx` com este conteúdo inteiro:

```tsx
import { useState } from 'react';
import { Disparos } from './Disparos.js';
import { AutomacoesLista } from './automacoes/AutomacoesLista.js';
import { Vigiar } from './automacoes/Vigiar.js';

type Aba = 'disparos' | 'automatizar' | 'vigiar';

const ABAS: { id: Aba; label: string }[] = [
  { id: 'disparos', label: 'Disparos' },
  { id: 'automatizar', label: 'Automatizar' },
  { id: 'vigiar', label: 'Vigiar' },
];

export function Automacoes() {
  const [aba, setAba] = useState<Aba>('disparos');

  return (
    <>
      <div className="tabs">
        {ABAS.map((a) => (
          <button key={a.id} className="tabs__item" data-on={aba === a.id} onClick={() => setAba(a.id)}>
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'disparos' && <Disparos />}
      {aba === 'automatizar' && <AutomacoesLista />}
      {aba === 'vigiar' && <Vigiar />}
    </>
  );
}
```

- [ ] **Step 4: Limpar as rotas**

Em `apps/web/src/App.tsx`:

Remover estes três imports:

```tsx
import { Nichos } from './pages/Nichos.js';
import { Produtos } from './pages/Produtos.js';
import { Agenda } from './pages/Agenda.js';
```

E remover estas três rotas do `<Routes>`:

```tsx
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/nichos" element={<Nichos />} />
          <Route path="/agenda" element={<Agenda />} />
```

O `<Route path="*" element={<Navigate to="/" replace />} />` no fim já cobre quem tiver esses endereços salvos.

`apps/web/src/pages/Nichos.tsx` **não** é apagado: a fase 2 reaproveita o editor de regras dentro de Garimpar. Ele fica no disco sem rota até lá. `Agenda.tsx` é apagado de verdade — `Disparos.tsx` já agenda envio, e nenhuma rota da API depende da página.

```bash
git rm apps/web/src/pages/Agenda.tsx
```

- [ ] **Step 5: Reescrever a barra lateral**

Em `apps/web/src/components/app-sidebar.tsx`, substituir a constante `GROUPS` inteira por:

```tsx
const GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: 'Início',
    items: [
      { to: '/', label: 'Visão geral', end: true, icon: LayoutDashboard },
      { to: '/fila', label: 'Fila', icon: ListChecks },
    ],
  },
  { label: null, items: [{ to: '/garimpar', label: 'Garimpar', icon: Search }] },
  { label: null, items: [{ to: '/automacoes', label: 'Automações', icon: Workflow }] },
  {
    label: 'Métricas',
    items: [
      { to: '/desempenho', label: 'Desempenho', icon: BarChart3 },
      { to: '/grupos', label: 'Meus Grupos', icon: Users },
    ],
  },
  { label: null, items: [{ to: '/configuracoes', label: 'Configurações', icon: Settings }] },
];
```

E ajustar o import de `lucide-react` no topo, removendo `CalendarClock`, `Eye`, `Send` e `Tags`, que deixam de ser usados:

```tsx
import {
  BarChart3,
  LayoutDashboard,
  ListChecks,
  Search,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
```

O badge de pendentes continua funcionando: ele é ancorado em `item.to === '/fila'`, que segue existindo.

- [ ] **Step 6: Compilar**

Run: `npm run build --workspace @oferta-hub/web`
Expected: termina sem erro. Se acusar import não usado, é sobra do passo 5 — remover.

- [ ] **Step 7: Verificar à mão**

Com `npm run dev`:

1. A barra lateral mostra: grupo Início (Visão geral, Fila), Garimpar, Automações, grupo Métricas (Desempenho, Meus Grupos), Configurações.
2. Automações abre em Disparos. Clicar em Automatizar mostra a lista de regras; clicar em Vigiar mostra os blocos de vigiar produto e garimpo automático.
3. Cadastrar um item vigiado na aba Vigiar e conferir que ele aparece na lista logo abaixo.
4. Digitar `/produtos`, `/nichos` e `/agenda` na barra de endereço — todos caem em `/` sem tela branca.
5. Com ofertas pendentes, o badge numérico continua ao lado de Fila.
6. Colapsar a barra lateral (modo ícone): os grupos continuam legíveis e o tooltip de cada item aparece.

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): cinco secoes na sidebar e Automacoes com tres abas"
```

---

### Task 4: Configurações com cinco abas — Canais e Plataformas

**Files:**
- Rewrite: `apps/web/src/pages/Configuracoes.tsx`
- Create: `apps/web/src/pages/configuracoes/Canais.tsx`
- Create: `apps/web/src/pages/configuracoes/AparenciaCard.tsx`
- Create: `apps/web/src/pages/configuracoes/ExtensaoCard.tsx`
- Modify: `apps/web/src/pages/Conexoes.tsx`

**Interfaces:**
- Consumes: `api` de `../../api.js`; endpoints já existentes `GET /api/whatsapp/status`, `POST /api/whatsapp/connect`, `POST /api/whatsapp/logout`, `POST /api/whatsapp/sync-groups`, `POST /api/whatsapp/default-group`.
- Produces:
  - `Canais(): JSX.Element`
  - `AparenciaCard(): JSX.Element`
  - `ExtensaoCard(): JSX.Element`
  - `Configuracoes(): JSX.Element` — casca com cinco abas.

**Depends-on:** none. (Não conflita com a Task 3: nenhum arquivo em comum.)

- [ ] **Step 1: Mover o card do WhatsApp para `Canais.tsx`**

Criar `apps/web/src/pages/configuracoes/Canais.tsx`. O conteúdo vem de `Conexoes.tsx`: o estado `wa`, o `loadWa`, o efeito de polling que os alimenta, e o bloco JSX `<div className="panel">` do WhatsApp (`Conexoes.tsx:188-272`) — recortados como estão, sem reescrever a lógica de conexão.

O esqueleto, com o miolo do WhatsApp preservado:

```tsx
import { useEffect, useState } from 'react';
import { api } from '../../api.js';

// Mesma forma que Conexoes.tsx usava.
interface WaStatus {
  status: string;
  qr?: string | null;
  groups: { jid: string; name: string }[];
  defaultGroup?: string | null;
}

export function Canais() {
  const [wa, setWa] = useState<WaStatus | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const loadWa = () => api.get<WaStatus>('/api/whatsapp/status').then(setWa).catch(() => {});

  useEffect(() => {
    void loadWa();
    // Mesmo intervalo que Conexoes usava: o QR expira rapido e o status
    // muda sozinho quando o celular escaneia.
    const t = setInterval(() => void loadWa(), 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <div className="head">
        <div>
          <h1>Canais</h1>
          <p>Conecte os canais onde suas ofertas serão enviadas.</p>
        </div>
      </div>

      {aviso && <div className="notice">{aviso}</div>}

      <div className="split">
        {/* Cole aqui o <div className="panel"> do WhatsApp que estava em
            Conexoes.tsx:188-272, sem alterar a logica dos botoes. */}

        <div className="panel" aria-disabled="true" style={{ opacity: 0.55 }}>
          <h2 className="panel__title">
            Telegram <span className="chip" style={{ marginLeft: 8 }}>Em breve</span>
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
            Envio por bot do Telegram ainda não está disponível.
          </p>
        </div>
      </div>

      <button
        type="button"
        className="btn btn--ghost"
        style={{ marginTop: 12, width: '100%' }}
        onClick={() =>
          setAviso('Por enquanto o sistema conecta um número de WhatsApp por vez. Vários números vêm depois.')
        }
      >
        + Adicionar outro número ou bot
      </button>
    </>
  );
}
```

Conferir os nomes dos campos de `WaStatus` contra `Conexoes.tsx:16-23` antes de compilar: se a interface de lá tiver campos a mais, copiar a definição original inteira em vez da versão acima.

- [ ] **Step 2: Extrair Aparência e Extensão**

`Conexoes.tsx` tem dois componentes locais que não são credencial de loja: `AparenciaCard` (linha 274) e `ExtensaoCard` (linha 309). Mover cada um para o próprio arquivo, em `apps/web/src/pages/configuracoes/`, exportando com o mesmo nome:

- `AparenciaCard.tsx` → `export function AparenciaCard()`
- `ExtensaoCard.tsx` → `export function ExtensaoCard()`

O corpo dos dois não muda. Só os imports: `from '../api.js'` vira `from '../../api.js'`, e o mesmo para qualquer outro import relativo (`AparenciaCard` provavelmente importa de `../theme.js` — vira `../../theme.js`).

- [ ] **Step 3: Limpar `Conexoes.tsx`**

No que sobrou de `Conexoes.tsx`:
- Remover o bloco `<div className="panel">` do WhatsApp, o estado `wa`, `loadWa` e o `setInterval` que só servia a ele.
- Remover as definições de `AparenciaCard` e `ExtensaoCard`, e as chamadas `<AparenciaCard />` / `<ExtensaoCard />` do JSX.
- Ajustar o `<div className="head">` para o título "Plataformas" e o texto "Suas contas de afiliado, pra gerar links com a sua tag."
- Em `PlatformCard` (linha 24), acrescentar um selo de estado no canto do card, ao lado do título:

```tsx
<span className="chip" data-tone={info.connected ? 'on' : undefined}>
  {info.connected ? 'Conectado' : 'Pendente'}
</span>
```

Antes de escrever isso, conferir em `Conexoes.tsx:6-15` o nome real do campo em `PlatformInfo` que indica credencial ativa. Se não for `connected`, usar o nome que estiver lá — não inventar campo nem mexer na API.

- Conferir que os botões do card são "Salvar" e "Validar conexão". Se o segundo hoje se chama outra coisa (a função é `test`), renomear só o rótulo visível.

- [ ] **Step 4: Escrever a casca de Configurações**

Substituir `apps/web/src/pages/Configuracoes.tsx` inteiro por:

```tsx
import { useState } from 'react';
import { Conexoes } from './Conexoes.js';
import { Templates } from './Templates.js';
import { Canais } from './configuracoes/Canais.js';
import { Cupons } from './configuracoes/Cupons.js';
import { Conta } from './configuracoes/Conta.js';

type Aba = 'canais' | 'plataformas' | 'mensagens' | 'cupons' | 'conta';

const ABAS: { id: Aba; label: string }[] = [
  { id: 'canais', label: 'Canais' },
  { id: 'plataformas', label: 'Plataformas' },
  { id: 'mensagens', label: 'Mensagens' },
  { id: 'cupons', label: 'Cupons' },
  { id: 'conta', label: 'Conta' },
];

export function Configuracoes() {
  const [aba, setAba] = useState<Aba>('canais');

  return (
    <>
      <div className="tabs">
        {ABAS.map((a) => (
          <button key={a.id} className="tabs__item" data-on={aba === a.id} onClick={() => setAba(a.id)}>
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'canais' && <Canais />}
      {aba === 'plataformas' && <Conexoes />}
      {aba === 'mensagens' && <Templates />}
      {aba === 'cupons' && <Cupons />}
      {aba === 'conta' && <Conta />}
    </>
  );
}
```

`Cupons` e `Conta` são criados na Task 5. Para esta tarefa compilar sozinha, criar os dois arquivos já com um corpo mínimo:

`apps/web/src/pages/configuracoes/Cupons.tsx`:

```tsx
export function Cupons() {
  return <div className="empty">Em breve.</div>;
}
```

`apps/web/src/pages/configuracoes/Conta.tsx`:

```tsx
export function Conta() {
  return <div className="empty">Em breve.</div>;
}
```

- [ ] **Step 5: Compilar**

Run: `npm run build --workspace @oferta-hub/web`
Expected: termina sem erro. Erro de import não usado em `Conexoes.tsx` é sobra do passo 3.

- [ ] **Step 6: Verificar à mão**

Com `npm run dev`, em Configurações:

1. As cinco abas aparecem e Canais é a inicial.
2. Em Canais: o card do WhatsApp mostra o status certo. Com a sessão caída, o QR aparece e some quando o celular escaneia. Sincronizar grupos e escolher grupo padrão funcionam como funcionavam em Conexões.
3. Clicar em "+ Adicionar outro número ou bot" mostra o aviso, sem quebrar nada.
4. Em Plataformas: um card por loja, cada um com selo Conectado ou Pendente. Salvar uma credencial e clicar em Validar conexão dão o mesmo resultado de antes.
5. O card do WhatsApp **não** aparece mais em Plataformas.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/Configuracoes.tsx apps/web/src/pages/Conexoes.tsx apps/web/src/pages/configuracoes/
git commit -m "feat(web): Configuracoes com cinco abas, Canais separado de Plataformas"
```

---

### Task 5: Aba Conta — trocar senha, sair, aparência e extensão

**Files:**
- Rewrite: `apps/web/src/pages/configuracoes/Conta.tsx`
- Rewrite: `apps/web/src/pages/configuracoes/Cupons.tsx`

**Interfaces:**
- Consumes: `api` de `../../api.js`; `POST /api/senha` (Task 1); `POST /api/logout` (já existe); `AparenciaCard` e `ExtensaoCard` de `./AparenciaCard.js` e `./ExtensaoCard.js` (Task 4).
- Produces: `Conta(): JSX.Element`, `Cupons(): JSX.Element`.

**Depends-on:** Task 1 (rota `POST /api/senha`), Task 4 (os cards extraídos e a casca das abas).

- [ ] **Step 1: Escrever a aba Cupons**

Substituir `apps/web/src/pages/configuracoes/Cupons.tsx` por:

```tsx
export function Cupons() {
  return (
    <>
      <div className="head">
        <div>
          <h1>Cupons</h1>
          <p>Códigos de desconto pra entrar automaticamente nas mensagens.</p>
        </div>
      </div>

      <div className="empty">
        <strong>Ainda não disponível</strong>
        O token <code>{'{CUPOM}'}</code> já funciona nos modelos de mensagem, mas o cadastro de cupons por
        loja chega numa próxima versão.
      </div>
    </>
  );
}
```

- [ ] **Step 2: Escrever a aba Conta**

Substituir `apps/web/src/pages/configuracoes/Conta.tsx` por:

```tsx
import { useState } from 'react';
import { api } from '../../api.js';
import { AparenciaCard } from './AparenciaCard.js';
import { ExtensaoCard } from './ExtensaoCard.js';

export function Conta() {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function trocar() {
    setErro(null);
    setOk(false);

    if (nova.length < 8) return setErro('A nova senha precisa de pelo menos 8 caracteres.');
    if (nova !== repetida) return setErro('As duas senhas novas não batem.');

    setBusy(true);
    try {
      await api.post('/api/senha', { atual, nova });
      setOk(true);
      setAtual('');
      setNova('');
      setRepetida('');
      // A troca derruba a sessao no servidor. Recarregar leva pro login em vez
      // de deixar a tela viva dando 401 no proximo clique.
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não consegui trocar a senha.');
    } finally {
      setBusy(false);
    }
  }

  async function sair() {
    await api.post('/api/logout');
    window.location.reload();
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Conta</h1>
          <p>Seus dados de acesso e ajustes pessoais do painel.</p>
        </div>
        <button className="btn btn--ghost" onClick={() => void sair()}>
          Sair
        </button>
      </div>

      <div className="panel">
        <h2 className="panel__title">Dados</h2>
        <div className="row">
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label>Nome</label>
            <input value="—" disabled readOnly />
          </div>
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label>E-mail</label>
            <input value="—" disabled readOnly />
          </div>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label>Plano</label>
            <input value="Instalação própria" disabled readOnly />
          </div>
        </div>
        <small style={{ color: 'var(--muted)' }}>
          Nome, e-mail e plano entram quando o painel virar multiusuário. Hoje o acesso é por senha única.
        </small>
      </div>

      <div className="panel">
        <h2 className="panel__title">Senha do painel</h2>

        {erro && <div className="notice">{erro}</div>}
        {ok && <div className="notice">Senha trocada. Entre de novo com a nova senha.</div>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void trocar();
          }}
        >
          <div className="row">
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="senha-atual">Senha atual</label>
              <input
                id="senha-atual"
                type="password"
                autoComplete="current-password"
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="senha-nova">Nova senha</label>
              <input
                id="senha-nova"
                type="password"
                autoComplete="new-password"
                value={nova}
                onChange={(e) => setNova(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label htmlFor="senha-repetida">Repita a nova senha</label>
              <input
                id="senha-repetida"
                type="password"
                autoComplete="new-password"
                value={repetida}
                onChange={(e) => setRepetida(e.target.value)}
              />
            </div>
          </div>

          <button className="btn" disabled={busy || !atual || !nova}>
            {busy ? 'Trocando...' : 'Trocar senha'}
          </button>
        </form>
      </div>

      <AparenciaCard />
      <ExtensaoCard />
    </>
  );
}
```

- [ ] **Step 3: Compilar**

Run: `npm run build --workspace @oferta-hub/web`
Expected: termina sem erro.

- [ ] **Step 4: Verificar à mão**

Com a API e o painel no ar, em Configurações → Conta:

1. Trocar a senha com a atual correta e duas novas iguais de 8+ caracteres: aparece o aviso de sucesso, a página recarrega e cai no login.
2. Entrar com a nova senha: funciona. Com a antiga: "Senha incorreta."
3. Senha atual errada: mostra "Senha atual incorreta." depois de cerca de meio segundo.
4. Nova senha com 5 caracteres: barra no cliente, sem chamar a API.
5. Novas senhas diferentes entre si: mostra "As duas senhas novas não batem."
6. Botão Sair: derruba a sessão e volta pro login.
7. Aparência e Extensão continuam funcionando na nova aba — trocar o tema pega, e o token da extensão ainda copia.
8. Aba Cupons abre com o estado vazio, sem erro no console.

Para voltar à senha do `.env`: apagar a linha `dashboard_password_hash` em `AppSetting`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/configuracoes/Conta.tsx apps/web/src/pages/configuracoes/Cupons.tsx
git commit -m "feat(web): aba Conta com troca de senha, sair, aparencia e extensao"
```

---

## Ordem de execução

As tarefas 1, 2, 3 e 4 podem ser distribuídas assim, respeitando conflito de arquivo:

- **Onda 1:** Task 1 (api) e Task 3 (web) em paralelo — conjuntos de arquivos disjuntos.
- **Onda 2:** Task 2 (api, encosta em `server.ts` como a Task 1) e Task 4 (web) em paralelo.
- **Onda 3:** Task 5, que depende da rota da Task 1 e dos componentes da Task 4.

## Verificação final da fase

Depois da Task 5, com `npm run build` limpo na raiz:

- [ ] A barra lateral tem cinco seções, nesta ordem: Início (Visão geral, Fila), Garimpar, Automações, Métricas (Desempenho, Meus Grupos), Configurações.
- [ ] Automações abre em Disparos, com Automatizar e Vigiar acessíveis.
- [ ] `/agenda`, `/nichos` e `/produtos` redirecionam para `/`.
- [ ] Configurações tem Canais, Plataformas, Mensagens, Cupons e Conta, abrindo em Canais.
- [ ] O WhatsApp conecta e desconecta pela aba Canais.
- [ ] Os cinco modelos de mensagem aparecem em Mensagens, com "Direto e agressivo" como padrão.
- [ ] Trocar a senha derruba a sessão e a nova senha passa a valer.
- [ ] `npx tsx apps/api/src/plugins/senha.check.ts` imprime `senha.check: ok`.
