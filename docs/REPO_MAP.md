# SIOMAC ERP — Repository Map

Fast orientation for the codebase so you can jump to the right file without re-searching.
Read this first; it points at *where things live*, not *how they work* (that's the module
docs, indexed at the bottom).

## Tech stack (one line each)
- **Frontend:** Preact + Vite + TypeScript. Data via TanStack Query. `noUncheckedIndexedAccess: true`.
- **Backend:** Netlify Functions (single `api.ts` entry) → Hono router → Zod → lib → Supabase. **POST-only**, every route behind `requirePermission()`.
- **DB:** Supabase/Postgres. RLS on every table. `app_users.id` is **TEXT** (all user FKs are text).
- **Auth:** JWT (HS256). `requireUser` resolves role from `app_users`, **not** the token.

## Path aliases (tsconfig + vite)
`@/` → `src/` · `@api` → `src/api` · `@lib` → `src/lib` · `@ui` → `src/ui` · `@shell` → `src/shell` · `@store` → `src/store` · `@cfg` → `src/config` · `@shared/*` → `src/components/shared/*` · `@sections/*` → `src/components/sections/*` · `@components/*` → `src/components/*`
> API/mutation helpers wrap the body as `{ args: payload }` — backend routes must read `body.args ?? body`.

## Top-level
```
src/        frontend (Preact)
netlify/    backend (functions + routes + lib)  ← serves compiled dist/ in dev:netlify
database/   migrations/ (authoritative schema)
supabase/   apply-*.sql seed scripts + migrations/ (172 files)
docs/       specs, module maps, implementation briefs (index below)
scripts/    e2e harness + suites, seed runners, build-widget-package
types/      shared BE↔FE DTOs (camelCase, imported by both)
tests/      root-level tests
assets/     global stylesheets (topbar.css lives here)
```

