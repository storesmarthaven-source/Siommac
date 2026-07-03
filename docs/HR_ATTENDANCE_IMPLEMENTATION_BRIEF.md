# HR Attendance & Timekeeping — Implementation Brief (for the build agent)

> Supersedes any earlier `docs/ATTENDANCE_TIMEKEEPING_IMPLEMENTATION_BRIEF.md`.
> Read `CLAUDE.md` (No-Band-Aids + Known Pitfalls) and `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md`
> FIRST. **§0 below OVERRIDES the pasted spec wherever they conflict — it is reconciled against
> the ACTUAL codebase.** The pasted spec (§1 onward) is the detailed design; build it WITH §0 applied.

---

## §0. CRITICAL CORRECTIONS (verified against the codebase — these WIN on conflict)

1. **Finance Payroll does NOT exist yet.** `finance_payroll_runs` / `finance_payroll_run_lines`
   tables are NOT built. Therefore:
   - **SKIP §5.5** (`hr_timesheet_payroll_links`) — it FKs to non-existent finance tables and
     the migration WILL fail. Do not create it. (Defer to when Finance Payroll is built.)
   - **SKIP §17 entirely** (Finance Payroll integration / calculation) — it is cross-module work
     into a module that doesn't exist. Attendance's job ends at producing an **approved,
     queryable timesheet** (`hr_timesheets.status='approved'`). Finance consumes it LATER.
   - In §25 (E2E) and §27 (DoD), **drop** "Finance Payroll consumes approved timesheet" — out of scope.
   - Do NOT reference any `finance_*` table or role anywhere.

2. **Collaboration rail (Message Center + Tickets) is DEFERRED — functional-first.** Per the
   standing project decision (`docs/` note / memory: collaboration-rail-deferred), do NOT build or
   wire the rail now:
   - **SKIP §18** (Message Center threads). In the workflow adapter (§15), **remove** the
     `postModuleSystemMessage(...)` call — the adapter only: sets timesheet status → writes
     `hr_audit_log` (via `writeHrAudit`) → emits the app_event. Nothing else.
   - **SKIP §19** (Tickets). No ticket creation from exceptions now.
   - Do NOT create message/ticket/module_registry tables for this module.
   - **§20 Notifications are fine** — but only via the REAL platform (`emitAppEvent`, and
     `notify.ts`/`recipientResolver` if you wire recipients). Keep them real; never fake a notify.

3. **Verify every signature against real code — the pasted spec's shapes are illustrative.**
   - Central workflow: the REAL signature is
     `startWorkflowForRecord(params: { context: ModuleWorkflowContext; actor: WorkflowActor }): Promise<WorkflowRow | null>`
     in `netlify/functions/lib/workflow/service.ts`. **Read `ModuleWorkflowContext` and match it
     exactly** — do NOT copy the spec's §14.2 `context` object literally.
   - The workflow **adapter** interface: read `netlify/functions/lib/workflow/adapterRegistry.ts`
     and `hrAdapters.ts`. Register the attendance adapter the SAME way the existing HR adapters do
     (likely a `sourceStatusMap` + completion hook — NOT the spec's freehand
     `onWorkflowCompleted/onWorkflowRejected` object). One binding/version engine; adapters only
     sync source-record status on completion — no second approval authority.
   - Workflow **binding + template** must be seeded exactly like
     `supabase/migrations/20260711000000_workflow_hr_change_bindings.sql`: a `workflow_templates`
     row + a **PUBLISHED** `workflow_template_versions` v1 + a binding row in
     **`public.module_workflow_bindings`** (`module_key, workflow_type, trigger_event, template_id,
     template_version_id, scope_type, is_active, priority`). The engine THROWS if there's no
     published version. Timesheet workflow: `workflow_type='hr_timesheet_approval'`,
     `trigger_event='hr.timesheet.submitted'`, `module_key='hr_attendance'`.
   - The **null-binding fallback** in `submitTimesheet` (workflow == null → status 'approved') is
     correct and required — keep it.

4. **Migration numbering.** Highest existing is `20260730000000_profile_photo_approval.sql`.
   Use `20260731000000+`. **Run `ls supabase/migrations | sort | tail` and confirm the next free
   slot before finalizing.** Every migration ends with a trailing comment
   `-- After applying, run: NOTIFY pgrst, 'reload schema';`. **Migrations are operator-applied —
   do NOT run them yourself.** All new tables: RLS enabled + `service_role` grants +
   `set_updated_at` trigger where mutable (the function `public.set_updated_at()` already exists).

5. **Roles that exist** (`role_permissions.role_name` has a FK to `roles.name`): `employee`,
   `manager`, `admin`, `superadmin`, `hr_manager`, `hr_staff`, `hse_staff`. Granting to ANY other
   role name throws 23503. The spec's §8.2 grants use only existing roles — keep as written. Never
   invent `supervisor`/`finance_*`.

