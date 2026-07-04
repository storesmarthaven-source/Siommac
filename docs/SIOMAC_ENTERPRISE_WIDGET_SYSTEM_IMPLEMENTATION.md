# SIOMAC Enterprise Widget System — Implementation Blueprint

> **Status:** Design document. No runtime code in this deliverable.
> **Scope:** HR, Finance, HSE, and Platform surfaces (Settings, Superadmin Console, My Profile,
> Messages, Notifications, Tickets). **Legacy modules are explicitly out of scope** — do NOT design
> widgets for legacy Employees, legacy Attendance, legacy Leave, legacy Payroll, HourlyRates, or any
> deprecated API. Widgets consume only the active module hooks/routes.
> **Companion files:** [`WIDGET_SYSTEM_TYPES.ts`](WIDGET_SYSTEM_TYPES.ts),
> [`WIDGET_PACKAGE_MANIFEST_SCHEMA.json`](WIDGET_PACKAGE_MANIFEST_SCHEMA.json),
> [`WIDGET_EXAMPLE_MANIFESTS.json`](WIDGET_EXAMPLE_MANIFESTS.json),
> [`WIDGET_IMPLEMENTATION_PHASES.md`](WIDGET_IMPLEMENTATION_PHASES.md),
> [`WIDGET_ACCEPTANCE_CHECKLIST.md`](WIDGET_ACCEPTANCE_CHECKLIST.md).

**Legend used throughout:** `[EXISTS]` = already built in the v2 widget library, reuse as-is ·
`[EXTEND]` = present but must be widened for enterprise scope · `[NEW]` = does not exist yet.

**No-band-aids rule (from CLAUDE.md):** this initiative **extends the existing v2 widget library**
(`src/ui/widgets/*`, `registry.*.tsx`, `WidgetBoard`, `useBoardLayout`, `ui_layout.layout`,
`ui_widget_packages`). It does **not** introduce a second, parallel widget system. Every concept below
either maps to an existing primitive or is a disciplined extension of one.

---

## 1. Executive Summary

SIOMAC already runs a **v2 widget library**: a self-registering cross-module catalogue of code-based
widgets, a gridstack-backed per-page board with drag/resize/preview-on-board, per-user persistence in
`ui_layout.layout` (jsonb), and a declarative (no-code) widget format installable at runtime from
`.zip`/`.json` packages (`ui_widget_packages`). Today it powers **HR ▸ Employee Master** and
**HR ▸ Onboarding**.

This blueprint promotes that library into a full **Enterprise Widget System**: one architecture in
which every active module (HR, Finance, HSE, Platform) ships a **module widget catalog**; widgets
declare **size adaptivity** (mini→full), **animation presets**, **permission/role gating**, and
**theme tokens**; packages carry a **versioned manifest** with install/update/uninstall governance;
and admins **govern** which packages/widgets are enabled, locked, or role-restricted, with an audit
trail. It also defines the **migration** from the remaining hand-rolled dashboards
(`HSEDashboard`, `AttendanceDashboard`, `AdminDashboardController`, `DashboardController`) onto the
one board engine.

The goal: a developer adds a widget by authoring one entry in a `registry.<module>.tsx` package (or a
declarative spec), and it is instantly catalogued, permission-gated, resizable, themable, testable,
installable, and governable — with **zero** new plumbing per widget.

---

## 2. Widget System Goals

1. **One engine, all modules.** A single registry + board + persistence + governance layer serves HR,
   Finance, HSE, and Platform. No per-module board forks.
2. **Author once, adapt everywhere.** A widget declares its supported sizes and content-priority rules;
   the renderer adapts content from mini to full without bespoke code per placement.
3. **Reuse-hooks data model `[EXISTS]`.** A widget fetches its own data via the module's existing
   TanStack hooks. `dataSource` is descriptive metadata (permissions/refresh/deps) for gating and the
   detail panel — there is **no** generic data endpoint and no data blob passed into render.
4. **Permission-first.** Visibility and each action are gated by the RBAC catalogue keys. A widget that
   the user cannot see never mounts; an action the user cannot perform never renders as clickable.
5. **Themable by tokens, not per-widget CSS.** Widgets consume shared design tokens + module accents;
   they never invent their own palette.
6. **Installable + governable.** Packages install/update/uninstall through a validated, versioned,
   audited flow; admins enable/disable/restrict; nothing bypasses RBAC.
7. **Safe at runtime.** A widget that throws, lacks permission, or references an unavailable route
   degrades to a defined state (locked/empty/error) and never crashes the board.
8. **Migratable.** Existing dashboard cards move onto the system while preserving user layouts.

---

## 3. Problems With the Current Widget/Card Approach

| Problem | Evidence today | Enterprise fix |
|---|---|---|
| Only HR is on the board | `registry.hr.tsx`, `registry.hrEmployees.tsx`, `registry.hrOnboarding*` exist; Finance/HSE/Platform have none | Module catalogs `registry.finance.tsx`, `registry.hse.tsx`, `registry.platform.tsx` `[NEW]` |
| Parallel hand-rolled dashboards | `HSEDashboard.tsx`, `AttendanceDashboard.tsx`, `AdminDashboardController.tsx`, `DashboardController.tsx` render bespoke card grids outside the board | Migrate to board + registry widgets (Section 30) |
| No animation layer | No animation concept in `types.ts` | `WidgetAnimationPreset` + reduced-motion layer `[NEW]` (Section 8) |
| Size set is fixed, not adaptive-by-contract | `WidgetSizeKey` = compact/standard/wide/large/tall/hero; adaptivity is per-widget ad hoc | Formal density/content-priority rules per size `[EXTEND]` (Sections 6–7) |
| Governance is minimal | `lockedReason`, `lockedByAdmin`, `isHidden` exist but there is no admin policy store | `ui_widget_policy` + catalog overrides + audit `[NEW]` (Section 16) — already flagged deferred in `WIDGET_LIBRARY_PLAN.md` |
| Packages are unversioned in practice | `DeclarativePackageManifest` = `{name, version, widgets}` only | Full versioned manifest + compatibility + migration notes `[EXTEND]` (Sections 13–15) |
| Declarative widgets can't bind live data | declarative view carries embedded sample values | Data-source registry for declarative widgets `[NEW]` (Section 9, Phase 3) |

---

## 4. Target Architecture

