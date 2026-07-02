# HR Leave & Absence — Implementation Brief (for Codex)

**Module:** HR sub-module #5 — Leave & Absence
**Goal:** Build a **greenfield** enterprise Leave & Absence module: leave **types + policies**, a
**balances / accruals** engine, **approvals on the central workflow engine**, **attachments** (e.g.
medical certificates), a **team leave calendar**, and HR-manager balance/approval views.

> ⛔ **The old leave code is OUT OF SCOPE.** Do NOT read, reuse, extend, or migrate the legacy
> `leave_requests` table or `netlify/functions/routes/leaves.ts` or the legacy `leaves.*` permissions.
> This is a fresh `hr_leave_*` domain. "Reuse" below refers ONLY to the current shared **platform**
> (workflow engine, events, audit, settings, presign, `@ui`, Organization Structure) — that is the
> enterprise backbone, not legacy.

> Read `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` (canonical conventions) + `CLAUDE.md`
> (No-Band-Aids). Where this brief and any generated plan disagree, this brief wins (verified against code).

**Frontend scope (current mandate):** **functional-only** — plain `.obx-*` tables/forms + `@ui`. No
widget board / registry KPI tiles (the user adds per-page widgets later). `@lib/dialog` for
confirms/prompts/toasts (never `window.*`).

---

## 0. Conventions (do not deviate — verified against the codebase)
- Envelope: `c.json({ success: true, data })` / `c.json({ success: false, message }, code as 200)`.
- Request body: `const args = (c.get('body') as Record<string, unknown>).args ?? {}`.
- Auth: `requirePermission(c, key)` returns the `AppUser` (incl. `role`); `requireUser(c)`.
- `app_users.id` is **TEXT**; every user FK is `text references public.app_users(id)`.
- Shared **camelCase** DTOs in `types/hrLeave.ts`, imported BE + FE — no per-endpoint mappers.
- Mutations: business write → `emitAppEvent` (fire-and-forget `void`) → `writeHrAudit` (awaited; throws). `writeHrAudit`'s field is **`previousState`** (NOT `oldState`).
- Approvals: central workflow via **`startWorkflowForRecord({ context, actor })`** resolving a **binding** — NOT hardcoded template keys (§6.3). `role_permissions` grant column is **`role_name`**.
- `nextRef(prefix)` accepts arbitrary prefixes — use **`LVR`** for leave request refs.

## 0b. Platform to REUSE (current backbone — NOT legacy)
`emitAppEvent` (`lib/appEvents`), `writeHrAudit` (`lib/hr/employeeCore`), `nextRef` (`lib/refGenerator`),
`resolveSettingValue` + the settings-manifest catalog, the **central workflow engine**
(`startWorkflowForRecord`, `module_workflow_bindings`, the adapter registry — study the
`hr_org_structure` / `hr_employee_master` adapters for the apply-on-approval pattern), the attachment
presign flow (`createAttachmentUploadUrl` in `lib/upload`, `getSignedUrl` in `lib/photos`), the
orchestration timeline, `runModuleMutation` (`lib/moduleServiceAdapter`) for idempotent creates,
`@ui`, and the Organization Structure data (`departments` tree, `hr_positions`, cost centres) +
`app_users` (`department_id`, `supervisor_id`, `role`, `employment_type`).

---

## 1. Data model — new `hr_leave_*` tables (migrations, operator-applied + NOTIFY pgrst)
Number `20260718000000+` (confirm the highest existing first — onboarding …16, org `20260715*`,
hr-docs `20260716*`, offboarding `20260717*`). Each migration ends with
`-- After applying: NOTIFY pgrst, 'reload schema';`. Every PK `uuid default gen_random_uuid()` unless
noted; RLS enabled + `grant … to service_role`; `set_updated_at` triggers on mutable tables.

- **`hr_leave_types`** — `code` text unique, `label`, `paid` boolean, `unit` text check ('days','hours')
  default 'days', `requires_attachment` boolean, `requires_approval` boolean default true,
  `accrual_rate` numeric, `accrual_cadence` text check ('none','monthly','annual') default 'annual',
  `max_carryover` numeric, `applies_to_scope` text check ('all','role','employment_type','department')
  default 'all', `applies_to_value` text, `color` text, `is_active` boolean default true, timestamps.
