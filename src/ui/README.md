# `src/ui` — Siomac UI System

The shared design system for the whole ERP. Pages define **data, content, actions, workflow**.
This folder defines **look, spacing, layout, states, interaction patterns**.

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