```
                       ┌──────────────────────────────────────────────┐
                       │                Widget Board (page)            │
                       │  WidgetBoard → WidgetBoardZone (gridstack)    │
                       │      → WidgetFrame → WidgetRenderer           │
                       └───────────────┬──────────────────────────────┘
        resolve renderer/def           │ layout in/out
        ┌──────────────────────────────┴───────────────┐
        ▼                                               ▼
┌───────────────────┐                        ┌─────────────────────────┐
│  Widget Registry  │  allWidgets() =        │  useBoardLayout(pageKey) │
│  (code + runtime) │  code (glob) + runtime │  optimistic persistence  │
│  registry.ts      │  (installed pkgs)      │  → /layout/*InstanceLayout│
└───────┬───────────┘                        └───────────┬─────────────┘
        │ code widgets                                     │ ui_layout.layout (jsonb, per-user)
        │  registry.<module>.tsx (import.meta.glob)        │
        │ runtime widgets                                  ▼
        │  runtimeRegistry ← declarativeToWidgetDef ← DeclarativeWidgetSpec
        │                                              ▲
        ▼                                              │ install/uninstall/update
┌───────────────────┐        validate/govern    ┌──────┴───────────────────┐
│ WidgetPermission  │◄──────────────────────────│  Widget Installer +      │
│ Gate (RBAC keys)  │                            │  Governance (ui_widget_* │
└───────────────────┘                            │  packages + policy)      │
        ▲                                         └──────────────────────────┘
        │ tokens/accents                                    ▲ audit_logs
┌───────┴───────────┐                              ┌────────┴─────────┐
│ Widget Theme      │                              │ Admin: Superadmin│
│ Adapter (tokens)  │                              │ Console › Widgets│
└───────────────────┘                              └──────────────────┘
```

**Layered responsibilities**

- **Definition layer** — `WidgetDef` (code) or `DeclarativeWidgetSpec` (data) → normalized to `WidgetDef`.
- **Registry layer** — `registry.ts` self-collects code packages via `import.meta.glob('./registry.*.tsx')`; `runtimeRegistry.ts` holds installed declarative widgets; `allWidgets()` unions both.
- **Data layer** — reuse-hooks: each widget's `render` calls module TanStack hooks. `WidgetDataProvider` (Section 9) formalizes the status contract (`loading|ready|empty|error|stale`) as a thin wrapper around those hooks — it is **not** a generic fetcher.
- **Board layer** — `WidgetBoard` → zones (one gridstack grid per zone) → `WidgetFrame` (chrome) → `WidgetRenderer` (safe mount).
- **Persistence layer** — `useBoardLayout` → `/layout/getInstanceLayout` / `/layout/saveInstanceLayout` (per-user), `/layout/saveInstanceLayoutDefault` (admin default), `/layout/resetInstanceLayout`.
- **Package layer** — `ui_widget_packages` + `/api/widgets/packages/{list,install,uninstall}`; extended with `update` + versioning + governance.
- **Governance layer** `[NEW]` — `ui_widget_policy` (enable/disable/role-restrict/lock) + `audit_logs` entries + Superadmin Console UI.

---

## 5. Widget Types

A "type" is the widget's **render strategy**, orthogonal to size and module.

| Type | Render strategy | Backing today | Notes |
|---|---|---|---|
| **Code widget** `[EXISTS]` | `WidgetDef.render` (Preact VNode, fetches via hooks) | `registry.*.tsx` | The default for module widgets with real data. |
| **Declarative widget** `[EXISTS]` | `DeclarativeWidgetSpec.view` → generic `DeclarativeWidgetView` | `registry.samples.tsx`, installed packages | Data-as-config; used for no-code + installable packages. Currently sample data only. |
| **Data-bound declarative** `[NEW]` | Declarative view + a `dataBinding` resolved by a data-source registry | Phase 3 | Lets installed widgets pull live data without code. |
| **HTML design widget** `[EXISTS]` | `DeclHtml` (sandboxed, CSP-locked iframe) | declarative `kind:'html'` | Bespoke HTML/CSS/JS design cards; static/mock, no network. |
| **Page-local widget** `[EXISTS]` | `LocalWidget.render` supplied by the host page | `hr.employees.register` | Closes over page state (filters/selection/modals); NOT in the catalogue. |
| **Composite/workspace widget** `[EXTEND]` | Code widget at `full` size acting as a mini-workspace | — | A `full`-size widget may embed lists+chart+filters (Section 6). |

**Category vs type.** `WidgetDef.category` is a catalogue grouping label (e.g. "KPI", "Trend",
"Operational", "Compliance"); it is display metadata, not a render contract.

---

## 6. Widget Size System

The existing `WidgetSizeKey` is `compact | standard | wide | large | tall | hero`. The enterprise
size vocabulary requested is `mini | small | medium | large | wide | tall | full`. **We reconcile by
extending the enum to the union and defining canonical grid footprints**, so existing widgets keep
working and new authoring uses the enterprise names. The board grid is a **12-column** grid; row unit
≈ 90px (gridstack cellHeight, existing).

| Size key | Grid (w×h) | Min | Max | Intent |
|---|---|---|---|---|
| `mini` `[NEW]` | 1×1 | 1×1 | 2×1 | Icon + single value. No chart. |
| `small` (≈ existing `compact`) | 2×1 | 2×1 | 2×2 | KPI + short context or sparkline. |
| `medium` (≈ existing `standard`) | 4×2 | 3×2 | 4×3 | KPI + chart/list; optional action. |
| `large` `[EXISTS]` | 6×3 | 4×3 | 8×4 | Chart + table/list + filters + actions. |
| `wide` `[EXISTS]` | 8×2 | 6×2 | 12×2 | Horizontal trend/timeline. |
| `tall` `[EXISTS]` | 3×4 | 3×3 | 4×6 | List-heavy. |
| `full` (≈ existing `hero`) | 12×4 | 8×4 | 12×8 | Module overview / mini-workspace. |

> **Migration of names:** keep `compact/standard/hero` as **deprecated aliases** mapping to
> `small/medium/full` in a normalization function (`normalizeSizeKey`) so no existing registry entry
> breaks. New widgets use the enterprise names only. (See Section 30.)

Each `WidgetDef` declares `defaultSize`, `allowedSizes` (subset of the above with per-size grid/min/max),
`resizeBehavior`, `densityRules`, and `contentPriorityRules` (Section 7 / `WIDGET_SYSTEM_TYPES.ts`).

---

## 7. Responsive Resize Behavior

Adaptivity is **declared, not hard-coded per placement**. Each widget provides
`contentPriorityRules`: an ordered list of content "slots" with the minimum size at which each appears.
The renderer shows a slot only when the current `sizeKey` ≥ the slot's `minSize` (size order:
mini < small < medium < large ≈ wide ≈ tall < full).

**Canonical adaptation ladder** (a widget need not use every rung):

| From → to | What changes |
|---|---|
| **mini** | Icon tile + value only. Title becomes the tooltip. No subtext, no chart, no actions. |
| **small** | Add short context line and/or a sparkline. Status shown as a dot, not a pill. |
| **medium** | Add KPI helper text, a compact chart (sparkline→bars/area) or a short list (top-N), status pill, single primary action in the footer menu. |
| **large** | Full chart + breakdown table/list + inline filters + action menu. Legends move from tooltip-only to a visible legend row. Labels show full text. |
| **wide** | Chart stretches horizontally (timeline/trend); table collapses to inline row. |
| **tall** | List expands to full scroll; chart hides or shrinks to a header sparkline. |
| **full** | Mini-workspace: header KPIs + chart + table + filters + actions + footer. May include tabs. |

