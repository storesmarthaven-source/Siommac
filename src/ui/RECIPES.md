# UI Kit v2 — Recipe convention

How a canonical component owns its styling, and how the Gallery edits it.

---

## 1. Tokens vs. recipes

Two different things, deliberately separated:

| | **Token** | **Recipe variable** |
|---|---|---|
| Question it answers | "What is our brand navy?" | "How tall is a medium Button?" |
| Scope | Global, cross-component | One component (optionally one variant) |
| Lives in | `assets/styles/base.css`, `src/ui/tokens/tokens.css` | the component's own `*.recipe.css` |
| Layer | `base` | `recipes` |
| Naming | `--siomac-navy`, `--ui-control-md` | `--ui-button-primary-bg` |
| Editable in Gallery | Token Inspector (Foundations) | Inspector → **Style** tab |

A recipe variable's **default must be a token**, never a literal:

```css
/* correct — the recipe defers to the palette */
--ui-button-primary-bg: var(--siomac-red);

/* wrong — this value is now invisible to the theme editor */
--ui-button-primary-bg: #E40C0C;
```

That rule is what makes "change the brand colour once" actually re-theme every
component, and it is why the audit's B4 finding (484 CSS vars referenced, ~85
defined) must not be allowed to repeat inside the kit.

---

## 2. Naming

```
--ui-<component>[-<variant>]-<property>
```

- `<component>` — kebab-case, matches the registry id: `button`, `text-input`, `dialog`
- `<variant>` — optional; only when the value genuinely differs per variant
- `<property>` — `bg`, `fg`, `border`, `radius`, `height`, `pad-x`, `pad-y`,
  `font-size`, `font-weight`, `gap`, `icon-size`, `shadow`

Size-scoped values append the size key:

```css
--ui-button-height-sm  --ui-button-height-md  --ui-button-height-lg
```

Interaction-scoped values append the state:

```css
--ui-button-primary-bg  --ui-button-primary-bg-hover  --ui-button-primary-bg-active
```

Do not invent a variant variable when the value is shared. `--ui-button-radius`
is one variable because every Button variant is the same shape; splitting it into
six would give the Style tab six controls that must always be changed together.

---

## 3. File layout

```
src/ui/primitives/Button.tsx          component
src/ui/primitives/Button.recipe.css   its recipe   ← @layer recipes
src/ui/registry/button.def.tsx        its metadata
src/ui/primitives/Button.test.tsx     its behaviour
```

The component imports its own recipe. Every recipe file self-wraps, because a TS
`import './x.css'` cannot carry a `layer()` token:

```css
@layer recipes {
  :root { /* recipe variable defaults */ }
  .ui-btn { /* … */ }
}
```

`recipes` is declared **last** in `src/styles/index.css`, so a recipe out-ranks a
legacy `sections` rule by layer order alone.

---

## 4. The `!important` rule — NON-NEGOTIABLE

**Recipe CSS never uses `!important`.**

Cascade layer priority is **reversed for `!important`**: the *earliest* layer wins.
With `@layer bootstrap, base, components, sections, recipes`, a `sections`
`!important` rule beats a `recipes` `!important` rule, and beats any `recipes`
normal declaration outright.

So there is no ordering trick that lets the kit override legacy `!important` from
a later layer. Adding `!important` to a recipe starts an escalation war the kit is
structurally guaranteed to lose — and is a band-aid by the project's own definition.

**The mechanism for legacy overrides is deletion.** A component migration is not
complete until the module rules it supersedes — especially the `!important` ones —
are removed. Layer order only keeps the clean case clean.

---

## 5. Forcing states for preview

`:hover`, `:focus-visible` and `:active` cannot be triggered synthetically, so the
Gallery could not preview them if recipes only used pseudo-classes. Every
interactive recipe therefore pairs each pseudo-class with an attribute selector:

```css
.ui-btn:hover:not(:disabled),
.ui-btn[data-ui-state~='hover'] {
  background: var(--ui-button-primary-bg-hover);
}
```

Components accept `forceState` and emit it as `data-ui-state`. This is a real,
inspectable attribute — not a Gallery-only fork of the styling — so what the
Compare view shows is exactly what a user sees.

