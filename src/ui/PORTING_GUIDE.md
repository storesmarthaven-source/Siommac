# Porting a mockup into Siomac — the playbook

Companion to **[PAGE_GUIDE.md](./PAGE_GUIDE.md)** (which defines the page *shape* +
the non-negotiable rules). This doc is the *how-to* for turning a design mockup
(e.g. the v36 HTML prototypes) into a real, wired Siomac page — and the gotchas
that will bite you if you don't.

The order that actually works:

```
1. READ the source design first (CSS + markup), not a guess.
2. PORT it faithfully (look identical), THEN componentize into @ui.
3. WIRE every visible action end-to-end (migration → route → api → UI → seed).
4. AUDIT every button (wire it, or honestly disable — never a dead toast).
5. VERIFY: tsc clean, then the module's E2E suite green.
```

---

## 0. The mechanics: HTML + CSS → Preact

The mockups are a single `.html` file: a big `<style>` block + a render layer
written in **hyperscript** — `h('tag', { props }, ...children)` (htm/Preact).
Converting it has two halves — the **markup** and the **CSS**.

### Where the files go

```
src/components/sections/<Module>/
  <Module>Section.tsx   ← the page (renders CONTENT only, inside the Siomac AppShell)
  <Module>.css          ← the ported CSS, scoped + @layer sections
  shared.tsx            ← format/tone/avatar helpers
  mount.ts module.ts index.ts   ← shell registration (copy an existing module)
import './<Module>.css'  // once, from the page component
```

### Markup: `h(...)` / HTML → JSX

`h('tag', { props }, ...children)` maps **directly** to JSX. Preact specifics:

| Mockup | Preact JSX |
|---|---|
| `h('div', { class:'card-head' }, h('h4', null, 'Title'))` | `<div class="card-head"><h4>Title</h4></div>` |
| `class` / `className` | **`class`** (Preact accepts it natively) |
| `onClick:fn`, `onInput`, `onChange` | `onClick={fn}` … (same names) |
| `cond && h(X)` · `a ? h(X) : h(Y)` | `{cond && <X/>}` · `{a ? <X/> : <Y/>}` |
| `arr.map(x => h(...))` | `{arr.map(x => <…/>)}` — **add `key`** |
| inline SVG, `stroke-width`, `aria-hidden`, `viewBox` | keep the kebab/camel attrs **as-is** (Preact passes them through) |
| glyph stand-ins (`'⚙'`, `'♜'`, `'✉'`) | keep verbatim for the faithful pass, or swap to `<i class="fas fa-…"/>` (app standard) |

Then:
- **Drop the mockup's own chrome.** The file ships its own `.app-shell` /
  `.hr-sidebar` / topbar — Siomac's AppShell provides those. Port **only the page
  content** (the main column), never the mockup shell.
- **Replace mock data with real hooks.** The `const employees = [{…}]` literal →
  `useHrEmployees()` etc. Mock fields with no backend column → omit or wire them;
  never render a live input the backend ignores (accept-and-drop).

### CSS: `<style>` → scoped section file

1. Copy the `<style>` rules into `src/components/sections/<Module>/<Module>.css`.
2. **Wrap the whole file in `@layer sections { … }`** — a `import './x.css'` can't
   carry a `layer()` token, so the file self-wraps. (Order: `bootstrap < base <
   components < sections`; section CSS wins.)
3. **Scope every selector under a page class** so the mockup's generic names can't
   leak app-wide:
   ```css
   @layer sections {
     .hr-emp-master .card      { … }   /* was  .card      */
     .hr-emp-master table      { … }   /* was  table      */
     .hr-emp-master .pill.green{ … }   /* was  .pill.green */
   }
   ```
   Render the page inside `<div class="hr-emp-master"> … </div>`.
4. **Guard the names that collide with Bootstrap/globals** — `.modal`,
   `.dropdown-menu`, `.toast`, `.card`, `.badge`, `.btn`, `table`. Scoping under
   `.hr-emp-master` raises specificity but Bootstrap still leaks any property your
   rule doesn't *declare* (e.g. `.dropdown-menu{display:none}`,
   `.modal{position:fixed}`). Either **prefix the class** (`hrm-modal`) or
   explicitly set the leaked property. Prefixing is safest. (See §6.)
5. **Read every rule for a selector**, including later `!important` override
   blocks — the last layer is the real look (the dark `.drawer.open` lesson).
6. **Cap font weights at 700** — `font-weight:900` → `var(--font-weight-bold,700)`.
7. Keep the mockup's exact hex/sizes for the faithful pass; the mockup's `:root`
   vars (`--line`, `--ink-900`, …) → inline the values under your scope now, map to
   Siomac tokens in the later re-skin.

