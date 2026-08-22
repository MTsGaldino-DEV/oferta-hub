# Overnight ledger — branch: frontend-melhorias

Base: docker-e-identidade @ 7fb9361. User approved "modo automático" — no
check-ins until done or a hard-stop (irreversible op, security-sensitive
action, external side effect, or broken plan). Never touch the live Docker
containers, the live Postgres DB, or run `npm run dev`/`dev:api` (Baileys
auto-connects to the real WhatsApp account on boot — established earlier
this session as off-limits without explicit review).

## Locked decisions (from brainstorming, do not re-litigate)
- Automações stays as-is; Disparos is a new, separate, additive flow.
- Visão Geral becomes the new root route "/"; Fila moves to "/fila".
- Templates (with rotating CTAs) are NEW and additive — only used by
  Disparos. Fila's existing message-building/editing is untouched.
- Disparos pulls its offers FROM Fila's existing PENDING queue, using the
  Offer.status `QUEUED` value that already exists in the schema and is
  currently unused.
- Build order: 1) Dark mode 2) Visão geral 3) Fila platform filter
  4) Templates + CTA 5) Disparos 6) Meus Grupos 7) Configurações
  (Conexões folds into it) 8) Garimpar.

## Sub-project log

1. Dark mode: COMPLETE (commit ba5b576, review clean — approved, no
   Critical/Important). Minor deferred: `.catbox__item input`
   `accent-color: var(--ink)` not addressed by the theme flip (checkbox
   tick may render near-white on dark) — cosmetic, low priority, revisit
   if noticed live.

## Sub-project 2 prep (Visão Geral) — grounded, ready to dispatch once #1 closes
- New page apps/web/src/pages/VisaoGeral.tsx. Route "/" -> VisaoGeral,
  Fila moves to "/fila" (App.tsx). Layout.tsx GROUPS: add a new
  `{ label: null, items: [{ to: '/', label: 'Visão geral', end: true }] }`
  entry before the existing Fila one; change the existing Fila entry's
  `to` to '/fila'; the pending-count badge condition in the nav render
  (`l.to === '/'`) must become `l.to === '/fila'`.
- Data: GET /api/stats/overview?days=1 (pending/queued are NOT date-filtered
  server-side, so this is safe to use for "hoje" framing) gives pending,
  queued, clicks.value, sent.value. GET /api/whatsapp/status gives
  groups[] (length = grupos ativos) and quota.
- Reuse existing CSS: .panel, .panel--hero (from the sidebar/hero
  redesign), .grid-kpi/.kpi (from Desempenho), .empty. Avoid new CSS
  where these already fit.
- Hero CTA card: do NOT promise a "Garimpar" flow — that page doesn't
  exist yet (sub-project 8). Point it at /fila with honest copy.
- "Disparos em andamento" and the two ranking/heatmap blocks: Disparos
  doesn't exist yet (sub-project 5) — render as honest "em breve" panels,
  not fake data, matching the reference mockup's own placeholder pattern.

