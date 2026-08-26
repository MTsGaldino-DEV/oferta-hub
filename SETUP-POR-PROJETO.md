# Setup por-projeto — Vibe Coding Toolkit

> **Como usar:** cole este arquivo inteiro na raiz do projeto que você quer
> configurar e peça pro Claude Code: *"Leia SETUP-POR-PROJETO.md e execute
> os passos dele neste projeto."* Este arquivo é autocontido — todo
> conteúdo que precisa ser criado já está aqui dentro, em blocos de código
> prontos pra copiar. Não é necessário ter o repositório
> `vibe-coding-toolkit` por perto.
>
> Pré-requisito: a instalação global já feita na máquina — ver
> `INSTALACAO-GLOBAL.md`. Isso inclui Superpowers, Ponytail, Caveman, mais
> um conjunto maior de plugins/skills/MCP servers (Context7, Chrome
> DevTools MCP, aia-harness, ui-ux-pro-max, as Skills oficiais da
> Anthropic, Graphify, agent-browser). Nada disso precisa ser reinstalado
> por projeto — está ativo em toda sessão, em qualquer pasta. Ver seção
> "Ferramentas globais já disponíveis" mais abaixo pra saber o que cada
> uma faz e quando ela entra em ação sozinha.

---

## Instruções para o Claude Code (execute nesta ordem)

### Passo 0 — Não pise em trabalho existente

Antes de criar qualquer arquivo, verifique se já existe `CLAUDE.md` ou
`.claude/settings.json` na raiz do projeto. Se existir, **não sobrescreva**
— mostre o que já tem e pergunte se é pra atualizar, mesclar, ou pular
aquele arquivo específico.

### Passo 1 — Detecte o stack real do projeto

Leia `package.json` (ou `requirements.txt`/`pyproject.toml`,
`go.mod`, `Cargo.toml`, conforme a linguagem) na raiz e em qualquer
workspace/monorepo. Identifique: linguagem(ns), framework(s) principal(is),
gerenciador de pacote, e os comandos reais de install/lint/typecheck/test/
build/dev — olhando o campo `scripts` (ou equivalente). **Nunca invente um
comando que não existe no projeto** — se lint ou test não estiverem
configurados, marque como "ainda não configurado" em vez de chutar.

### Passo 2 — Crie o `CLAUDE.md` na raiz

