# Fase 4 — Proteção de grupos: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao usuário três proteções de grupo — Escudo (blocklist), Filtro de DDI e Guilhotina (limpeza sob demanda) — sem nunca remover ninguém que ele não tenha visto e aprovado, e sem queimar o número dele.

**Architecture:** Primeira fase que altera o schema Prisma: duas tabelas novas (blocklist e log de moderação) e um campo em `WhatsappGroup`. A lógica de decisão sai pura num módulo com self-check, porque é onde erro custa caro. O listener de participantes que já existe ganha a avaliação de quem entra. A Guilhotina é deliberadamente partida em duas rotas — escanear lê, remover executa só a lista escolhida.

**Tech Stack:** Node 20+, TypeScript ESM, Fastify 4, Prisma 5, Zod 3, Baileys, React 18, Vite.

**Spec:** `docs/superpowers/specs/2026-08-24-fase4-protecao-design.md`

## Global Constraints

- Ambos os workspaces são ESM (`"type": "module"`). Todo import relativo termina em `.js`, mesmo apontando para `.ts`/`.tsx`.
- Validação de entrada da API sempre com Zod.
- Prisma é a única camada de dados. **Esta fase altera o schema** — a única das quatro que pode.
- Nenhuma dependência nova.
- Todo texto de interface e toda mensagem de erro em português do Brasil.
- Comentários explicam **por quê**, não o quê, e são escritos **sem acentuação** — padrão do repositório. A regra vale **só para comentário**: strings visíveis ao usuário mantêm os acentos.
- Tokens de cor reais: texto `--ink`, fundo de painel `--surface`, marca `--brand`, ganho `--gain`, perda `--drop`. Não inventar cor.
- Classes CSS a reusar: `head`, `panel`, `panel__title`, `field`, `row`, `split`, `btn`, `btn--ghost`, `btn--sm`, `chip`, `notice`, `empty`, `tabs`, `tabs__item`, `table`, `num`, `grupos`, `grupo`, `kpi`, `grid-kpi`.
- Não existe runner de testes. A verificação é `npm run build` mais scripts `.check.ts` rodados com `npx tsx`.
- Commits em português, no formato Conventional Commits.

## Regras de segurança que valem para toda a fase

Esta fase age no WhatsApp de produção do usuário. Três regras absolutas:

1. **Nenhum implementador remove ninguém de nenhum grupo real para testar.** Remoção é irreversível e visível para todos os membros. A verificação de remoção ponta a ponta fica para o usuário decidir.
2. **Nenhum implementador derruba container Docker.** Rebuild da `api` é seguro; o `db` nunca.
3. **`git checkout --`, `git reset --hard` e `git clean` são proibidos** neste repositório — um implementador anterior desfez o próprio trabalho não commitado assim.

## Fatos do ambiente

- O ambiente do usuário roda em Docker: painel em `:8090`, API em `:3333`, Postgres em `:5432`. **O Docker estava desligado quando este plano foi escrito** — a Task 1 precisa ligá-lo ou reportar que não conseguiu.
- Migração de schema: o projeto usa `npm run db:push --workspace @oferta-hub/api` (Prisma `db push`), não `migrate`. Confirme no `package.json` antes de rodar.
- O listener `group-participants.update` já existe em `apps/api/src/whatsapp/baileys.ts` (por volta da linha 163) e já grava `GroupMemberEvent` numa transação com o ajuste de `memberCount`. O handler inteiro está num `try/catch` com um comentário explícito: exceção ali pode derrubar a conexão usada para enviar oferta.
- `syncGroups()` (por volta da linha 238) já varre `groupFetchAllParticipating()` e faz upsert de cada grupo.

---

### Task 1: Levantamento do formato de JID e schema novo

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Produces: models `BlockedNumber` e `ModerationLog`, enums `ModerationAction` e `ModerationReason`, e o campo `WhatsappGroup.botIsAdmin`.

**Depends-on:** none.

- [ ] **Step 1: Medir a proporção de LID contra número visível**

Esta medição decide o quanto o Filtro de DDI entrega na prática, e o usuário precisa saber o resultado. Ela vem **antes** do código.

Ligue o Docker se estiver desligado (`docker compose up -d`, ou peça ao usuário para abrir o Docker Desktop). Se não conseguir, **não invente o número** — reporte que não foi possível medir e siga para o Step 2.