- **`hr_leave_requests`** — `case_no` text unique (prefix **LVR** via `nextRef`), `employee_id` text FK,
  `leave_type_id` uuid FK, `from_date` date, `to_date` date, `unit` text ('days','hours') default 'days',
  `days` numeric, `hours` numeric, `half_day` boolean default false, `reason` text, `status` text check
  ('draft','pending_approval','approved','rejected','cancelled') default 'pending_approval',
  `workflow_id` uuid references workflow_instances(id) on delete set null, `department_id` text,
  `reviewed_by` text FK, `reviewed_at` timestamptz, `review_notes` text, `applied_at` timestamptz default now(),
  `cancelled_by`/`cancelled_at`, `metadata` jsonb.
- **`hr_leave_balances`** — `employee_id` text FK, `leave_type_id` uuid FK, `year` int, `entitled`
  numeric, `accrued` numeric, `taken` numeric, `pending` numeric, `adjustment` numeric,
  `unique(employee_id, leave_type_id, year)`.
- **`hr_leave_accruals`** — append-only ledger: `employee_id`, `leave_type_id`, `year`, `delta` numeric,
  `kind` text check ('accrual','deduction','release','adjustment'), `source_request_id` uuid, `note`,
  `created_by`, `created_at`.
- **`hr_leave_attachments`** — `request_id` uuid FK, `file_path`, `file_name`, `mime_type`,
  `uploaded_by`, `uploaded_at` (presigned upload; private bucket, signed URL on read).
- **Seed migration** — default leave types (Annual, Sick, Unpaid, Maternity, Paternity, Bereavement)
  with sensible accrual policies. No data migration from legacy (greenfield).
- **Permission grants** migration (§4) + **workflow template + published version + binding** (§6.3).

## 2. Architecture decisions (No-Band-Aids)
- **Greenfield domain** — `hr_leave_requests` is the request record; nothing touches `leave_requests`.
- **Balances are ledgered + snapshotted** — `hr_leave_accruals` is the append-only source of truth
  (accrual +, approved leave −, release +, adjustment ±); `hr_leave_balances` is the recomputed
  snapshot. Never let the snapshot drift silently; recompute from the ledger.
- **Approval = the ONE central workflow engine** — submit starts a workflow via a **binding**; a
  registered **`hr_leave` adapter** applies the decision on completion (sets status + deducts/releases
  balance). No second approval authority. **Null binding → direct-approve fallback** (approval is
  opt-in via binding config), mirroring the Organization Structure module.
- **Validation at submit** — min-notice (policy), overlapping-request check, sufficient balance
  (unless `allow_negative_balance`), type applies-to the employee. Deduct `pending` on submit; move
  `pending → taken` on approval; release on reject/cancel.
- **Attachments** via the presign flow (reuse `lib/upload`/`lib/photos`), gated by permission.

## 3. Backend — lib + routes
### 3.1 Lib (`netlify/functions/lib/hr/leave*.ts`)
`leaveCore.ts` (`submitLeaveRequest` → validate + `runModuleMutation` idempotent insert + start
workflow + event + audit), `leaveQueries.ts` (my/team/all dept-scoped, get, dashboard stats, calendar
range, balances), `leaveMutations.ts` (update/cancel own, direct approve/reject fallback, adjust
balance), `leaveTypes.ts` (type CRUD), `leaveAccruals.ts` (`runAccruals(period)` service-role → ledger
+ snapshot recompute), `leaveReports.ts`. Compose the platform; don't re-implement it.
### 3.2 Routes (new `netlify/functions/routes/hrLeave.ts` mounted `/api/hr/leave` in `api.ts`)
`request/submit|list|list-all|get|update|cancel|approve|reject`, `request/upload-url` + `request/attach`,
`types/list|create|update|retire`, `balances/get`, `balances/adjust`, `accruals/run` (service-role),
`calendar/get`, `reports/list|run|export`.
### 3.3 Approval wiring (LOCKED engine)
`startWorkflowForRecord({ context:{ moduleKey:'hr_leave', workflowType:'hr_leave_approval',
triggerEvent:'hr.leave.requested', sourceRecordId:request.id, sourceRecordRef:caseNo,
requestedBy:actor.id, departmentId, recordData:{…} }, actor:{ id: actor.id } })` → `WorkflowRow|null`.
Register an `hr_leave` adapter (`registerWorkflowAdapter`): `onWorkflowCompleted` → status `approved`
+ balance deduction (ledger `deduction` + snapshot); `onWorkflowRejected` → `rejected` + release.
Null binding → direct-approve. Seed template + **published version** (required, else the call throws)
+ one binding on the trigger event (mirror `20260711000000_workflow_hr_change_bindings.sql`).