`data-ui-state` is space-separated (`~=`) so combinations compose: a control can
be `focus` and `error` at once.

**Rule:** `forceState` is for the Gallery. Application code never sets it; genuine
states (`disabled`, `readOnly`, `loading`, `validation`) have their own props.

---

## 6. Draft vs. published

The Gallery writes drafts to a **scoped element**, not `:root`:

```
Published tokens   ── app_theme table ──▶ :root (every user)
       │
       ▼
Gallery draft      ── inline style ─────▶ [data-ui-preview-scope]  (this browser tab only)
       │
       ▼
Review & publish   ── promotes draft ───▶ :root + app_theme
```

Because recipe variables are ordinary custom properties, one mechanism covers both
tokens and recipes: set them on the preview scope and everything inside re-styles,
while the rest of the app — and every other user — is untouched.

This is why `applyTheme.ts` grew `applyScopedOverrides`: the previous editor wrote
straight to `:root` **and** persisted app-wide on save, which made it unusable as an
interactive playground (dragging a slider re-themed production for everyone).

---

## 7. One component, many variants — the bar for a NEW primitive

The point of this kit is to REDUCE SIOMAC's component count. A new primitive is
justified only when the **interaction model** differs. Everything else — variant,
size, state, icon-only, tone, orientation, density — is a prop.

**Not a new component:**

| Tempting name | What it actually is |
|---|---|
| `IconButton` | `<Button iconOnly aria-label>` — the type makes the label required |
| `LinkButton` | `<Button href>` — renders a real `<a>` |
| `ToggleButton` | `<Button pressed>` — emits `aria-pressed` |
| `PrimaryButton` | `<Button variant="primary">` |
| `ConfirmDialog` | `<Dialog variant="confirm">` |
| `HseModal` / `HrModal` | `<Dialog>` |
| `StatusPill` / `Tag` / `Chip` | `<Badge tone variant onRemove>` |
| `KpiCard` / `MetricCard` / `ChartCard` / `MiniCard` / `RailCard` / `SummaryCard` / `Panel` | `<Card variant tone density>` |
| `TableToolbar` / `RowsPerPage` / `ColumnChooser` | parts of `<DataTable>` |
| `Banner` | `<Alert placement="page">` |
| `ErrorState` / `PermissionDeniedState` | `<EmptyState tone>` |
| `ProgressRing` / `Meter` | `<Progress shape>` |
| `VerticalTabs` / `ModuleTabs` / `TabBar` / `AreaTabs` / `PanelTabs` | `<Tabs orientation variant size maxVisible>` |

**Is a new component** — the interaction genuinely differs:

- `SegmentedControl` vs a row of Buttons — radiogroup semantics, roving
  focus, arrow-key movement. A screen reader announces them differently.
- `Menu` vs `Select` — a menu moves REAL focus onto its items; a listbox keeps
  focus on the trigger and uses `aria-activedescendant`.
- `Switch` vs `Checkbox` — a switch applies immediately; a checkbox is a pending
  form value. Using the wrong one lies about when the change lands.
- `Combobox` vs `Select` — type-to-filter vs press-to-open, and a different value
  contract for multi-select (`T` vs `T[]`).

Shared implementation is the test, not shared appearance. Select, Combobox and
MultiSelect keep separate exports but share ONE keyboard core, ONE popup, ONE
option list and ONE recipe — so they are one component with three interaction
modes, and the Gallery shows them as **one card**.

### The Gallery follows the same rule

A registry entry is a component, not a variant. Six cards for Button's variants
would reproduce inside a nicer Gallery exactly the fragmentation this kit exists
to remove. Variants and states belong in the entry's `props`, `states`, `compare`
and `examples`.

---

## 8. Checklist for a new canonical component

0. It passes §7 — the interaction model genuinely differs from everything that exists
1. Recipe CSS in `@layer recipes`, no `!important`, defaults alias tokens
2. Every interactive rule paired with its `[data-ui-state~='…']` selector
3. Registry definition — props schema, style tokens, states, a11y, code example
4. Behavioural tests (not screenshots)
5. Appears in the Gallery with a working inspector
6. One real SIOMAC consumer migrated as proof
7. The superseded implementation and its CSS **deleted**