### Worked example (one card)

```js
// mockup
h('section', { class:'info-card' },
  h('div', { class:'card-head' }, h('h4', null, 'Personal Summary'),
    h('button', { class:'small-outline', onClick: openEdit }, 'Edit')),
  h('div', { class:'field-list' },
    h('div', { class:'field-row' },
      h('div', { class:'field-label' }, 'Email'),
      h('div', { class:'field-value' }, profile.email))))
```
```tsx
// Preact (faithful first; later → <InfoCard><FieldList><FieldRow/></FieldList></InfoCard>)
<section class="info-card">
  <div class="card-head"><h4>Personal Summary</h4>
    <button class="small-outline" type="button" onClick={openEdit}>Edit</button></div>
  <div class="field-list">
    <div class="field-row">
      <div class="field-label">Email</div>
      <div class="field-value">{profile.email ?? '—'}</div>
    </div>
  </div>
</section>
```
Faithful first (scoped `.info-card` CSS), then lift into the shared `@ui`
primitives so the values live in one place.

---

## 1. Read the source first

Don't reconstruct a design from memory or from a sibling page — open the source
mockup and read its **CSS and markup directly**.

- **Mockups evolve in layers.** The authoritative look is usually a *later
  override layer*, not the base rules. The v36 employee profile drawer looked
  white in the base CSS but the real design is **dark navy** via a
  `.drawer.open { background:#1b2d54 … }` override block 400 lines later. Porting
  the base only = "colors wrong". **Grep the whole file for the class** and read
  every rule that targets it, including `!important` override layers.
- Pull the **exact values** (hex, sizes, radii) from the source. A token re-skin
  is a *separate, later* pass — port faithfully first.

## 2. Port faithfully, then componentize

1. **Faithful first.** Reproduce the markup + values so it looks identical. The
   look is the contract; "improving" it mid-port is how you ship the wrong cut.
2. **Then extract into `@ui`.** Once it matches, lift the repeated structure into
   reusable components with the values defined **once** (see the inventory below).
   A later "Siomac-fit" pass re-tints those components to brand tokens.

### Font weights (recurring trap)
Mockups use an 800–950 weight ramp, but the app loads Inter only to 800 and the
type tokens cap at 700. A verbatim `font-weight:900` collapses onto 800 and reads
*heavier than anything else in the app*. **Remap every ported weight onto
`var(--font-weight-bold,700)` / `…-semibold,600` / `…-medium,500`.**

---

## 3. The @ui overlay / detail inventory

PAGE_GUIDE covers page-shape components. These are the **detail panel, dialog and
wizard** primitives (in `assets/styles/uikit-overlay.css`, exported from `@ui`):

| Need | Use |
|---|---|
| Rich entity panel (slide-in profile/detail) | `Drawer` with **`rich`** — dark v36 panel; compose the body from the pieces below |
| Simple detail drawer | `Drawer` (default) — `title`/`sub`/`details`/`foot` |
| Slot beside the drawer close button (kebab) | `Drawer` `headActions={<Menu …/>}` |
| Entity header (avatar + name + ref + meta) | `EntityHead` (`reference`, **not** `ref` — Preact intercepts `ref`) |
| Stat strip under the head | `PanelStats` (`plain` variant for inside a card) |
| Tab strip with overflow "More" | `PanelTabs` (`primary` + `more`) |
| Dropdown menu (kebab / "More actions") | `Menu` — owns open state + outside-click + Esc |
| Titled card / label-value rows / mini table | `InfoCard` · `FieldList`+`FieldRow` · `MiniTable` |
| Tonal status chip in a panel/dialog | `Pill` (`green/amber/red/purple/blue/gray`) |
| Risk/readiness banner | `Callout` (`alert` swaps to danger palette) |
| Activity feed | `ActivityList` |
| Restricted, view-only governance panel | `SystemActionsPanel` (informational — never live controls before the engine exists) |
| One-shot dialog | `Modal` + `ModalSection` (title + desc + body) |
| Multi-step / long wizard | `WizardShell` (dark rail: title + step nav + info panels) |
| Form controls | `FormGrid` + `Field` + `TextInput`/`SelectInput`/`TextareaInput` |
| Small inline action button | `.ui-mini-btn` (card head / mini-table row actions) |

**Accessibility is built in:** `Modal`, `Drawer`, `WizardShell` use
`useOverlayA11y` (Escape closes · Tab trapped · focus returns to the opener);
`Menu` closes on Escape. Add `role`/`aria-label` to any new icon-only button.

`WizardShell` is the rich wizard frame. Drive it controlled: you own `activeStep`
and render the matching content; pass `info` panels (Current Batch / Permissions),
`footNote`, and a `footer` slot of buttons. Use it for both long forms (Onboarding)
and step-gated flows (Import — gate `stepEnabled` by which data exists).

