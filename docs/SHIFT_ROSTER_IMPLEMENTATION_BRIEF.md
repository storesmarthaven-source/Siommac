# HR Shift / Roster Scheduling — Implementation Brief (for Codex)

**Module:** HR sub-module #7 — Shift / Roster Scheduling
**Goal:** a greenfield rostering module: define **shift templates** and **rotation patterns**, build a
**roster** (a schedule of who works which shift on which day, per site/department over a period), detect
**coverage gaps** against required headcount, **publish** the roster (notifying assigned employees), and feed
the published roster to **Attendance** (expected vs actual) and **Leave** (approved leave shows as off).

> Read `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` FIRST (envelope `c.json({success,data})` /
> `{success:false,message}` code as `200`; body `(c.get('body') as Record<string,unknown>).args ?? {}`;
> `app_users.id` is TEXT; permission model; side-effects; camelCase DTO; no URL router; test cadence). Also
> read `CLAUDE.md` (No-Band-Aids + Known Pitfalls) and the sibling briefs (Attendance/Leave/Offboarding) for
> the shared platform patterns (`runModuleMutation`, `emitAppEvent`, `writeHrAudit`, `nextRef`, notifications,
> central workflow, `module_workflow_bindings`, the permission drift-guard).

**GREENFIELD (user-confirmed 2026-07-02: "nothing will be used").** Fresh `hr_roster_*` / `hr_shift_*`
domain. Reuse ONLY the platform backbone: `app_users` (identity, `department_id`, `site_id`, `position_id`,
`supervisor_id`), Organization Structure (`departments` / `hr_positions` / `project_sites`), notifications
(`notify.ts` / `recipientResolver.ts`), the central workflow engine (optional roster approval before
publish), and `@ui`. Do NOT reuse any legacy scheduling/attendance code.

**Frontend scope:** **functional-only**. No widget board. Plain `.obx-*` tables/forms + `@ui`. The roster grid
(employees × days) is a functional table, not a KPI board.

---

## 0. TL;DR — what to build
1. **Shift templates** (Day/Night/Split… start/end/break/hours) + **rotation patterns** (e.g. 4-on-4-off).
2. **Rosters** — a schedule for a site/department over a period (week/fortnight/month), status
   `draft → pending_approval? → published`.
3. **Shift assignments** — employee × date × (shift template | off | leave) within a roster; auto-generate
   from a rotation, then hand-edit.
4. **Coverage requirements + gap detection** — required headcount per site/dept/role/shift → surface gaps.
5. **Publish** — lock the roster, notify assigned employees, expose it to Attendance/Leave (read-only feed).
6. **Permissions** `hr.roster.*` (all four catalogues + DB grants). **Types/hooks**, **functional-only
   frontend**, **E2E**.

---

## 1. Current state (build ON the platform)
Reuse ONLY:
- `app_users` (TEXT id) + `department_id`, `site_id`, `position_id`, `supervisor_id`.
- Org Structure: `departments` (org units), `hr_positions`, `project_sites` (locations) — a roster is scoped
  to a site/department; coverage is per role (position).
- `emitAppEvent` (void), `writeHrAudit` (throws), `nextRef(prefix)` — use `'ROS'` (roster) — free.
- `runModuleMutation` for idempotent roster creation.
- Notifications — on publish, notify assignees via the existing `notify.ts` / `recipientResolver`
  (recipient strategy: the assigned employees). Do NOT build a new notification system.
- Central workflow engine — OPTIONAL: if a site requires roster sign-off before publish, route via
  `startWorkflowForRecord({moduleKey:'hr_roster', workflowType:'hr_roster_approval', triggerEvent:
  'hr.roster.submitted'})` + a `hr_roster` adapter + seeded template/version/binding (mirror `20260711000000`).
  If no approval is required, publish directly (a `manage`+`publish` gated action). Decide in §2.3.
- Settings manifest (`resolveSettingValue`) for roster policy (default period length, week start day,
  min rest hours between shifts, max consecutive days) — used by validation.

---

## 2. Architecture decisions (No-Band-Aids)

### 2.1 A roster is the container; assignments are the rows.
`hr_rosters` (one per site/dept + period) owns many `hr_shift_assignments` (employee × date). Auto-generation
from a `hr_rotation_patterns` row fills assignments; then they're hand-editable until published. On publish
the roster + its assignments are frozen (edits require re-open → re-notify, audited).