**Density & truncation rules (declared via `densityRules`):**
- **Charts simplify down:** area/line → sparkline → single delta arrow as size shrinks.
- **Legends:** visible legend at large/full; tooltip-only below medium.
- **Labels:** full at large+, truncated with ellipsis at medium, hidden (icon/value only) at mini.
- **Actions collapse:** individual buttons at large/full → single "⋯" menu at medium → hidden at small/mini (the widget becomes read-only; deep actions live on the module page).
- **Tooltips replace text:** any element hidden by size exposes its content via `title`/tooltip.
- **Numbers:** abbreviate (1.2k, 3.4M) below medium; full precision at large/full.

**State behavior at every size** (all four are mandatory, Section 21):
- **loading** → `skeleton-shimmer` sized to the current footprint (never a fake "0").
- **empty** → icon + one-line reason + optional CTA (only if the user has the action permission).
- **error** → compact inline error with a `refresh()` affordance; never a stack trace; never crashes the board.
- **stale** → last value dimmed + a "stale" chip + auto-refresh indicator.

---

## 8. Widget Animation System `[NEW]`

A shared, subtle animation layer. Presets are CSS-class + small JS-driven (count-up) primitives applied
by `WidgetRenderer`/`WidgetFrame` and the inline primitives — **not** authored per widget.

**Presets** (`WidgetAnimationPreset`):
`none` · `fade-in` · `slide-up` · `pulse-soft` · `count-up` · `sparkline-draw` · `chart-grow` ·
`alert-pulse` · `progress-fill` · `skeleton-shimmer` · `status-change-flash` · `drag-lift` · `resize-settle`.

**Rules (hard constraints):**
- Subtle, professional, enterprise. No bouncing, no parallax, no long durations (mount ≤ 240ms; micro
  transitions ≤ 160ms).
- **`prefers-reduced-motion: reduce` disables all non-essential motion** — every preset degrades to an
  instant state; only opacity may remain.
- Animation **never blocks data loading** — data fetch and render are independent of animation; a widget
  is interactive as soon as data is ready regardless of animation state.
- **Critical alerts** may `alert-pulse` **lightly and only briefly** (≤ 3 pulses / ≤ 2s), then rest at a
  static emphasized state. No perpetual motion.
- **`count-up`** is used **only** for a KPI numeric value that changed since last render (diff-driven),
  capped ~600ms; never on first mount of static data.
- **Chart animations disabled for high-frequency realtime** — if `refreshIntervalMs` < 15000 or the
  widget is realtime, `chart-grow`/`sparkline-draw` are suppressed to avoid constant redraw motion.
- `drag-lift` / `resize-settle` are board-level (applied by the layout engine), not by the widget.

Each `WidgetDef` may set `animation.default` and `animation.byState` (e.g. `error → status-change-flash`),
but the layer clamps everything to the rules above; a widget cannot opt into disallowed motion.

---

## 9. Widget Data Contract

**Model = reuse-hooks `[EXISTS]`.** A widget's `render` component calls the module's existing TanStack
Query hooks (e.g. `useOffboardingDashboardStats`, `useOvertimeEntries`, `useHseIncidentStats`). There is
**no** generic data endpoint. `WidgetDataSourceDef` remains descriptive metadata used for (a) permission
gating, (b) the detail panel, (c) governance validation (routes exist), and (d) realtime refetch wiring.

**`WidgetDataSourceDef` (extended):**
```
dataSourceType: 'static' | 'api' | 'query' | 'realtime' | 'derived'
sourceKey: string                 // stable id, e.g. 'hr.offboarding.dashboardStats'
label: string
apiRoute?: string                 // for governance route-availability check (not called generically)
queryKey?: readonly unknown[]     // the TanStack key the widget's hook uses (for invalidation)
refreshIntervalMs?: number
realtimeChannel?: string          // realtime signal that triggers refetch (never the source of truth)
requiredPermissions: string[]     // RBAC catalogue keys — ALL required to view
fallbackData?: unknown
dependencies?: WidgetDependencyDef[]
```

**`WidgetDataProvider` / `WidgetDataResult` `[EXTEND]`** — a thin, optional wrapper so widgets expose a
uniform status the frame can render. It **wraps the widget's own hook**, it does not fetch generically:
```
useWidgetData<T>(def, config) → {
  status: 'loading' | 'ready' | 'empty' | 'error' | 'stale',
  data: T | null,
  meta: { lastUpdated?: string; source: string },
  lastUpdated?: string,
  error?: { message: string; code?: string },
  refresh: () => void
}
```
- `status` is derived from the underlying query (`isLoading` → loading; `data && isEmpty(data)` → empty;
  `isError` → error; `isStale`/`isPreviousData` → stale; else ready).
- **Realtime** only triggers `refresh()`; the authorized data source is always the JWT API per §2 of
  CLAUDE.md.
- A widget must **declare its data needs** in `dataSource`; it must not fetch inside deeply nested UI
  outside what the definition declares (drift-guard, Section 12 / acceptance checklist).

**Declarative data binding `[NEW]` (Phase 3):** a `dataBinding: { sourceKey, params }` on a
declarative spec resolves through a **data-source registry** (`registerWidgetDataSource(sourceKey, hook)`)
so no-code widgets can bind to whitelisted, permissioned module sources.

---

## 10. Widget Configuration Contract

Config is per **instance**, merged over `WidgetDef.defaultConfig`. Fields come from
`WidgetDef.configSchema` (`WidgetConfigField[]` `[EXISTS]`, extended).

**Field shape (extended):**
```
{
  key, label,
  type: 'text'|'select'|'multiSelect'|'dateRange'|'number'|'boolean'|'threshold'|'statusFilter'
        |'chartType'|'refreshInterval'|'animationPreset',   // [EXTEND] new types
  defaultValue?, required?, options?, helpText?,
  editableBy: 'user' | 'admin',                              // [NEW] who may edit
  permission?: string,                                       // [NEW] RBAC key required to edit
  validation?: { min?, max?, pattern?, message? }            // [NEW]
}
```

**Standard config keys** (widgets pick what applies): `titleOverride`, `moduleScope`, `dateRange`,
`departmentId`, `siteId`, `employeeGroup`, `riskLevel`, `severity`, `chartType`, `refreshInterval`,
`animationPreset`, `compactMode`, `showActions`, `showTrend`, `thresholds`, `alertRules`.