```bash
docker compose exec -T db psql -U oferta -d ofertahub -t -A -F' | ' -c "
select case
         when participant like '%@lid' then 'LID (numero oculto)'
         when participant like '%@s.whatsapp.net' then 'numero visivel'
         else 'outro'
       end as tipo,
       count(*)
from \"GroupMemberEvent\" group by 1;"
```

Registre o resultado no relatório, com uma frase dizendo o que ele significa: se a maioria for LID, o Filtro de DDI vai poder avaliar pouca gente.

Traga também uma amostra de 5 valores de `participant` (sem inventar, os reais) para o relatório — o formato exato importa para a Task 2.

- [ ] **Step 2: Acrescentar os models ao schema**

Em `apps/api/prisma/schema.prisma`, acrescentar ao fim (ou perto dos outros models de grupo):

```prisma
/// Numeros barrados em todos os grupos. `phone` guarda so digitos, com DDI,
/// ja normalizado -- e a chave de comparacao contra quem entra.
model BlockedNumber {
  id        String   @id @default(cuid())
  phone     String   @unique
  note      String?
  createdAt DateTime @default(now())
}

/// Registro de toda acao de moderacao, inclusive as que falharam ou foram
/// puladas. Remocao e irreversivel: sem log nao ha como auditar depois.
model ModerationLog {
  id          String           @id @default(cuid())
  groupJid    String
  participant String
  action      ModerationAction
  reason      ModerationReason
  detail      String?
  occurredAt  DateTime         @default(now())

  @@index([groupJid, occurredAt])
  @@index([occurredAt])
}

enum ModerationAction {
  REMOVED
  FAILED
  SKIPPED
}

enum ModerationReason {
  BLOCKLIST
  FOREIGN_DDI
  MANUAL
}
```

E dentro de `model WhatsappGroup`, junto de `memberCount`:

```prisma
  /// Se o numero conectado e admin do grupo. Sem admin nao ha como remover
  /// ninguem, e a tela precisa dizer isso em vez de deixar o usuario ligar uma
  /// protecao que nunca vai agir. Preenchido no syncGroups().
  botIsAdmin Boolean @default(false)
```

- [ ] **Step 3: Aplicar ao banco**

Confirme no `apps/api/package.json` qual é o comando (deve ser `db:push`), e rode-o.

Run: `npm run db:push --workspace @oferta-hub/api`
Expected: aplica sem pedir reset. **Se o Prisma avisar que vai perder dados, PARE e reporte** — nenhuma das mudanças acima deveria destruir nada (duas tabelas novas e um campo com default), então um aviso desses significa que algo está diferente do esperado.

- [ ] **Step 4: Gerar o client e compilar**

Run: `npm run build --workspace @oferta-hub/api`
Expected: sem erro. O `postinstall` roda `prisma generate`; se os tipos novos não aparecerem, rode `npx prisma generate` dentro de `apps/api`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat(api): schema de protecao de grupos (blocklist, log de moderacao, admin)"
```

---

### Task 2: Decisão de moderação, pura e testada

**Files:**
- Create: `apps/api/src/services/protecao.ts`
- Create: `apps/api/src/services/protecao.check.ts`

**Interfaces:**
- Produces:
  - `normalizarNumero(entrada: string): string | null` — só dígitos, forma canônica; `null` se implausível.
  - `numeroDoJid(jid: string): string | null` — extrai o número de `<n>@s.whatsapp.net`; `null` para `@lid` e qualquer outro formato sem número.
  - `type Decisao = { remover: true; motivo: 'BLOCKLIST' | 'FOREIGN_DDI' } | { remover: false; motivo: 'NAO_AVALIAVEL' | 'PERMITIDO' | 'PROPRIO' | 'ADMIN' }`
  - `decidir(params): Decisao` — a decisão completa para um participante.
- Consumes: nada. **Este módulo é puro:** sem Prisma, sem Baileys, sem rede. É o que permite testá-lo de verdade.

**Depends-on:** Task 1 (só para os nomes dos enums; a lógica não importa Prisma).

- [ ] **Step 1: Escrever o self-check que falha**

Criar `apps/api/src/services/protecao.check.ts`:

```ts
/**
 * Self-check da decisao de moderacao. Roda sem banco e sem rede:
 *   npx tsx apps/api/src/services/protecao.check.ts
 *
 * Esta e a logica que decide se alguem e removido de um grupo -- acao
 * irreversivel e visivel pra todo mundo. Cada caso aqui existe porque errar
 * nele significa remover a pessoa errada, ou deixar passar quem devia sair.
 */
