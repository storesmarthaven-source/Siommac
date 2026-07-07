# Widget Authoring Guide — how to build a SIOMAC widget

> The canonical recipe for adding a widget to the library. A widget is one entry in a
> module's registry array (`src/ui/widgets/registry.<module>.tsx`). Working reference:
> [`registry.hrOnboarding.tsx`](../src/ui/widgets/registry.hrOnboarding.tsx). Contract:
> [`types.ts`](../src/ui/widgets/types.ts).
>
> **Engine:** the board runs on **react-grid-layout** (Preact-native — layout is data, tiles are
> normal children). A widget just returns its VNode; never touch the grid cell.

---

## The data model you must follow: REUSE-HOOKS

A widget does **not** receive data as a prop. Its `render` is a component that fetches its
**own** data via the module's existing TanStack hooks (e.g. `useOnboardingDashboard()`).
There is no generic data endpoint and `WidgetRenderProps` carries no `data`. This means:

- **You can only build a widget for data that already has a hook.** If the data isn't
  exposed by an `@api/<module>/…` hook yet, add the hook first (the enterprise way) — do
  NOT fetch ad-hoc inside the widget or fake it.
- `render` is a real component: call hooks at the top level, handle loading via the
  component (`loading={q.isLoading && !q.data}` — never render a fake "0").
- `renderPreview` is a **separate, static thumbnail** for the catalogue/detail panel.
  It uses representative SAMPLE numbers and calls **no hooks**. It is clearly a preview,
  never presented as live data.

---

## The presentation model you must follow: FLUID + ANIMATED (code-first contract)

Every first-party widget is a Preact **code widget** built to ONE contract. (Declarative /
sandboxed-JS widgets exist only as the installable *third-party* path — see the end of this doc.)

**Fluid — the widget adapts to its TILE, not the page.** A ported fixed-layout card that hard-codes
widths or hangs its styling off page-ancestry selectors (`.some-page-grid > .card`) *squeezes* when
resized and is the #1 source of board bugs. Instead:

1. Put `class="wbi-widget"` on your widget's ROOT — it fills the tile and becomes a **container**
   (`container-type: inline-size`).
2. Adapt with **`@container` queries** (respond to the tile's own width, never the viewport or a fixed
   px breakpoint), and lay out with fluid primitives — `%`, `minmax()`, `clamp()`, `auto-fit`.

```tsx
// widget root
<div class="wbi-widget my-kpis">{/* … */}</div>
```
```css
.my-kpis { display: grid; gap: 12px; grid-template-columns: 1fr; }
@container (min-width: 340px) { .my-kpis { grid-template-columns: repeat(2, 1fr); } }
@container (min-width: 560px) { .my-kpis { grid-template-columns: repeat(3, 1fr); } }
```

**Animated — use the toolkit, never ad-hoc.** Import motion hooks from `@ui/widgets`
([`motion.ts`](../src/ui/widgets/motion.ts)) — they wrap the `motion` library's vanilla API and all
NO-OP under `prefers-reduced-motion`. Attach the returned **callback ref** to the element:

| Hook | Attach to | Effect |
|---|---|---|
| `useMountReveal()` | (automatic — the board fades every tile in; only add manually for inner elements) | fade + rise on mount |
| `useValuePulse(value)` | the metric's number element | pop when `value` changes (KPI tick) |
| `useStaggerReveal(dep)` | a list/grid container | cascade its direct children in when `dep` (data) resolves |

```tsx
import { useValuePulse, useStaggerReveal } from '@ui/widgets';
function ActiveCases() {
  const q = useMyModuleData();
  const numRef = useValuePulse(q.data?.total);
  const listRef = useStaggerReveal(q.data?.rows?.length);
  return (
    <div class="wbi-widget">
      <strong ref={numRef}>{q.data?.total ?? 0}</strong>
      <ul ref={listRef}>{(q.data?.rows ?? []).map(r => <li key={r.id}>{r.label}</li>)}</ul>
    </div>
  );
}
```

---

## What information a widget needs (every field)