- **`titleOverride`** is stored on the instance (`WidgetInstance.titleOverride` `[EXISTS]`).
- **Admin-only fields** (`editableBy:'admin'`) are hidden in the user configure modal and only editable
  from the Superadmin Console widget governance panel.
- Config is validated against `configSchema` on save (client + server); unknown keys are dropped
  (no accept-and-drop of config the widget ignores).

---

## 11. Widget Permission Model

**Two independent checks — visibility and action.**

- **Visibility gate `[EXISTS→EXTEND]`.** A widget renders only if the user holds **all**
  `dataSource.requiredPermissions`. If not, the widget is either (a) hidden from the catalogue's
  "add" menu, or (b) shown **locked** (`lockedReason`) if discoverable-but-unavailable. Enforced by
  `WidgetPermissionGate` before mount.
- **Action gate `[NEW]`.** Each declared action carries its own `permission`. Actions the user cannot
  perform are omitted (not merely disabled) unless the widget explicitly renders a disabled+tooltip
  affordance. *Example:* a user may **view** "Payroll Run Status" (`finance.payroll.view_all`) but the
  **Lock Run** action requires `finance.payroll.lock` — the button is absent without it.

**Permission fields on the definition (extended):**
```
requiredPermissions: string[]     // view (all required)
optionalPermissions?: string[]    // enrich if present (e.g. show extra column)
installPermission: string         // who can install the package that carries this widget
configurePermission?: string      // who can change instance config (default: view)
viewPermission?: string           // alias/override for the primary view key
actions?: { key, label, permission, ... }[]  // per-action gate
```

Keys are **exact RBAC catalogue strings** (per CLAUDE.md: `hse.ptw.view`, not `hse.permits.view`).
The governance layer validates every referenced key against the catalogue at install time
(fail install on an uncatalogued enforced key).

---

## 12. Widget Registry `[EXISTS→EXTEND]`

Existing `src/ui/widgets/registry.ts`: self-registering via `import.meta.glob('./registry.*.tsx')`;
`allWidgets()` = code widgets + runtime (installed declarative) widgets; helpers
`getWidgetDef`, `findWidgetDef`, `getWidgetsForPage`, `getWidgetsByModule`.

**Enterprise registry API (adds to the above):**
```
registerWidget(def)               // runtime (used by installer); dedupes by id
unregisterWidget(widgetId)        // runtime (uninstall)
getWidgetDefinition(widgetId)
listWidgetsByModule(module)       // [EXISTS] getWidgetsByModule
listWidgetsByPermission(userPerms)// filter to widgets the user can view
listInstalledPackages()           // [EXISTS] via @api/widgets
validateWidgetManifest(manifest)  // schema + permission + route + size checks
resolveWidgetDataProvider(def)    // returns the hook wrapper for the widget
resolveWidgetRenderer(def|instance)// code render, declarative view, or page-local
```

**The registry MUST reject / never surface a widget that:**
- has a **duplicate id** (already dropped with a dev warning — keep, and make it a hard error at install);
- declares an **unsupported `schemaVersion`** / `compatibleSiomacVersion` mismatch;
- has **no `requiredPermissions`** (empty view gate is invalid — must be explicit, even if `['*']` for
  a truly public platform widget, which requires justification);
- has **no `allowedSizes`** or no `defaultSize` within `allowedSizes`;
- omits any of the **loading/empty/error** states (states are mandatory, Section 21);
- references an **`apiRoute` that is not registered** in the running backend (route-availability check).

A `registry.test.ts` (exists) + an extended drift-guard test enforces these at build time.

---

## 13. Widget Package Manifest `[EXTEND]`

Today: `DeclarativePackageManifest = { name, version, widgets: DeclarativeWidgetSpec[] }`. Enterprise
manifest (`WidgetPackageManifest`, full JSON schema in `WIDGET_PACKAGE_MANIFEST_SCHEMA.json`):

```
packageId            // stable unique id, e.g. 'siomac.hr.attendance-pack'
name
description
version              // semver
publisher            // 'SIOMAC' | org | vendor
module               // 'hr'|'finance'|'hse'|'platform'  (platform = enterprise surfaces)
widgets[]            // WidgetPackageWidget[] (declarative specs or code-widget references)
requiredPermissions[]// union of all widget view keys — validated vs catalogue
requiredRoutes[]     // apiRoutes the widgets need — validated vs backend
requiredFeatureFlags[]
compatibleSiomacVersion // semver range the package supports
dependencies[]       // { packageId, versionRange }
migrationNotes       // human notes for updates
installDefaults      // default enablement, default role restriction, default layout hints
uninstallBehavior    // 'preserve-instances-disabled' | 'remove-instances' (default: preserve)
signature?           // optional integrity signature (future)
```

- **Code-widget packages** (`registry.<module>.tsx`) are first-party and don't ship a `.zip`; their
  "manifest" is derived at build from the `WidgetDef[]` (module, permissions, routes) so governance and
  the acceptance checklist apply uniformly to code and declarative widgets.
- **Declarative/installable packages** ship `widget-package.json` (this manifest) + assets, installed via
  the installer (Section 15).

---

## 14. Widget Bundle Format

A distributable bundle (`.zip`, parsed by existing `parsePackageFile.ts` via `fflate`):
```
widget-package.json          # WidgetPackageManifest
src/
  widgets/                   # DeclarativeWidgetSpec[] (one file per widget or an index)
  providers/                 # optional dataBinding specs (Phase 3)
  styles/                    # optional scoped CSS (namespaced, token-based)
  assets/                    # icons/images (data-URI or bundled)
README.md
CHANGELOG.md
```
Rules: no executable app code (declarative + sandboxed HTML only); styles must be token-based and
namespaced (`.wpkg-<packageId>-*`); assets inlined or referenced relatively. A first-party code package
is just a `registry.<module>.tsx` file in the repo (no bundle) — same manifest semantics, validated at
build.

---

## 15. Widget Installation Flow

Backend today: `ui_widget_packages` + `/api/widgets/packages/{list,install,uninstall}`
(`widgetPackages.ts`), FE `@api/widgets` (`listInstalledPackages`, `installWidgetPackage`,
`uninstallWidgetPackage`). Runtime: `runtimeRegistry.ts` + `allWidgets()`; board/library re-render via
`useRuntimeWidgetsVersion` / `useInstalledWidgetPackages`.

**Install (`[EXTEND]` — add validate/version/govern/audit):**
1. Upload/register package (`.zip`/`.json`) — `installPermission` required.
2. **Validate manifest** against `WIDGET_PACKAGE_MANIFEST_SCHEMA.json`.
3. **Validate permissions & routes** — every `requiredPermissions` key exists in the RBAC catalogue;
   every `requiredRoutes` route is registered. Fail atomically on any miss (no partial install).