import assert from 'node:assert/strict';
import { decidir, normalizarNumero, numeroDoJid } from './protecao.js';

// --- normalizacao ---

// Mesma pessoa escrita de varios jeitos tem que virar a mesma chave.
const canon = normalizarNumero('+55 11 98765-4321');
assert.equal(normalizarNumero('5511987654321'), canon);
assert.equal(normalizarNumero('55 (11) 98765 4321'), canon);
assert.equal(normalizarNumero('  +55-11-987654321  '), canon);

// Numero brasileiro com e sem o nono digito e a MESMA pessoa. Sem isso, quem
// voce barra com nono digito continua entrando sem ele.
assert.equal(normalizarNumero('551187654321'), normalizarNumero('5511987654321'));

// Lixo nao vira chave: guardar torto falha depois em silencio.
assert.equal(normalizarNumero(''), null);
assert.equal(normalizarNumero('abc'), null);
assert.equal(normalizarNumero('123'), null, 'digitos de menos');
assert.equal(normalizarNumero('1'.repeat(20)), null, 'digitos demais');

// --- extracao do JID ---

assert.equal(numeroDoJid('5511987654321@s.whatsapp.net'), normalizarNumero('5511987654321'));
assert.equal(numeroDoJid('209384756@lid'), null, 'LID nao carrega numero');
assert.equal(numeroDoJid('120363000000000000@g.us'), null, 'jid de grupo nao e pessoa');
assert.equal(numeroDoJid(''), null);

// --- decisao ---

const bloqueados = new Set([normalizarNumero('5511999999999')!]);
const base = {
  bloqueados,
  filtroDdiLigado: true,
  ddiPermitido: '55',
  jidProprio: '5511000000000@s.whatsapp.net',
  admins: new Set(['5511777777777@s.whatsapp.net']),
};

// Blocklist manda, mesmo com DDI brasileiro.
assert.deepEqual(decidir({ ...base, jid: '5511999999999@s.whatsapp.net' }), {
  remover: true,
  motivo: 'BLOCKLIST',
});

// Blocklist tem precedencia sobre DDI: o motivo registrado tem que ser o certo,
// senao o log conta a historia errada.
assert.deepEqual(
  decidir({ ...base, bloqueados: new Set([normalizarNumero('447700900000')!]), jid: '447700900000@s.whatsapp.net' }),
  { remover: true, motivo: 'BLOCKLIST' },
);

// DDI estrangeiro com numero visivel: remove.
assert.deepEqual(decidir({ ...base, jid: '447700900000@s.whatsapp.net' }), {
  remover: true,
  motivo: 'FOREIGN_DDI',
});

// Brasileiro comum fica.
assert.deepEqual(decidir({ ...base, jid: '5521912345678@s.whatsapp.net' }), {
  remover: false,
  motivo: 'PERMITIDO',
});

// LID nunca e removido por DDI: o numero nao veio, entao nao da pra saber.
// Remover por suposicao seria expulsar alguem inocente.
assert.deepEqual(decidir({ ...base, jid: '209384756@lid' }), {
  remover: false,
  motivo: 'NAO_AVALIAVEL',
});

// Mas LID na blocklist tambem nao e removido -- nao da pra comparar sem numero.
assert.equal(decidir({ ...base, jid: '999@lid' }).remover, false);

// A propria conta nunca sai.
assert.deepEqual(decidir({ ...base, jid: base.jidProprio }), { remover: false, motivo: 'PROPRIO' });

// Admin do grupo nunca sai, nem se estiver na blocklist.
assert.deepEqual(
  decidir({ ...base, bloqueados: new Set([normalizarNumero('5511777777777')!]), jid: '5511777777777@s.whatsapp.net' }),
  { remover: false, motivo: 'ADMIN' },
);

// Filtro desligado: estrangeiro fica.
assert.deepEqual(decidir({ ...base, filtroDdiLigado: false, jid: '447700900000@s.whatsapp.net' }), {
  remover: false,
  motivo: 'PERMITIDO',
});

// Filtro desligado nao desliga a blocklist.
assert.equal(decidir({ ...base, filtroDdiLigado: false, jid: '5511999999999@s.whatsapp.net' }).remover, true);

