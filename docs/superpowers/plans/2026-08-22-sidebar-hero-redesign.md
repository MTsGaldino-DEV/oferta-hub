# Sidebar/Hero Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the `apps/web` sidebar into grouped sections, turn the sidebar footer into a status card, and give the Fila page's "Adicionar oferta" panel a hero treatment — reusing the three structural patterns observed on Garimpa Links, reimplemented with our own light/yellow brand tokens.

**Architecture:** Pure visual/structural change, no new files, no new reusable components (each pattern is used once). Three tasks, each editing `Layout.tsx` or `Fila.tsx` plus additions to the shared `styles.css`. No logic, API, or data changes.

**Tech Stack:** React 18 + TypeScript (apps/web), plain CSS (no CSS-in-JS, no Tailwind).

**Spec:** `docs/superpowers/specs/2026-08-22-sidebar-hero-redesign-design.md`

## Global Constraints

- Keep the light theme and `--brand` yellow "etiqueta de gôndola" identity. No dark mode, no adopting the competitor's color palette — structure only, not color.
- No new reusable components — `NavSection`/`HeroCard`-style extraction is out of scope; each pattern is used exactly once in the current code.
- No functional/logic changes and no API changes — this is CSS + JSX restructuring over data that's already fetched.
- No test runner is configured in this project (`apps/web` has no test framework). Verification per task is: `npm run build --workspace=apps/web` (typecheck, per the repo's documented build command) plus a manual visual check with the chrome-devtools MCP tools against the running dev server.
- The dashboard is password-gated (`dashboardPassword` in `apps/api/.env`, not committed, unknown to the plan). Before the first visual check, log in once by hand in the chrome-devtools-controlled tab — the session cookie then persists for the rest of the checks.

---

### Task 1: Sidebar navigation grouped into sections

**Files:**
- Modify: `apps/web/src/components/Layout.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: existing `pending` state and `NavLink`/`useLocation` imports already in `Layout.tsx` — unchanged.
- Produces: nothing consumed by later tasks — self-contained.

- [ ] **Step 1: Add group CSS to `styles.css`**

Find this block (around line 105-109):

```css
.rail__nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
```

Add immediately after it:

```css

.rail__group + .rail__group {
  margin-top: 14px;
}

.rail__group-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.4);
  padding: 0 10px;
  margin: 0 0 4px;
}
```

- [ ] **Step 2: Replace the flat `LINKS` array with grouped `GROUPS` in `Layout.tsx`**

Find:

```tsx
const LINKS = [
  { to: '/', label: 'Fila', end: true },
  { to: '/desempenho', label: 'Desempenho' },
  { to: '/nichos', label: 'Nichos' },
  { to: '/produtos', label: 'Preços vigiados' },
  { to: '/agenda', label: 'Agenda' },
  { to: '/automacoes', label: 'Automações' },
  { to: '/conexoes', label: 'Conexões' },
];
```

Replace with:

```tsx
type NavLinkDef = { to: string; label: string; end?: boolean };

const GROUPS: { label: string | null; items: NavLinkDef[] }[] = [
  { label: null, items: [{ to: '/', label: 'Fila', end: true }] },
  {
    label: 'Catálogo',
    items: [
      { to: '/nichos', label: 'Nichos' },
      { to: '/produtos', label: 'Preços vigiados' },
    ],
  },
  {
    label: 'Automação',
    items: [
      { to: '/agenda', label: 'Agenda' },
      { to: '/automacoes', label: 'Automações' },
    ],
  },
  { label: 'Métricas', items: [{ to: '/desempenho', label: 'Desempenho' }] },
  { label: 'Configurações', items: [{ to: '/conexoes', label: 'Conexões' }] },
];
```

- [ ] **Step 3: Update the nav render to map groups**

Find:

```tsx
        <nav className="rail__nav">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="rail__link">
              {l.label}
              {l.to === '/' && pending > 0 && <span className="rail__count">{pending}</span>}
            </NavLink>
          ))}
        </nav>