## 4. Permissions — `hr.leave.*` (catalogue in ALL 4 places or the drift-guard fails)
`view` (own), `view_all`, `submit`, `cancel_own`, `approve`, `manage`, `types.manage`,
`balances.view`, `balances.adjust`, `accruals.run`, `calendar.view`, `reports.view`, `reports.export`.
Add to `netlify/functions/lib/permissions.ts` + `src/lib/permissions.ts` PERMISSION_KEYS +
admin/superadmin Sets + `src/lib/permissionMeta.ts` (group 'Leave'). Grants (migration, **`role_name`**):
`employee` → view/submit/cancel_own/balances.view(own)/calendar.view; `manager` → +view_all/approve
(dept-scoped); `hr_manager`/`admin`/`superadmin` → all; `hr_staff` → execution keys (not types.manage /
balances.adjust / accruals.run / reports.export).

## 5. Settings manifest `hrLeave.manifest.ts` (register in `manifests/index.ts`)
`hr_leave.enabled`, `hr_leave.accrual_cadence`, `hr_leave.default_carryover_cap`,
`hr_leave.min_notice_days`, `hr_leave.allow_negative_balance`, `hr_leave.blackout_dates`.

## 6. Types + hooks
`types/hrLeave.ts` (LeaveType, LeaveRequest, LeaveBalance, LeaveCalendarEntry, LeaveStats, args).
`src/api/hr/leave.ts` (`call()` throws on `success:false`; keys `['hr','leave',…]`; `useLeaveMutation`
invalidates `['hr','leave']`; gated approve returns applied|pendingApproval union → union toast).

## 7. Frontend — functional-only (`src/components/sections/HR/`)
`LeaveOverview.tsx` (header + plain stat row + `surface` enum: My Requests / Team / Balances / Types /
Calendar / Reports) + submit modal (type picker shows remaining balance; range; half-day; reason;
attachment), approval queue (approve/reject; union toast applied vs submitted-for-approval), balances
table, types admin, a simple month calendar. Nav item `s-hr-leave` in `module.ts` + route in
`HRSection.tsx`.

## 8. E2E `scripts/e2e/suites/hrLeave.mjs`
Submit (balance-validated) → workflow created (if binding) / direct-approve (if not) → balance
deducted; reject/cancel releases; min-notice + insufficient-balance + overlap rejections; accrual run
adds ledger + updates snapshot; types CRUD; calendar range; dept-scoped approver allowed / non-dept
denied; §2 side-effects (app_events + hr_audit_log, polled with a local `waitFor`); **real provisioned**
users (roles resolve from `app_users`). Cleanup via `h.TAG`.

## 9. Verification gate + migrations
`typecheck:frontend`+`typecheck:backend`+`build:backend` clean; `npm test`+`npx vitest run` green
(drift-guard + settings-manifest gate); `npm run test:e2e -- hrLeave` after migrations + `NOTIFY pgrst`.
List every migration file in apply order.

## 10. Definition of done
Greenfield typed leave with policies; balances/accruals ledgered (no drift); approvals on the central
engine (binding + adapter, null fallback); attachments via presign; team calendar; functional-only UI
nav-wired; `hrLeave.mjs` + full gate green. No band-aids, and **nothing from the legacy leave code**.

## §0 Corrections — DO NOT copy these wrong patterns
| Wrong | Correct |
|---|---|
| touching / extending `leave_requests` or `leaves.ts` | **greenfield `hr_leave_*`; legacy is out of scope** |
| `role_permissions (role, permission)` | column is **`role_name`** |
| `writeHrAudit({ oldState })` | **`previousState`** |
| hardcoded workflow `templateKey` routing | **`startWorkflowForRecord` + binding** (published version required) |
| new enforced key granted only in DB | also add to `permissions.ts` ×2 + `permissionMeta.ts` (drift-guard) |
| balances maintained ad-hoc | ledger (`hr_leave_accruals`) + recomputed snapshot |