4. **Validate widget schemas** — each widget has sizes, states, permissions (Section 12 rules).
5. **Compatibility** — `compatibleSiomacVersion` satisfied; dependencies present.
6. Register package row (`ui_widget_packages`, org-wide) + write `audit_logs` (`widget.package.installed`).
7. Register widgets into `runtimeRegistry` (org-wide availability).
8. Add widgets to the module catalog (they appear filtered by module in the library).
9. **Admin enables** the package (governance default may be disabled-until-enabled).
10. Users may add enabled widgets to their boards.

**Uninstall:**
1. Disable package (governance) → write audit.
2. Remove widgets from the "add widget" catalog immediately.
3. **Preserve existing instances** as `unavailable` (rendered as a locked placeholder) per
   `uninstallBehavior:'preserve-instances-disabled'` (default) — never silently drop user layout.
4. Admin may explicitly remove orphaned instances.
5. Keep the full audit trail.

**Update:**
1. Compare incoming `version` vs installed (semver).
2. Run compatibility checks + dependency checks.
3. **Migrate widget configs** via `migrationNotes`/config migrators if the schema changed
   (fix-the-source config migration, not a shim).
4. **Preserve dashboard placement** (instanceIds/geometry unchanged; only defs swap).
5. Write `audit_logs` (`widget.package.updated`, from→to version).

---

## 16. Widget Governance / Admin Controls `[NEW]`

Home: **Superadmin Console ▸ Widgets** (+ per-module admin views where relevant). Backed by a new
`ui_widget_policy` table (already flagged as deferred in `WIDGET_LIBRARY_PLAN.md`).

**`ui_widget_policy` (org-wide):**
```
id, subject_type ('package'|'widget'), subject_id,
enabled boolean, allowed_roles text[] null (null = all), allowed_modules text[] null,
locked boolean,           -- forces widget into user default layout, not removable
hidden_from_catalog boolean,
default_config jsonb null, created_at, updated_at, updated_by
```

**Admin capabilities:**
- Enable/disable a widget **package** (disabled = not installable/addable; existing instances preserved-disabled).
- **Restrict a widget to roles** (`allowed_roles`) and/or **modules** (`allowed_modules`).
- **Set default layout** per page (`/layout/saveInstanceLayoutDefault` `[EXISTS]`).
- **Lock required widgets** (`locked` → seeded into every user's board, non-removable; maps to
  `WidgetInstance.lockedByAdmin` `[EXISTS]`).
- **Hide a widget** from the add-widget menu (`hidden_from_catalog`).
- **Audit** every install/uninstall/update/enable/disable/config-change to `audit_logs`
  (per §2 CLAUDE.md side-effects).
- **Usage stats** (Phase 6): count instances per widget/module for curation.

Governance is enforced in `listWidgetsByPermission` + the catalog + the board seeding — a policy-disabled
or role-excluded widget never reaches the user.

---

## 17. Widget Runtime Rendering

`WidgetRenderer` `[EXISTS→EXTEND]` mounts a board item safely:

1. **Resolve renderer** (`resolveBoardWidget` `[EXISTS]`): page-local `localWidgets` first → global
   registry (`findWidgetDef`) → declarative view. Unknown id → locked placeholder (not a crash).
2. **Permission gate** (`WidgetPermissionGate`): if the user lacks `requiredPermissions`, render locked
   (or hide, per governance). Never mount the data hook for a widget the user can't view.
3. **Error boundary `[NEW]`**: wrap `render` in a Preact error boundary. A thrown widget renders the
   **error state** and reports (dev console + optional telemetry); the board and sibling widgets survive.
4. **State machine**: `useWidgetData` status → loading/empty/error/stale/ready visuals (Section 21).
5. **Chrome**: `chrome:'standard'` → `WidgetFrame` (header + bordered body + footer); `chrome:'none'` →
   bare (widget renders its own card); edit/preview tools float.
6. **Animation**: apply the resolved preset within the rules (Section 8); suppress for realtime/reduced-motion.
7. **Size/density**: pass `sizeKey` into render; renderer applies `contentPriorityRules`.

**Runtime safety invariants:** a single widget cannot crash the board; cannot fetch data it didn't
declare; cannot exceed its permission scope; cannot inject global styles (scoped/tokened only); HTML
widgets run only in the CSP-locked sandbox iframe.

---

## 18. Widget Layout Engine `[EXISTS→EXTEND]`

`WidgetBoard` → `WidgetBoardZone` (one **gridstack** grid per zone) → `WidgetFrame` → `WidgetRenderer`,
using the proven gridstack↔Preact bridge (`GridStack.renderCB` + `grid.load` + `render()` per cell;
constant container class; `renderCB` cleared on unmount). Zones let a page split its board (e.g.
`stats` row vs `main` grid).

- **Grid:** 12 columns; per-zone gridstack config; `cellHeight` fixed (existing).
- **Instance geometry:** `WidgetInstance.{x,y,w,h,sizeKey}` persisted in `ui_layout.layout`.
- **Breakpoints `[EXTEND]`:** responsive column counts (e.g. 12 desktop / 6 tablet / 1 mobile) with a
  documented reflow; at ≤ 6 cols, `wide/full` clamp to available width, `large` degrades to `medium`
  density.
- **Default layout:** page-supplied `BoardLayout` (fixed instanceIds `${widgetId}#def`) `[EXISTS]`;
  admin default via `saveInstanceLayoutDefault` `[EXISTS]`.

---

## 19. Drag / Drop / Resize Behavior `[EXISTS→EXTEND]`

Provided by gridstack (existing), governed by the definition:
- **Drag & drop**, **resize handles**, **snap-to-grid** — gridstack built-ins.
- **min/max width/height** per size (`WidgetSizeDef.min/max`); resize clamps to `allowedSizes`.
- **Preview-on-board** `[EXISTS]` — the headline feature: preview a widget with dashed chrome,
  drag/resize WITHOUT saving; **Add to board** (`commitPreviewWidget`) or **Discard**. Persisted layout
  never contains a preview.
- **Persistence** `[EXISTS]` — optimistic via `useBoardLayout`; only committed widgets saved.
- **Locked widgets** `[EXISTS]` — `lockedByAdmin` instances can't be moved/removed.
- **Required/hidden widgets** `[EXTEND]` — governance `locked`/`hidden_from_catalog`.
- **Reset layout** `[EXISTS]` — `resetInstanceLayout`; **duplicate instance** + **remove instance**
  (board toolbar).
- On resize across a size threshold, `sizeKey` updates and content re-densifies (Section 7);
  `resize-settle` animation applies.

Each `WidgetDef` declares `minSize`, `defaultSize`, `maxSize`, `supportedSizes`, `resizeBehavior`,
`densityRules`, `contentPriorityRules`.

---

## 20. Widget Theming and Design Tokens

Widgets consume **shared tokens + a module accent**, never a per-widget palette. Theming is applied by a
`WidgetThemeAdapter` that sets CSS custom properties on the widget root from the active theme and the
widget's `module`.

