# Building a page — the Siomac standard

Every page in every module (HSE, HR, Finance, Operations) is built from `@ui` only.
**Never hand-roll** a header, card, modal, drawer, table, or form control — if a
primitive doesn't exist for what you need, add it to `@ui` first, then use it.

There are exactly **two page shapes**. Pick one.

---

## 1. Module dashboard — ONE per module

The module overview. The only place the dark hero appears.

```tsx
import { PageHero } from '@ui';

<div class="hse-tab hse-dash">
  <PageHero
    icon="fa-shield-halved"
    title="HSE"
    pageKey="hse.dashboard"          // ← makes the 4 stat cards rearrangeable + persisted
    stats={[ /* up to 4 HeroStatDef */ ]}
    footerItems={[ /* KPI strip */ ]}
  />
  {/* dashboard content */}
</div>
```

## 2. Sub-module page — Incidents, Risk & JSA, Permits, …

No dark hero. **Incidents is the reference implementation** — every sub-module page
matches it exactly: same order, same spacing tokens, same card sizes.

The page is a **flex column with `gap: 14px`** (set inline so it wins over the
`hse-dash` grid while keeping the container query). Order is always:

```
PageHeader                  (light, info-only — ProfilePill is on the right, from PageHeader)
StatsCard row               (4 fixed-size cards, rearrangeable, tab-aware)
tab row  [ TabBar | New ▾ ] (marginTop: 20px — TabBar flex:1, NewMenu fill on the right)
spark KPI row               (marginTop: 16px — 4 compact .hse-spark cells, NO icons)
table card(s)               (optionally main | right-panel via hse-main-grid)
```

```tsx
import { PageHeader, MetricRow, StatsCard, TabBar, NewMenu, Sparkline } from '@ui';

<div class="hse-tab hse-dash" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
  <PageHeader
    icon="fa-radiation"
    module="HSE"                      // breadcrumb root
    title="Risk & JSA"
    sub="Hazard register, risk assessments and job safety analyses."
    meta={[                           // context chips — NOT action buttons
      { icon: 'fa-radiation', label: `${total} hazards` },
      { icon: 'fa-table-cells-large', label: '5×5 matrix' },
    ]}
  />

  {/* 4 standard StatsCards — fixed size, rearrangeable, tab-aware. rowClass MUST be
      "ui-stat-row". Use the donut / count / % (navy) / trend mix from Incidents. */}
  <MetricRow pageKey={`hse.risk.${tab}`} rowClass="ui-stat-row" cards={[ /* 4 StatsCard */ ]} />

  {/* Tab workspace — nav + the ONE standard create action on the right */}
  <div style={{ display: 'flex', alignItems: 'stretch', gap: '12px', marginTop: '20px' }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <TabBar tabs={tabs} active={active} onSelect={setActive} />
    </div>
    <div style={{ flexShrink: 0 }}>
      <NewMenu label="New" fill items={[ /* page-specific create items */ ]} />
    </div>
  </div>

  {/* Compact KPI spark row */}
  <div style={{ marginTop: '16px' }}>
    <div class="hse-spark-row">{/* 4 × .hse-spark (label / val / sub — no icons) */}</div>
  </div>

  {/* Table — full width, OR main | aside via hse-main-grid (1fr 320px) when the page
      has a supporting signals panel. The panel goes on the RIGHT, never below. */}
  <div class="hse-main-grid">
    <div class="hse-left-col">{/* <RegisterTable> table card(s) */}</div>
    <div class="hse-right-col">{/* signals panel (optional) */}</div>
  </div>
</div>
```

### The table card — fixed shape

```
.hse-table-card
  .hse-table-card-top
    .vt-section-titlewrap   (icon + title + sub)        ← LEFT
    [ optional table-level action e.g. "Audit Log" ]    ← RIGHT
    .vt-toolbar  (search + filter selects + Export)
  table.vt-table
  <Pagination noun="…" />   (10 rows / page default)
```

**Never put a "New …" button in the table card.** Creation is the `NewMenu` on the tab
row — one create entry-point per page. The table-top right slot is only for table-level
actions (Audit Log, bulk export); leave it empty otherwise.

---

## The rules — non-negotiable