// Blocklist vazia e filtro desligado: ninguem sai.
assert.equal(
  decidir({ ...base, bloqueados: new Set(), filtroDdiLigado: false, jid: '447700900000@s.whatsapp.net' }).remover,
  false,
);

console.log('protecao.check: ok');
```

- [ ] **Step 2: Rodar o check e ver falhar**

Run: `npx tsx apps/api/src/services/protecao.check.ts`
Expected: FALHA com `Cannot find module` apontando para `./protecao.js`.

- [ ] **Step 3: Escrever o módulo**

Criar `apps/api/src/services/protecao.ts`. Pontos de desenho que o check exige:

- A ordem da decisão é: própria conta → admin → blocklist → DDI → permitido. Cada guarda antes protege de um engano irreversível.
- Números brasileiros: a forma canônica precisa fazer `5511987654321` e `551187654321` colidirem. Uma saída é, para DDI 55 com DDD, remover o nono dígito quando ele existir — mas **decida com cuidado e comente o porquê**, porque essa regra vale só para o Brasil.
- Comprimento plausível: um número internacional com DDI tem aproximadamente 10 a 15 dígitos. Ajuste os limites para que os casos do check passem.
- `numeroDoJid` só aceita o sufixo de pessoa com número. Qualquer outro sufixo devolve `null`.

Escreva o módulo sem importar nada do Prisma nem do Baileys — se precisar de um tipo do enum, use união de strings literais. É isso que mantém o check rodando sem banco.

- [ ] **Step 4: Rodar o check e ver passar**

Run: `npx tsx apps/api/src/services/protecao.check.ts`
Expected: imprime `protecao.check: ok`.

- [ ] **Step 5: Compilar**

Run: `npm run build --workspace @oferta-hub/api`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/protecao.ts apps/api/src/services/protecao.check.ts
git commit -m "feat(api): decisao de moderacao de grupo, pura e coberta por self-check"
```

---

### Task 3: Ritmo, execução da remoção e admin no sync

**Files:**
- Create: `apps/api/src/services/moderacao.ts`
- Modify: `apps/api/src/whatsapp/baileys.ts`
- Modify: `apps/api/src/env.ts`

**Interfaces:**
- Consumes: da Task 2 — `decidir`, `normalizarNumero`, `numeroDoJid`. Da Task 1 — os models novos.
- Produces:
  - `carregarConfig(): Promise<{ escudo: boolean; ddi: boolean }>` — lê de `AppSetting`.
  - `salvarConfig(parcial): Promise<void>`
  - `removerParticipante(groupJid, jid, motivo): Promise<'REMOVED' | 'FAILED' | 'SKIPPED'>` — respeita ritmo e teto, registra em `ModerationLog`.
  - `avaliarEntrada(groupJid, jids): Promise<void>` — o que o listener chama.
  - `whatsapp.removerDoGrupo(groupJid, jid)` exposto pela classe do Baileys.

**Depends-on:** Task 1, Task 2.

- [ ] **Step 1: Variáveis de ambiente do ritmo**

Em `apps/api/src/env.ts`, dentro do bloco `wa`, acrescentar os dois controles, seguindo o padrão dos que já existem:

```ts
    /** Intervalo minimo entre remocoes. Remocao em rajada e padrao que o
     *  WhatsApp detecta -- o numero do usuario e o ganha-pao dele. */
    moderacaoIntervaloSegundos: Math.max(10, Number(process.env.WA_MODERACAO_INTERVALO_SEGUNDOS ?? 20)),
    /** Teto diario de remocoes. Conservador de proposito. */
    moderacaoTetoDiario: Number(process.env.WA_MODERACAO_TETO_DIARIO ?? 30),
```

Acrescente as duas ao `.env.example` com um comentário curto, se o arquivo existir.

- [ ] **Step 2: Expor a remoção no Baileys**

Em `apps/api/src/whatsapp/baileys.ts`, acrescentar um método à classe:

```ts
  /**
   * Remove um participante do grupo. Exige que o numero conectado seja admin --
   * sem isso o WhatsApp recusa e a chamada volta com erro.
   */
  async removerDoGrupo(groupJid: string, participantJid: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp desconectado. Conecte em Configurações › Canais.');
    await this.sock.groupParticipantsUpdate(groupJid, [participantJid], 'remove');
  }
```