Use o template abaixo. Substitua `[PROJECT NAME]`, a seção **Stack**, os
seis **Canonical commands**, e a seção **Conventions** pelo que foi
detectado no Passo 1. Na **tabela de especialistas**, mantenha as linhas
genéricas que sempre se aplicam (`orchestrator`, `code-reviewer`,
`test-engineer`) e adicione/troque linhas puxando da tabela completa de
referência (mais abaixo neste arquivo, seção "Roster completo de
especialistas") conforme o domínio real do projeto — não copie o roster
inteiro, só o que esse projeto especificamente usa.

```markdown
# [PROJECT NAME]

> Project memory for Claude Code. Keep this file short and high-signal.

## Behavioral guidelines

1. **Think before coding** — state assumptions explicitly. If multiple interpretations exist, present them instead of picking silently. Say so when a simpler approach exists. If something is genuinely unclear, stop and ask.
2. **Simplicity first** — minimum code that solves the problem. No speculative features, no abstractions for single-use code, no unrequested configurability, no error handling for impossible scenarios.
3. **Surgical changes** — touch only what the request requires. Match existing style. Don't refactor, reformat, or "improve" adjacent code that wasn't part of the request.
4. **Goal-driven execution** — turn tasks into verifiable goals (e.g. "fix the bug" becomes "write a test that reproduces it, then make it pass"). For multi-step work, state a brief plan with a verify check per step, then loop until every step is verified.
5. **Orchestrator, not implementer** — the main session plans, decides, and coordinates; it does not implement. Delegable implementation and analysis goes to a specialist subagent, dispatched in parallel when task scopes don't conflict.

## Stack

[PLACEHOLDER: linguagens, frameworks, gerenciador de pacote]

## Canonical commands

Always use the exact commands here — don't guess.

- **Install:** `[PLACEHOLDER]`
- **Lint:** `[PLACEHOLDER ou "não configurado ainda"]`
- **Typecheck:** `[PLACEHOLDER ou "não configurado ainda"]`
- **Test:** `[PLACEHOLDER ou "não configurado ainda"]`
- **Build:** `[PLACEHOLDER]`
- **Run/Dev:** `[PLACEHOLDER]`

## Specialist agent routing table

When work is delegable, dispatch the specialist that matches the task instead of a generic agent.

| Agent | When to use |
|---|---|
| `orchestrator` | Coordinates multi-agent or cross-domain tasks by delegating to specialized agents. |
| `code-reviewer` | Reviews code changes for bugs, error handling, and test coverage. Use after editing any source file. |
| `test-engineer` | Writes unit and integration tests, covering edge cases. Use after implementing new logic. |
[PLACEHOLDER: adicione aqui as linhas do roster completo que fazem sentido pro domínio deste projeto]

## Conventions

[PLACEHOLDER: import style, testing conventions, formatting/linting rules, error-handling patterns, etc.]
```

### Passo 3 — Crie `.claude/settings.json`

Crie a pasta `.claude/` se não existir, e o arquivo `.claude/settings.json`
com este conteúdo mínimo (sem hooks reais ainda — são placeholders):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/example-command-proxy.mjs"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/example-session-banner.mjs"
          }
        ]
      }
    ]
  },
  "env": {
    "EXAMPLE_API_KEY": "${EXAMPLE_API_KEY}"
  }
}
```

Se o projeto não vai escrever hooks reais agora, **remova o bloco
`hooks` inteiro** em vez de deixar comandos apontando pra arquivos `.mjs`
que não existem — um `settings.json` com hook quebrado falha silenciosamente
pior que não ter hook nenhum. Nunca hardcode uma chave real dentro deste
arquivo — sempre `${NOME_DA_VAR}`, com o valor de verdade num `.env` fora
do controle de versão.

Se o projeto for escrever um hook de verdade depois, o helper de leitura
seguro de stdin (evita o bug de `JSON.parse("null")` não lançar erro) é
este, salvo em `.claude/hooks/hook-io.mjs`:

```js
import { readFileSync } from "node:fs";

export function readStdinRaw() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function parseHookEvent(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null) {
    return null;
  }
  return parsed;
}
```

### Passo 4 — Pergunte se o projeto vai usar ondas paralelas

Se o usuário confirmar que sim (recomendado quando o plano tem tasks
genuinamente independentes — ex.: back-end e front-end sem dependência
entre si), crie `.claude/rules/parallel-subagent-driven-development.md`
com o conteúdo abaixo, e adicione uma linha no `CLAUDE.md` referenciando
essa regra (ex.: `Ver .claude/rules/parallel-subagent-driven-development.md
pra execução em ondas paralelas.`):

```markdown
# Parallel Subagent-Driven Development

## Problem

The base subagent-driven-development pattern dispatches one implementer at a
time. That default is safe — but slow when a plan contains genuinely
independent tasks. The naive fix, dispatching every task in parallel, is
fast but unsafe in two specific ways:

- Two agents can edit the same file concurrently, and one's write silently
  clobbers the other's.
- Two agents can race each other to `git commit`, interleaving unrelated
  changes into a single commit or committing against a stale HEAD.

This rule describes when full parallel dispatch is safe, and how to
structure it so it stays safe.

## Why this override is safe

Both failure modes above are removed structurally, not by discipline or
convention:

- **File collisions** are prevented by only ever forming a wave from tasks
  whose file sets are fully disjoint. If two tasks might touch the same
  file, they never run in the same wave.
- **Commit races** are prevented by removing self-committing from
  implementers entirely. Implementers leave their changes in the working
  tree; the controller commits every task's changes itself, one at a time,
  after the wave finishes.

Because both preconditions that make parallel dispatch dangerous are
structurally absent, running independent tasks concurrently is no riskier
than running them serially — it's just faster.

