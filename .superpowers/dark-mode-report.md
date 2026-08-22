# Dark mode implementation report

## What was implemented

1. **`apps/web/src/styles.css`** — added a `[data-theme='dark']` override block
   right after `:root` (same file position/pattern as the light tokens), plus a
   final "ajustes pontuais" section at end of file for component-specific
   overrides that the plain token flip breaks.

2. **`apps/web/src/theme.ts`** (new) — `getTheme()` / `setTheme()` /
   `applyStoredTheme()`, exactly per spec: localStorage key `hub-theme`,
   `document.documentElement.dataset.theme` set to `'dark'` or `''`.

3. **`apps/web/src/main.tsx`** — `applyStoredTheme()` called synchronously
   before `ReactDOM.createRoot(...).render(...)`, so theme is set before first
   paint (no flash).

4. **`apps/web/src/pages/Conexoes.tsx`** — new `AparenciaCard` component
   rendered as a `.panel` between the WhatsApp panel and `<ExtensaoCard />`.
   Single ghost button, label "Modo escuro" / "Modo claro" depending on
   current state, calls `setTheme()` and mirrors it into local `useState`
   (initialized from `getTheme()`) to re-render.

## Dark token values chosen

| Token | Light | Dark | Why |
|---|---|---|---|
| `--ink` | `#16171a` | `#f2f2f0` | near-white text, per spec |
| `--canvas` | `#e8e9eb` | `#1c1d20` | dark charcoal, close to old `--ink`, per spec |
| `--surface` | `#ffffff` | `#232427` | one step lighter than canvas for card separation |
| `--muted` | `#74787f` | `#9a9da3` | mid-gray, legible on `--surface`/`--canvas` |
| `--line` | `#d8dadd` | `#34353a` | solid hex (not alpha-white) to match the flat/hard-edge motif already used for `--surface`/`--canvas` |
| `--drop` | `#d93a1e` | `#ff6b52` | brightened; old value read muddy on dark |
| `--gain` | `#0c7c4a` | `#22a866` | brightened; old value read muddy on dark |
| `--shadow` | dark-on-light rgba | `rgba(0,0,0,.4)/(.5)` alpha-black | kept subtle depth cue; not dropped to `none` since `--surface` is lighter than `--canvas` so a dark halo still reads |

`--brand`, `--tag`, `--display`, `--mono`, `--r` untouched, as required.

## Component-specific overrides (beyond the token flip)

Found by grepping every `var(--ink)`, `var(--drop)`, `var(--gain)` usage
across `styles.css` and the three other files that reference these tokens
(`Sparkline.tsx`, `Desempenho.tsx`, `Nichos.tsx` — those three only use the
tokens as plain foreground stroke/text color on a surface/canvas backdrop,
so the flip alone is safe there, no changes made).

Two real breakage classes found in `styles.css`:

**A. `--ink` used as a fixed dark BACKGROUND, paired with hardcoded `#fff` or
`var(--brand)` foreground.** Once `--ink` flips to near-white for dark mode,
these backgrounds go near-white while their foreground stays exactly what it
was designed to contrast against a *dark* chip — i.e. white-on-white /
brand-yellow-on-near-white. Pinned each to the original dark tone so they
render identically in both themes:
- `.rail` (sidebar) — background pinned to `#16171a`. Confirms the task's own
  note that the rail is deliberately dark in both themes already.
- `.login__mark` — background pinned to `#16171a` (comment in the source
  literally explains this element exists *because* yellow-on-white has no
  contrast — flipping `--ink` here would have silently reintroduced that
  exact bug in dark mode).
- `.btn` (primary button) — background/border repinned to `#3a3b40` (a
  visible-but-not-canvas-matching chip), scoped with
  `:not(.btn--ghost):not(.btn--tag)` so it doesn't clobber those two
  variants, which already have their own background rules later in the
  cascade.
- `.tabs__item[data-on='true']` (active niche tab) — same treatment,
  `#3a3b40`.