Confirme a assinatura real de `groupParticipantsUpdate` na versão do Baileys instalada antes de escrever — leia os tipos em `node_modules/@whiskeysockets/baileys`. Não assuma.

- [ ] **Step 3: Guardar quem é admin no sync**

No `syncGroups()` (por volta da linha 238), o `meta.participants` traz o papel de cada um. Descubra o JID da própria conta (`this.sock.user?.id`, normalizado) e grave se ele é admin:

```ts
      const eu = ...; // jid da propria conta, normalizado
      const botIsAdmin = meta.participants.some((p) => p.id === eu && (p.admin === 'admin' || p.admin === 'superadmin'));
```

**Confirme o formato real** de `sock.user.id` e de `p.admin` lendo os tipos do Baileys — `sock.user.id` costuma vir com sufixo de dispositivo (`:12`) que precisa ser tirado antes de comparar. Se não conseguir determinar com segurança, **reporte em vez de chutar**: um `botIsAdmin` errado faz a tela mentir sobre o que consegue fazer.

Passe `botIsAdmin` ao `upsert` que já existe.

- [ ] **Step 4: O módulo de moderação**

Criar `apps/api/src/services/moderacao.ts` com:

- `carregarConfig` / `salvarConfig` lendo e gravando duas chaves em `AppSetting` (por exemplo `protecao_escudo` e `protecao_ddi`), com padrão desligado. Proteção que liga sozinha é proteção que remove sem ninguém ter pedido.
- Um contador diário de remoções em `AppSetting`, com a chave contendo a data — o mesmo espírito de `SendLog`, mas sem tabela nova.
- `removerParticipante(groupJid, jid, motivo)`:
  1. Se o teto diário foi atingido: registra `SKIPPED` com detalhe dizendo isso e devolve `'SKIPPED'`.
  2. Espera o intervalo mínimo desde a última remoção.
  3. Chama `whatsapp.removerDoGrupo`.
  4. Em sucesso: incrementa o contador, registra `REMOVED`, devolve `'REMOVED'`.
  5. Em erro: registra `FAILED` com a mensagem, devolve `'FAILED'`. **Não repete em laço** — insistir numa remoção que o WhatsApp recusou é exatamente o padrão que queima o número.
- `avaliarEntrada(groupJid, jids)`:
  1. Carrega config; se as duas estiverem desligadas, retorna sem tocar no banco.
  2. Lê `botIsAdmin` do grupo; se falso, registra `SKIPPED` para cada um e retorna.
  3. Carrega a blocklist e os admins do grupo.
  4. Para cada JID, chama `decidir` da Task 2 e age conforme.

Registrar `SKIPPED` para quem não foi removido por não ser avaliável **é o ponto**: é o que permite ao usuário descobrir que o Filtro de DDI está vendo pouca coisa.

- [ ] **Step 5: Ligar no listener**

No handler de `group-participants.update` em `baileys.ts`, **depois** da transação que já existe, e só quando `action === 'add'`:

```ts
        if (action === 'add') {
          // Depois de registrar o evento, nunca antes: moderacao que falha nao
          // pode custar o historico de entrada/saida.
          await avaliarEntrada(groupJid, participants);
        }
```

Isso fica **dentro** do `try/catch` que já existe. O comentário no topo do handler é explícito: exceção ali pode derrubar a conexão usada para enviar oferta. A moderação nunca pode custar o envio.

- [ ] **Step 6: Compilar e rodar os checks**

Run: `npm run build --workspace @oferta-hub/api && npx tsx apps/api/src/services/protecao.check.ts`
Expected: build limpo e `protecao.check: ok`.

- [ ] **Step 7: Verificar sem remover ninguém**

Rebuild da API no Docker e confira, **sem acionar remoção**:

- O boot não quebra e o WhatsApp reconecta (`curl -s http://127.0.0.1:3333/health` diz `connected`).
- Depois de um `POST /api/whatsapp/sync-groups`, a coluna `botIsAdmin` foi preenchida:

```bash
docker compose exec -T db psql -U oferta -d ofertahub -t -A -F' | ' -c "select name, \"botIsAdmin\", \"memberCount\" from \"WhatsappGroup\";"
```

Compare com a realidade: o número do usuário é admin nesses grupos? Reporte o que encontrou. **Não** altere nada para "consertar" o resultado.

