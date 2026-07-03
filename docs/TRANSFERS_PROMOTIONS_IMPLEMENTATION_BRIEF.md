# HR Transfers & Promotions — Implementation Brief (for Codex)

**Module:** HR sub-module #14 — Transfers & Promotions
**Goal:** Let HR bundle a **dept + site + position + supervisor + role (promotion) + compensation** change
into **one effective-dated request** that goes through the existing maker-checker + central workflow
approval, and — on approval — applies all the bundled field changes atomically to the employee (with
assignment history). This is a **thin wrapper over machinery that already exists**, not a new engine.

> Read `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` FIRST — the canonical statement of the conventions
> every HR sub-module follows (response envelope `c.json({success,data})` / `{success:false,message}` with
> code as `200`; request body is `(c.get('body') as Record<string,unknown>).args ?? {}`; `app_users.id` is
> TEXT; permission model; mutation side-effects; camelCase shared DTO; no URL router; test cadence). This
> brief does not repeat those. Also read `CLAUDE.md` (No-Band-Aids + Known Pitfalls) — several decisions
> below exist *because* of those rules.

**Frontend scope (current mandate):** **functional-only** pages. Do **NOT** build any widget board /
registry KPI-tile widgets. Plain `.obx-*` tables/forms + `@ui` (see `OffboardingOverview.tsx` for the exact
house style). The user adds per-page widgets later.

---

## 0. TL;DR — what to build

1. **Extend the existing change-request flow** with ONE new `change_type`: `'transfer_promotion'`
   (`netlify/functions/lib/hr/changeApproval.ts`). No new envelope table — `hr_employee_change_requests`
   already IS the maker-checker envelope and the central workflow engine already drives its approval.
2. **New `applyChange` branch** (`transfer_promotion`) that patches whichever of dept/site/position/
   supervisor/role/salary are present + reuses the `hr_employee_assignments` close/reopen pattern, stamped
   with the request's `effectiveDate`.
3. **Two thin routes** (`netlify/functions/routes/hr.ts` or a small `routes/hrTransfers.ts`):
   `/transfers/request` (scoped submit → calls the existing `createChangeRequest`) and `/transfers/list`.
   **Reuse the existing generic `/employee-change-requests/decide` and `/cancel`** — they already route by
   `change_type` via `CHANGE_PERM`; do not reimplement them.
4. **Permissions** `hr.transfers.*` (view/request/approve/cancel) in all FOUR catalogue places + a grant
   migration (`role_name` column).
5. **Workflow binding** for `hr.employee.transfer_promotion` (mirror `20260711000000_workflow_hr_change_bindings.sql`).
6. **Types** `types/hrTransfers.ts` + **hooks** `src/api/hr/transfers.ts`.
7. **Frontend** `src/components/sections/HR/TransfersOverview.tsx` (functional-only) + nav `s-hr-transfers`
   + routing in `HRSection.tsx`.
8. **E2E** `scripts/e2e/suites/hrTransfers.mjs`.

---

## 1. Current state — the spine you reuse (verified in-repo; build ON this, do NOT fork)

Everything below already exists and is the exact machinery a transfer/promotion request rides.

### 1.1 The envelope table — `hr_employee_change_requests`
Generic maker-checker envelope: `id uuid, change_no text, employee_id text, change_type text,
requested_value jsonb, previous_value jsonb, status text ('submitted'|'in_review'|'returned'|'applied'|
'rejected'|'cancelled'), workflow_id uuid → workflow_instances, requested_by text, decided_at, applied_at,
metadata jsonb`. **Reuse it as-is** — a transfer/promotion is just a change request whose `requested_value`
bundles several fields.

### 1.2 `netlify/functions/lib/hr/changeApproval.ts`
- `export const CHANGE_TYPES = ['status_change','department_transfer','site_transfer','supervisor_change',
  'role_change','employment_type_change','contact_update'] as const;` — **you add `'transfer_promotion'`.**