6. **Greenfield — legacy is untouched and unused.** Do NOT read/reuse the legacy `attendance`
   table, `netlify/functions/routes/attendance.ts`, legacy `attendance.*` permission keys, or
   `AttendanceDashboard`. Build fresh `hr_attendance_*`. (The legacy `getMyHistory`/`getMyLeaves`
   routes stay mounted for other consumers — don't touch them, don't build on them.)

7. **Leave defensive-read: the table is `hr_leave_requests`** with `from_date`/`to_date` and
   `status='approved'` (migration `20260718000000_hr_leave_tables.sql`). **Verify the exact
   employee-FK column name and status value** before relying on them; the helper already
   try/catches and returns `{isOnLeave:false}` on any error — keep that defensive shape so
   Attendance works even if Leave changes. Never duplicate leave data.

8. **Conventions (non-negotiable):** body is `(c.get('body') as Record<string,unknown>).args ?? {}`;
   envelope `c.json({ success:true, data })` / `{ success:false, message }` with the code passed as
   `200`; `requirePermission(c, key)` returns the actor; `userCan(actor, key)`; `app_users.id` is
   TEXT (all user FKs `text references public.app_users(id)`); `writeHrAudit({ submoduleKey,
   recordId, actorId, action, previousState, newState, reason })` (param is `previousState`, it
   THROWS on error); `emitAppEvent({ eventType, sourceModule, sourceEntityType, sourceEntityId,
   actorUserId, severity, payload })` (void, camelCase); `nextRef('TSH')` (arbitrary prefix).
   Where a mutation adds real value going through `runModuleMutation` (record→event→idempotency),
   use it — but do NOT wrap high-frequency punches in ceremony that never dedupes (no-band-aid).

9. **Permission drift-guard** `tests/unit/permissions.sync.test.ts` FAILS the build on any enforced
   key missing from ALL THREE catalogues: `netlify/functions/lib/permissions.ts` (PERMISSION_KEYS +
   role grant Sets), `src/lib/permissions.ts` (PERMISSION_KEYS + admin/superadmin/employee/manager
   Sets), `src/lib/permissionMeta.ts` (module/group/label/description/risk). Add every
   `hr.attendance.*` key to all three, plus the DB `role_permissions` grant migration (§8.2).

10. **Nav wiring:** add the `s-hr-attendance` nav item in the real HR nav item list
    (`src/components/sections/HR/module.ts`) and route it in `HRSection.tsx`, matching exactly how
    Leave / Transfers / HR Requests are wired. The spec's §22.9 object is illustrative — match the
    real nav-item type.

11. **Private storage bucket `hr-attendance-photos`** (NOT the legacy attendance bucket): create it
    + policies via migration, and presign uploads/reads with the CURRENT helpers (see
    `netlify/functions/lib/upload.ts` / the avatars presign pattern in `routes/settings.ts`).
    Signed URLs only; no public bucket; photo reads audited.