**Não teste a remoção.** É irreversível e visível para todos os membros do grupo do usuário.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/moderacao.ts apps/api/src/whatsapp/baileys.ts apps/api/src/env.ts
git commit -m "feat(api): moderacao de entrada com ritmo, teto diario e registro"
```

---

### Task 4: Rotas de proteção

**Files:**
- Create: `apps/api/src/routes/protecao.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: das tarefas 1 a 3.
- Produces:
  - `GET /api/protecao` → `{ escudo, ddi, bloqueados: [{id, phone, note, createdAt}], grupos: [{jid, name, botIsAdmin}] }`
  - `PUT /api/protecao` ← `{ escudo?, ddi? }`
  - `POST /api/protecao/bloqueados` ← `{ numero, note? }`
  - `DELETE /api/protecao/bloqueados/:id`
  - `POST /api/protecao/escanear` ← `{ blocklist: boolean, ddi: boolean }` → `{ achados: [...], naoAvaliaveis: number, gruposSemAdmin: [...] }`
  - `POST /api/protecao/remover` ← `{ alvos: [{ groupJid, jid }] }` → `{ removidos, falhas, pulados, detalhes }`

**Depends-on:** Task 3.

- [ ] **Step 1: Escrever as rotas**

Criar `apps/api/src/routes/protecao.ts`. Pontos que valem cuidado:

- Toda entrada validada com Zod, mensagens em português.
- `POST /api/protecao/bloqueados` normaliza antes de gravar. Número inválido: 400 com mensagem clara. Número já existente: **não é erro** — devolve o registro existente.
- `POST /api/protecao/escanear` **não remove nada**. Ela lê os participantes de cada grupo pelo Baileys, aplica `decidir` e devolve a lista. Grupos onde `botIsAdmin` é falso entram em `gruposSemAdmin` e **seus membros não entram em `achados`** — mostrar alguém que não dá para remover é prometer o que não se cumpre.
- `escanear` com os dois critérios falsos: 400 pedindo para marcar pelo menos um.
- `POST /api/protecao/remover` recebe a **lista explícita** de alvos, não critérios. Para cada alvo, chama `removerParticipante` com motivo `MANUAL`. Devolve o placar e o detalhe por alvo.
- Nenhuma das rotas aceita "remova tudo que se encaixa". Essa assimetria é deliberada: o que o usuário viu na tela é exatamente o que sai.

- [ ] **Step 2: Registrar no servidor**

Em `apps/api/src/server.ts`, importar e registrar `protecaoRoutes` **dentro** do bloco que aplica `requireAuth` — é o mesmo cuidado que a rota de troca de senha teve. Rotas que removem gente de grupo não podem ficar abertas.

- [ ] **Step 3: Compilar**

Run: `npm run build --workspace @oferta-hub/api`

- [ ] **Step 4: Verificar as rotas de leitura**

Rebuild no Docker. Com sessão (`curl -s -c cookie.txt -X POST http://127.0.0.1:3333/api/login -H 'content-type: application/json' --data-binary @senha.json`, senha em `DASHBOARD_PASSWORD` no `.env`; **corpo JSON com acento quebra em `curl -d` no Git Bash, use `--data-binary @arquivo`**; apague os dois arquivos depois e **nunca** os commite):

- `GET /api/protecao` devolve config desligada e blocklist vazia.
- `POST /api/protecao/bloqueados` com `{"numero":"+55 11 90000-0000"}` grava normalizado; repetir devolve o mesmo registro sem erro; `{"numero":"abc"}` devolve 400 em português.
- `POST /api/protecao/escanear` com `{"blocklist":true,"ddi":false}` devolve a lista **sem remover ninguém**. Confira no banco que nenhum `ModerationLog` com `REMOVED` apareceu.
- `POST /api/protecao/escanear` com os dois falsos devolve 400.

**Não chame `POST /api/protecao/remover`.** Deixe essa verificação para o usuário.

Apague o número de teste da blocklist ao terminar, e diga no relatório qual usou.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/protecao.ts apps/api/src/server.ts
git commit -m "feat(api): rotas de protecao de grupos"
```

---

### Task 5: Aba Proteção em Meus Grupos

**Files:**
- Modify: `apps/web/src/pages/MeusGrupos.tsx`
- Create: `apps/web/src/pages/grupos/Monitor.tsx`
- Create: `apps/web/src/pages/grupos/Protecao.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: as rotas da Task 4.