- `applyChange(req, actorId)` — a `switch (req.change_type)` that mutates `app_users` (+ satellite rows).
  Study the existing `department_transfer`/`site_transfer` case: it patches `app_users.department_id`/
  `site_id`, closes the current `hr_employee_assignments` row (`is_current=false, effective_to=todayISO()`)
  and inserts a new `is_current=true` row. **You add a `transfer_promotion` case** doing the bundled version.
- `applyApprovedChange(crId, actorId)` — loads the CR, calls `applyChange`, sets status `applied`, writes
  audit + emits event. **Idempotent** (returns early if already `applied`). Your new `applyChange` case is
  invoked automatically through this — no new apply plumbing needed.
- `markChangeRequestStatus(crId, status, actorId, comment)` — in_review/returned/rejected/cancelled.

### 1.3 The submit helper — `createChangeRequest(actor, p)` (in `routes/hr.ts` ~line 1026)
Does the whole standard flow: `runModuleMutation` (idempotency key derived from
`actor:employee:changeType:JSON(requestedValue)`), `nextRef('HRC')` for `change_no`, inserts the CR with
`status:'submitted'`, writes `hr_audit_log`, then **starts the central workflow** via
`startWorkflowForRecord({ context: { moduleKey:'hr_employee_master', workflowType:'hr_change_approval',
triggerEvent:'hr.employee.'+changeType, sourceRecordId, sourceRecordRef, requestedBy, departmentId, siteId,
recordData }, actor:{id} })` and stores `workflow_id`. **Reuse this verbatim** for transfer_promotion — pass
`changeType:'transfer_promotion'`; the binding you seed (§6) routes `hr.employee.transfer_promotion`.

### 1.4 `CHANGE_PERM` + `snapshotForChange` (in `routes/hr.ts` ~line 1000-1019)
- `CHANGE_PERM: Record<ChangeType,string>` — maps a change_type → the permission the **checker** must hold
  to decide it (e.g. `department_transfer → 'hr.employees.transfer'`). **You add
  `transfer_promotion → 'hr.transfers.approve'`** (a single approve key; a bundle can include role+salary,
  so it needs its own oversight gate).
- `snapshotForChange(changeType, emp)` — captures `previous_value`. **You add a `transfer_promotion` case**
  returning the current `{ department_id, site_id, position_id, supervisor_id, role, monthly_salary,
  hourly_rate, pay_basis }` so the CR records the true before-state.

### 1.5 The generic decide / list / cancel routes (REUSE — do not duplicate)
- `POST /api/hr/employee-change-requests/decide` — `requireUser` then enforces `CHANGE_PERM[change_type]`;
  if `workflow_id` set → delegates to `decideTask` (the engine adapter applies), else falls back to
  `applyApprovedChange` / `markChangeRequestStatus`. **Because it routes by `CHANGE_PERM`, once you add the
  `transfer_promotion → hr.transfers.approve` entry, this route already handles approving your requests.**
  Report the TRUE post-decision status (single-step completes → `applied`; multi-step → `in_review`).
- `POST /api/hr/employee-change-requests/list` — filter by status/employee.
- `POST /api/hr/employee-change-requests/cancel` — requester (or approver) cancels a non-terminal request.

You MAY add transfer-scoped `/transfers/list` (a filtered view, `change_type='transfer_promotion'`) for the
page and a `/transfers/decide` thin passthrough if you want a transfers-scoped audit label — but do NOT
reimplement the decide logic; call the same lib functions / engine.

### 1.6 The workflow engine (LOCKED — one binding/version engine, ONE approval authority)
- `startWorkflowForRecord({ context, actor }): Promise<WorkflowRow | null>` — resolves the active **binding**
  for `(moduleKey, workflowType, triggerEvent)`; returns `null` if no binding (then the CR stays a plain
  maker-checker request the fallback path decides). Routing lives in **bindings**, not code.
- Binding seed pattern: `supabase/migrations/20260711000000_workflow_hr_change_bindings.sql` seeds ONE
  global binding per change type → template `hr_change_approval` (moduleKey `hr_employee_master`). The
  engine resolves a **PUBLISHED version only** and throws if none exists.