12. **NO BAND-AIDS (explicit user directive).** No accept-and-drop (don't accept inputs a feature
    doesn't honor), no FK to non-existent tables, no faked events/notifications, no ceremony, no
    swallowed DB errors (check every result, fail atomically / compensating-rollback). If something
    depends on a not-yet-built module (Finance Payroll, the rail), DEFER it with an explicit code
    comment — do NOT stub it.

13. **Verification gate (run at the END, once):** `npm run typecheck:frontend` +
    `npm run typecheck:backend` + `npm run build:backend` clean; `npm test` (incl. drift-guard +
    the `computeDay`/`computePeriod` unit tests) + `npx vitest run` green; then
    `npm run test:e2e -- hrAttendance` green **after** the operator applies the migrations +
    `NOTIFY pgrst` and the dev server is rebuilt/restarted (`dev:netlify` serves compiled `dist/`).
    229 frontend tests remain green. Report the operator-apply migration list at the end.

---

## Pasted spec (detailed design — apply §0 on top)

The full "Updated Implementation: HR Attendance & Timekeeping" spec follows. Build every section
EXCEPT where §0 defers/skips it (§5.5, §17, §18, §19, and the Finance-Payroll items in §25/§27).

### 1. Position in the module tree
```
HR
├─ Employee Master
├─ Leave & Absence
├─ Attendance & Timekeeping
├─ Compensation Inputs
├─ Overtime Review
└─ HR Requests
```
Attendance provides verified work-time inputs (regular/overtime minutes, exceptions, approved
timesheets). It does not calculate payroll. Chain: Punch → Compute Engine → Exceptions + Timesheet
→ Manager Approval → Approved Timesheet → (later) Finance Payroll.

### 2. Ownership
HR Attendance owns: check-in/out, geo/photo punch evidence, daily records, computed
worked/late/overtime minutes, exceptions, corrections, timesheets, manager approval queue,
attendance policy settings. Leave owns approved leave periods/reasons/balances/approval — Attendance
**defensively reads** approved leave to suppress false absence exceptions; it must not duplicate
leave data or hard-depend on Leave tables.

### 3. Module registry entry (metadata only — NOT the deferred rail registry table)
```
{ moduleKey:'hr_attendance', label:'Attendance & Timekeeping', parentArea:'HR',
  recordTypes:['attendance_record','attendance_exception','timesheet','attendance_correction'],
  viewPermission:'hr.attendance.view', createPermission:'hr.attendance.punch',
  managePermission:'hr.attendance.correct', approvePermission:'hr.attendance.timesheets.approve',
  exportPermission:'hr.attendance.reports.export', supportsWorkflow:true, supportsMessages:true,
  supportsTickets:true, supportsAttachments:true, supportsReports:true }
```
(messages/tickets are supported *capabilities* for the future rail — do NOT build them now, §0.2.)

### 4. Migrations (use §0.4 numbering — `20260731000000+`, confirm free)
```
_hr_attendance_core.sql          (tables 5.1–5.4 ONLY; NOT 5.5)
_hr_attendance_permissions.sql   (§8 keys + grants)
_workflow_hr_attendance_binding.sql (template + published v1 + module_workflow_bindings row)
_hr_attendance_storage_policies.sql (hr-attendance-photos private bucket + policies)
_hr_attendance_settings.sql      (§7 policy defaults if seeded in DB; else via manifest)
```

### 5. Database model
Build tables **5.1 `hr_attendance_records`**, **5.2 `hr_timesheets`**,
**5.3 `hr_attendance_exceptions`**, **5.4 `hr_attendance_corrections`** exactly as specified in the
pasted design (raw punch + computed day; periodised timesheet with `workflow_id uuid references
public.workflow_instances(id)`; computed exceptions; audit-friendly correction log). Columns
`worked_minutes/late_minutes/overtime_minutes/status` are **computed only** (never hand-maintained)
via `computeDay`/`computePeriod`. **DO NOT build 5.5 `hr_timesheet_payroll_links` (§0.1).**

### 6. Compute engine — `netlify/functions/lib/hr/timekeepingCompute.ts`
Implement pure `computeDay({ record, policy, approvedLeave })` and `computePeriod(records[])` plus
`roundMinutes`/`shiftStartForDate` helpers exactly as in the pasted design. **Pure + unit-tested**
(jest/vitest): late exception, short-hours, absent, over-hours, missing-punch, on-leave, rounding,
period rollup. No side effects in these two functions.

### 7. Attendance policy settings
Create `src/lib/settings/manifests/hrAttendance.manifest.ts` (keys: `hr_attendance.enabled`,
`shift_start`, `grace_minutes`, `standard_day_minutes`, `overtime_threshold_minutes`,
`rounding_minutes`, `workweek`, `geofence_radius_m`, `pay_period`) and register it in
`src/lib/settings/manifests/index.ts`. Resolve values with the existing settings resolver
(`resolveSettingValue`) — never hardcode policy.

### 8. Permissions — add ALL keys to the THREE catalogues + DB grants (§0.9)
Keys: `hr.attendance.{view, view_all, punch, correct}`,
`hr.attendance.timesheets.{view, submit, approve}`,
`hr.attendance.exceptions.{view, manage}`, `hr.attendance.compute.run`,
`hr.attendance.policy.manage`, `hr.attendance.reports.{view, export}`.
DB grants exactly per the pasted §8.2 (employee/manager/hr_staff/hr_manager/admin/superadmin — all
existing roles; `on conflict do nothing`; column `role_name`).

### 9. Backend files
`lib/hr/timekeepingCompute.ts`, `attendanceCapture.ts`, `attendanceExceptions.ts`,
`timesheetService.ts`, `attendanceCorrections.ts`, `attendanceQueries.ts`, `attendanceReports.ts`,
`workflow/adapters/hrAttendanceAdapter.ts` (or register in `hrAdapters.ts` per §0.3),
`routes/hrAttendance.ts`. Mount at `/api/hr/attendance` in `netlify/functions/api.ts`.

### 10–14. Services
- **Leave reconciliation** (`findApprovedLeaveForDate`) — defensive read of `hr_leave_requests`
  (§0.7); approved leave → `status:'on_leave'`, suppress absent exception; degrades if Leave absent.
- **Capture** (`punchIn`/`punchOut`/geofence `distanceMeters`) — validate geofence against
  `project_sites` coords; store photo paths via the `hr-attendance-photos` presign; upsert on
  `(employee_id, work_date)`; then `recomputeAttendanceDay`.
- **Recompute** (`recomputeAttendanceDay`) — load record + policy + approvedLeave → `computeDay` →
  update record's computed fields → delete open exceptions for the record → upsert new ones.
- **Timesheet** (`buildTimesheet`/`submitTimesheet`) — build rolls up `computePeriod` over the
  period's records, `nextRef('TSH')`, upsert on `(employee_id, period_start, period_end)`, link open
  exceptions; submit self-scopes (own OR `view_all`), starts the central workflow (§0.3) with the
  null-binding fallback, writes `hr_audit_log`.
- **Corrections** (`applyCorrection`) — update the record field, write `hr_attendance_corrections`,
  write `hr_audit_log` (`previousState`), recompute the day. Check every DB result (no swallow).

### 15. Workflow adapter — per §0.3 (status sync + audit + event ONLY; NO message post)
On approval: timesheet → `approved`, `approved_by`/`approved_at`, audit, emit
`hr.timesheet.approved`. On rejection: `rejected` + note, audit, emit `hr.timesheet.rejected`.

### 16. Routes (`routes/hrAttendance.ts`) + permission map
Build the full route map from the pasted §16.1/§16.2 (punch in/out/upload-url; record list/get;
correction apply; exceptions list/waive/resolve; timesheet list/get/build/submit/approve/reject/
reopen; compute run; live/daily-log/stats; policy get; reports list/run/export) with the exact
permission gates in §16.2 (self-vs-view_all scoping on record/timesheet get/list).

### 17. Finance Payroll integration — **SKIP (§0.1).**

### 18. Message Center — **SKIP (§0.2).**
### 19. Tickets — **SKIP (§0.2).**

### 20. Notifications (real platform only, §0.2)
Emit the pasted event set via `emitAppEvent` (punched_in/out, exception opened/waived/resolved,
correction applied, timesheet built/submitted/approved/rejected/reopened, compute completed). Wire
recipients only through the real `notify.ts`/`recipientResolver` if done; otherwise emit the
app_event and stop — never fake delivery.

### 21. Reports (`attendanceReports.ts`)
Implement the pasted report set (Daily Log, Late Arrival, Absence, Missing Punch, Overtime,
Exception Aging, Correction Audit, Timesheet Approval Aging, Geofence Violation, Attendance by
Dept/Site, Leave-Reconciled Absence). (Drop "Payroll Attendance Feed Report" — depends on Finance,
§0.1.) Follow the existing reports result contract.

### 22. Frontend — functional-only (`.obx-*` + `@ui` + `@lib/dialog`; NO widget board)
`src/components/sections/HR/AttendanceOverview.tsx` (surfaces: Daily Log, Timesheets, Exceptions,
Live, Reports — `PageHeader` + plain stat row + surface tabs + table/detail + dialogs), plus the
simple employee punch control (check-in/out + photo + geo + site-validation + current-day status).
Loading: `placeholderData` + gate `loading={isLoading && !data}`; never `window.*` — use
`@lib/dialog`. Nav item `s-hr-attendance` (§0.10).

### 23. Shared types — `types/hrAttendance.ts`
The camelCase DTOs from the pasted §23 (`AttendanceRecord`, `Timesheet`, `AttendanceException`,
`DayComputeResult`, `AttendanceStats`, status/type unions). ONE shared DTO imported by BE + FE.

### 24. API hooks — `src/api/hr/attendance.ts`
`hrAttendanceKeys` under `['hr','attendance', …]`; TanStack hooks; mutations invalidate
`['hr','attendance']`. (Drop the `['finance','payroll']` invalidation — §0.1.)

### 25. E2E — `scripts/e2e/suites/hrAttendance.mjs`
Cover: seed records; compute produces late/short-hours/absent exceptions; approved leave suppresses
absent; correction recomputes day; timesheet build rolls up minutes; submit starts workflow OR
direct-approve fallback; manager approves dept-scoped timesheet; non-dept manager DENIED; waive +
resolve exception; app_events + hr_audit_log written; cleanup via `h.TAG`.
(**Drop** Message-Center-thread, ticket, and Finance-Payroll assertions — §0.1/§0.2.)

### 26–27. Gate + Definition of Done — per §0.13.
Done when: greenfield `hr_attendance_*` exist; legacy untouched/unused; punch capture with geo +
photo + geofence works; daily records compute status/hours/exceptions; `computeDay`/`computePeriod`
pure + unit-tested; approved leave suppresses absent; corrections audited + recompute; timesheets
build + approve through the central workflow with null-binding fallback; exceptions waive/resolve;
functional `AttendanceOverview` nav-wired; `hrAttendance.mjs` green; full gate green;
migrations listed for operator apply. (Rail + Finance items are explicitly out of scope.)