| Field | Type | Required | What to provide |
|---|---|---|---|
| `id` | string | ✅ | Stable unique id, `module.area.thing` (e.g. `hr.onboarding.activeCases`). Never reuse/rename — it's the persisted key. |
| `module` | `'hr'\|'hse'\|'finance'\|'operations'\|'enterprise'` | ✅ | Owning module (drives the module filter). |
| `area` | string | ✅ | Sub-area within the module (e.g. `onboarding`). Free text. |
| `title` | string | ✅ | Catalogue + board-frame title (Title Case, short). |
| `description` | string | ✅ | One line for the catalogue tile + detail panel. |
| `longDescription` | string | – | Optional richer blurb for the detail panel. |
| `icon` | string | ✅ | Font Awesome class (`fa-users`). |
| `category` | string | ✅ | Catalogue section grouping (e.g. `Case Operations`). Keep consistent across a module. |
| `tags` | string[] | ✅ | Search keywords (the library search matches these). |
| `previewVariant` | enum | ✅ | Visual hint for the catalogue: `metric`/`trend`/`donut`/`task-board`/`timeline`/`people`/`table`/`checklist`/`risk`/`flow-map`/`matrix`/`status-stack`. |
| `supportedPages` | string[] | ✅ | pageKeys the widget is designed for. NOTE: the library is unified — EVERY widget shows on EVERY page; this (with `recommendedFor`) only drives the "Recommended for this page" section, not availability. |
| `supportedZones` | string[] | ✅ | Zone ids it may live in (e.g. `main`, `overview`). |
| `defaultSize` | `WidgetSizeKey` | ✅ | Size used when first added: `compact\|standard\|wide\|large\|tall\|hero`. |
| `allowedSizes` | `WidgetSizeDef[]` | ✅ | The sizes the user may pick, each `{ key, label, grid:{w,h}, description? }`. `w` is in 12 grid columns; `h` in 88px row units. Resize is clamped to the min/max across these. |
| `defaultConfig` | object | ✅ | Default values for the config fields (`{}` if none). |
| `configSchema` | `WidgetConfigField[]` | ✅ | Per-instance settings rendered in Configure (`[]` if none). See below. |
| `dataSource` | `WidgetDataSourceDef` | ✅ | `{ sourceKey, label, refreshIntervalMs?, permissions:string[], dependencies? }`. **`permissions`** gates the widget — if the user lacks any key it shows LOCKED. Use EXACT catalogue keys (e.g. `hr.onboarding.view`). |
| `recommendedFor` | string[] | – | pageKeys where it appears in the catalogue's "Recommended" band. |
| `lockedReason` | string | – | If set, the widget is shown LOCKED in the catalogue (module/data not built yet). Use this instead of shipping a fake widget. |
| `render` | `(props) => VNode` | ✅ | Live component (reuse-hooks). |
| `renderPreview` | `(props) => VNode` | – (strongly recommended) | Static sample thumbnail; no hooks. |

### `configSchema` field shape
`{ key, label, type, defaultValue?, required?, options?, helpText? }` where `type` is
`text\|select\|multiSelect\|dateRange\|number\|boolean\|threshold\|statusFilter`. The
instance's chosen values arrive as `props.config` in `render` (merged over `defaultConfig`).

### `render` / `renderPreview` props
`render(props: WidgetRenderProps)` — `{ widgetId, instanceId, pageKey, zoneId, sizeKey,
config, preview? }`. `preview` is true when rendered as an on-board preview (you may lighten
visuals; usually ignore). `renderPreview(props: WidgetPreviewProps)` — `{ widgetId, sizeKey,
config }`.

---

## Sizing convention (12-col grid, 88px rows)

| sizeKey | typical grid | use for |
|---|---|---|
| `compact` | `{w:3,h:2}` | a single KPI metric |
| `standard` | `{w:4,h:2}` | KPI + small breakdown |
| `wide` | `{w:6,h:2-3}` | trend/chart, side-by-side |
| `large` | `{w:8,h:4}` | rich panel |
| `tall` | `{w:4,h:4}` | lists/timelines |
| `hero` | `{w:12,h:4+}` | full-width table/board |

Only list the sizes that actually look right — the size selector shows exactly `allowedSizes`.

> **Grid units are PER-BOARD.** The table above is the Employee Master board (12 columns, 88px
> rows). A board can run a finer grid — the HR Onboarding board is **24 columns / 12px rows** for
> near-fluid resize — and then every `grid.w`/`min.w` you declare is in THAT board's units (double
> the numbers). Each `allowedSizes` entry may add `min: { w, h }` — the **resize floor** below which
> a fixed-layout card would clip. A fully fluid `.wbi-widget` (the contract above) reflows at any
> size and needs only a modest floor.

---

