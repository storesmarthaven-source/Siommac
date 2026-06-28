# Widget Library (v2) — Implementation Plan & Status

> A reusable, cross-module **widget library**: browse a catalogue, size/configure a
> widget, **preview it on the live page board** (drag/resize WITHOUT saving), then add it.
> Boards are per-page, zone-based, drag/resize, and persist per-user. Built on
> **gridstack.js** + Preact, on the **reuse-hooks** data model (each widget fetches its
> own data via the module's existing TanStack hooks — no generic data endpoint).
>
> This replaced the v1 card board, now **deleted** (no dual systems). Both HR ▸ Employee
> Master and HR ▸ Onboarding run on this v2 board.

---

## Architecture

- **Contract** — `src/ui/widgets/types.ts`
  - `WidgetDef<TConfig>` — registry entry (code-based, carries `render`/`renderPreview`).
  - `WidgetInstance` — a saved widget on a board (instanceId, widgetId, pageKey, zoneId, x/y/w/h, sizeKey, config).
  - `PreviewWidgetInstance` — an EPHEMERAL widget on the board, never persisted (`preview:true`).
  - `BoardLayout` — `{ pageKey, zones: Record<zoneId, WidgetInstance[]> }`, stored in `ui_layout.layout` (jsonb).
- **Registry** — `registry.ts` is SELF-REGISTERING: it auto-collects every widget "package"
  (`registry.<name>.tsx` exporting `export const widgets: WidgetDef[]`) via `import.meta.glob` —
  drop a package file and it registers itself, no aggregator edit (guarded by `registry.test.ts`).
  Packages: `registry.hr.tsx`, `registry.hrEmployees.tsx` (+ hse/finance/operations later) — a
  "bundle" is simply a package file (one file, multiple widgets). The library filter bar carries
  the **Live preview** + **Demo data** toggles. Authoring: `WIDGET_AUTHORING_GUIDE.md`.
- **Library modal** — `WidgetLibraryModal` + `WidgetCatalog` / `WidgetDetailPanel` / `WidgetSizeSelector` / `WidgetConfigFieldRenderer` / `WidgetConfigureModal` / `WidgetLivePreview`. Scoped CSS `widgetLibrary.css` (`.wlib-*`).
- **Board** — `WidgetBoard` → `WidgetBoardZone` (one gridstack grid per zone) → `WidgetFrame` → `WidgetRenderer`. Uses our PROVEN gridstack↔Preact bridge (`GridStack.renderCB` + `grid.load` + `render()` into each cell; constant container class; `renderCB` cleared on unmount). Scoped CSS `widgetBoard.css` (`.wbi-*`).
- **Persistence** — `useBoardLayout(pageKey)` (optimistic) → `src/api/layout.ts` `getInstanceLayout`/`saveInstanceLayout` → `uiPrefs.ts` `/layout/getInstanceLayout` + `/layout/saveInstanceLayout` (requireUser; per-user `ui_layout.layout`). Only committed widgets are saved; previews never are.
- **Public entry** — `import { ... } from '@ui/widgets'` (`src/ui/widgets/index.ts`).

### Preview-on-board (the headline feature)
The host page owns `preview: PreviewWidgetInstance | null`. "Preview on board" from the
library emits a preview + closes the modal. The board renders it with dashed chrome,
gridstack lets you drag/resize it (geometry flows back via `onPreviewChange`), and
**Add to board** (`commitPreviewWidget` → `addWidget`) or **Discard** resolves it. The
persisted layout never contains a preview.

---

## Stage status

- **Stage A — contract + registry** ✅ types, registry, instance helpers, real HR widgets (see inventory).
- **Stage B — library modal** ✅ catalogue + detail panel + size/config + live preview, scoped CSS.
- **Stage C — board + preview-on-board** ✅ `useBoardLayout`, board components, gridstack bridge, persistence routes (`ui_layout.layout`), `@ui/widgets` barrel. Typechecks green (FE + BE).
- **Stage D — wire onto a page** ✅ **HR ▸ Onboarding** (`OnboardingOverview.tsx`, pageKey `hr.onboarding.overview`). New nav item `s-hr-onboarding` in `hrModule`; `HRSection` routes Employee Master vs Onboarding via `siomac:section`. Widget Library button + Customize toggle + preview banner.
- **Stage E — migrate Employee Master + delete legacy** ✅ **DONE.** Employee Master runs on
  the v2 board (`hr.employees.overview`): KPI/insight/workforce widgets come from the global
  registry (browsable in the library); the **register table is a PAGE-LOCAL widget**
  (`localWidgets` — its render closes over the page's filters/selection/modals, `chrome:'none'`)
  seeded by a per-page `defaultLayout`. Legacy v1 deleted: `WidgetBoard`/`WidgetBoardZone`/
  `WidgetPicker` (`src/ui/components`), `theme/useBoardLayout`, the legacy `registry.ts`,
  `HR/widgets/hrWidgets.tsx` + `panels.tsx`, the `@ui` legacy exports, the FE board API
  (`getBoardLayout`/`saveBoard*`/`BoardItem`) + BE routes (`layout/saveBoard*`) + `WIDGET_BOARD_SPEC.md`.
  `widgetRegistry.ts`→`registry.ts`. **Kept** (still used elsewhere): `useModuleLayout` +
  `reorder.tsx` (PageHero/MetricRow/HSE card ordering). Table-as-widget solved cleanly via the
  page-local-widget mechanism (no state-closure hack, no dropdown-clip — `chrome:'none'` lets the
  register own its tall scrolling card).

---

## Chrome, page-local widgets, default layout (v2 board mechanics)

- **`chrome`** on `WidgetDef`/`LocalWidget` (`'standard'` | `'none'`). `none` = bare (the widget
  renders its own card, e.g. StatsCard/ChartCard or the register's tall scrolling table); edit/
  preview tools float. `standard` = framed header + bordered body (lists).
- **Page-local widgets** — a host page may pass `localWidgets` (widgetId → `{ render, chrome, title }`)
  for board instances NOT in the global registry, so they can close over page state. Resolved
  before the registry (`resolveBoardWidget`). Not offered in the catalogue. This is how the
  employee register lives on the board.
- **`defaultLayout`** — a host page passes a `BoardLayout` used when the user has no saved layout
  (fixed instanceIds `${widgetId}#def`).

## Widget inventory

**HR ▸ Onboarding** (`registry.hr.tsx`, live via `@api/hr/onboarding`) — KPIs/trend: `activeCases`,
`activationReadiness`, `blockingTasks`, `dueThisWeek`, `weeklyTrend`; lists: `recentCases`,
`overdueTasks`, `pendingHandoffs`, `activeBlockers`, `packagesInUse`. **10 widgets.**

**HR ▸ Employee Master** (`registry.hrEmployees.tsx`, live via `@api/hr/employees`) — KPIs:
`activeWorkforce`, `workQueue`, `readiness`, `exceptions`; insight: `deptDistribution`,
`demographics`; locked (no source module yet): `compliance`, `expiringCerts`, `attendanceTrend`,
`lifecycleFunnel`, `skillsHeatmap`. Plus the page-local `hr.employees.register`. **11 widgets + register.**

Shared inline primitives (`inlinePrimitives.tsx`): `ListRow`/`WidgetList`/`MiniSparkline`/
`TrendArea`/`MiniBars`/`DonutPct`/`Empty`/`humanize` — inline-styled so the same markup renders on
the board AND in catalogue previews. How to add more: `WIDGET_AUTHORING_GUIDE.md`.

## Declarative (no-code) widgets + installable packages

A widget can be defined as DATA (no code) and installed at runtime from a `.zip`/`.json`:
- **Engine** — `src/ui/widgets/declarative/`: `types.ts` (`DeclarativeWidgetSpec`, `view:{kind:…}`),
  `DeclarativeWidgetView.tsx` (generic renderer → primitives), `declarativeToWidgetDef.tsx` (spec→WidgetDef),
  `parsePackageFile.ts` (unzip via `fflate` / parse JSON). Samples: `registry.samples.tsx`.
- **Install** — admin → Widget Library → **Install package** (.zip/.json) → validated client + server →
  stored in `ui_widget_packages` (org-wide) → appears for everyone. **Manage** lists/uninstalls.
  Backend: `widgetPackages.ts` (`/api/widgets/packages/list|install|uninstall`). FE: `@api/widgets`.
- **Runtime registry** — `runtimeRegistry.ts` holds installed widgets; `registry.ts` `allWidgets()` =
  code + runtime (so `findWidgetDef`/library/board resolve them); library + board re-render on change
  via `useRuntimeWidgetsVersion`; `useInstalledWidgetPackages()` (in `WidgetBoard`) loads them.
- Sample package to test: `docs/examples/sample-widget-package.json`.
- **Phase 3 (later):** live data binding (a data-source registry so declarative widgets pull real
  data, not embedded sample) + a widget-spec editor UI.

## Operator steps (before boards work at runtime)

1. Apply migration **`20260714000007_ui_layout_instances.sql`** (adds `layout jsonb` to `ui_layout`).
2. Apply migration **`20260714000009_ui_widget_packages.sql`** (installable declarative packages).
3. **Rebuild backend + restart dev** — `npm run build:backend` then restart `dev:netlify` (compiled `dist/`, routes don't hot-reload). New dep: `fflate ^0.8.3` → `npm install` if not already.

---

## Deferred / later

- Live data binding for declarative widgets (a data-source registry) — Phase 3.
- `ui_widget_policy` + `ui_widget_catalog_overrides` (admin lock/curation beyond `lockedReason` + permission gate).
- Full multi-module registries (hse / finance / operations).
