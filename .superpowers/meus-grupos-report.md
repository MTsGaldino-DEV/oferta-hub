# Meus Grupos — report

## Schema (NOT applied — see ruling at bottom)

Two additive changes in `apps/api/prisma/schema.prisma`:

- `WhatsappGroup.memberCount Int?` — current live member count, nullable
  (never-synced groups have none yet).
- New model `GroupMemberEvent` (`id`, `groupJid`, `participant`, `action`
  enum `GroupMemberAction { ADD REMOVE }`, `occurredAt`), indexed
  `@@index([groupJid, occurredAt])` for the range query the stats endpoint
  needs. `///` doc-comments on both explain the why, matching the file's
  existing voice.

`npx prisma generate` was run from `apps/api` after the edit — client
regenerated clean, no DB connection needed.

## Event handler (`apps/api/src/whatsapp/baileys.ts`)

Registered `this.sock.ev.on('group-participants.update', ...)` right after
the existing `connection.update` listener in `connect()`, same
registration pattern/placement.

Payload shape confirmed against the installed package's own types
(`node_modules/@whiskeysockets/baileys/lib/Types/Events.d.ts` /
`GroupMetadata.d.ts`): `{ id, author, participants: string[], action:
'add'|'remove'|'promote'|'demote'|'modify' }` — matches the brief exactly,
plus a `modify` variant neither of us anticipated. The handler's guard is
`if (action !== 'add' && action !== 'remove') return;`, so `promote`,
`demote`, and `modify` all fall through untouched — only membership
changes get logged. Traced all three paths by hand:
- `add` → writes one `GroupMemberEvent` row per participant (`ADD`),
  `memberCount` incremented by `participants.length`.
- `remove` → same, `REMOVE`, decremented.
- `promote` → guard returns immediately, nothing written, nothing
  incremented.

Whole handler body is wrapped in try/catch; catch only logs via `logger`
and never rethrows, so a malformed event can't take the socket down.

## `memberCount` consistency

Two writers, no race:

1. `syncGroups()` (full resync, runs on every `connection === 'open'`,
   which fires on every boot per `main()`'s `whatsapp.connect()` call) —
   now reads `meta.participants.length` from
   `groupFetchAllParticipating()` and writes it as `memberCount` in both
   the `upsert`'s `create` and `update`. This is a plain overwrite with
   ground truth from the WhatsApp API.
2. The event handler — does `prisma.whatsappGroup.updateMany({ where:
   { jid }, data: { memberCount: { increment: delta } } })` inside a
   `$transaction` alongside the `createMany` of event rows. `increment` on
   `updateMany` compiles to a single atomic `UPDATE ... SET
   "memberCount" = "memberCount" + $delta` — no `findUnique` + manual add,
   so it can't lose an update racing a concurrent `syncGroups()` upsert;
   whichever write lands second just applies cleanly on top of whatever
   the first left behind.

Edge case (not a bug, just worth flagging): if a `group-participants.update`
event fires for a group that has never been through `syncGroups()` yet, the
`updateMany` matches zero rows and does nothing — the group briefly has no
`memberCount` row to increment. Self-heals on the next full sync. Not
guarded against further since it can't crash anything and boot always
calls `syncGroups()` first.

## Honesty-note design

`GET /api/groups?days=N` (new `apps/api/src/routes/groups.ts`, registered
in `server.ts`'s authenticated block, alphabetically between
`extensaoAdminRoutes` and `nichoRoutes`) returns per group: `name`,
`memberCount`, `joined`/`left` counts from `GroupMemberEvent` clipped to
the `days` window (same clamp convention as `stats.ts`: `Math.min(180,
Math.max(1, ...))`, default 30), and `trackingSince` — the `occurredAt` of
that group's **oldest logged event ever** (not clipped to the period), or
`null` if the group has no events yet. Computed via `groupBy` with `_min`,
parallelized with the join/leave counts through `Promise.all` — no N+1.

Frontend (`apps/web/src/pages/MeusGrupos.tsx`) surfaces this directly in
the table, one column per group ("Rastreando desde: desde DD/MM/AAAA" or
"ainda sem histórico" in muted text), plus a standing caption below the
table: *"Entradas e saídas só contam a partir de quando essa métrica
passou a ser registrada (...) — período anterior a isso não é zero, é
desconhecido."* Not a tooltip — always visible under the table.

## Frontend

New `apps/web/src/pages/MeusGrupos.tsx`: `.head` block with title/subtitle
+ 7/30/90-day `<select>` (same markup as `Desempenho.tsx`), one `.panel`
with a `.table` (mirrors the platforms table in `Desempenho.tsx`) — columns
Grupo / Membros / Entraram / Saíram / Rastreando desde. Join/leave counts
get a `+`/`-` prefix colored via `var(--gain)`/`var(--drop)` inline
(only when non-zero) — reused the existing `.kpi__delta[data-dir]` color
tokens directly rather than adding a new CSS class, since nothing in
`styles.css` already renders an up/down indicator inside a table cell.
Empty state reuses the exact two-line `.empty` voice from
`Automacoes.tsx` ("Nenhum grupo sincronizado" / "Conecte o WhatsApp e
sincronize os grupos em Conexões...").

Wired into `apps/web/src/App.tsx` (`/grupos` route) and
`apps/web/src/components/Layout.tsx`'s nav — added to the existing
**"Métricas"** group alongside "Desempenho", since this is unambiguously a
metrics page (member counts + join/leave over a period), not automation
config.

## Build result

`npx prisma generate` (apps/api): clean, no DB connection required.
`npm run build` from worktree root: both workspaces exit 0 — `tsc -p
tsconfig.json` for the API, `tsc -b && vite build` for the web app (51
modules, no type errors).

## Self-review findings

- Verified the Baileys event payload shape against the actually-installed
  package's `.d.ts` files rather than trusting the brief blind — matched,
  plus the extra `modify` action, which the existing `!== 'add' && !==
  'remove'` guard already excludes correctly.
- Caught and fixed one mistake made mid-edit: an initial sloppy `Edit` call
  split the `connection.update` callback's `if (connection === 'close')`
  block in half while trying to insert the new listener, leaving dead code
  (`connection.update.close` on a fake `if (false)`). Caught by re-reading
  the file immediately after the edit (before building) and rewrote the
  whole `connect()` body cleanly in one corrected `Edit` — the version that
  got built and committed is the clean one; confirmed by re-reading the
  full block afterward.
- `apps/api/src/routes/groups.ts` uses `Promise.all` across four parallel
  Prisma queries (groups, add-counts, remove-counts, oldest-per-group) —
  no per-group query loop.
- No new npm dependency, no new CSS class, no speculative config.

## Concerns

- No automated test exists for the increment/decrement logic (project has
  no test runner configured per `CLAUDE.md`, and the hard constraints here
  forbid running the dev server or touching the DB, so nothing here is
  runnable inside this sandbox anyway). Recommend a manual smoke check
  after deploy: watch the API logs for one real group-join/leave event and
  confirm a `GroupMemberEvent` row lands and `memberCount` moves by 1.
- The zero-rows-matched edge case (event before first sync) is silently a
  no-op, not silently wrong — flagged above, not fixed, since fixing it
  would mean either a speculative upsert-on-event (extra write path,
  unrequested) or blocking on a full resync (slower, unrequested). Leaving
  it as "self-heals on next boot" is the surgical option.

## Schema is NOT applied

`prisma generate` was run (client regenerated, needed for typecheck).
`prisma db push`/`migrate` was **not** run — no `DATABASE_URL` connection
was made, and the live Postgres schema is untouched. The controller must
review the two additive schema changes above and apply them (`db push` or
a migration) before this feature is live.