## Widget packages — self-registering (the "extension" format)

A **widget package** is one file `src/ui/widgets/registry.<name>.tsx` — a SINGLE-segment
name, no interior dots (`registry.hr.tsx`, `registry.hrEmployees.tsx`, future
`registry.hse.tsx`) — that exports:

```ts
export const widgets: WidgetDef[] = [ … ];
```

[`registry.ts`](../src/ui/widgets/registry.ts) auto-collects every such file via
`import.meta.glob('./registry.*.tsx')`. **Drop the file and it registers itself — no edit to
any aggregator.** Duplicate ids are dropped with a dev warning. The mechanism is guarded by
[`registry.test.ts`](../src/ui/widgets/registry.test.ts) (run it after adding a package).

## The template (copy to a new `registry.<name>.tsx`)

```tsx
// src/ui/widgets/registry.<name>.tsx — a widget package (auto-registered via `widgets`)
import type { WidgetDef } from './types';
import { StatsCard } from '@ui';                        // or ChartCard, a custom view, etc.
import { useMyModuleData } from '@api/<module>/<area>'; // an EXISTING hook (reuse-hooks)

const PAGES  = ['<module>.<area>.overview'];
const ZONES  = ['main', 'overview'];
const SOURCE = { sourceKey: '<module>_<thing>', label: '<Human label>', refreshIntervalMs: 300000, permissions: ['<module>.<area>.view'] };

export const widgets: WidgetDef[] = [
  {
    id: '<module>.<area>.<thing>',
    module: '<module>', area: '<area>',
    title: '<Title Case>', description: '<one line>',
    icon: 'fa-<icon>', category: '<Category>', tags: ['<kw>'],
    previewVariant: 'metric',
    chrome: 'none',                              // 'none' if the widget renders its own card (StatsCard/ChartCard); omit for framed list widgets
    supportedPages: PAGES, supportedZones: ZONES,
    defaultSize: 'compact',
    allowedSizes: [
      { key: 'compact',  label: 'Compact',  grid: { w: 3, h: 2 }, description: 'Metric.' },
      { key: 'standard', label: 'Standard', grid: { w: 4, h: 2 }, description: 'Metric + breakdown.' },
    ],
    defaultConfig: {}, configSchema: [],
    dataSource: SOURCE, recommendedFor: PAGES,
    render: () => {                              // LIVE — own data via the hook; real loading, never fake 0
      const q = useMyModuleData();
      return <StatsCard icon="fa-<icon>" title="<Title>" loading={q.isLoading && !q.data} metric={q.data?.total ?? 0} supporting="<sub>" footer={`<a> · <b>`} />;
    },
    renderPreview: () => (                       // CATALOGUE thumbnail + DEMO mode — static sample, no hooks
      <StatsCard icon="fa-<icon>" title="<Title>" metric={42} supporting="<sub>" footer="<a> · <b>" />
    ),
  },
];
```

## After authoring — 2 checks, no wiring

1. **Nothing to wire for availability** — the library is unified, so a self-registered widget
   appears on EVERY board automatically (any page that renders `<WidgetBoard>` +
   `WidgetLibraryModal` — see [`OnboardingOverview.tsx`](../src/components/sections/HR/OnboardingOverview.tsx)).
   Set `recommendedFor` to the page(s) it's designed for so it surfaces in "Recommended for this page".
2. **Verify** — `tsc -p tsconfig.frontend.json --noEmit` (typed contract; a missing field or bad
   size key fails) + `npx vitest run src/ui/widgets/registry.test.ts` (confirms it registered).

---

## Bundles — curated first-party sets

A **bundle** is a named, curated list of widget ids that ship with the SIOMAC platform
(defined in [`src/ui/widgets/bundles.ts`](../src/ui/widgets/bundles.ts)). Bundles appear
as compact cards at the top of the Widget Library catalog pane with an **"Add N widgets"**
button that adds every member widget in one action.

**Bundles vs packages — the distinction is intentional and must not be blurred:**

| Concept | Source | Who authors it | Where stored |
|---|---|---|---|
| **Bundle** | Code — `bundles.ts` | SIOMAC platform team | Compiled JS (this repo) |
| **Package** | Data — `manifest.json` / `.zip` | Third-party / admin upload | `ui_widget_packages` DB table |