## Task tagging

At plan time, every task gets two fields:

- **`Files:`** — the exact file paths or globs the task will create or
  modify.
- **`Depends-on:`** — the IDs of tasks whose output this task consumes, or
  `none`.

If either field is missing, or there's genuine uncertainty about what a
task touches or depends on, treat the task as depending on everything
before it. This is the fail-safe: an under-specified task silently
degrades to serial execution instead of risking a false-parallel bug.
Never guess a narrower scope than you actually know.

## Wave formation rule

Two tasks belong in the same wave if and only if **both** hold:

1. Neither task is in the other's `Depends-on` chain, even transitively.
2. Their `Files` sets are fully disjoint.

If either condition fails, the later or colliding task moves to a
subsequent wave.

A fully linear dependency chain (task 2 depends on task 1, task 3 depends
on task 2, …) degrades to exactly one task per wave — identical to plain
serial execution. There's no regression versus not using this rule at all;
it only adds concurrency where the plan actually has it.

## Per-wave execution loop

For each wave, in order:

1. Write one task-brief file per task in the wave.
2. Dispatch every implementer in the wave in a single message. This is the
   only step where real parallelism happens.
3. Implementers do **not** commit. Each one leaves its changes in the
   working tree and reports back which files it touched.
4. The controller commits per task, in wave order — capturing the current
   HEAD fresh immediately before each commit, never a stale or hardcoded
   ref.
5. Once commits exist for the wave, dispatch that wave's task reviewers
   together. This is safe because review is read-only — each reviewer is
   scoped to its own task's commit range.
6. Make exactly one controller-owned log or ledger write for the whole
   wave, not one per task. Concurrent per-task writes to the same log race
   each other and lose updates; a single write after the wave completes
   doesn't.

## Escape hatch

Sometimes two tasks genuinely can't avoid touching the same files. When
that happens, don't force them into a shared wave — isolate each
implementer in its own git worktree or branch instead, so self-committing
becomes safe again inside that isolated copy.

This is expensive: real disk space and setup cost per isolated agent. Use
it as a last resort for the rare unavoidable collision, not as a default
way to parallelize.

## What this does not change

This rule changes orchestration only:

- The specialist type dispatched for each task still comes from your
  project's specialist-routing table, matched to the task's file scope —
  this rule doesn't add or replace agent types.
- The prompt body given to each implementer and reviewer is still the base
  skill's own unmodified contract: ask questions first if the task is
  ambiguous, follow TDD, self-review before reporting, and return an
  explicit status on completion.

Nothing here changes what an agent does with a task. It only changes how
many tasks run at once, and who is allowed to commit.
```

### Passo 5 — Pergunte se o projeto vai usar o sistema de memória leve

Se sim, crie `MEMORY.md` na raiz com este esqueleto:

```markdown
# MEMORY.md

> Índice sempre carregado no início da sessão. Uma linha por memória,
> apontando pra um arquivo de tópico. Teto de ~130 linhas — quando passar
> disso, migre o que for menos usado pra fora (Obsidian ou arquivo próprio).
> Teste pra decidir se algo vira memória: uma sessão futura ficaria
> surpresa e grata de saber isso antes de começar a trabalhar?