- The `hr_employee_master` workflow **adapter** applies the approved change on completion (calls
  `applyApprovedChange`) — so a transfer_promotion routed to that same template/adapter is applied by the
  existing adapter with zero new adapter code, because the adapter just calls `applyApprovedChange` which
  calls your new `applyChange` case. **Confirm** the existing binding's `workflowType`/template covers a new
  trigger event by adding a binding row for `hr.employee.transfer_promotion` pointing at the SAME
  `hr_change_approval` template (single HR-manager approval step) — reuse the template, add the binding.

### 1.7 `app_users` compensation columns (already real)
`monthly_salary numeric(12,2)`, `hourly_rate numeric(12,2)`, `pay_basis text ('hourly'|'salary')`
(`20260510190000_add_payroll_fields_to_app_users.sql`). Plus `department_id text`, `site_id text`,
`position_id uuid → hr_positions`, `supervisor_id text → app_users`, `role text`. These are the fields a
transfer/promotion patches.

---

## 2. What is genuinely NEW (the gap)

| Area | Exists | New work |
|---|---|---|
| Bundled change | one field per change_type | ONE `transfer_promotion` request carrying any subset of dept/site/position/supervisor/role/salary + a mandatory `effectiveDate` |
| Apply | per-type switch cases | a `transfer_promotion` case that patches present fields + one assignment-history row stamped `effectiveDate` |
| Scoped submit | generic `/employees/change-request` (hr.view) | `/transfers/request` gated by `hr.transfers.request` |
| Permissions | `hr.employees.transfer/role_change/...` | `hr.transfers.view/request/approve/cancel` |
| Page | none | Transfers & Promotions page (submit + list + decide) functional-only |
| E2E | none | `hrTransfers.mjs` |

---

## 3. Architecture decisions (No-Band-Aids — do NOT “fix” by forking)

### 3.1 It is a `change_type`, NOT a new table.
`hr_employee_change_requests` already is the envelope + has the workflow lifecycle wired. A new
`hr_transfer_requests` table would be a dual maker-checker system (band-aid). Add `transfer_promotion` to
`CHANGE_TYPES` and ride the existing flow. `requested_value` (jsonb) holds the bundle:
`{ departmentId?, siteId?, positionId?, supervisorId?, role?, monthlySalary?, hourlyRate?, effectiveDate,
reason }` — at least one *changed* field required (validate this).

### 3.2 Effective-dating — NO scheduler infra exists; apply at approval, stamp the date on the rows.
There is **no `netlify/functions/scheduled/` directory** in this repo (verified — the Org brief established
this). Do **not** invent a background job that applies future-dated transfers. On approval, `applyChange`
runs immediately and **stamps `effectiveDate`** on the `hr_employee_assignments` (`effective_from`) and any
history rows so the record is date-accurate. If — and only if — the business genuinely needs the
`app_users` columns to flip on a FUTURE date (not just be recorded as effective then), implement it exactly
like the Org module’s deferred path: a **service-role-only route** `POST /api/hr/transfers/apply-due` that
applies `approved` requests whose `effectiveDate <= now`, plus a **verified external trigger** (check
`netlify.toml`) — never a timer that isn’t wired. **Default: do NOT build the sweep** — approval applies now
and the effective date is recorded. State which you chose.

### 3.3 Compensation history — DECIDE; default is DO NOT build a new table.
A prior throwaway attempt invented `hr_employee_compensation_history` — **do not copy that.** We already have
three history surfaces: `hr_audit_log` (stores `previous_state`/`new_state` per action via `writeHrAudit`),
`app_events`, and the change-request row itself (`previous_value`/`requested_value` persist the exact
before/after salary). A queryable *compensation ledger over time* is a genuine need, but it is **Payroll’s**
(Item 11) concern, and Onboarding/Offboarding shipped enterprise-grade with **no** per-module history table.
**Default: do NOT add a comp-history table in this module** — the CR row + audit already capture every
salary change with its effective date and actor. Only build `hr_employee_compensation_history` if you can
name a report it serves that the audit log + CR rows cannot, and if you do, it belongs to Payroll, seeded
there. If unsure, STOP and leave a `-- TODO(payroll): comp ledger` and rely on audit.

