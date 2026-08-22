# Retomar amanhã — melhorias de frontend (Garimpa Links como referência)

Sessão de 2026-08-22 à noite, modo automático (usuário foi dormir/desligou o PC).
Este arquivo é o ponto de retomada — leia ele inteiro antes de continuar.

## Onde está o trabalho

- **Worktree:** `C:\APPWEB\oferta-hub-worktrees\frontend-melhorias`
- **Branch:** `frontend-melhorias` (criada a partir de `docker-e-identidade` @ `7fb9361`)
- Repo principal (`C:\APPWEB\oferta-hub`) continua em `docker-e-identidade`, intocado por este trabalho.
- **IMPORTANTE — nunca rodar `npm run dev` / `npm run dev:api` neste projeto.** A API conecta automático numa conta real de WhatsApp via Baileys assim que sobe (descoberto e travado numa sessão anterior). Toda verificação aqui é `npm run build --workspace=apps/web` (typecheck) + revisão de diff, nunca dev server ao vivo.
- **Nunca tocar nos containers Docker rodando nem rodar migration contra o Postgres ao vivo** sem o usuário revisar acordado — combinado explicitamente com ele.

## Decisões já travadas (não re-perguntar, já foram aprovadas)

- Automações (regra recorrente existente) **fica como está**; Disparos é fluxo novo, aditivo, não substitui nem apaga nada.
- Visão Geral vira a rota raiz `/`; Fila muda pra `/fila`.
- Templates (com CTA rotativo) são **aditivos**, usados só pelo Disparos — não mexem em como a Fila já monta a mensagem de cada oferta hoje.
- Disparos puxa as ofertas de dentro da Fila (fila de curadoria já aprovada), usando o status `QUEUED` que já existe no schema Prisma (`Offer.status`) e hoje nunca é usado.
- Dark mode: botão manual (não segue preferência do SO), tema persistido em `localStorage`.

## Ordem dos sub-projetos

1. ~~Dark mode~~ — **COMPLETO**
2. Visão geral — **EM ANDAMENTO** (ver abaixo)
3. Fila: filtro por plataforma
4. Templates + CTA rotativo
5. Disparos (convive com Automações)
6. Meus Grupos (métricas de membro)
7. Configurações reestruturada (Conexões vira aba dentro dela)
8. Nova aba Garimpar

## Status detalhado por sub-projeto

### 1. Dark mode — COMPLETO ✅

- Commit: `ba5b576` — "feat(web): modo escuro com toggle em Conexões"
- Review: aprovado, sem Critical/Important. Um Minor pendente (não bloqueia):
  `.catbox__item input` usa `accent-color: var(--ink)`, não foi tratado no
  flip — o tique da checkbox pode ficar quase-branco no dark. Cosmético,
  resolver se notar ao vivo.
- Relatório completo: `.superpowers/dark-mode-report.md` (dentro do worktree)

### 2. Visão Geral — EM ANDAMENTO ⏳

Um subagent foi despachado (implementer, modelo sonnet) pra construir isso,
mas a sessão foi interrompida (desligamento do PC) antes de terminar.
**Estado confirmado no momento do desligamento** (checado logo antes de
salvar este arquivo): `git status --short` mostrava

```
 M apps/web/src/App.tsx
 M apps/web/src/components/Layout.tsx
```

ou seja, o subagent já tinha editado a rota e o nav (passo 2 do brief),
mas **ainda não tinha criado `apps/web/src/pages/VisaoGeral.tsx`** (passo 3)
nem commitado nada. Nada foi perdido — está tudo em disco no worktree,
só não commitado. **Primeira coisa a fazer amanhã: checar o estado atual**
(pode ter mudado se o processo teve tempo de continuar antes do SO matar
ele de fato):

```bash
cd /c/APPWEB/oferta-hub-worktrees/frontend-melhorias
git log --oneline -3          # tem commit novo depois de ba5b576?
git status --short            # tem coisa suja/incompleta?
cat .superpowers/visao-geral-report.md 2>/dev/null   # relatório existe?
```

- **Se tem commit novo com o relatório presente:** o subagent terminou.
  Leia o relatório, gere o diff (`git diff ba5b576..HEAD`), despache um
  revisor (mesmo padrão usado no dark mode — ver "Padrão de revisão"
  abaixo), resolva achados, feche o sub-projeto 2 no ledger, siga pro 3.
- **Se não tem commit novo:** o subagent foi interrompido no meio. No
  momento em que este arquivo foi salvo, `App.tsx` e `Layout.tsx` já
  estavam editados (rota + nav) mas `VisaoGeral.tsx` ainda não existia.
  Revise `git diff` desses dois arquivos contra o design descrito abaixo
  antes de confiar neles — se baterem, aproveite e só falta criar a
  página nova; se não baterem ou parecerem quebrados, descarte
  (`git checkout -- apps/web/src/App.tsx apps/web/src/components/Layout.tsx`
  DEPOIS de olhar, nunca antes de olhar) e re-despache do zero com o
  mesmo design.