1. **One create entry-point per page: the `NewMenu` on the tab row.** No create buttons in
   `PageHeader` / `PageHero`, and **none inside table cards** (`hse-table-card-top` is
   info + table-level actions only — Audit Log / Export, never "New …"). The page's create
   action is the standard **`NewMenu`** ("New ▾", red accent, `fill`) placed to the **right of
   the nav/tabs row**. Each page passes its own items (the submenu) and the workflow each
   triggers — e.g. Risk/JSA → New Hazard / Risk Assessment / JSA; Incidents → Injury /
   Near Miss / Environmental / Property. One item renders a plain button; many render the dropdown.
2. **One ProfilePill per page** — the app-level header (`AppShell`) owns it. Never render
   a ProfilePill inside a page or hero.
3. **The four top summary cards use `<StatsCard>`** — the standard skeleton (fixed size,
   configurable header colour, slots for metric / supporting / status dots / chart / footer).
   The body always fills, so cards never look empty. **Any card showing a percentage MUST pass
   `percent`** so a compliance/progress bar renders near the bottom (the "Overall Compliance"
   pattern). The *content* (charts, metrics, insights) stays page-specific; the *skeleton* is shared.
   Inside-tab cards and one-off tiles use `<Card>` (the same shell, simpler). Never hand-roll
   `.inc-mini-card` markup.
4. **Four-card rows are rearrangeable.** Give `PageHero` a `pageKey`, or wrap a sub-module
   row in `MetricRow` with a `pageKey`. Order persists per-user with an admin-set org default
   (via the `ui_layout` backbone). `pageKey` convention: `<module>.<area>`, and
   `<module>.<area>.<tab>` for per-tab strips (e.g. `hse.incidents.capa`).
5. **Overlays use the standard window.** `Modal` (one-shot), `Wizard` (multi-step), `Drawer`
   (detail). Header icon+title+sub, close top-right, footer buttons bottom-right — don't
   build your own modal CSS.
6. **Forms use the standard controls.** `FormGrid` + `Field` + `TextInput` / `SelectInput`
   / `TextareaInput`. Don't hand-roll inputs.
7. **Tables** use `RegisterTable`; **tabs-in-a-panel** use `Tabs`; the page nav uses `TabBar`.
8. **Status** via `StatusPill` (and `riskPill` for risk). Never a local colour `switch` —
   route through `@ui/status/statusTokens`.
9. **Theme through tokens only.** No raw hex / magic numbers — use `var(--siomac-*)`,
   `var(--st-*)`, `var(--space-*)`, `var(--radius-*)`. The superadmin theme editor re-themes
   everything that obeys this.
10. **Data through authenticated APIs.** TanStack Query for reads; mutations go through the
    shared **module service adapter** (`runModuleMutation`) so every write emits
    `app_events` + `audit_logs` + workflow tasks + notifications. **No direct browser
    Supabase reads for ERP data.** (See CLAUDE.md.)

---

## Component cheat-sheet

| Need | Use |
|---|---|
| Module dashboard header | `PageHero` (4 rearrangeable stat cards + KPI footer) |
| Sub-module header | `PageHeader` (breadcrumb + title + sub + meta chips, info-only) |
| Page tabs | `TabBar` (bare) — or `ModuleTabs` if you really need a header card |
| Primary create action | `NewMenu` ("New ▾") to the right of the nav/tabs — page-specific items |
| The 4-card row | `MetricRow` (rearrangeable) with `StatsCard` cards |
| Make an existing card row rearrangeable | `ReorderableRow` — wrap the cards + pass a `pageKey` (no restructuring) |
| A summary card (top of page) | `StatsCard` — fixed skeleton; `percent` → compliance bar |
| An inside-tab / one-off card | `Card` — header + body, default/navy |
| Charts | `SparkCard`, `Sparkline`, `BarRow`, `ProgressBar`, `ChartCard` |
| Section header in content | `SectionHead` (this is where action buttons go) |
| Table | `RegisterTable` |
| Create flow | `Wizard`; single dialog `Modal`; detail `Drawer` |
| Form | `FormGrid` + `Field` + inputs |
| Status / risk | `StatusPill`, `riskPill` |
| Layout inside a tab | `SplitLayout` (main + aside) |

See the live catalog: **Superadmin Console → UI Kit** (every component + variants, plus the
theme editor).