### 3.4 One approval authority — the engine. Reuse the generic decide route.
Do **NOT** add a parallel approve/reject endpoint that applies the change independently. The transfer’s
approval is `CHANGE_PERM['transfer_promotion']`-gated inside the **existing** decide route, which either
delegates to `decideTask` (engine adapter applies) or falls back to `applyApprovedChange`. This preserves
“no dual approval authority” (a LOCKED rule).

### 3.5 Guard the generic submit route against the sensitive bundle.
The generic `POST /api/hr/employees/change-request` gates only on `hr.view` (managers may request simple
changes for their reports). A `transfer_promotion` bundles role + salary — it must **not** be submittable
through that low-gate route. Either (a) have `/employees/change-request` reject `changeType ===
'transfer_promotion'` with “use /transfers/request”, or (b) validate its enum against a subset excluding
`transfer_promotion`. The **only** entry point for a transfer_promotion request is `/transfers/request`
(gated `hr.transfers.request`). State which guard you used.

---

## 4. Migrations (new files, additive, operator-applied)

Max existing migration is `20260718000004`. **Use `20260719000000+`** and confirm no higher number exists
before finalizing. Every migration ends with a comment: `-- After applying, run: NOTIFY pgrst, 'reload schema';`

### 4.1 `20260719000000_hr_transfers_permissions.sql` — grants (column is `role_name`, NOT `role`)
```sql
insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.transfers.view'),('superadmin','hr.transfers.request'),('superadmin','hr.transfers.approve'),('superadmin','hr.transfers.cancel'),
  ('admin','hr.transfers.view'),('admin','hr.transfers.request'),('admin','hr.transfers.approve'),('admin','hr.transfers.cancel'),
  ('hr_manager','hr.transfers.view'),('hr_manager','hr.transfers.request'),('hr_manager','hr.transfers.approve'),('hr_manager','hr.transfers.cancel'),
  ('manager','hr.transfers.view'),('manager','hr.transfers.request'),          -- line managers request for reports; do NOT approve
  ('hr_staff','hr.transfers.view'),('hr_staff','hr.transfers.request')          -- execution tier: request/view, not approve
on conflict do nothing;
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```

### 4.2 `20260719000001_workflow_transfer_promotion_binding.sql` — one binding, reuse the existing template
Mirror `20260711000000_workflow_hr_change_bindings.sql` exactly. Add ONE global binding:
`module_key='hr_employee_master'`, `workflow_type='hr_change_approval'`, `trigger_event='hr.employee.transfer_promotion'`,
pointing at the **existing published** `hr_change_approval` template + its published version (look up the
template/version ids the same way that seed does). **Do not create a new template** unless the transfer
approval genuinely needs a different step config than the existing single HR-manager approval — reuse it.
If you must add a template, you MUST also insert a **published version** (the engine throws on none).
```
-- After applying, run:  NOTIFY pgrst, 'reload schema';
```
> There are NO structural table migrations for this module — `hr_employee_change_requests` already exists.
> If §3.2 you chose the (optional) deferred sweep, no table change is needed either; it reads `status`.

---

## 5. Permissions — exact edits (drift-guard fails the build if you miss one)

Add `hr.transfers.view`, `hr.transfers.request`, `hr.transfers.approve`, `hr.transfers.cancel` to **all four**:
1. `netlify/functions/lib/permissions.ts` → `PERMISSION_KEYS` (near the `hr.employees.*` block).
2. `src/lib/permissions.ts` → `PERMISSION_KEYS` **and** the `admin` Set + `superadmin` Set (grant all four);
   add `view`/`request` to the `manager` Set.
3. `src/lib/permissionMeta.ts` → a group `'Transfers'` (or reuse `'Employees'`) with label/description/risk
   (`approve` = high, `request` = medium, `view` = low).