**B. `--ink` used as foreground TEXT on `var(--brand)`/`var(--tag)`
(unchanged bright yellow) background.** Once `--ink` flips to near-white,
these become near-white text on bright yellow — poor contrast. Pinned
`color` to `#16171a` (the original ink) for all six instances:
`.rail__count`, `.btn--tag`, `.tag__score`, `.tabs__item[data-on='true'] span`,
`.card__selo`, `.card__nicho`.

**C. Two hardcoded (non-token) light-mode colors that also broke:**
- `.empty` had `background: rgba(255,255,255,.5)` (hardcoded, not a token).
  In dark mode this washes out to a light blob on the dark canvas, and
  `.empty strong` (`color: var(--ink)`, now near-white) becomes nearly
  invisible against it. Overrode the background to `rgba(255,255,255,.04)`
  for dark mode so both the near-white heading and the mid-gray `--muted`
  body text stay legible.
- `.card__well` (product photo backdrop) is intentionally kept light in both
  themes (neutral background for store photos, most of which have white
  backgrounds) — that part is fine and untouched. But `.card__semfoto`
  ("sem foto" placeholder text) used `color: var(--muted)`, which flips to a
  *light* gray in dark mode while still sitting on that same hardcoded-light
  well (`#f4f5f6`) — light-on-light. Pinned `.card__semfoto` color to the
  original light-mode muted value `#74787f`.

## Typecheck / build result

`npm run build --workspace=apps/web` → **exit 0**. `tsc -b` passed with no
errors, `vite build` completed (17.00 kB CSS, 223.91 kB JS bundle, no
warnings beyond normal chunk size info).

## Self-review findings

- Verified selector specificity for every override that competes with an
  existing rule for the same property: all `[data-theme='dark'] .foo`
  overrides have strictly higher specificity than the light-mode rule they
  replace (attribute selector adds a class-level specificity point), so the
  cascade doesn't depend on source order — confirmed each one by hand.
- Confirmed `.btn:not(.btn--ghost):not(.btn--tag)` doesn't accidentally beat
  `.btn--ghost` / `.btn--tag`'s own background rules for elements carrying
  both classes (e.g. `className="btn btn--ghost"` on ~10 buttons across the
  app) — the `:not()` exclusion means the dark override selector simply
  never matches those elements, no specificity race needed.
- Left three purely cosmetic (non-breaking) spots untouched, noted here
  rather than "fixed" to avoid over-engineering:
  - `.tag:hover` / `.card:hover` box-shadow (hardcoded `rgba(22,23,26,…)`) —
    barely visible on a dark background, but it's a hover embellishment, not
    a legibility issue.
  - `.catbox__item:hover` background (`rgba(22,23,26,.04)`) — same, subtle
    hover affordance gets weaker in dark mode, not broken.
  - `.tag::before` perforation texture (`repeating-linear-gradient` with
    `rgba(22,23,26,.055)`) — decorative dashed-edge dots, near-invisible in
    dark mode but purely decorative.
  - `.card__ganho` background tint (`rgba(12,124,74,.09)`, the *old*
    light-mode `--gain` RGB) — text color already uses the new brighter
    `var(--gain)`, so contrast is fine; the tint itself is just a slightly
    different hue than a "correct" dark-mode green tint would be. Cosmetic
    mismatch only.
- Did not find any other `--ink`/`--drop`/`--gain` usage (in `styles.css` or
  the three `.tsx` files that reference these tokens directly) that breaks
  under the flip beyond what's listed above.

## Files changed

- `apps/web/src/styles.css`
- `apps/web/src/theme.ts` (new)
- `apps/web/src/main.tsx`
- `apps/web/src/pages/Conexoes.tsx`

## Concerns

None blocking. Minor judgment calls made without re-confirming with the
owner (all within the "you may need a dark-specific override" latitude
granted by the task):
- Picked `#3a3b40` for the primary-button / active-tab dark chip color; not
  specified in the design doc, chosen to be clearly visible against
  `--canvas`/`--surface` while keeping the existing white-text-on-dark-chip
  look intact.
- `--shadow` kept as a visible (if subtle) dark halo rather than `none`,
  since `--surface` panels sit lighter than `--canvas`.