### 2.2 Coverage is computed, not stored per cell.
`hr_coverage_requirements` declares "site X, department Y, role Z, shift S needs N people per day". Gap
detection is a query over assignments vs requirements for the roster's date range — a read endpoint, not a
denormalized field. Gaps surface in the UI and block publish only if policy says so (configurable; default:
warn, don't block).

### 2.3 Publish path — direct or workflow, but ONE authority.
Default: publish is a permissioned action (`hr.roster.publish`) that sets `status='published'`, stamps
`published_at`, emits `hr.roster.published`, and notifies assignees. If a site needs approval first, the
SAME action routes through the central engine (binding present → workflow; null → direct). Never a second,
parallel approval mechanism.

### 2.4 Feeds, not couplings.
Attendance reads the published roster to know the **expected** shift per employee/day (variance = actual vs
expected). Leave reads/writes nothing here directly; instead the roster's assignment builder marks a day
`leave` when an approved `hr_leave_request` covers it (read the Leave module's approved requests). Keep these
as read integrations — do NOT write into Attendance/Leave tables from this module.

### 2.5 Validation in the mutation layer.
Enforce policy on assignment save (not just UI): no overlapping shifts same day, min rest hours between
consecutive shifts, max consecutive working days, employee belongs to the roster's site/dept. Reject with a
clear message (`@lib/dialog` on the FE surfaces it).

---

## 3. Migrations (greenfield, additive, operator-applied)
Max existing migration is `20260721000002`; Attendance takes `20260722+`, Payroll `20260725+`. **Use
`20260726000000+`** (confirm the current max before finalizing). RLS + `service_role` grants + `set_updated_at`
on every mutable table. Each ends with `-- After applying, run: NOTIFY pgrst, 'reload schema';`.

### 3.1 `20260726000000_hr_roster_core.sql`
- **`hr_shift_templates`** — `id uuid pk`, `code text unique`, `name text`, `starts_at time`, `ends_at time`,
  `crosses_midnight boolean default false`, `break_minutes int default 0`, `paid_hours numeric(5,2)`,
  `colour text`, `site_id text null`, `is_active boolean`, `created_by text → app_users`, timestamps.
- **`hr_rotation_patterns`** — `id`, `code text unique`, `name text`, `cycle_days int` (e.g. 8 for 4-on-4-off),
  `pattern jsonb` (array of `{dayIndex, shiftTemplateCode | 'off'}`), `is_active boolean`, `created_by`,
  timestamps.
- **`hr_coverage_requirements`** — `id`, `site_id text`, `department_id text null`, `position_id uuid null →
  hr_positions`, `shift_template_id uuid → hr_shift_templates`, `required_headcount int`, `day_of_week int
  null` (null = every day), `is_active boolean`, timestamps.

### 3.2 `20260726000001_hr_rosters.sql`
- **`hr_rosters`** — `id`, `roster_no text unique` (nextRef 'ROS'), `title text`, `site_id text`,
  `department_id text null`, `period_start date`, `period_end date`, `status text check (status in
  ('draft','pending_approval','returned','published','archived'))`, `rotation_pattern_id uuid null`,
  `workflow_id uuid null → workflow_instances`, `assignment_count int default 0`, `open_shift_count int
  default 0`, `created_by`, `published_by`, `published_at`, timestamps. Consider a partial unique index to
  avoid two active rosters for the same site/dept/overlapping period (or validate in-app).
- **`hr_shift_assignments`** — `id`, `roster_id uuid → hr_rosters on delete cascade`, `employee_id text →
  app_users`, `work_date date`, `shift_template_id uuid null → hr_shift_templates` (null + `kind` = off/leave),
  `kind text check (kind in ('shift','off','leave','open'))`, `hours numeric(5,2) null`, `note text`,
  `source text default 'manual'` (manual | rotation | leave_sync), `created_by`, timestamps.
  Unique `(roster_id, employee_id, work_date)` (one assignment per employee per day per roster).

### 3.3 `20260726000002_hr_roster_permissions.sql`
Grants for `hr.roster.*` (§4). **VERIFY grantee roles exist in `public.roles`** (FK
`role_permissions_role_name_fkey`; granting a non-existent role like `supervisor` throws 23503 — that bug bit
HR Requests). Valid: `employee, manager, hr_staff, hr_manager, admin, superadmin`.

### 3.4 `20260726000003_workflow_hr_roster_binding.sql` (ONLY if approval-before-publish is in scope)
Mirror `20260711000000`: template `hr_roster_approval` + published v1 + binding in **`module_workflow_bindings`**
for `hr.roster.submitted`. If you ship direct-publish only, skip this migration (and the workflow_id column
stays null) — but do not half-wire it.

---

## 4. Permissions — `hr.roster.*` in all FOUR catalogues + DB grants
Keys: `hr.roster.view` (see rosters for their scope), `hr.roster.view_own` (my published shifts),
`hr.roster.manage` (create/edit/assign/generate), `hr.roster.publish`, `hr.roster.templates.manage`
(shift templates + rotation patterns + coverage requirements), and `hr.roster.approve` (only if §3.4).
Catalogue in `netlify/functions/lib/permissions.ts`, `src/lib/permissions.ts` (PERMISSION_KEYS + admin/
superadmin Sets + `view_own` on the employee baseline), `src/lib/permissionMeta.ts` (group `'Roster'`).
Grants: superadmin/admin all; hr_manager + manager (manage/publish/templates/view for their site);
hr_staff (manage + view, NOT publish/templates unless policy says so); employee `view_own`. Drift-guard
fails the build on a missing key.

---

## 5. Backend — lib + routes
### 5.1 `netlify/functions/lib/hr/roster*.ts`
- `rosterTemplates.ts` — CRUD for shift templates / rotation patterns / coverage requirements.
- `rosterCore.ts` — `createRoster` (via `runModuleMutation`, idempotencyKey
  `hr.roster:${site}:${period_start}`), `generateFromRotation(rosterId, patternId)` (fill assignments),
  `syncLeave(rosterId)` (mark days `leave` from approved `hr_leave_request`s), `saveAssignment` (with §2.5
  validation), `publishRoster` (freeze + notify + optional workflow), `reopenRoster` (audited).
- `rosterQueries.ts` — `listRosters(filters)`, `getRoster(id)` (with assignments grouped by employee/day),
  `getCoverageGaps(rosterId)` (requirements vs assignments), `getMyShifts(employeeId, from, to)` (published
  only), `getExpectedShift(employeeId, date)` (the Attendance feed).
- `rosterReports.ts` — coverage %, open-shift count, hours by employee/site.
### 5.2 Routes `netlify/functions/routes/hrRoster.ts` (mount `/api/hr/roster` in `api.ts`)
`templates/list|upsert|remove`, `rotations/list|upsert`, `coverage/list|upsert`, `rosters/list|get|create|
generate|sync-leave|publish|reopen`, `assignments/upsert|remove|bulk`, `coverage/gaps`, `my-shifts`. Validate
`body.args ?? {}`; envelope + `requirePermission`. `view_own`/`my-shifts` enforce `employee_id === actor.id`.
Every mutation: `emitAppEvent` + `writeHrAudit`. Publish emits `hr.roster.published` and triggers assignee
notifications through the existing notification path.

---

## 6. Types + hooks + frontend
`types/hrRoster.ts` (ShiftTemplate, RotationPattern, CoverageRequirement, Roster, ShiftAssignment,
CoverageGap, MyShift, args — camelCase, shared). `src/api/hr/roster.ts` (TanStack hooks, keys `['hr','roster']`,
`apiPost` `{args}`, `call<T>` throws on `success:false`). **Frontend functional-only**
`src/components/sections/HR/RosterOverview.tsx` (mirror `OffboardingOverview.tsx`): tabs — **Rosters** (list +
the roster **grid**: employees as rows, days as columns, each cell a shift-template picker / off / leave;
generate-from-rotation, coverage-gap panel, publish/reopen actions gated), **Templates** (shift templates +
rotation patterns + coverage requirements editors), **My Shifts** (employee self-view of published shifts,
`view_own`). Use `@lib/dialog` for confirms; never `window.*`. Loading: `placeholderData` + gate
`loading={isLoading && !data}`. Nav `s-hr-roster` in `module.ts` + route in `HRSection.tsx`.

---

## 7. E2E — `scripts/e2e/suites/hrRoster.mjs`
Mirror `hrOffboarding.mjs`. Cover: create shift template + rotation + coverage requirement; create a roster;
generate-from-rotation writes assignments; save an assignment that violates a rule (overlap / min-rest) is
rejected; coverage-gap query returns the right shortfall; publish → `published` + assignees get a notification
(assert `notifications`/delivery rows) + edits then blocked; leave-sync marks a day `leave` from an approved
leave request; `my-shifts` returns only the caller's published shifts (employee A can't see B's draft); access
control (employee denied `manage`/`publish`); §2 side-effects (app_events + hr_audit_log); cleanup via `h.TAG`.

---

## 8. Verification gate (once, at end)
`typecheck:frontend` + `typecheck:backend` + `build:backend` clean; `npm test` + `npx vitest run` green
(watch the drift-guard); `npm run test:e2e -- hrRoster` green (after migrations applied + `NOTIFY pgrst`).
229 frontend tests remain green. Migrations to operator-apply in order: `20260726000000` …
(`20260726000003` only if workflow approval is included).

---

## 9. APPENDIX — DO NOT COPY / common drift
| # | Wrong | Correct |
|---|---|---|
| 1 | write into Attendance/Leave tables from here | read-only feeds (§2.4); this module owns only `hr_roster_*`/`hr_shift_*` |
| 2 | second notification system for publish | reuse `notify.ts` / `recipientResolver` (assignee strategy) |
| 3 | second approval mechanism | central engine only (if approval in scope) — `module_workflow_bindings` + adapter + published version |
| 4 | validate rules only in the UI | enforce overlap / min-rest / max-consecutive / site-membership in the mutation layer |
| 5 | `insert into role_permissions (role, permission)` / grant `supervisor` | `role_name`; only roles in `public.roles` |
| 6 | `writeHrAudit({oldState})` | `previousState` |
| 7 | denormalize coverage into each cell | compute gaps as a query over assignments vs requirements |
| 8 | half-wire a workflow (binding but no published version) | seed a published version or skip workflow entirely (direct publish) |

## 10. Definition of done
Greenfield `hr_roster_*`: shift templates + rotation patterns + coverage requirements; rosters with
auto-generation, rule-validated assignments, computed coverage gaps; publish (freeze + assignee notifications,
optional central-workflow approval); `my-shifts` self-view; read feeds for Attendance (expected shift) and
Leave (leave-sync). Permissions in all four catalogues + granted (roles verified against `public.roles`);
functional-only Roster page nav-wired; `hrRoster.mjs` + full gate green; migrations listed for operator-apply.