A bundle references widget ids by string. Any id that is not currently registered (e.g. a
forward-reference to a widget not yet shipped in a `registry.*.tsx` file) is silently skipped
by `resolveBundleWidgets()` — so bundles are safe to author before all their member widgets
exist. The "Add N" count in the UI reflects only the widgets that are actually addable given the
current registry, board state (not already placed), and locks (permissions).

### Adding a bundle

1. Open `src/ui/widgets/bundles.ts` and add an entry to `WIDGET_BUNDLES`.
2. Give it a stable `id` (never rename — used as a React key), a `title`, `description`, `icon`
   (Font Awesome class), `module` (the owning `ModuleKey`), and `widgetIds`.
3. You may include forward-reference ids for widgets not yet built — they are skipped until
   the matching `registry.*.tsx` ships.
4. A bundle with zero currently-registered members is hidden entirely (not rendered).
5. A bundle whose every registered widget is already placed shows a disabled "Added" button.

```ts
// bundles.ts excerpt
export const WIDGET_BUNDLES: WidgetBundle[] = [
  {
    id: 'bundle.hr.onboarding.manager',
    title: 'Onboarding Manager Pack',
    description: 'Key onboarding metrics and readiness gates.',
    icon: 'fa-user-plus',
    module: 'hr',
    widgetIds: [
      'hr.onboarding.readinessGates',   // registered now
      'hr.onboarding.activeCases',      // forward-ref — ships in Phase 5
    ],
  },
];
```

The helper `resolveBundleWidgets(bundle, allWidgetIds)` (also exported from `@ui/widgets`)
returns only the member ids that are currently registered — use it if you need to check
bundle addability outside the library modal.

---

## Declarative (no-code) widgets + installable packages (.zip / .json)

Besides code widgets (above), a widget can be defined purely as **data** — no `render` function —
and **installed at runtime from a file**, no code change. A generic engine
([`DeclarativeWidgetView`](../src/ui/widgets/declarative/DeclarativeWidgetView.tsx)) renders the
spec onto the same primitives.

A **package** is a `manifest.json` (optionally inside a `.zip` with assets) — admins install it via
**Widget Library → Install package**; it's stored in `ui_widget_packages` and appears in the library
for everyone. Shape (see [`docs/examples/sample-widget-package.json`](examples/sample-widget-package.json)):

```jsonc
{
  "name": "Sample Pack", "version": "1.0.0",
  "widgets": [
    { "id": "pack.revenue", "title": "Revenue", "description": "…", "icon": "fa-sack-dollar",
      "category": "Finance", "tags": ["finance"], "defaultSize": "standard", "allowedSizes": ["compact","standard"],
      "view": { "kind": "metric", "metric": "$1.24M", "supporting": "This quarter", "footer": "+8%" } }
  ]
}
```

`view.kind` is one of: **metric** `{metric,supporting?,footer?}` · **donut** `{percent,…}` ·
**trend** `{points:number[]}` · **bars** `{rows:{label,count}[]}` · **list** `{rows:{primary,secondary?,right?,tone?}[]}`.
Values are embedded sample data (great for mocks). Live data binding is a later phase. The backend
re-validates every spec on install. Manage/uninstall via **Widget Library → Manage** (admin).

## Rules & gotchas (no band-aids)

- **No fake data.** If the data has no hook, add the hook or ship the widget with
  `lockedReason`. Never hardcode numbers in `render`.
- **`renderPreview` ≠ live.** Sample numbers only; no hooks; never let it read like real data.
- **Permission keys are exact.** `dataSource.permissions` must match the catalogue
  EXACTLY (e.g. `hr.onboarding.view`) — these are what lock/unlock the widget.
- **Stable `id`s.** Changing an `id` orphans every saved instance. Treat it as a key.
- **Loading gate.** `loading={q.isLoading && !q.data}` so cached data shows instantly and
  only a cold load shows a skeleton (matches the loading-state standard).
- **Fluid, not fixed.** Root `.wbi-widget` + `@container` breakpoints + fluid units. NO fixed px
  widths, NO page-ancestry selectors — those squeeze instead of reflow.
- **Animate via the toolkit only.** `useMountReveal`/`useValuePulse`/`useStaggerReveal` from
  `@ui/widgets` (they honor `prefers-reduced-motion`). Don't hand-roll transitions or import
  `motion` directly in a widget.
- **The board (react-grid-layout) owns layout.** Just return your VNode into the tile; never touch
  the grid cell, and never assume a pixel size — the user resizes it.
```