**Token set** (names align to existing scoped families `.obx-*` / `.wbi-*` / `.wlib-*`; the adapter maps
theme → these): `--wgt-surface`, `--wgt-border`, `--wgt-text`, `--wgt-muted`, `--wgt-accent`
(module-derived), `--wgt-danger`, `--wgt-warning`, `--wgt-success`, `--wgt-info`, chart tokens
`--wgt-chart-1..n`, `--wgt-radius`, `--wgt-shadow`, spacing `--wgt-space-1..6`.

**Module accents** (derive `--wgt-accent` from `module`): HR, Finance, HSE, Platform each get a distinct
accent so a widget visually reads as its module without bespoke CSS. Dark-mode and high-contrast are
token swaps only.

**Standard anatomy** (enforced by `WidgetFrame` for `chrome:'standard'`): icon tile · title ·
value/main content · context/subtext · status/tone pill (where needed) · optional chart area · optional
action menu (⋯) · footer (timestamp + refresh). `chrome:'none'` widgets render their own card but must
still consume tokens.

---

## 21. Widget States

Every widget must define and the frame must render, at every size:
- **loading** — `skeleton-shimmer` shaped to footprint. Never a fake `0`/empty chart.
- **ready** — normal content.
- **empty** — icon + one-line reason + optional CTA (permission-gated).
- **error** — compact inline error + `refresh()`; error boundary catches throws; board survives.
- **stale** — dimmed last value + "stale" chip + refreshing indicator (realtime/slow refresh).
- **locked** — `lockedReason`/permission/governance: icon + reason, no data fetch.
- **unavailable** — widget def missing (uninstalled package): locked placeholder preserving the slot.

States are part of the definition contract; the registry rejects a widget missing loading/empty/error
(Section 12).

---

## 22. Module-Specific Widget Catalogs

One package file per module (self-registering). Only **active** modules; **no legacy**.

- **HR** `[EXISTS partial]` — `registry.hr.tsx`, `registry.hrEmployees.tsx`, `registry.hrOnboarding*`
  today. Add: Offboarding, Leave, Attendance, Compensation, Overtime, Requests, Training/compliance.
- **Finance** `[NEW]` — `registry.finance.tsx`: payroll run status, statutory version health, NIS
  verification, pay-component usage, payroll warnings, export readiness, gross/net totals, approvals.
- **HSE** `[NEW]` — `registry.hse.tsx`: incident trends, JSA risk level, PTW active permits, permit
  expiry, training compliance, inspection findings, CAPA overdue, PPE stock/compliance.
- **Platform** `[NEW]` — `registry.platform.tsx`: notifications, messages, tickets, security alerts,
  pending approvals, role/permission changes, settings governance.

Each catalog widget lists its exact hook + route + permission keys. Full per-widget specs for the
required set are in Section 26 (examples) and the module catalog appendix at the end.

---

## 23. Developer API

To add a **code widget** (the common case):
1. Add an entry to `src/ui/widgets/registry.<module>.tsx` `export const widgets: WidgetDef[]`
   (self-registers via glob; no aggregator edit).
2. `render` uses the module's existing TanStack hook(s); reuse `inlinePrimitives`
   (`StatsCard`/`WidgetList`/`MiniSparkline`/`TrendArea`/`MiniBars`/`DonutPct`/`Empty`).
3. Declare `dataSource.requiredPermissions` (exact catalogue keys), `allowedSizes`, `defaultSize`,
   `configSchema`, `previewVariant`/`renderPreview`, `chrome`, and (new) `animation`,
   `contentPriorityRules`, `actions`.
4. It is now catalogued, gated, resizable, themable, previewable, and governable — no extra plumbing.

To add a **declarative widget/package**: author `DeclarativeWidgetSpec`(s) + `widget-package.json`
(Section 13), install via Superadmin Console ▸ Widgets ▸ Install package.

Public entry: `import { ... } from '@ui/widgets'`. Authoring reference: `docs/WIDGET_AUTHORING_GUIDE.md`
(extend with the new fields).

---

## 24. File Structure

```
src/ui/widgets/                         # [EXISTS] extend
  types.ts                              # WidgetDef/Instance/... (extend per WIDGET_SYSTEM_TYPES.ts)
  registry.ts                           # self-registering aggregator [EXISTS]
  registry.hr.tsx / registry.hrEmployees.tsx / registry.hrOnboarding*.tsx  [EXISTS]
  registry.finance.tsx                  # [NEW]
  registry.hse.tsx                      # [NEW]
  registry.platform.tsx                 # [NEW]
  runtimeRegistry.ts                    # installed declarative widgets [EXISTS]
  resolveBoardWidget.ts                 # local→registry→declarative [EXISTS]
  useBoardLayout.ts                     # persistence [EXISTS]
  WidgetBoard.tsx / WidgetBoardZone.tsx / WidgetBoardToolbar.tsx  [EXISTS]
  WidgetCatalog.tsx / WidgetDetailPanel.tsx / WidgetConfigureModal.tsx / WidgetConfigFieldRenderer.tsx  [EXISTS]
  WidgetRenderer.tsx / WidgetFrame.tsx  # add error boundary + states + animation [EXTEND]
  animation/                            # [NEW] presets + reduced-motion
  theme/widgetTokens.ts                 # [NEW] WidgetThemeAdapter + token map
  inlinePrimitives.tsx                  # shared primitives [EXISTS]
  declarative/                          # DeclarativeWidgetSpec engine [EXISTS]
  governance/                           # [NEW] policy client + validators
  index.ts                             # @ui/widgets barrel [EXISTS]
src/api/widgets.ts                       # packages list/install/uninstall (+update) [EXISTS→EXTEND]
src/api/layout.ts                        # instance layout get/save/default/reset [EXISTS]
netlify/functions/routes/uiPrefs.ts      # /layout/* [EXISTS]
netlify/functions/routes/widgetPackages.ts # /api/widgets/packages/* (+ update, + policy) [EXISTS→EXTEND]
netlify/functions/lib/widgetGovernance.ts  # [NEW] policy + audit
supabase/migrations/*_ui_widget_policy.sql # [NEW]
docs/WIDGET_AUTHORING_GUIDE.md            # [EXISTS→EXTEND]
```

---

## 25. TypeScript Interfaces

Full definitions in **[`WIDGET_SYSTEM_TYPES.ts`](WIDGET_SYSTEM_TYPES.ts)** (interfaces only, no
implementation): `WidgetSize`, `WidgetTone`, `WidgetAnimationPreset`, `WidgetModuleScope`,
`WidgetDefinition`, `WidgetInstance`, `WidgetPackageManifest`, `WidgetConfigField`, `WidgetDataProvider`,
`WidgetDataResult`, `WidgetRendererProps`, `WidgetLayoutItem`, `WidgetRegistry`, `WidgetInstallResult`,
`WidgetValidationResult`. These are a **superset** of the existing `src/ui/widgets/types.ts` — the
existing names (`WidgetDef`, `WidgetInstance`, `BoardLayout`) are preserved as aliases so nothing breaks.

