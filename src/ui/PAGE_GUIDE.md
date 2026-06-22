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

No dark hero. A light, info-only header, a rearrangeable metric row, then bare tabs.

```tsx
import { PageHeader, MetricRow, TabBar, Card, SparkCard } from '@ui';

<div class="hse-tab hse-dash">
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

  <MetricRow                          // the 4-card row — rearrangeable + persisted
    pageKey="hse.risk"
    cards={sparks.map(s => ({ key: s.label, node: <SparkCard spark={s} /> }))}
  />

  <TabBar tabs={tabs} active={active} onSelect={setActive} />

  {/* tab content — tables, SplitLayout, panels */}
</div>
```

---

## The rules — non-negotiable

1. **Headers are info-only.** No "New …" / action buttons in `PageHeader` or `PageHero`.
   Primary actions live in the tab content (a `SectionHead` action, a table toolbar).
2. **One ProfilePill per page** — the app-level header (`AppShell`) owns it. Never render
   a ProfilePill inside a page or hero.
3. **All cards use `<Card>`.** Never hand-roll `.inc-mini-card` markup. `Card` is the one
   shell: header (`icon` + `title` + optional `headerRight`), body (`children` + `bodyStyle`),
   `variant="default" | "navy"`. Different data goes in the body — the window stays identical.
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
| The 4-card row | `MetricRow` (rearrangeable) with `Card`/`SparkCard` cards |
| A card | `Card` (always) — header + body, default/navy |
| Charts | `SparkCard`, `Sparkline`, `BarRow`, `ProgressBar`, `ChartCard` |
| Section header in content | `SectionHead` (this is where action buttons go) |
| Table | `RegisterTable` |
| Create flow | `Wizard`; single dialog `Modal`; detail `Drawer` |
| Form | `FormGrid` + `Field` + inputs |
| Status / risk | `StatusPill`, `riskPill` |
| Layout inside a tab | `SplitLayout` (main + aside) |

See the live catalog: **Superadmin Console → UI Kit** (every component + variants, plus the
theme editor).
