# HR Attendance & Timekeeping — Implementation Brief (for Codex)

**Module:** HR sub-module #6 — Attendance & Timekeeping
**Goal:** Build a **greenfield** enterprise Attendance & Timekeeping module: a **punch/record**
capture (geo + photo), **timesheets** (periodised hours + overtime), **exception/late rules**
(policy-driven), **corrections** (audited edits), a **manager approval queue**, and an
**attendance-policy** manifest. It is the **twin of Leave & Absence** (shared timekeeping spine): an
approved leave day must suppress an "absent" exception.

> ⛔ **The old attendance code is OUT OF SCOPE.** Do NOT read, reuse, extend, or migrate the legacy
> `attendance` table or `netlify/functions/routes/attendance.ts` or the legacy `attendance.*`
> permissions / `AttendanceDashboard`. This is a fresh `hr_attendance_*` domain. "Reuse" below means
> ONLY the current shared **platform** (workflow engine, events, audit, settings, presign, `@ui`,
> Organization Structure).

> Read `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` + `CLAUDE.md` first. Build **Leave & Absence**
> first (or in tandem) — Attendance reads approved leave to reconcile absences (defensively). Where
> this brief and any generated plan disagree, this brief wins.

**Frontend scope:** **functional-only** — plain `.obx-*` tables/forms + `@ui`, no widget board.
`@lib/dialog` for confirms/prompts/toasts.

---

## 0. Conventions (verified — do not deviate)
Envelope `{success,data}`; request `body.args`; `requirePermission(c,key)` returns the `AppUser`
(has `role`); `app_users.id` is TEXT; shared camelCase DTOs in `types/hrAttendance.ts`; mutations do
`emitAppEvent` (void) + `writeHrAudit` (awaited; field is **`previousState`**); approvals via the
central engine **`startWorkflowForRecord` + binding**; `role_permissions` grant column is **`role_name`**;
`nextRef` accepts arbitrary prefixes. (Full detail in §0 of the Leave brief.)

## 0b. Platform to REUSE (current backbone — NOT legacy)
`emitAppEvent`, `writeHrAudit`, `nextRef`, `resolveSettingValue` + settings manifests, the central
workflow engine (`startWorkflowForRecord`, bindings, adapter registry), the presign + signing helpers
(`createAttachmentUploadUrl` in `lib/upload`, `getSignedUrl` in `lib/photos`), the orchestration
timeline, `@ui`, Organization Structure (`departments` tree, `hr_positions`, cost centres) +
`app_users` (`department_id`, `supervisor_id`, `role`). Positions/cost-centres/hierarchy exist now for
costing + approval routing.

---

## 1. Data model — new `hr_attendance_*` tables (migrations, operator-applied + NOTIFY pgrst)
Number `20260719000000+` (confirm the highest existing first). Every PK `uuid default gen_random_uuid()`;
RLS + `service_role` grants; `set_updated_at` triggers. Each migration ends with
`-- After applying: NOTIFY pgrst, 'reload schema';`.

- **`hr_attendance_records`** — the raw punch (greenfield, replaces nothing): `employee_id` text FK,
  `work_date` date, `check_in_at` timestamptz, `check_out_at` timestamptz,
  `check_in_lat/lng` numeric, `check_in_accuracy` numeric, `check_in_photo_path` text,
  `check_in_site_id` text references project_sites(id), `check_in_distance_m` numeric,
  `check_out_lat/lng/accuracy/photo_path/site_id/distance_m` (same shape),
  `worked_minutes` int, `late_minutes` int, `overtime_minutes` int, `status` text
  ('present','late','partial','absent','on_leave') — the last four are **computed** (§2.2),
  `source` text ('self','manager','import') default 'self', `metadata` jsonb,
  `unique(employee_id, work_date)`.
- **`hr_timesheets`** — `employee_id` text FK, `period_start` date, `period_end` date, `status` text
  ('draft','submitted','approved','rejected','reopened') default 'draft', `total_minutes` int,
  `regular_minutes` int, `overtime_minutes` int, `exception_count` int, `workflow_id` uuid references
  workflow_instances(id) on delete set null, `submitted_at`, `approved_by`, `approved_at`, `note`,
  `unique(employee_id, period_start, period_end)`.