---

## 26. Example Widget Implementations

Eight canonical specs (full JSON manifests in
[`WIDGET_EXAMPLE_MANIFESTS.json`](WIDGET_EXAMPLE_MANIFESTS.json)). Each lists id, module, sizes, data
source (hook + route + permission), fields-by-size, animation, config, states, and actions.

### 26.1 HR — Attendance Exceptions (`hr.attendance.exceptions`)
- **module** hr · **sizes** small, medium, large, tall · **default** medium
- **data** hook `useAttendanceExceptions({status:'open'})` · route `hr/attendance/exceptions/list` ·
  perms `['hr.attendance.exceptions.view']` · realtime refetch on attendance signal
- **fields by size:** mini/small → open-exception count + tone dot; medium → count + top-3 types
  (late/missing/geofence) as bars + status pill; large → full exceptions table + type filter + "Resolve"/"Waive" actions
- **animation** `count-up` on the count; `alert-pulse` (brief) if overdue exceptions > threshold
- **config** `dateRange`, `siteId`, `severity`, `thresholds.overdue`, `showActions`
- **actions** Resolve (`hr.attendance.exceptions.manage`), Waive (`hr.attendance.exceptions.manage`)
- **states** loading/empty("No open exceptions")/error/stale

### 26.2 HR — Leave Balance (`hr.leave.balance`)
- **module** hr · **sizes** mini, small, medium · **default** small
- **data** hook `useLeaveBalances(employeeId)` · route `hr/leave/balances/get` · perms
  `['hr.leave.balances.view']`
- **fields:** mini → days remaining; small → remaining + type; medium → per-type breakdown bars + accrual footer
- **animation** `count-up`; `progress-fill` on the balance bar
- **config** `employeeGroup` (self/team, admin), `leaveTypeId`, `compactMode`
- **actions** Request leave (`hr.leave.request_own`) — opens Submit-Leave EFM
- **states** loading/empty("No balances")/error

### 26.3 HR — Onboarding Progress (`hr.onboarding.progress`) `[EXISTS-ish]`
- **module** hr · **sizes** small, medium, large · **default** medium
- **data** hook `useOnboardingDashboardStats()` · route `hr/onboarding/dashboard-stats` · perms
  `['hr.onboarding.view']`
- **fields:** small → active cases; medium → activation readiness donut + due-this-week; large → recent cases list + blocking tasks
- **animation** `chart-grow` (suppressed if realtime), `count-up`
- **config** `dateRange`, `siteId`, `showTrend`
- **actions** Open case (`hr.onboarding.view`)
- **states** loading/empty/error

### 26.4 Finance — Payroll Run Status (`finance.payroll.run_status`)
- **module** finance · **sizes** small, medium, large, wide · **default** medium
- **data** hook `usePayrollRuns({latest:true})` · route `finance/payroll/runs/list` · perms
  `['finance.payroll.view_all']`
- **fields:** small → current run status pill; medium → status + progress (calc→approve→lock→payslips) + gross/net; large → run detail + warnings list + actions; wide → status timeline across recent runs
- **animation** `status-change-flash` on status change; `progress-fill`
- **config** `dateRange`, `siteId`, `showActions`
- **actions** Approve (`finance.payroll.approve`), **Lock Run** (`finance.payroll.lock`), Export
  (`finance.payroll.export`) — **each gated separately** (view ≠ lock)
- **states** loading/empty("No runs")/error/stale

### 26.5 Finance — NIS Verification (`finance.nis.verification`)
- **module** finance · **sizes** mini, small, medium · **default** small
- **data** hook `useNisProfiles({status:'pending_verification'})` · route `finance/nis/profiles/list` ·
  perms `['finance.payroll.nis.view']`
- **fields:** mini → pending count; small → pending + oldest age; medium → pending list + "Verify"/"Return" actions
- **animation** `count-up`; `alert-pulse` (brief) if pending age > SLA
- **config** `thresholds.slaHours`, `siteId`
- **actions** Verify (`finance.payroll.nis.verify`), Return (`finance.payroll.nis.verify`)
- **states** loading/empty("All verified")/error

### 26.6 HSE — Incident Trend (`hse.incidents.trend`)
- **module** hse · **sizes** medium, large, wide · **default** large
- **data** hook `useHseIncidentStats({window:'90d'})` · route `hse/incidents/stats` · perms
  `['hse.incidents.view']`
- **fields:** medium → 30-day sparkline + count; large → trend area + severity breakdown + top types; wide → long trend timeline
- **animation** `sparkline-draw`/`chart-grow` (suppressed if realtime)
- **config** `dateRange`, `siteId`, `severity`, `chartType`
- **actions** Open incidents (`hse.incidents.view`)
- **states** loading/empty/error

### 26.7 HSE — PTW Active Permits (`hse.ptw.active`)
- **module** hse · **sizes** small, medium, large, tall · **default** medium
- **data** hook `useActivePermits()` · route `hse/ptw/list` · perms `['hse.ptw.view']`
  *(exact key — not `hse.permits.view`)*
- **fields:** small → active permit count; medium → count + expiring-soon; large/tall → permits list with expiry countdown + status pills
- **animation** `count-up`; `alert-pulse` (brief) on permits expiring within threshold
- **config** `siteId`, `thresholds.expiringHours`, `statusFilter`
- **actions** Open permit (`hse.ptw.view`)
- **states** loading/empty("No active permits")/error/stale

### 26.8 Platform — Pending Approvals (`platform.approvals.pending`)
- **module** platform · **sizes** mini, small, medium, tall · **default** small
- **data** hook `useMyWorkflowTasks({state:'pending'})` · route `workflow/my_tasks/list` · perms
  `['workflow.my_tasks.view']`
- **fields:** mini → pending count; small → count + oldest; medium/tall → task list grouped by module with "Open" action
- **animation** `count-up`; `alert-pulse` (brief) if overdue
- **config** `moduleScope` (all/hr/finance/hse), `thresholds.overdueHours`
- **actions** Open task (`workflow.my_tasks.view`) — routes to the owning module surface
- **states** loading/empty("Nothing pending")/error/stale

---

## 27. Packaging Examples

See [`WIDGET_EXAMPLE_MANIFESTS.json`](WIDGET_EXAMPLE_MANIFESTS.json) for four full package manifests —
one per module (HR attendance pack, Finance payroll pack, HSE PTW/incident pack, Platform inbox pack) —
each with `packageId`, `version`, `module`, `widgets[]`, `requiredPermissions[]`, `requiredRoutes[]`,
`compatibleSiomacVersion`, `installDefaults`, `uninstallBehavior`.

