# SIOMAC Enterprise Widget System — Implementation Phases

Phased build plan. Each phase is independently shippable, `tsc`-green, and (where it touches runtime) has
tests. Follows CLAUDE.md: **extend the existing v2 library, no parallel system, no legacy sources**, run
the full suite only at the end of a phase. `[EXISTS]`/`[EXTEND]`/`[NEW]` mark reuse vs work.

> **Reality check:** Phase 1 (types/registry/renderer/board/persistence/permission gate), Phase 2
> (layout/drag/drop/resize/persistence/defaults), and the package plumbing of Phase 3 are **largely already
> built** for HR (`src/ui/widgets/*`, `ui_layout.layout`, `ui_widget_packages`). The enterprise work is the
> **deltas**: size/animation/governance/versioning + Finance/HSE/Platform catalogs + dashboard migration.

---

## Phase 0 — Reconciliation & guardrails (prep)
- `[NEW]` `normalizeSizeKey` + extend `WidgetSize` to the enterprise union with `compact/standard/hero`
  aliases (no breakage to existing `registry.hr*` widgets).
- `[NEW]` Add `platform` to `WidgetModuleScope` (keep `enterprise` alias).
- `[EXTEND]` Land the superset types from `WIDGET_SYSTEM_TYPES.ts` into `src/ui/widgets/types.ts`
  (all new fields optional; `WidgetDef` alias preserved).
- `[EXTEND]` Extend `registry.test.ts` drift-guard with the Section-12 reject rules.
- **Gate:** `tsc` FE+BE green; existing HR widgets still compile and render.

## Phase 1 — Foundation (widget core)
- `[EXISTS]` Registry (self-registering glob), `WidgetDef`, instance helpers, board renderer.
- `[EXTEND]` `WidgetRenderer`/`WidgetFrame`: add the **error boundary**, the full **state machine**
  (loading/empty/error/stale/locked/unavailable), and the **WidgetFrame** standard anatomy (icon/title/
  value/subtext/status/chart/action-menu/footer).
- `[EXTEND]` `WidgetPermissionGate`: two-check model (visibility + per-action), exact RBAC keys.
- `[EXTEND]` Size/density: implement `contentPriorityRules` + `densityRules` in the renderer.
- `[NEW]` `useWidgetData` wrapper (status contract over the widget's own hook).
- **Gate:** unit tests — a sample widget renders at every allowedSize; all six states; permission show/hide.

## Phase 2 — Layout
- `[EXISTS]` gridstack board, zones, drag/drop/resize, preview-on-board, `useBoardLayout` persistence
  (`ui_layout.layout`), default layout, admin default (`saveInstanceLayoutDefault`), reset.
- `[EXTEND]` Responsive breakpoints (12/6/1 columns) + documented reflow (wide/full clamp, large→medium).
- `[EXTEND]` `resize-settle`/`drag-lift` board animations (respect reduced-motion).
- **Gate:** layout save/load/reset/default tests; preview never persisted; breakpoint reflow test.

## Phase 3 — Package system
- `[EXISTS]` Declarative engine (`DeclarativeWidgetSpec`, `DeclarativeWidgetView`,
  `declarativeToWidgetDef`, `parsePackageFile`), `ui_widget_packages`, `/api/widgets/packages/{list,
  install,uninstall}`, runtime registry.
- `[EXTEND]` `WidgetPackageManifest` (versioned) + `validateWidgetManifest` (schema + perms-in-catalogue +
  routes-registered + widget-schema checks) per `WIDGET_PACKAGE_MANIFEST_SCHEMA.json`.
- `[NEW]` `/api/widgets/packages/update` (semver compare, compat check, config migration, geometry
  preserved, audit).
- `[EXTEND]` Uninstall = preserve-instances-disabled (locked placeholder), audit on every lifecycle event.
- **Gate:** install valid/invalid manifest; update with config migration; uninstall preserves instances;
  audit rows written.

## Phase 4 — Animation
- `[NEW]` `animation/` presets (13) as CSS classes + `count-up` JS primitive; `WidgetAnimationConfig`
  wired through `WidgetRenderer`.
- `[NEW]` Reduced-motion layer; realtime chart-animation suppression; alert-pulse clamp; count-up
  diff-only.
- **Gate:** reduced-motion disables motion; realtime suppresses chart anim; count-up only on value change.

## Phase 5 — Module widgets (catalogs)
- `[EXTEND]` **HR**: add Offboarding, Leave, Attendance, Compensation, Overtime, Requests, Training/
  compliance widgets to HR registries.
- `[NEW]` **Finance** `registry.finance.tsx`: payroll run status, statutory version health, NIS
  verification, pay-component usage, payroll warnings, export readiness, gross/net totals, approvals.
- `[NEW]` **HSE** `registry.hse.tsx`: incident trends, JSA risk, PTW active, permit expiry, training
  compliance, inspection findings, CAPA overdue, PPE.
- `[NEW]` **Platform** `registry.platform.tsx`: notifications, messages, tickets, security alerts,
  pending approvals, role/permission changes, settings governance.
- Each widget reuses `inlinePrimitives`, declares exact hook/route/permission, sizes, animation, states.
- **Gate:** each catalog widget passes the acceptance checklist; per-module unit tests.

## Phase 6 — Governance
- `[NEW]` `ui_widget_policy` migration (enable/disable, allowed_roles, allowed_modules, locked,
  hidden_from_catalog, default_config) + `netlify/functions/lib/widgetGovernance.ts`.
- `[NEW]` **Superadmin Console ▸ Widgets** admin UI: enable/disable packages, role/module restriction,
  lock required widgets, hide from catalog, set default layout, view audit + usage stats.
- `[EXTEND]` `listWidgetsByPermission` + catalog + board seeding honor policy.
- **Gate:** governance E2E — non-admin denied; disabled/role-restricted widget never reaches user; audit
  rows; usage counts.

## Phase 7 — Migration (dashboards → board)
- `[EXTEND]` Migrate `HSEDashboard` (respect the build-order deferral — only when that phase is approved),
  `AttendanceDashboard`, `AdminDashboardController`, `DashboardController` onto `WidgetBoard` with default
  layouts mirroring current cards; delete the bespoke card grids (no dual systems).
- Preserve existing user layouts (stable instanceIds); seed defaults to match today's order.
- **Gate:** each migrated page shows the same KPIs on the board; old layouts map; legacy card components
  deleted; full E2E green.

---

## Sequencing notes
- Phases 0–2 unblock everything and are mostly consolidation of what exists.
- Phase 5 (Finance/HSE/Platform catalogs) can begin in parallel with Phase 4 once Phase 1 lands.
- Phase 7 HSE migration is **gated by the existing HSE-dashboard build-order deferral** — do not start it
  until that phase is explicitly approved.
- Operator migrations required before runtime (already noted in `WIDGET_LIBRARY_PLAN.md`):
  `20260714000007_ui_layout_instances.sql`, `20260714000009_ui_widget_packages.sql`, and the new
  `*_ui_widget_policy.sql` (Phase 6). Rebuild backend + restart dev after applying.