- **`hr_attendance_exceptions`** — `employee_id` text FK, `work_date` date,
  `record_id` uuid references hr_attendance_records(id) on delete cascade, `type` text
  ('late_in','early_out','missing_punch','short_hours','over_hours','absent'), `minutes` int,
  `status` text ('open','waived','resolved') default 'open', `resolved_by` text FK, `resolved_at`,
  `waiver_reason`, `timesheet_id` uuid references hr_timesheets(id) on delete set null,
  `unique(employee_id, work_date, type)`.
- **`hr_attendance_corrections`** — audit-friendly correction log: `record_id` uuid FK, `field` text,
  `previous_value` jsonb, `new_value` jsonb, `reason` text, `actor_id` text FK, `created_at`. (Also
  written to `hr_audit_log` via `writeHrAudit`.)
- **Permission grants** migration (§4) + **workflow template + published version + binding** for
  `hr_timesheet_approval` (§3.3).
- Photos: reuse the presign pattern into a private **`hr-attendance-photos`** bucket (own bucket;
  do not reuse the legacy `attendance-photos` bucket).

## 2. Architecture decisions (No-Band-Aids)
### 2.1 Greenfield capture — `hr_attendance_records` is the punch record; nothing touches `attendance`.
The employee punch endpoint validates the site geofence (distance from `project_sites` coords vs the
policy radius) and stores a presigned photo path. Reuse the presign/signing HELPERS only.
### 2.2 Exceptions + hours are RECOMPUTED, never hand-kept.
A **pure** `computeDay(record, policy, approvedLeave)` → `{ workedMinutes, lateMinutes,
overtimeMinutes, status, exceptions[] }` and `computePeriod(records[]) → timesheet totals`. A
`compute/run` service-role sweep (per day/period) upserts `hr_attendance_records` computed columns +
`hr_attendance_exceptions` and rolls up `hr_timesheets`. Recompute on every correction. Keep
`computeDay` pure + **unit-tested** (vitest).
### 2.3 Timesheet approval = the ONE central workflow engine.
Submit a period → `startWorkflowForRecord({ moduleKey:'hr_attendance',
workflowType:'hr_timesheet_approval', triggerEvent:'hr.timesheet.submitted',
sourceRecordId:timesheet.id, … })`; a registered **`hr_attendance` adapter** sets the timesheet
`approved/rejected` on completion. Null binding → direct manager-approve fallback. Seed
template + published version + binding.
### 2.4 Leave reconciliation is a soft, defensive read.
When computing an 'absent' exception, check for an approved `hr_leave_requests` row covering that date
(from the Leave module). Wrap in try/catch so Attendance still works if Leave isn't deployed. Set
`status='on_leave'` and suppress the 'absent' exception when found. Never duplicate leave data.
### 2.5 Corrections are audited.
`correction/apply` edits an `hr_attendance_records` field, logs to `hr_attendance_corrections` +
`writeHrAudit` (`previousState`), then recomputes the day.

## 3. Backend — lib + routes
### 3.1 Lib (`netlify/functions/lib/hr/attendance*.ts` / `timekeeping*.ts`)
`timekeepingCompute.ts` (**pure** `computeDay` + `computePeriod`), `attendanceCapture.ts` (punch
in/out + geofence + presign), `attendanceExceptions.ts` (recompute + waive/resolve),
`timesheetService.ts` (build/submit/approve/reject/reopen + workflow wiring),
`attendanceCorrections.ts` (audited edit → recompute), `attendanceQueries.ts` (my/team/all history
dept-scoped, live, daily log, stats), `attendanceReports.ts`.
### 3.2 Routes (new `netlify/functions/routes/hrAttendance.ts` mounted `/api/hr/attendance`)
`punch/in`, `punch/out`, `punch/upload-url`, `record/list` (my/team/all dept-scoped), `record/get`,
`correction/apply`, `exceptions/list`, `exceptions/waive`, `exceptions/resolve`,
`timesheet/list|get|build|submit|approve|reject|reopen`, `compute/run` (service-role), `live`,
`daily-log`, `stats`, `policy/get`, `reports/list|run|export`.
### 3.3 Approval wiring — same LOCKED-engine pattern as §3.3 of the Leave brief (binding + `hr_attendance` adapter + null-binding fallback + seeded published version).