<!-- Exemplo de linha, apague depois do primeiro uso real:
- [Nome curto](memory/topico.md) — o que essa memória resolve, em uma frase.
-->
```

E crie a pasta `memory/` vazia (ou com um `.gitkeep`) ao lado.

### Passo 6 — Pergunte se o projeto quer indexação com Graphify (opcional)

O binário `graphify` já está instalado globalmente. Indexar um projeto
específico é uma ação por-projeto, separada da instalação — só faz
sentido pra projeto de porte médio/grande, onde vale a pena responder "o
que quebra se eu mudar isso" sem grep exploratório. Se o usuário confirmar
que sim:

```bash
graphify extract .
```

Isso cria `graphify-out/` (grafo HTML, JSON, e um relatório em texto) na
raiz do projeto. Opcionalmente, ofereça também conectar o hook de
orientação **só a este projeto** (nunca use `graphify install` sem
`--project` aqui — isso mudaria o comportamento de toda sessão em todo
projeto, uma decisão maior demais pra este passo):

```bash
graphify install --project
```

Se o usuário não souber decidir, pule este passo — Graphify funciona
igual bem instalado depois, quando a dor de navegar um projeto grande
aparecer de verdade.

### Passo 7 — Pergunte se o projeto quer memória de longo prazo via Obsidian (opcional, avançado)

Diferente dos passos anteriores, isto **não é autocontido** — exige duas
decisões pessoais que este arquivo não pode tomar por conta própria:
qual servidor MCP de Obsidian usar (não existe um "oficial" recomendado —
busque "obsidian" num registro de MCP) e onde fica o vault. Só ofereça
este passo se o usuário já sentiu a dor de `MEMORY.md` (Passo 5) ficando
grande demais, ou pedir explicitamente. Se confirmado, o roteiro é:

1. Criar `vault/{01-projetos,02-areas,03-conhecimento,04-referencia,daily,templates}`.
2. Escrever um modelo (frontmatter + seções obrigatórias) por pasta em `vault/templates/`.
3. Instalar e configurar o servidor MCP escolhido, apontando pra `vault/`.
4. Escrever um hook `PreToolUse` que bloqueia `Read`/`Grep`/`Glob`/`Write`/`Edit`
   direto em `vault/` (exceto leitura de `vault/daily/`), forçando toda
   escrita a passar pelas ferramentas MCP — sem isso a validação de
   frontmatter/modelo/link não é garantida.
5. Testar os dois caminhos: criar uma nota via MCP (deve funcionar) e
   tentar ler o arquivo direto (deve ser bloqueado pelo hook).

Detalhe completo, incluindo o hook pronto pra copiar e o exemplo de nota
válida vs. rejeitada, em `docs/tools/08-obsidian-memory.md` do
`vibe-coding-toolkit` (única exceção neste arquivo que não é 100%
autocontida, porque a escolha de servidor MCP é sua, não algo que dá pra
cravar num template genérico).

### Passo 8 — Relatório final

Depois de criar os arquivos, liste pro usuário exatamente o que foi
criado, o que foi pulado (e por quê — ex.: `CLAUDE.md` já existia), e
lembre que todo o conjunto global (Superpowers/Ponytail/Caveman, Context7,
Chrome DevTools MCP, aia-harness, ui-ux-pro-max, Skills oficiais,
agent-browser) já está ativo — nenhuma ação extra necessária pra eles
funcionarem neste projeto.

---

## Roster completo de especialistas (referência pro Passo 2)

Puxe só as linhas relevantes pro domínio deste projeto — não cole a
tabela inteira no `CLAUDE.md`.

| Agent | When to use |
|---|---|
| `orchestrator` | Coordena trabalho que cruza vários domínios, delegando pra outros especialistas. |
| `code-reviewer` | Revisão geral de qualquer mudança de código — bugs, tratamento de erro, cobertura de testes. |
| `security-reviewer` | Vulnerabilidades OWASP, segredos no código-fonte, falhas de autenticação, CVEs em dependências. |
| `typescript-reviewer` | Segurança de tipos, corretude de código assíncrono, risco de injeção, prototype pollution em TS/JS. |
| `react-reviewer` | Regras de hooks do React, fronteira servidor/cliente, acessibilidade, performance de renderização. |
| `react-build-resolver` | Build ou dev server quebrado — config de bundler, erro de compilação, tipos faltando. |
| `test-engineer` | Testes unitários e de integração, test-first, cobrindo casos de borda. |
| `qa-automation-engineer` | Testes end-to-end e quality gates de CI/CD pra um fluxo crítico de usuário. |
| `database-architect` | Design de schema, migrations, índices, estratégia de queries. |
| `devops-engineer` | Deploy, pipelines de CI/CD, infraestrutura, operação em produção. |
| `backend-specialist` | Endpoints de API, lógica de negócio no servidor, persistência de dados. |
| `frontend-specialist` | Componentes de UI, layout, estilo, arquitetura de front-end. |
| `seo-specialist` | Metadados, dados estruturados, indexação por buscadores, visibilidade em buscas via IA. |
| `performance-optimizer` | Gargalo já identificado por profiling — endpoint lento, memória alta, Core Web Vitals ruins. |
| `product-manager` | Requisito indefinido ou ambíguo, antes mesmo de existir uma story. |
| `product-owner` | Transformar um objetivo de negócio em critérios de aceite pra uma story. |
| `project-planner` | Quebrar uma feature ou epic em tarefas ordenadas e executáveis. |
| `code-archaeologist` | Entender código legado ou sem documentação antes de mexer nele. |
| `debugger` | Encontrar a causa raiz de um bug, crash ou teste instável — antes de propor qualquer correção. |
| `explorer-agent` | Mapear uma base de código desconhecida ou complexa antes de planejar uma mudança. |
| `documentation-writer` | READMEs, documentação de API, runbooks — escritos ou atualizados sob pedido. |
| `penetration-tester` | Técnicas simuladas de ataque contra um fluxo de autenticação real ou um release. |
| `security-auditor` | Revisão de defesa em profundidade e modelagem de ameaças antes de um lançamento importante. |

## Ferramentas globais já disponíveis (referência)

Já instaladas na máquina, ativas em qualquer projeto, sem nenhuma ação
extra por-projeto. Só listado aqui pra saber o que esperar — não recrie
nada disso nos passos acima.

| Ferramenta | O que faz | Como entra em ação |
|---|---|---|
| Superpowers | Disciplina brainstorm → plano → implementação → revisão | Sozinha, em qualquer pedido ambíguo ou criativo |
| Ponytail | Escada anti-over-engineering (stdlib > nativo > dependência já instalada > 1 linha) | Sozinha, antes de qualquer código novo |
| Caveman | Corta enrolação da prosa do agente, sem perder informação | Sozinha, em toda resposta |
| Context7 | Injeta documentação real e atual de biblioteca no contexto | Sozinha, quando a pergunta depende de API/versão específica |
| Chrome DevTools MCP | Diagnóstico de página real rodando (performance, console, rede) | Sob pedido — "por que essa página está lenta/quebrada" |
| aia-harness | `/aia-harness:init` monta CLAUDE.md/agentes/hooks escaneando o projeto | Só quando você digita o comando |
| ui-ux-pro-max | Skill de design de UI/UX | Sob pedido de design de interface |
| document-skills | Gera/edita `.docx`/`.pdf`/`.pptx`/`.xlsx` de verdade | Sob pedido de documento |
| example-skills | `skill-creator`, `mcp-builder`, `web-artifacts-builder`, `webapp-testing`, e mais | Sob pedido, cada uma pela própria descrição |
| Graphify | Grafo de conhecimento do código (indexação é por-projeto — Passo 6) | `graphify query "..."` depois de indexado |
| agent-browser | Automação de navegador nativa pra agentes (`@e1`, `@e2`...) | Sob pedido — testar um fluxo de UI de ponta a ponta |

## Depois do setup — o fluxo do dia a dia

Esse arquivo só monta o cenário. O fluxo real de trabalho, pra usar depois
que os arquivos acima existem, é sempre o mesmo ciclo:

```
brainstorm → plano → implementação (em ondas, se aplicável) → revisão multi-agente → commit
```

- **Brainstorm:** peça a feature de forma propositalmente aberta — o
  Superpowers (já instalado globalmente) empurra o agente a perguntar o
  que falta antes de codar.
- **Plano:** peça um plano passo a passo, cada passo com verificação
  explícita (comando, teste, ou comportamento observável).
- **Implementação:** agrupe tasks sem dependência nem conflito de arquivo
  na mesma onda (ver regra do Passo 4, se copiada).
- **Revisão:** um painel de revisores especialistas, em paralelo, sem ver
  o achado um do outro — depois sintetize, dedupe, ranqueie por
  severidade.
- **Commit:** o orquestrador (você) commita, um por task, na ordem da
  onda — nunca o subagente que implementou.