4. DB grants: migration §4.1.

`CHANGE_PERM['transfer_promotion'] = 'hr.transfers.approve'` (in `routes/hr.ts`). Confirm `hr.transfers.approve`
is `userCan`-checkable there (it is enforced → catalogued above, so the drift-guard passes).

---

## 6. Backend — the small new surface

### 6.1 `changeApproval.ts`
- Add `'transfer_promotion'` to `CHANGE_TYPES`.
- Add the `applyChange` case:
  ```ts
  case 'transfer_promotion': {
    const patch: Record<string, unknown> = { ...stamp };
    if ('departmentId'  in rv) patch['department_id']  = rv['departmentId'];
    if ('siteId'        in rv) patch['site_id']        = rv['siteId'];
    if ('positionId'    in rv) patch['position_id']    = rv['positionId'];
    if ('supervisorId'  in rv) patch['supervisor_id']  = rv['supervisorId'];
    if ('role'          in rv) patch['role']           = rv['role'];
    if ('monthlySalary' in rv && rv['monthlySalary'] != null) { patch['monthly_salary'] = rv['monthlySalary']; patch['pay_basis'] = 'salary'; }
    if ('hourlyRate'    in rv && rv['hourlyRate']    != null) { patch['hourly_rate']    = rv['hourlyRate'];    if (!('monthlySalary' in rv)) patch['pay_basis'] = 'hourly'; }
    await sb.from('app_users').update(patch).eq('id', eid);
    // Assignment history — reuse the exact pattern from the /employees/transfer route:
    const orgChanged = 'departmentId' in rv || 'siteId' in rv || 'positionId' in rv || 'supervisorId' in rv;
    if (orgChanged) {
      const eff = String(rv['effectiveDate'] ?? todayISO());
      // load current dept/site/supervisor to fill unchanged assignment fields (see /employees/transfer)
      await sb.from('hr_employee_assignments').update({ is_current: false, effective_to: eff }).eq('employee_id', eid).eq('is_current', true);
      await sb.from('hr_employee_assignments').insert({ employee_id: eid, position_id: (rv['positionId'] as string|null) ?? null,
        department_id: /* changed ?? current */, site_id: /* changed ?? current */, supervisor_id: /* changed ?? current */,
        assignment_type: 'primary', effective_from: eff, is_current: true, created_by: actorId });
    }
    break;
  }
  ```
  (The `ChangeRow` passed to `applyChange` includes `previous_value` — use it to fill unchanged assignment
  fields, or re-load the employee; match how the existing cases do it. No compensation-history insert — §3.3.)
- Add the `snapshotForChange('transfer_promotion', emp)` case returning the current dept/site/position/
  supervisor/role/monthly_salary/hourly_rate/pay_basis.

### 6.2 Routes (`routes/hr.ts` or a small `routes/hrTransfers.ts` mounted in `api.ts`)
- `POST /transfers/request` — `requirePermission(c,'hr.transfers.request')`, zod-validate
  `{ employeeId, departmentId?, siteId?, positionId?, supervisorId?, role?, monthlySalary?, hourlyRate?,
  effectiveDate (required), reason? }`, require ≥1 changed field, then call the existing `createChangeRequest`
  with `changeType:'transfer_promotion'`, `previousValue: snapshotForChange('transfer_promotion', emp)`,
  `requestedValue: { ...bundle, effectiveDate, reason }`. Returns `{ id, changeNo }`.
- `POST /transfers/list` — `hr.transfers.view` — `hr_employee_change_requests` where
  `change_type='transfer_promotion'` (+ optional status/employee filter), joined to employee/requester names.
- (Optional) `POST /transfers/get` — one request with decoded bundle + names.
- **Reuse** `/employee-change-requests/decide` (approve/reject/return — already routes by `CHANGE_PERM`) and
  `/employee-change-requests/cancel`. Expose them through your API client under transfers-friendly names; do
  NOT reimplement.
- Guard `/employees/change-request` against `transfer_promotion` (§3.5).