## 4. Permissions — `hr.attendance.*` (catalogue in ALL 4 places)
`view` (own), `view_all`, `punch`, `correct`, `timesheets.view`, `timesheets.submit`,
`timesheets.approve`, `exceptions.view`, `exceptions.manage`, `compute.run`, `policy.manage`,
`reports.view`, `reports.export`. Add to `permissions.ts` ×2 + admin/superadmin Sets +
`permissionMeta.ts` (group 'Attendance'). Grants (**`role_name`**): `employee` → view/punch/
timesheets.view+submit(own); `manager` → +view_all/timesheets.approve/exceptions.manage (dept-scoped);
`hr_manager`/`admin`/`superadmin` → all; `hr_staff` → execution keys (not policy.manage / compute.run /
reports.export).

## 5. Settings manifest `hrAttendance.manifest.ts` (register in `manifests/index.ts`)
`hr_attendance.enabled`, `hr_attendance.shift_start` (HH:MM), `hr_attendance.grace_minutes`,
`hr_attendance.standard_day_minutes`, `hr_attendance.overtime_threshold_minutes`,
`hr_attendance.rounding_minutes`, `hr_attendance.workweek`, `hr_attendance.geofence_radius_m`,
`hr_attendance.pay_period` (weekly/biweekly/monthly).

## 6. Types + hooks
`types/hrAttendance.ts` (AttendanceRecord, Timesheet, AttendanceException, DayComputeResult, Stats, args).
`src/api/hr/attendance.ts` (`call()` throws on `success:false`; keys `['hr','attendance',…]`;
`useAttendanceMutation` invalidates `['hr','attendance']`; gated approve returns applied|pendingApproval union).

## 7. Frontend — functional-only (`src/components/sections/HR/`)
`AttendanceOverview.tsx` (header + plain stat row + `surface` enum: Daily Log / Timesheets /
Exceptions / Live / Reports) + timesheet review table (build → submit → approve/reject, union toast),
exception queue (waive/resolve with reason via `@lib/dialog`), correction modal (edit punch → shows
recomputed hours), daily-log + live views. Nav item `s-hr-attendance` in `module.ts` + route in
`HRSection.tsx`. (The employee punch UI can be a simple check-in/out control; the module's focus is
review/timesheets/exceptions.)

## 8. E2E `scripts/e2e/suites/hrAttendance.mjs`
Seed `hr_attendance_records` → `compute/run` produces expected exceptions (late/short/absent) +
timesheet hours (incl. overtime past threshold); an approved leave suppresses 'absent'; correction
recomputes; timesheet submit → workflow (if binding) / direct-approve (if not); waive/resolve
exception; dept-scoped approver allowed / non-dept denied; §2 side-effects (app_events + hr_audit_log,
polled with local `waitFor`); **real provisioned** users (roles from `app_users`). Cleanup via `h.TAG`.

## 9. Verification gate + migrations
`typecheck:frontend`+`typecheck:backend`+`build:backend` clean; `npm test`+`npx vitest run` green
(**unit-test `computeDay`**); `npm run test:e2e -- hrAttendance` after migrations + `NOTIFY pgrst`.
List migrations in apply order.

## 10. Definition of done
Greenfield punch capture; timesheets (periodised hours + overtime) from `hr_attendance_records`;
policy-driven exceptions recomputed on correction; leave-reconciled absences; approvals on the central
engine (binding + adapter, null fallback); manager queue; functional-only UI nav-wired; `hrAttendance.mjs`
+ full gate green. No band-aids, `computeDay` pure + tested, and **nothing from the legacy attendance code**.

## §0 Corrections — DO NOT copy these wrong patterns
| Wrong | Correct |
|---|---|
| touching / reusing `attendance` or `attendance.ts` | **greenfield `hr_attendance_*`; legacy is out of scope** |
| `role_permissions (role, permission)` | column is **`role_name`** |
| `writeHrAudit({ oldState })` | **`previousState`** |
| hardcoded workflow `templateKey` routing | **`startWorkflowForRecord` + binding** (published version required) |
| new enforced key granted only in DB | also catalogue in `permissions.ts` ×2 + `permissionMeta.ts` |
| exceptions/timesheets hand-maintained | pure `computeDay`/`computePeriod`, recomputed on correction |
| hard dependency on Leave tables | defensive read (try/catch) — Attendance must work if Leave isn't deployed |
