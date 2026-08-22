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
- Disparos pulls its offers FROM Fila's existing PENDING queue.
  *** CORRECTION (found while designing sub-project 5): the earlier note
  that `QUEUED` was "unused" was WRONG. `QUEUED` is already the Agenda
  feature's status — `apps/api/src/routes/offers.ts:301` sets
  `{ status: QUEUED, scheduledFor, groupJid }`, and `runScheduler()`
  (`apps/api/src/workers/index.ts:182-196`, cron every minute) picks up
  every `QUEUED` offer whose `scheduledFor <= now` and sends it. If
  Disparos reused QUEUED, that legacy scheduler would hijack its offers
  and send them to the default group, bypassing Disparos entirely.
  DECISION: Disparos gets its own new `OfferStatus` value (`DISPATCHING`).
  Adding an enum value is additive in Postgres (ALTER TYPE ADD VALUE),
  non-destructive. User informed. ***
- Build order: 1) Dark mode 2) Visão geral 3) Fila platform filter
  4) Templates + CTA 5) Disparos 6) Meus Grupos 7) Configurações
  (Conexões folds into it) 8) Garimpar.

## Sub-project log

1. Dark mode: COMPLETE (commit ba5b576, review clean — approved, no
   Critical/Important). Minor deferred: `.catbox__item input`
   `accent-color: var(--ink)` not addressed by the theme flip (checkbox
   tick may render near-white on dark) — cosmetic, low priority, revisit
   if noticed live.

2. Visão Geral: COMPLETE (commit 6063df0, review clean — approved, zero
   findings; reviewer independently verified route table, API response
   shapes against the real handlers, and placeholder honesty).

3. Fila platform filter: COMPLETE (commit ec67c66, review clean —
   approved). Position-numbering requirement verified by both me and the
   reviewer: `offers.map((o,i) => ({offer:o, posicao:i+1})).filter(...)`
   keeps `#74` as `#74` under a filter. Minor deferred: one-render-frame
   empty `.shelf` flash when the selected platform's last offer is
   sent/skipped (effect resets to "Todos" post-paint, self-heals next
   commit) — cosmetic, not stranding.

4. Templates + CTA rotativo: COMPLETE (commits 1f0935a + fedc096, review
   approved, only Minors). Schema APPLIED to the live DB — user approved
   after seeing the `prisma migrate diff` SQL (pure CREATE TABLE +
   CREATE INDEX, zero ALTER/DROP on existing tables).
   Owner decision mid-flight: empty token now drops the WHOLE line
   (`.some` not `.every`), since "De por *R$89*" was broken output. User
   was warned that a mixed line like `{TITULO} {CUPOM}` vanishes wholly
   when there's no coupon, and accepted it.
   Minors deferred: (a) dead `v === null ? '' : v` branch in the token
   replace callback; (b) empty-body + non-empty CTA leaves leading
   `\n\n`; (c) `isDefault` maintained by two non-atomic queries (could
   yield two defaults); (d) un-checking "Padrão" via PUT leaves ZERO
   defaults with no auto-promotion (DELETE does promote).
   >>> MITIGATION for (c)/(d): Disparos must NOT depend on "exactly one
   default template" — it requires an explicit template pick in the
   wizard, no silent fallback to the default. This sidesteps the
   invariant entirely rather than hardening it. <<<

5. Disparos: design locked with the user (see decisions below), about to
   dispatch.
   - Offers move OUT of Fila when added to a disparo; cancelling returns
     them to PENDING.
   - Multi-group = one send per (offer, group) pair, each respecting the
     interval (no burst).
   - "Não enviar oferta expirada": toggle rendered but INERT for now,
     user chose to defer the expiry-detection mechanism.
   - Minimum interval 5 minutes.

## RULING: schema changes are written but NOT applied tonight

This project has NO Prisma migrations folder — `apps/api/package.json` only
has `db:push` (`prisma db push`), i.e. the schema-push workflow. Applying
any schema change therefore means writing directly to the LIVE Postgres in
the running Docker container, which is exactly what the user said not to
touch while asleep.

Decision for sub-projects 4 (Templates), 5 (Disparos), 6 (Meus Grupos) —
all of which need new models:
- DO edit `apps/api/prisma/schema.prisma`.
- DO run `npx prisma generate` — this only regenerates the TypeScript
  client from the schema file, makes NO database connection, so typecheck
  can pass against the new models.
- DO write all API routes + frontend against the new models.
- Do NOT run `db:push`, `migrate`, or `db:studio`. The code will compile
  but the new endpoints will fail at runtime until the user applies the
  schema in the morning.
- Every such sub-project must be reported to the user as "code done,
  schema pending `npm run db:push --workspace=apps/api`".

Cost if wrong: the user wakes up to code that doesn't run until they run
one command — clearly documented, one line to fix. The alternative
(pushing schema to a live DB unattended) risks their real data.

## Sub-project 6 prep (Meus Grupos) — grounded, ready to dispatch
- Member count IS available and currently thrown away:
  `apps/api/src/whatsapp/baileys.ts:194` calls
  `this.sock.groupFetchAllParticipating()`, whose metadata includes a
  `participants` array, but `syncGroups()` only persists `subject` (name).
  So `meta.participants.length` is a free win — no new Baileys wiring.
- Schema: add `memberCount Int?` to `WhatsappGroup` (current snapshot),
  plus a new `GroupSnapshot { id, groupJid, memberCount, takenAt }` model
  so week/month deltas can be computed. Index on `[groupJid, takenAt]`.
- `syncGroups()` writes both the current count and a daily snapshot
  (upsert-by-day so repeated syncs in one day don't inflate the series).
- node-cron is already a dependency and workers are already scheduled
  (see server.ts / workers) — add a daily snapshot job there.
- HONESTY REQUIREMENT for the UI: growth history only starts accumulating
  the day this ships. The page must say so rather than rendering "0 em
  30d" as if it were a measured zero. This is exactly the trap the
  Garimpa Links reference screenshot falls into.
- Blocked on the same schema ruling below (code yes, `db:push` no).

## Sub-project 3 prep (Fila platform filter) — grounded, ready to dispatch
- Zero backend change needed. `GET /api/offers` already returns each
  offer's `product.platform` (apps/api/src/routes/offers.ts serialize()).
  Fila.tsx already loads the full PENDING offers array into state. A
  client-side filter (derive a Set of platforms present, render filter
  chips reusing `.tabs`/`.chip` CSS already in styles.css, filter the
  `offers` array before rendering `.shelf`) is the whole implementation.
  `STORE` (platform code -> display name map) already exists in api.ts,
  reuse it for chip labels.