Every mutation already emits event + audit through `createChangeRequest`/`applyApprovedChange` — do not add
redundant emits, but DO confirm the audit `submoduleKey` reads sensibly (the shared path uses
`'employees'`; that is acceptable, or thread a `'transfers'` submodule label if you add a scoped route).

---

## 7. Types + hooks

`types/hrTransfers.ts` (shared camelCase; imported by BE + FE — no per-endpoint mappers):
```ts
export interface TransferPromotionValue {
  departmentId?: string | null; siteId?: string | null; positionId?: string | null;
  supervisorId?: string | null; role?: string | null;
  monthlySalary?: number | null; hourlyRate?: number | null;
  effectiveDate: string; reason?: string | null;
}
export type TransferStatus = 'submitted' | 'in_review' | 'returned' | 'applied' | 'rejected' | 'cancelled';
export interface TransferRequestRow {
  id: string; changeNo: string; employeeId: string; employeeName: string | null;
  requestedBy: string; requestedByName: string | null;
  status: TransferStatus; effectiveDate: string | null;
  previousValue: TransferPromotionValue | Record<string, unknown>;
  requestedValue: TransferPromotionValue; reason: string | null;
  requestedAt: string; decidedAt: string | null; appliedAt: string | null;
}
export interface SubmitTransferArgs extends TransferPromotionValue { employeeId: string; }
```
`src/api/hr/transfers.ts` — mirror `src/api/hr/offboarding.ts`: `call<T>()` throws on `success:false`,
`hrTransfersApi` object, TanStack hooks under `['hr','transfers']`, `useTransfersMutation` invalidates that
key (+ `['hr','employees']` since app_users changes on apply). `apiPost` wraps body as `{ args }`.

---

## 8. Frontend — functional-only (`src/components/sections/HR/TransfersOverview.tsx`)

Mirror `OffboardingOverview.tsx`. `PageHeader` + a plain stat row (pending / applied this month / returned)
+ status-filtered `.obx-table` of requests + **New Transfer/Promotion** modal + inline detail with
decide/cancel actions (gated). Modal fields: employee picker, then optional dept / site / position /
supervisor / role selects + monthly-salary / hourly-rate inputs (show only what they toggle to change),
a required **effective date**, and a reason. Decide actions (`Approve`/`Return`/`Reject`) visible only if
`can('hr.transfers.approve')`; `Cancel` for the requester. Use `@lib/dialog` for confirms/prompts/toasts —
never `window.*`. Loading: `placeholderData` + gate `loading={isLoading && !data}`; `@ui TableSkeleton` on
cold path; never a fake `0`.

Nav wiring:
- `src/components/sections/HR/module.ts` — add `TRANSFERS_ITEM: ModuleNavItem = { id:'s-hr-transfers',
  label:'Transfers & Promotions', icon:'fa-right-left', sub:'Bundled dept/role/pay changes with approval' }`
  and push into `navItems`.
- `src/components/sections/HR/HRSection.tsx` — add `TRANSFERS_ID='s-hr-transfers'`, include in
  `isHrSection`, render `<TransfersOverview/>` when `sectionId===TRANSFERS_ID`.

---

## 9. E2E — `scripts/e2e/suites/hrTransfers.mjs`

Mirror `hrOffboarding.mjs` (harness `scripts/e2e/harness.mjs`; run `npm run test:e2e -- hrTransfers` against
live `npm run dev:netlify` — `dev:netlify` serves compiled `dist/`, so `npm run build:backend` + restart
before trusting it). Cover:
1. **Submit** a bundled `transfer_promotion` (e.g. dept + role + salary + effectiveDate) → assert the CR row
   (`change_type='transfer_promotion'`, `requested_value` bundle intact, `status='submitted'`, `workflow_id`
   set because the binding exists).
2. **Approve** via `/employee-change-requests/decide` → assert `app_users` actually changed (dept + role +
   monthly_salary), a new `hr_employee_assignments` row is `is_current=true` with `effective_from =
   effectiveDate`, and the CR is `applied`.