## Frontend (`src/`)
- **`components/sections/<Module>/`** — one dir per module page. Active: `HR`, `Finance`, `HSE`, `Settings`, `SuperadminConsole`, `Profile`, `Messages`, `Tickets`, `NotificationCenter`, `ProjectSites`, `Dashboard`, `AdminDashboard`, `LiveMap`. Legacy (being removed): `Employees`, `Attendance`, `AttendanceDashboard`, `Payroll`, `HourlyRates`, `AdminLeave`.
- **`api/`** — TanStack Query hooks per domain. Subdirs `hr/`, `finance/`, `hse/`; flat files for platform (`workflows.ts`, `communications.ts`, `layout.ts`, `widgets.ts`, `orchestration.ts`). Query keys in `queryKeys.ts`, Zod in `schemas/`.
- **`store/`** — Zustand. `session.ts` (auth/identity, `selectIsManager`/`selectIsAdmin`/`selectUserId`), `onboardingCase.ts` + `onboardingDashboard.ts` (widget-board state that can't flow as props — see widgets note), `realtime.ts`, `notifications.ts`, `ui.ts`, `data.ts`.
- **`lib/`** — `permissions.ts` (RBAC catalogue + `can()`), `permissionMeta.ts`, `api.ts` (fetch wrapper), `dialog.ts` (app-wide popups — never `window.alert/confirm`), `session.ts`, `moduleRegistry.ts`, `navVisibility.ts`, `workflow/`.
- **`ui/`** — shared component kit (`components/`, `charts/`, `layouts/`, `status/`, `toast/`, `theme/`) + `PAGE_GUIDE.md` (mandatory page structure). **`ui/widgets/`** = the widget system (see below).
- **`shell/`** — AppShell (nav, section routing via `siomac:section` events, keeps visited sections mounted).

## Widget system (`src/ui/widgets/`) — the customizable dashboard board
- **Contract:** `types.ts` — `WidgetDef` (registry entry), `WidgetInstance` (saved), `PreviewWidgetInstance`, `LocalWidget` (page-local tile), `BoardLayout`.
- **Registry:** `registry.ts` self-collects `registry.<name>.tsx` packages via `import.meta.glob`, runs `validation.ts`. Runtime (installed .zip) widgets via `runtimeRegistry.ts` + `declarative/`.
- **Board:** `WidgetBoard` → `WidgetBoardZone` (gridstack↔Preact bridge; **one static `renderCB` dispatcher** routes to the owning board — never assign per-mount) → `WidgetFrame` → `WidgetRenderer` (permission-gates on mount). `useBoardLayout.ts` persists per-user to `ui_layout.layout` (jsonb).
- **Library:** `WidgetLibraryModal` + catalog/detail/config/preview. Authoring: `defineWidget.ts`; sizing/responsive helpers `size.ts`/`responsive.ts`.
- **Per-board config:** `WidgetBoard` accepts `cellHeight` + `column` (onboarding runs a fine 12px/24-col grid for near-fluid, sizeToContent tiles). Only Employee Master + HR Onboarding are on the board today.
- **Page-local tiles** (not in the library catalogue) close over page state via `localWidgets` — e.g. the employee register, and the onboarding dashboard cards (`OnboardingOverview.localWidgets.tsx`).

## Backend (`netlify/functions/`)
- **Entry:** `api.ts` (single function; Hono mounts every route).
- **`routes/`** — one file per surface. HR: `hr.ts`, `hrOnboarding.ts`, `hrOffboarding.ts`, `hrAttendance.ts`, `hrLeave.ts`, `hrCompensation.ts`, `hrOvertime.ts`, `hrRequests.ts`, `hrRoster.ts`, `hrStatutoryProfile.ts`, `departments.ts`. Finance: `finance*.ts`. HSE: `hse*.ts`. Platform: `workflows.ts`, `workflowEngine.ts`, `handoffs.ts`, `orchestration.ts`, `communications.ts`, `notifications.ts`, `tickets.ts`, `settings*.ts`, `uiPrefs.ts`, `widgetPackages.ts`, auth (`auth*.ts`, `webauthn.ts`, `trustedDevices.ts`, `authStepUp.ts`).
- **`lib/`** — platform backbone: `appEvents.ts`, `handoffBus.ts`, `moduleServiceAdapter.ts` (`runModuleMutation` — use for ALL module mutations), `moduleMutationRuns.ts`, `refGenerator.ts` (`nextRef`), `recipientResolver.ts`, `orchestration/`, `workflow/`, `receivers/`, `securityPolicy.ts`, `ratelimit.ts`. Per-domain in `lib/hr/`, `lib/finance/`, `lib/settings/` (module split as `<x>Core/Queries/Mutations`).
- **Scheduled:** `auto-checkout.ts`, `hse-*-sweeps.ts`.
- **Backbone plan:** `netlify/functions/lib/MUTATION_BACKBONE_PLAN.md` (mutation atomicity — supabase-js can't wrap multi-table writes in one tx; use compensating rollback until the transactional-outbox RPC exists).

## Data
- **Schema:** `database/migrations/` (authoritative) + `supabase/migrations/` (172). Naming: `snake_case`, module-prefixed (`hr_*`, `finance_*`, `hse_*`, `ops_*`, `payroll_*`); platform tables unprefixed. `id uuid default gen_random_uuid()`, `created_at`/`updated_at`, RLS enabled.
- **Seeds:** `supabase/apply-*.sql` (one per module, idempotent) + `scripts/apply-*-seed.mjs` runners (service-role REST; pick real `app_users` by subquery).

## Testing
- **Unit:** vitest (`*.test.ts`), 265 currently. Run `npx vitest run`.
- **Typecheck (fast loop):** `npm run typecheck:frontend` / `:backend`. Use this while iterating — NOT the E2E suite.
- **E2E:** `scripts/e2e/suites/<module>.mjs` (35 suites) via `npm run test:e2e -- <module>` against a **running** `dev:netlify`. Harness: `scripts/e2e/harness.mjs` (`acquireActors` prefers real employees). Reference suite: `communications.mjs`.
- **Cadence:** run full suites only when a task is DONE, not per-edit.

## Hotspots & gotchas (cost real time before)
- **`dev:netlify` serves compiled `dist/`** — backend changes need `npm run build:backend` + restart; no hot-reload for routes.
- **`OnboardingCommandCenter.css` ≈ 12,000 lines**, multiple `@layer sections` blocks + `!important`. The WINNING rule is the LAST applicable one — grep ALL declarations for a selector. Cards are styled by container-context selectors (`.obv-v20-layout > …`, `.obv-right-calendar-stack > …`) so pulling one into a widget tile requires re-creating that ancestry (see `OnboardingOverview.localWidgets.css`).
- **Permission keys must match the catalogue EXACTLY** (`hse.ptw.view`, not `hse.permits.view`) — the drift-guard doesn't cover read-gate/inheritance maps.
- **Dependency pins:** `@supabase/supabase-js` EXACTLY `2.105.3` + `overrides.ws ^8.21.0`; `hono ^4.12.27`. Don't bump blind (broke ~29 E2E).
- **New junction table breaks existing PostgREST `B(...)` embeds** — disambiguate with `!fk_column`.

## Docs index (deeper detail lives here)
- **Architecture:** `ARCHITECTURE.md`, `FRONTEND_ARCHITECTURE.md`, `SHELL_STRUCTURE.md`, `CODING_STANDARDS.md`, `DATA_DICTIONARY.md`, `API_SPEC.md`, `SECURITY.md`, `RUNBOOK.md`.
- **Module maps:** `HR_MODULE_MAP.md`, `FINANCE_MODULE_MAP.md`; build order in `PHASE_PLAN.md` / `IMPLEMENTATION_PLAN.md`.
- **Widget system:** `SIOMAC_ENTERPRISE_WIDGET_SYSTEM_IMPLEMENTATION.md` (+ `WIDGET_*` companions), `src/ui/widgets` (self-documenting), `WIDGET_AUTHORING_GUIDE.md`.
- **Platform:** `COMMUNICATIONS_BACKBONE.md`, `ORCHESTRATION_EXISTING_PLATFORM.md`, `DIALOG_SYSTEM.md`, `ENV_REGISTRY.md`.
- **Per-module briefs:** `docs/*_IMPLEMENTATION_BRIEF.md` (Attendance, Leave, Compensation, Documents, Requests, Roster, Org Structure, Disciplinary/Grievance) + `ONBOARDING_*`, `docs/ONBOARDING_MODULE_PLAN.md`.
