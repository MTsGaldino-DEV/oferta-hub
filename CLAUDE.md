# oferta-hub

> Project memory for Claude Code. Keep this file short and high-signal.

## Behavioral guidelines

1. **Think before coding** — state assumptions explicitly. If multiple interpretations exist, present them instead of picking silently. Say so when a simpler approach exists. If something is genuinely unclear, stop and ask.
2. **Simplicity first** — minimum code that solves the problem. No speculative features, no abstractions for single-use code, no unrequested configurability, no error handling for impossible scenarios.
3. **Surgical changes** — touch only what the request requires. Match existing style. Don't refactor, reformat, or "improve" adjacent code that wasn't part of the request.
4. **Goal-driven execution** — turn tasks into verifiable goals (e.g. "fix the bug" becomes "write a test that reproduces it, then make it pass"). For multi-step work, state a brief plan with a verify check per step, then loop until every step is verified.
5. **Orchestrator, not implementer** — the main session plans, decides, and coordinates; it does not implement. Delegable implementation and analysis goes to a specialist subagent, dispatched in parallel when task scopes don't conflict.

## Stack

- Monorepo com npm workspaces (`apps/api`, `apps/web`)
- **apps/api**: Node.js + TypeScript, Fastify, Prisma (`@prisma/client`), Zod, Baileys (WhatsApp), node-cron, Pino
- **apps/web**: React 18 + TypeScript, Vite, React Router
- **extensao/**: Chrome extension (Manifest V3), JS puro sem bundler — captura de produtos do Mercado Livre
- Docker (`docker-compose.yml`, `docker/`) para deploy/execução containerizada
- Gerenciador de pacote: npm

## Canonical commands

Always use the exact commands here — don't guess.

- **Install:** `npm install` (raiz, resolve os workspaces)
- **Lint:** não configurado ainda
- **Typecheck:** não configurado ainda (roda implicitamente dentro de `build`, via `tsc`)
- **Test:** não configurado ainda
- **Build:** `npm run build` (api: `tsc -p tsconfig.json`; web: `tsc -b && vite build`)
- **Run/Dev:** `npm run dev` (sobe api e web juntos) — ou `npm run dev:api` / `npm run dev:web` isolado

Outros comandos do workspace api: `npm run db:push`, `npm run db:studio` (Prisma), `npm run keygen` (gera `MASTER_KEY`).

## Specialist agent routing table

When work is delegable, dispatch the specialist that matches the task instead of a generic agent.

| Agent | When to use |
|---|---|
| `orchestrator` | Coordinates multi-agent or cross-domain tasks by delegating to specialized agents. |
| `code-reviewer` | Reviews code changes for bugs, error handling, and test coverage. Use after editing any source file. |
| `test-engineer` | Writes unit and integration tests, covering edge cases. Use after implementing new logic. |
| `backend-specialist` | Endpoints Fastify, lógica de negócio, integração Baileys/WhatsApp, jobs de cron. |
| `frontend-specialist` | Componentes React, layout, estilo em `apps/web`. |
| `database-architect` | Schema Prisma, migrations, índices, estratégia de queries. |
| `typescript-reviewer` | Segurança de tipos, corretude de código assíncrono, risco de injeção. |
| `react-reviewer` | Regras de hooks do React, acessibilidade, performance de renderização em `apps/web`. |
| `devops-engineer` | Docker, docker-compose, pipelines de deploy. |

Ver `.claude/rules/parallel-subagent-driven-development.md` pra execução em ondas paralelas.

## Conventions

- TypeScript com `"type": "module"` em ambos workspaces — usar import ESM (`import ... from`), sem `require`.
- Validação de entrada da API com Zod (já usado em `apps/api`).
- Prisma é a única camada de acesso a dados — não escrever SQL cru fora de migrations.
- Segredos (chaves, tokens) sempre em `.env`, nunca hardcoded — ver `.env.example` para o formato esperado.
- `extensao/` não usa bundler nem TypeScript — manter JS puro compatível com Manifest V3 (service worker, content scripts).