3. **Reject** a second request → `rejected`, **no** `app_users` change.
4. **Access control** — a provisioned real `employee` cannot submit (`hr.transfers.request` denied); an
   `hr_staff` can submit but CANNOT approve (`hr.transfers.approve` denied → decide 403); the generic
   `/employees/change-request` REJECTS a `transfer_promotion` (§3.5). **Provision real users of each role**
   (auth resolves role from `app_users`, not the JWT — CLAUDE.md pitfall).
5. **§2 side-effects** — after submit + apply, assert (poll, `emitAppEvent` is fire-and-forget) the expected
   `app_events` (`source_module='hr'`, `hr.employee.change_requested` / `hr.employee.change_applied`) and
   `hr_audit_log` rows.
6. **Cleanup** — tag with `h.TAG`; delete created CRs + revert the test employee in `h.onCleanup()`.

---

## 10. Verification gate (run ONCE, at the end)
1. `npm run typecheck:frontend` + `npm run typecheck:backend` — clean.
2. `npm run build:backend` — clean (needed before E2E; `dev:netlify` serves `dist/`).
3. `npm test` (jest) + `npx vitest run` — green. **Watch `tests/unit/permissions.sync.test.ts`** (fails if
   `hr.transfers.*` isn’t in both `permissions.ts` files).
4. `npm run test:e2e -- hrTransfers` — green (after migrations applied + `NOTIFY pgrst`).
5. 229 frontend tests remain green.

**Migrations to operator-apply, in order (then `NOTIFY pgrst, 'reload schema';`):**
`20260719000000_hr_transfers_permissions.sql`, `20260719000001_workflow_transfer_promotion_binding.sql`.
(Confirm numbers don’t collide with anything above `20260718000004`.)

---

## 11. APPENDIX — DO NOT COPY these (they’re wrong against this codebase)

| # | Wrong | Correct |
|---|---|---|
| 1 | new `hr_transfer_requests` table | reuse `hr_employee_change_requests` + `change_type='transfer_promotion'` |
| 2 | reimplement submit/decide/cancel | reuse `createChangeRequest` + the generic `/employee-change-requests/decide`/`/cancel` (they route by `CHANGE_PERM`) |
| 3 | new `hr_employee_compensation_history` table by default | audit log + CR row already capture salary before/after + effective date; a comp ledger is Payroll’s, built only on a named need (§3.3) |
| 4 | `insert into role_permissions (role, permission)` | column is **`role_name`** |
| 5 | `writeHrAudit({ oldState, newState })` | param is **`previousState`** (unknown key silently dropped = accept-and-drop) |
| 6 | `workflow_instance_id text` / hand-managing workflow | `hr_employee_change_requests.workflow_id` is a **uuid FK**; let `createChangeRequest` set it |
| 7 | hardcoded template routing / new template | add a **binding** for `hr.employee.transfer_promotion` → the existing `hr_change_approval` template (bindings own routing) |
| 8 | `netlify/functions/scheduled/...` for future-dated apply | no scheduler infra — apply on approval + stamp `effectiveDate`; a real sweep is a service-role route + verified external trigger (§3.2) |
| 9 | `transfer_promotion` submittable via `/employees/change-request` (hr.view) | only via `/transfers/request` (`hr.transfers.request`); guard the generic route (§3.5) |
| 10 | new enforced keys granted only in DB | also add to `permissions.ts` ×2 + `permissionMeta.ts` or the **drift-guard fails the build** |

## 12. Definition of done
- `transfer_promotion` change type end-to-end: scoped submit → workflow approval → atomic bundled apply
  (dept/site/position/supervisor/role/salary) with an `effectiveDate`-stamped assignment-history row.
- Reuses the existing envelope, `createChangeRequest`, generic decide/cancel, and the `hr_change_approval`
  template via a new binding — no forked table, no second approval authority, no invented scheduler, no
  redundant comp-history table.
- `hr.transfers.*` catalogued in all four places + granted; drift-guard green.
- Functional-only Transfers page, nav-wired. `hrTransfers.mjs` green; full gate green; migrations listed.