---

## 4. Wire every visible action end-to-end

A page is done only when each action (1) saves real data, (2) starts the correct
workflow, (3) creates the right handoff, (4) writes audit/app_events, (5) respects
permissions/settings, (6) refreshes the UI. The end-to-end slice for a new field
or action:

```
migration (.sql)         add the column/table              (operator-applied — see §5)
lib (netlify/functions)  read/write it (e.g. provisionEmployee, *Core.ts)
route (routes/*.ts)      accept it in the zod schema; return it in the SELECT cols
api (src/api/**)         add to the TS request/row types + the hook
component (src/…)         collect it (wizard/dialog) / show it (drawer/table)
seed (supabase/*.sql)    populate demo rows so it renders non-empty
E2E (scripts/e2e)         assert the value + the side-effects (events/audit)
```

- **Mutations** go through the module service adapter (`runModuleMutation`) so the
  §2 side-effects fire — don't hand-roll an insert that skips events/audit.
- **Don't accept-and-drop.** If the backend doesn't honor a field, don't render a
  live input for it — wire it, honestly disable it, or omit it. A strict
  `z.object` **silently strips** unknown keys, so a field absent from the schema
  is dropped — add it to the schema, or it's a no-op.
- **Flexible storage:** a `policy jsonb` / metadata column can take new fields with
  no migration — but only if you *surface* them (otherwise it's accept-and-drop).

---

## 5. Migrations & seed (this project's reality)

There is **no DDL channel from the app** — only the PostgREST service client. So:

- You **author** the migration `.sql` + an idempotent seed `.sql`; the **operator
  applies** them, then `NOTIFY pgrst, 'reload schema'` (or restart `dev:netlify`).
- **Order matters:** apply the migration **before/with** `npm run build:backend`,
  or code that references the new column errors at runtime.
- `dev:netlify` serves the **compiled `dist/`** — backend route changes won't take
  effect until `npm run build:backend` (or a restart).
- Every module ships a **manual seed** so pages render populated (idempotent
  `UPDATE`/`INSERT`, pick `app_users` by a stable id/username).
- New tables need **explicit `grant … to service_role`** (default privileges leave
  them readable-but-not-insertable → PostgREST "not in schema cache").

---

## 6. CSS gotchas that will bite you

- **Bootstrap class collisions.** Bootstrap is imported globally (lowest layer).
  Generic class names collide: `.modal { position:fixed;top:0;left:0 }`,
  `.dropdown-menu { display:none }`, `.toast { width:350px }`. If your scoped rule
  doesn't *declare* `display`/`position`, you inherit Bootstrap's value (dialog
  pinned top-left, dropdown invisible). **Either namespace your classes (`ui-…`,
  `hr-…`) or explicitly set the property.** Prefer namespaced.
- **`position:fixed` containing block.** An ancestor with `transform`,
  `filter`, `perspective`, or **`container-type`** (e.g. `.hse-dash`) makes a fixed
  child position relative to *it*, not the viewport → off-centre overlays. Fix by
  **portaling to `<body>`** (what `Drawer` does) or avoiding the ancestor.
- **Portaled overlay ⇒ no page scope.** A component portaled to `<body>` escapes
  its page's scoped CSS (`.hr-emp-master …`). Its content must use **global**
  classes (`.ui-*`) or it renders unstyled.
- **CSS layer order** (`src/styles/index.css`): `bootstrap < base < components <
  sections`. A later layer wins regardless of specificity. `@ui` lives in
  `components`; page CSS self-wraps in `@layer sections`. Don't try to override a
  `sections` rule from `components`.

## 7. Data gotchas

- **Don't trust enum strings — derive.** The API may return a value outside the FE
  union (e.g. `trainingStatus`). Map with a fallback, or **derive the display from
  the underlying counts** so it can never render blank.
- **Verify against the live DB/code**, not assumptions — a PostgREST
  `head:true count` is not proof a table exists or is writable; use a real
  `.select().limit(1)`.

---

## TL;DR checklist for a new page

- [ ] Read the source design's CSS + markup (incl. later override layers).
- [ ] Faithful port → componentize into `@ui` (values defined once; weights capped at 700).
- [ ] Page shape per PAGE_GUIDE; overlays/wizards from the inventory above.
- [ ] Every field/action wired end-to-end (migration → route → api → UI → seed); no accept-and-drop.
- [ ] Every button wired or honestly disabled — no dead toasts.
- [ ] Namespaced classes; no Bootstrap collisions; tokens not hex.
- [ ] `tsc --noEmit` clean while iterating; module **E2E green** before "done".
```