---

## 28. Install / Uninstall / Update Flow

Consolidated in Section 15. Contract summary: **atomic install** (validate manifest → perms → routes →
schemas → compat; fail whole on any miss; audit), **preserve-on-uninstall** (instances kept disabled;
never silently drop layout), **migrate-and-preserve on update** (config migrators + geometry preserved +
version-stamped audit). All three write `audit_logs` and respect `installPermission`/governance.

---

## 29. Testing Plan

- **Registry drift-guard** (`registry.test.ts` extended): every widget has id-uniqueness, module,
  ≥1 allowedSize with defaultSize ∈ allowedSizes, non-empty requiredPermissions (catalogue-valid),
  loading/empty/error states, and — if `apiRoute` set — a registered route.
- **Size/density unit tests:** for each example widget, render at each `allowedSize` and assert the
  correct content slots appear/hide per `contentPriorityRules`.
- **State tests:** force loading/empty/error/stale/locked/unavailable and assert the frame renders the
  right state (and never a fake `0`).
- **Permission tests:** render with/without each `requiredPermissions` key → visible/locked; render
  actions with/without action permission → present/absent (view ≠ action, e.g. Payroll Lock).
- **Animation tests:** `prefers-reduced-motion` disables motion; realtime suppresses chart animation;
  `count-up` only on value change.
- **Layout persistence:** save/load `ui_layout.layout`; preview never persisted; reset/default work.
- **Package lifecycle E2E** (`scripts/e2e/suites/widgets.mjs` `[NEW]`): install (valid + invalid
  manifest), enable/disable (governance), role-restrict, update (config migration + geometry preserved),
  uninstall (instances preserved-disabled), and **audit rows** for each (per §2 CLAUDE.md). Access
  control: non-admin denied install/govern.
- **Migration tests:** each migrated dashboard renders the same KPIs on the board; old layouts map.
- Follow the testing standard: unit (vitest) + a live E2E suite; full E2E green before "done".

---

## 30. Migration Plan (from existing dashboards/cards)

**Principle:** build-new-on-the-board → delete-legacy-cards. No dual systems (per CLAUDE.md and the v1→v2
precedent already completed for Employee Master/Onboarding).

1. **Size-key normalization** — add `normalizeSizeKey` mapping deprecated `compact/standard/hero` →
   `small/medium/full`; keep aliases so existing `registry.hr*` widgets keep working. Extend
   `WidgetSizeKey` to the enterprise union.
2. **HSE Dashboard** (`HSEDashboard.tsx`) → author `registry.hse.tsx` widgets for its cards
   (incident trend, JSA risk, PTW active, permit expiry, training compliance, inspection findings,
   CAPA overdue, PPE) and re-home the page onto `WidgetBoard` (pageKey `hse.dashboard.overview`) with a
   default layout mirroring today's cards. Delete the bespoke card grid. *(Respect the build-order
   deferral: HSE Dashboard wiring is gated — do this only when that phase is approved.)*
3. **Attendance Dashboard** (`AttendanceDashboard.tsx`) → HR attendance widgets on the board.
4. **Admin/General dashboards** (`AdminDashboardController.tsx`, `DashboardController.tsx`) → Platform
   widgets (approvals, notifications, tickets, security alerts) on the board.
5. **Preserve layouts** — where a page already persisted an order, seed the board `defaultLayout` to
   match; users with saved layouts keep them (instanceIds stable).
6. **Delete legacy card components** once each page is on the board and E2E-green (no leftover parallel
   card system).
7. **`reorder.tsx` / `useModuleLayout`** (PageHero/MetricRow ordering) stays only where it's not a
   widget board; anything that becomes a board is migrated, not left dual.

Migration is **incremental and per-page**, each shipped green, so the board becomes the single dashboard
substrate across HR, Finance, HSE, and Platform.

---

## 31. Acceptance Criteria

A widget/package is acceptable only when (full list in
[`WIDGET_ACCEPTANCE_CHECKLIST.md`](WIDGET_ACCEPTANCE_CHECKLIST.md)):
1. Registered via a `registry.<module>.tsx` package or a validated declarative package.
2. Declares `module`, exact `requiredPermissions` (catalogue-valid), `allowedSizes` + `defaultSize`.
3. Renders correctly at every `allowedSize` per `contentPriorityRules`; adapts (no overflow/clipping).
4. Implements loading/empty/error (+ stale/locked/unavailable where relevant); never a fake `0`.
5. Fetches only via declared hooks/`dataSource`; realtime only refetches.
6. Actions gated independently of visibility; no ungated mutation.
7. Uses tokens + module accent; no bespoke palette; scoped CSS only.
8. Animations within the rules; reduced-motion respected; realtime suppresses chart motion.
9. Governable (enable/disable/role-restrict/lock/hide) and audited on lifecycle events.
10. Covered by unit tests (sizes/states/permissions) + package E2E; full suite green.
11. No legacy module/API usage.

---

## 32. Open Questions

1. **Size enum reconciliation** — extend to the 7-name union with aliases (recommended), or hard-rename
   `compact/standard/hero`? (Recommendation: alias, no breakage.)
2. **Realtime threshold** — confirm the `refreshIntervalMs` cutoff (proposed 15s) below which chart
   animations are suppressed.
3. **Governance home** — Superadmin Console only, or also a per-module admin widget panel?
4. **Declarative live-data binding** — which module sources are safe to expose to no-code widgets, and
   how are their permissions enforced (data-source registry allowlist)?
5. **Third-party packages** — do we allow non-SIOMAC publishers? If yes, signing + sandbox review gate.
6. **Platform "module"** — treat Platform as a first-class `WidgetModuleScope` value (`platform`) vs
   reusing `enterprise`? (Recommendation: add `platform`; keep `enterprise` alias.)
7. **Per-widget usage analytics** — store counts where (new table vs app_events aggregation)?
8. **Mobile board** — is a 1-column mobile board in scope now, or desktop/tablet first?

---

## Appendix A — Module Widget Catalog (target set)

**HR:** headcount · onboarding progress · offboarding risk · leave balance · attendance exceptions ·
payroll readiness · compensation changes · HR requests · training/compliance summary.
**Finance:** payroll run status · statutory version health · NIS verification · pay-component usage ·
payroll warnings · export readiness · gross/net totals · finance approvals.
**HSE:** incident trends · JSA risk level · PTW active permits · permit expiry · training compliance ·
inspection findings · CAPA overdue · PPE stock/compliance.
**Platform:** notifications · messages · tickets · security alerts · pending approvals ·
role/permission changes · settings governance.

Each ships with: exact hook, route, permission key(s), default size, supported sizes, config schema,
animation, and states — authored per Section 23 and validated per Section 12. **No legacy sources.**