**Design já decidido pra esse sub-projeto** (reusar se precisar redespachar):

- Nova página `apps/web/src/pages/VisaoGeral.tsx`.
- Rota: `App.tsx` — `/` vira `VisaoGeral`, Fila move pra `/fila`.
- Nav: `Layout.tsx` — `GROUPS` ganha um novo item `{ label: null, items:
  [{ to: '/', label: 'Visão geral', end: true }] }` antes do item da Fila;
  o item da Fila passa a apontar pra `/fila` (sem `end: true`); a
  condição do badge de contagem pendente (`l.to === '/'`) vira
  `l.to === '/fila'`.
- Dados: `GET /api/stats/overview?days=1` (pending/queued não são
  filtrados por data no backend, então days=1 é seguro) dá pending,
  queued, clicks.value, sent.value. `GET /api/whatsapp/status` dá
  `groups.length` (grupos ativos).
- Reusar CSS existente: `.panel`, `.panel--hero` (do redesign
  sidebar/hero desta mesma noite), `.grid-kpi`/`.kpi`, `.empty`. Evitar
  classe nova se já existe algo que serve.
- Card hero: **não prometer** fluxo "Garimpar" (aba 8, não existe ainda)
  — aponta pra `/fila` com copy honesto.
  Blocos de "Disparos em andamento" e os dois placeholders (ranking de
  conversão / melhores horários): Disparos (sub-projeto 5) não existe
  ainda — renderizar como painel `.empty` honesto ("em breve"), não
  dado fake.

### 3-8. Ainda não iniciados

Contexto de investigação já levantado (não precisa re-explorar do zero):

- **Schema Prisma relevante já existe:** `Offer.status` tem `QUEUED`
  (não usado hoje — é pra Disparos). `Category` já tem dados de
  categoria da Shopee (feed diário) — a aba Garimpar reaproveita, não
  precisa model novo pra isso. `WhatsappGroup` só tem jid/name/isDefault
  — **não tem contagem de membro nem histórico** — Meus Grupos (sub-projeto
  6) precisa de infra nova: ouvir eventos do Baileys
  (`group-participants.update`) + tabela de histórico/snapshot.
- **Automações (`AutomationRule`) já existe** e é regra recorrente por
  nicho/horário — DIFERENTE do que "Disparos" deve ser (fila manual,
  escolhida à mão, disparo único ou agendado, com progresso e cancelar).
  Não confundir os dois, não reaproveitar o model `AutomationRule` pra
  Disparos — é um model novo.
- **Templates de mensagem não existem** como entidade hoje — só o texto
  final já pronto por oferta (`Offer.message`, editável na Fila via
  "Refazer pelo modelo"). O sistema de Templates+CTA do sub-projeto 4 é
  aditivo, novo, não mexe nisso.
- **Conexões (`apps/web/src/pages/Conexoes.tsx`) já existe e funciona**
  — WhatsApp, extensão do ML, credenciais de plataforma. Sub-projeto 7
  deve mover esse conteúdo pra dentro de uma aba "Canais" dentro de uma
  nova página Configurações, não duplicar.

Nenhum desses 6 sub-projetos foi desenhado em detalhe ainda (sem spec,
sem plano). Ao retomar, seguir o processo normal: brainstorming (a
maioria vai ser "architectural" — model novo no Prisma — exceto o
filtro de plataforma na Fila, que é bounded) → spec se arquitetural →
plano → subagent-driven-development, no mesmo worktree/branch
`frontend-melhorias`.

## Padrão de revisão usado até agora

Não existe `scripts/review-package` aplicável aqui (é específico do
fluxo de plano formal do skill `subagent-driven-development` e exige um
arquivo de plano — este trabalho não tem um plano `.md` formal, é mais
leve). Em vez disso, gerar o diff manualmente:

```bash
mkdir -p .superpowers/reviews
git log --oneline BASE..HEAD > .superpowers/reviews/NOME.diff
git diff --stat BASE..HEAD >> .superpowers/reviews/NOME.diff
git diff -U10 BASE..HEAD >> .superpowers/reviews/NOME.diff
```

E despachar um subagent revisor (general-purpose, modelo sonnet) apontando
pra esse arquivo, pedindo formato Spec Compliance / Strengths / Issues
(Critical/Important/Minor) / Assessment — mesmo prompt usado pro dark
mode, é só copiar a estrutura.

## Quando tudo terminar

Seguir o mesmo fluxo usado no redesign de sidebar/hero desta sessão:
review final de branch inteira (modelo mais capaz, opus) → fix wave se
achar algo → re-review escopado → merge local pra `docker-e-identidade`
(NUNCA rebuild Docker nem migration ao vivo sem o usuário revisar
acordado) → perguntar se quer rebuildar o container web depois.

## Ledger completo

`.superpowers/overnight-progress.md` (dentro do worktree) tem o log
sub-projeto a sub-projeto, mais granular que este arquivo.