```

Replace with:

```tsx
        <nav className="rail__nav">
          {GROUPS.map((g, gi) => (
            <div className="rail__group" key={g.label ?? `g${gi}`}>
              {g.label && <div className="rail__group-label">{g.label}</div>}
              {g.items.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className="rail__link">
                  {l.label}
                  {l.to === '/' && pending > 0 && <span className="rail__count">{pending}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
```

- [ ] **Step 4: Typecheck**

Run: `npm run build --workspace=apps/web`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Start the dev stack and log in once (first visual check only)**

Run in background: `npm run dev`
This starts both `apps/api` (port 3333) and `apps/web` (port 5173, proxying `/api` to 3333).

Using the chrome-devtools MCP tools: `new_page` (or `navigate_page`) to `http://localhost:5173`. If the login screen shows, ask the user for the dashboard password, `fill` it into the password field, and submit. This session persists (cookie) for the remaining visual checks in Tasks 2 and 3.

- [ ] **Step 6: Visual check**

Take a screenshot (`take_screenshot`, `fullPage: true`) of the Fila page (default route `/`).
Expected: sidebar nav shows "Fila" alone at top (no group label), then a "Catálogo" label above Nichos/Preços vigiados, "Automação" above Agenda/Automações, "Métricas" above Desempenho, "Configurações" above Conexões — each group visually separated by the added top margin.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/Layout.tsx apps/web/src/styles.css
git commit -m "feat(web): agrupa nav da sidebar em seções"
```

---

### Task 2: Sidebar footer becomes a status card

**Files:**
- Modify: `apps/web/src/components/Layout.tsx`
- Modify: `apps/web/src/styles.css`

**Depends-on:** Task 1 (same files — `.rail__nav` edits in Task 1 must land first to avoid clobbering).

**Interfaces:**
- Consumes: existing `wa` and `online` state in `Layout.tsx` (`wa: { status: string; quota: { used: number; cap: number } } | null`, `online = wa?.status === 'connected'`) — unchanged.
- Produces: nothing consumed by later tasks — self-contained.

- [ ] **Step 1: Replace `.rail__foot` CSS with a card variant in `styles.css`**

Find:

```css
.rail__foot {
  margin-top: auto;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  padding: 0 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

Replace with:

```css
.rail__foot {
  margin-top: auto;
  padding: 0 8px;
}

.rail__user {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--r);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rail__user__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.rail__user__status {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #fff;
}

.rail__user__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  flex: none;
}

.rail__user__dot[data-online='true'] {
  background: var(--tag);
}

.rail__user__quota {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
```

- [ ] **Step 2: Rebuild the footer JSX in `Layout.tsx`**

Find:

```tsx
        <div className="rail__foot">
          <div>
            WhatsApp: <strong style={{ color: online ? 'var(--tag)' : '#fff' }}>{online ? 'conectado' : 'offline'}</strong>
          </div>
          {wa && (
            <div>
              Envios hoje: {wa.quota.used}/{wa.quota.cap}
            </div>
          )}
          <button
            className="btn btn--ghost btn--sm"
            style={{ borderColor: 'rgba(255,255,255,.25)', color: '#fff', width: 'fit-content' }}
            onClick={async () => {
              await api.post('/api/logout');
              window.location.href = '/';
            }}
          >
            Sair
          </button>
        </div>
```

Replace with:

```tsx
        <div className="rail__foot">
          <div className="rail__user">
            <div className="rail__user__row">
              <span className="rail__user__status">
                <span className="rail__user__dot" data-online={online} />
                {online ? 'Conectado' : 'Offline'}
              </span>
              <button
                className="btn btn--ghost btn--sm"
                style={{ borderColor: 'rgba(255,255,255,.25)', color: '#fff' }}
                onClick={async () => {
                  await api.post('/api/logout');
                  window.location.href = '/';
                }}
              >
                Sair
              </button>
            </div>
            {wa && (
              <div className="rail__user__quota">
                Envios hoje: {wa.quota.used}/{wa.quota.cap}
              </div>
            )}
          </div>
        </div>
```

- [ ] **Step 3: Typecheck**

Run: `npm run build --workspace=apps/web`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Visual check**

Dev stack from Task 1 should still be running with the session already logged in. Reload the page (`navigate_page` type `reload`) and take a screenshot.
Expected: sidebar footer is now a bordered/rounded card with a status dot (yellow/`--tag` colored when WhatsApp is connected, translucent white when not) to the left of "Conectado"/"Offline", the "Sair" button aligned to the right of that same row, and the daily quota line below when available.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Layout.tsx apps/web/src/styles.css
git commit -m "feat(web): rodape da sidebar vira card de status"
```

---

### Task 3: Hero card for the Fila "Adicionar oferta" panel

**Files:**
- Modify: `apps/web/src/pages/Fila.tsx`
- Modify: `apps/web/src/styles.css`

**Depends-on:** Task 2 (styles.css is shared and must be edited in sequence).

**Interfaces:**
- Consumes: none — pure CSS class addition on existing JSX.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add `.panel--hero` variant to `styles.css`**

Find:

```css
.panel__title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 14px;
}
```

Add immediately after it:

```css

.panel--hero {
  background: color-mix(in srgb, var(--brand) 6%, var(--surface));
  border-color: var(--brand);
  padding: 24px;
}

.panel--hero .panel__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
}
```

- [ ] **Step 2: Apply the hero class to the "Adicionar oferta" panel in `Fila.tsx`**

Find:

```tsx
      <div className="panel">
        <h2 className="panel__title">Adicionar oferta</h2>
```

Replace with:

```tsx
      <div className="panel panel--hero">
        <h2 className="panel__title">Adicionar oferta</h2>
```

- [ ] **Step 3: Typecheck**

Run: `npm run build --workspace=apps/web`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Visual check**

Dev stack still running, session still logged in. Reload the Fila page and take a screenshot.
Expected: the "Adicionar oferta" panel has a visible yellow-tinted background and border (distinct from the plain white panels below it), larger padding, and a bolder/larger title — while the URL/note fields, "Capturar" button, and search row inside it are unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/Fila.tsx apps/web/src/styles.css
git commit -m "feat(web): card hero pro formulario de adicionar oferta na fila"
```