## §0.1 CORRECTIONS to the pasted "HR Leave — Technical Implementation" Codex plan
That plan's **domain design is good — adopt it** (the `pending_reserve` ledger kind, per-entry
`idempotency_key`, recompute-from-ledger, reports list, notification events, overlap/min-notice/
balance validation). But its **code uses APIs that DO NOT EXIST here.** Translate every one:

| Pasted plan (WRONG / fictional) | Real SIOMAC pattern (use this) |
|---|---|
| `references public.employees(id)` | **`references public.app_users(id)`** — there is NO `employees` table |
| `db.query(...)` / `db.one` / `db.transaction(tx => …)` / `tx.insert` / `db.upsert` | the **`sb`** supabase-js client (`sb.from('…').insert/update/select`). **supabase-js has NO app-layer transactions** (CLAUDE.md pitfall) — see the atomicity note below |
| `runModuleMutation({ db, moduleKey, mutationKey, run })` | real signature: `runModuleMutation({ context:{ actorUserId }, options:{ module, operation, entityType, idempotencyKey, eventType, eventSeverity, getEntityIdentity, buildEventPayload }, writeRecord: async () => {…} })` |
| `publishAppEvent(db, {…})` | **`emitAppEvent({ eventType, sourceModule:'hr', sourceEntityType, sourceEntityId, actorUserId, severity, payload })`** (fire-and-forget `void`) |
| `writeHrAudit(db, { entityType, entityId, previousState, nextState })` | **`writeHrAudit({ submoduleKey:'leave', recordId, actorId, action, previousState, newState })`** — field is `newState` (NOT `nextState`), no `db` arg, awaited (throws) |
| `nextRef(db, 'LVR')` | **`nextRef('LVR')`** (no db arg) |
| `requirePermission(actor, key)` inside a lib | permission checks live in the **route**: `const actor = await requirePermission(c, 'hr.leave.submit')`, then pass `actor` (id+role) to the lib |
| `startWorkflowForRecord` adapter `registerWorkflowAdapter('hr_leave', { onWorkflowCompleted({db,workflow,actor}) })` | real `ModuleWorkflowAdapter` object `{ moduleKey:'hr_leave', buildWorkflowContext, onWorkflowStarted, onWorkflowStepCompleted, onWorkflowCompleted({workflowId,sourceRecordId,finalDecision}), onWorkflowReturned, onWorkflowRejected, onWorkflowCancelled }` registered via `registerWorkflowAdapter(adapter)` in `lib/workflow/hrAdapters.ts`; the **approver is NOT passed** — resolve it via `decidedBy(workflowId)` reading `workflow_decisions` (copy the `hr_org_structure` adapter). |
| `hrLeaveRoute(event,context)` + `switch(path)` + `router.mount` | **Hono**: `const router = new Hono(); router.post('/request/submit', async c => { const actor = await requirePermission(c,'…'); const v = zv(c, Schema, (c.get('body') as any).args ?? {}); … })`; mount `app.route('/api/hr/leave', hrLeaveRouter)` in `api.ts`. Reply `c.json({ success:true, data })`. |
| frontend `@tanstack/react-query` + raw `fetch('/api/hr/leave/…')` + `json.error` | **`@tanstack/preact-query`** + **`apiPost`** (`@lib/api`, wraps body as `{ args }`); a `call<T>()` that throws on `success:false` reading `res.message`; components use **`@ui`** (PageHeader/Modal/Tabs/Field) + **`@lib/dialog`** for toasts (never raw HTML/`window.*`) |
| migrations `20260712000100…` | those numbers are **older** than existing migrations → out of order. Use **`20260718000000+`** (confirm the highest first). |

**Atomicity (critical):** the ledger multi-write (reserve / release / deduction) **cannot** be a JS
transaction. The pasted design already solves this with a **unique `idempotency_key` per accrual
row** — so do each `sb.from('hr_leave_accruals').insert(...)` as its own idempotent write (a retry
`on conflict (idempotency_key) do nothing`), then recompute the `hr_leave_balances` snapshot from the
ledger. No `tx` needed. Add `idempotency_key text unique` + the `pending_reserve` kind to
`hr_leave_accruals` (both are improvements over §1 above — adopt them).
