# `src/ui` — Siomac UI System

The shared design system for the whole ERP. Pages define **data, content, actions, workflow**.
This folder defines **look, spacing, layout, states, interaction patterns**.

## The page standard

Two page shapes, applied uniformly across every module (HSE, HR, Finance, Operations):

```
MODULE DASHBOARD                     SUB-MODULE PAGE
PageHero  ← dark hero, 4 cards       PageHeader  ← light header: breadcrumb + title + meta chips + actions
<content>                            MetricRow   ← 4 rearrangeable cards
                                     TabBar      ← bare tabs (no second header)
                                     <content>
```

Only **module dashboards** get the dark `PageHero`. **Sub-module pages** use the light
`PageHeader` + a rearrangeable `MetricRow` + a bare `TabBar`. The four cards rearrange
(drag, persisted per-user with an admin-set org default) on BOTH via `useCardReorder`.
ProfilePill lives only in the app-level header (`AppShell`), never per-page.

## Component catalog (`import { … } from '@ui'`)

| Group | Components |
|---|---|
| Page shape | `PageHero` (module dashboard) · `PageHeader` (sub-module) · `ModuleTabs` / `TabBar` (+ `withCounts`) · `SectionHead` |
| Rearrangeable cards | `MetricRow` · `useCardReorder` + `ArrangeControls` (drag-to-arrange, persisted via `ui_layout`) |
| Layouts | `ModulePageLayout` · `SplitLayout` · `RegisterLayout` |
| Cards & metrics | `Card` (the standard card shell — header + body, default/navy, forwards drag props) · `MetricCard` (alias) · `SparkCard` · `ChartCard` · `MiniCard` · `RecordRow` · `StatusPill` |
| Charts | `Sparkline` · `BarRow` · `ProgressBar` |
| Inputs & forms | `Button` · `Field` · `TextInput` · `SelectInput` · `TextareaInput` · `FormGrid` · `Toolbar`/`SearchInput`/`FilterSelect` |
| Data | `RegisterTable` · `Tabs` |
| Overlays (standard window) | `Modal` · `Wizard` · `Drawer` |

**Standard window:** `Modal` and `Wizard` render the ONE app-wide window spec
(`.ui-modal*` in `assets/styles/uikit.css`): icon + title + sub header, close button
top-right, scrolling body, footer buttons bottom-right. Forms use the standard
`.ui-field` / `.ui-input` controls. Don't hand-roll modal or form CSS — use these.

Legacy aliases (`AreaHero`=`PageHero`, `AreaTabs`=`ModuleTabs`, `HseModal`=`Modal`,
`HseDrawer`=`Drawer`, `Record`=`RecordRow`) exist for the in-progress HSE migration
and will be removed once all pages import the canonical names.

```
src/ui/
  tokens          → design tokens live in assets/styles/base.css (:root)
  status/         → statusTokens.ts: the ONE source of status → tone → colour/pill
  components/      → reusable presentational components (Button, Card, Tabs, …)
  layouts/         → page-shape primitives (PageHeader, RegisterLayout, …)
  examples/        → UIKitPage.tsx — the living visual catalog (/ui-kit)
  index.ts         → barrel: import everything from '@ui'
```

## How to add something later — the rules

These exist so the library grows from real needs and never rots into abstract,
unused components.

### 1. Extract on the THIRD use, not the first
- **Exists already?** Use it. If it's *almost* right, add a **prop/variant** — don't fork.
- **New, but you've written near-identical markup 3× across pages?** Extract it here, delete the copies.
- **One-off (used once)?** Keep it local to the page. A component used once is not
  reusable — it's just code in the wrong folder.

> From the design brief: *"Only create components you actually need. Otherwise you
> risk building abstract components that do not fit real pages."*

### 2. A component earns its place here only if it
- uses **tokens** — never raw hex or magic numbers. Colours come from `var(--st-*)`,
  `var(--siomac-*)`; spacing from `var(--space-*)`; radius `var(--radius-*)`;
  elevation `var(--elev-*)`; z-index `var(--z-*)`.
- routes any status → colour through **`@ui/status/statusTokens`**. Never write a new
  local status→colour `switch`.
- has a **clear variant API** (props), not copy-paste forks.
- gets an entry in **`examples/UIKitPage.tsx`**. If it's not worth showing in the kit,
  it's not a system component.

### 3. Prefer wrapping existing CSS over inventing new CSS
Most components here are thin typed wrappers over class names that already exist in
`HSE.css` / `components.css` (e.g. `.inc-action-btn`, `.inc-mini-card`, `.vt-pill`).
This keeps one CSS source and means adopting a component is a zero-visual-change swap.
Only add new CSS when no existing class covers the pattern.

## Token reference (defined in `assets/styles/base.css`)
- **Status colour:** `--st-{danger,warning,success,info,neutral,purple}` (+ `-strong`, `-tint`)
- **Brand:** `--siomac-{red,navy,gold,blue}` (+ variants)
- **Spacing:** `--space-0..12` (4px base)
- **Radius:** `--radius-{xs,sm,md,lg,pill}`
- **Elevation:** `--elev-1..5`
- **Z-index:** `--z-{base,sticky,dropdown,drawer-back,drawer,modal-back,modal,popover,tooltip,toast,loading}`