**Depends-on:** Task 4.

- [ ] **Step 1: Extrair o Monitor**

O conteúdo atual de `MeusGrupos.tsx` (indicadores e cartões, da fase 3) vira `grupos/Monitor.tsx`, exportando `Monitor`. Recorte mecânico: renomear a função, corrigir os imports relativos de `../` para `../../`. Nada de lógica muda.

`MeusGrupos.tsx` vira a casca com duas abas — **Monitor** (inicial) e **Proteção** — no mesmo padrão que `Configuracoes.tsx` e `Automacoes.tsx` já usam.

- [ ] **Step 2: A aba Proteção**

Criar `apps/web/src/pages/grupos/Protecao.tsx`, seguindo a referência do usuário:

- Linha de apoio no topo: que isso mantém os grupos limpos e reduz risco de ban, e que **vale para os grupos onde o número conectado é admin**.
- **Cartão Escudo**: liga-desliga, campo "Número com DDI (ex.: 55 11 99999-9999)" com botão de adicionar, e a lista do que está barrado com ação de remover cada um. Estado vazio: "Nenhum número na blocklist ainda."
- **Cartão Filtro de DDI**: liga-desliga e a explicação. **Inclua a ressalva** de que o filtro só age quando o WhatsApp mostra o número — é honestidade sobre o que a função consegue fazer, e a spec exige.
- **Cartão Guilhotina**, largura cheia, com aviso de ação destrutiva: duas caixas de seleção ("Na blocklist", "DDI estrangeiro") e o botão "Escanear grupos".
  - O resultado vem como lista com caixa de seleção por pessoa, mostrando número, grupo e motivo.
  - Se houver não avaliáveis, mostre a contagem e explique em uma linha por quê.
  - Se houver grupos sem admin, liste-os como não protegidos.
  - O botão de remover diz quantos serão removidos e usa `var(--drop)`. **Confirmação antes de executar**, com o número de pessoas no texto.
  - Depois de executar, mostre o placar: removidos, falhas, pulados.

Grupos sem admin e pessoas não avaliáveis **nunca** entram na lista selecionável.

- [ ] **Step 3: Compilar**

Run: `npm run build --workspace @oferta-hub/web`

- [ ] **Step 4: Verificar na tela**

`cd apps/web && npx vite --port 5199 --strictPort`, abrir `http://localhost:5199/grupos`.

- As duas abas aparecem; Monitor é a inicial e continua igual à fase 3.
- Em Proteção: os dois liga-desliga refletem o estado do servidor e persistem ao recarregar.
- Adicionar um número à blocklist funciona; adicionar de novo não duplica; número inválido mostra erro em português.
- "Escanear grupos" com nenhum critério marcado avisa.
- "Escanear grupos" com um critério devolve resultado **sem remover ninguém**.

**Não clique no botão de remover da Guilhotina.** Ele remove pessoas de verdade dos grupos do usuário. Deixe essa verificação para ele.

Apague o número de teste ao terminar e diga qual usou. Derrube o Vite.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/MeusGrupos.tsx apps/web/src/pages/grupos/ apps/web/src/styles.css
git commit -m "feat(web): aba Protecao em Meus Grupos com Escudo, filtro de DDI e Guilhotina"
```

---

## Ordem de execução

Cadeia quase linear, porque cada camada depende da anterior:

- **Onda 1:** Task 1 (schema + medição).
- **Onda 2:** Task 2 (decisão pura).
- **Onda 3:** Task 3 (ritmo, Baileys, listener).
- **Onda 4:** Task 4 (rotas).
- **Onda 5:** Task 5 (tela).

## Verificação final da fase

- [ ] `npm run build` limpo na raiz.
- [ ] `npx tsx apps/api/src/services/protecao.check.ts` → `protecao.check: ok`
- [ ] Os três checks das fases anteriores continuam passando (`stats-offers`, `garimpar-merge`, `senha`).
- [ ] A medição de LID contra número visível foi feita e reportada ao usuário.
- [ ] `botIsAdmin` preenchido e conferido contra a realidade.
- [ ] Escanear devolve lista coerente e **não** cria nenhum `ModerationLog` com `REMOVED`.
- [ ] As proteções chegam **desligadas** por padrão.
- [ ] Nenhuma pessoa foi removida de nenhum grupo real durante a implementação.
