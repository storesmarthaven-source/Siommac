# Payroll Pay-Policy-to-Run Integration (F-02) Delivery Contract -- Rev 4.1

**Status:** CONDITIONALLY SIGNED OFF (Rev 4.1, 2026-07-20) -- the five required corrections are folded in
(§8 create `for share`+revalidate / TOCTOU; §8 F-02-owned `calendar.zero_working_days`; route-unreachable
branches → unit; E2E-PPR-041 real correction lifecycle; `app_users.start_date/end_date` clamp; browser-QA
REQUIRED gate + 2000-emp benchmark). Cleared to implement without another design-review round. No code yet.
**Rev history:** Rev 1 mis-scoped to legacy JS. Rev 2 rebuilt on the RPC/snapshot model. Rev 3
made every source, formula, checksum, owner, lock order, and invariant executable (named columns/RPCs)
but DEFERRED `working_days` proration (no holiday-calendar source existed). **Rev 4 removes that deferral
(DEC-PPR-010) and integrates the now-delivered Shared Work Calendar (F-CAL) end-to-end: resolve -> fail
closed -> immutably pin the calendar version + holiday checksum + resolution inputs + numerator/denominator
+ evidence into the input snapshot, and CONSUME the pinned calendar at calculation.**
**Slice:** F-02 (successor to F-01; both merge together after both green).
**Branch (planned):** off `codex/payroll-policy-setup` tip (`3c917002`) -- the only branch carrying BOTH F-01
(pay policy) AND F-CAL (work calendar). F-CAL is already independently merged to `main` (`1b3d7102`); when
F-01+F-02 later merge to `main`, the F-CAL commits are same-content duplicates git resolves cleanly.
**Author date:** 2026-07-19 (Rev 3); Rev 4 2026-07-20.

Purpose: make payroll runs deterministically resolve, pin, and CONSUME the governed pay policy AND the
governed work calendar so both actually drive the numbers. Precondition to enabling the release gate.

**F-CAL boundary (NON-NEGOTIABLE):** F-02 CALLS F-CAL's service-role functions read-only
(`public.work_calendar_resolve`, `public.work_calendar_working_days`) from inside its own RPCs. It does
**not** add, alter, or migrate any F-CAL or Shared-Calendar object, function, table, permission, or UI.
Any F-CAL gap found during F-02 is raised to the user, not patched here.

---

## 1. Objective

- Create (`finance_payroll_create_run_tx`): resolve the one active assignment+version covering the WHOLE
  run period; pin `(pay_policy_version_id, pay_policy_checksum)` in the same commit; fail-closed otherwise.
  **When the pinned policy binds any `working_days` component, additionally resolve the work-calendar version
  for the run's pay group over the whole period via `work_calendar_resolve`, verify a non-zero period
  denominator, and pin `(work_calendar_version_id, holiday_calendar_version_id, work_calendar_checksum,
  holiday_calendar_checksum, calendar_resolution)` in the SAME commit; fail-closed otherwise.**
- Input-lock (`finance_payroll_lock_inputs_tx`): enforce the pinned version's source + costing rules against
  the employee sources; write exactly ONE immutable policy-evidence manifest row bound to the new
  `input_snapshot_id`. **For each employee with a `working_days` component, compute the period denominator and
  the employment-clamped numerator from the PINNED work-calendar version via `work_calendar_working_days`, and
  write exactly ONE immutable calendar-evidence row per employee bound to that `input_snapshot_id`.**
- Calculate (`finance_payroll_calculation_start_tx` + `computeRunLine`): derive each employee's earning
  inputs from the pinned components (basis/rate/eligibility) using the snapshot manifest -- **`working_days`
  base pay = `round2(rate * numerator / denominator)` from the snapshotted calendar evidence (never a live
  re-resolution)** -- then run the existing statutory math on the run's pinned `statutory_version_id`.
- Retirement/assignment-end (policy OR calendar) affect FUTURE runs only; a pinned run is never invalidated.

## 2. Scope (REQUIRED / FORBIDDEN)

REQUIRED R1..R10 (policy) + **R11..R13 (work calendar)** as detailed in Sections 5b/5c/6/8:
- **R11 Resolve+pin the work calendar** for a `working_days` policy at create (pay group + whole period,
  F-CAL org-default fallback); fail-closed on missing / ambiguous(split) / unpublished / uncovered /
  jurisdiction-mismatch / zero-denominator.
- **R12 Per-employee working_days evidence** at lock: period denominator + employment-clamped numerator +
  excluded arrays from the PINNED version, exactly ONE immutable row per employee per snapshot.
- **R13 Consume the pinned calendar** at calc: `working_days` base pay from the snapshotted numerator/
  denominator; a later calendar change or version supersede never alters a pinned run.

FORBIDDEN/DEFERRED:
- N1 Phase B run-policy types. N2 back-fill / retroactive re-resolution. N3 multi-policy blend / per-employee
  override. N4 lock-time invalidation of a pinned run. N5 rich UI beyond Section 4. N6 enabling the release
  gate / merging (or un-feature-gating the Pay-Policy UI) before F-01+F-02 both green AND the combined live
  regression passes. N7 any F-01 change or JS compensating rollback.
- **N7b any F-CAL / Shared-Calendar change** -- F-02 calls `work_calendar_resolve` /
  `work_calendar_working_days` read-only and may take a **read-only `for share` lock** on the resolved
  `work_calendar_assignments` row during create (to close the resolve→insert race, §8); it writes/adds/alters/
  migrates NO F-CAL object (see the F-CAL boundary). A `for share` acquires no write and mutates nothing.
- N8 **site/location-scoped** work-calendar resolution (F-CAL deferred `location` scope): F-02 resolves the
  pay-group calendar with F-CAL's organization-default fallback only; "company/site" == the organization
  default. N9 per-employee calendar OVERRIDE (numerator clamps to the employee's employment window against the
  ONE pay-group/org calendar; no per-employee calendar selection).

Dependencies: F-01 (OK); **F-CAL delivered** -- `public.work_calendar_resolve(pay_group_id,start,end)` +
`public.work_calendar_working_days(version_id,start,end)` (`security invoker`, `service_role`-executable;
migs `20260919000700/701`, applied to the shared DB); execution RPCs `finance_payroll_create_run_tx` /
`_lock_inputs_tx` / `_calculation_start_tx` (migs 420/421, OK); `finance_payroll_runs.{pay_group_id,pay_date,
period_start,period_end,current_input_snapshot_id}` (OK); operator applies the F-02 migration (D3).

## 3. Current-state verification (as of `490bf6af`)

- Canonical create/lock/calc are `security invoker` RPCs (migs 420/421). Run pins
  `statutory_version_id ... on delete restrict` (the precedent). No `pay_policy_*` columns; 0 governed-policy
  refs in the run pipeline.
- `finance_pay_policy_versions.canonical_checksum` is persisted at submit (mig 600 line 474) and
  re-validated at activate (line 548). Approved/active versions are immutable (`draft_command_tx` filters
  `status='draft' for update`). Versions carry `effective_from` (not null) + `effective_to`.
- `finance_payroll_calculation_versions.input_snapshot_id` is not-null -> calc consumes a specific snapshot;
  `finance_payroll_runs.current_input_snapshot_id` exists.
- New control findings are inserted by the execution/calc RPC into `finance_payroll_control_findings`
  (mig 421 line 1300); `finance_payroll_finding_command_tx` only manages EXISTING findings
  (assign/escalate/resolve/waive/reopen).
- Run events: `app_events.event_type in ('payroll_run.created','payroll_run.inputs_locked',
  'payroll_run.calculated')`.
- **F-CAL (as of `1b3d7102` on main / `3c917002` on codex):** `work_calendar_resolve(uuid,date,date)` returns
  `{workCalendarId,workCalendarVersionId,workCalendarChecksum,holidayCalendarVersionId,holidayCalendarChecksum,
  resolutionPath{scope,assignmentId}}` and raises `PR422` for `calendar.invalid_period` / `.split_period` /
  `.unresolved` / `.version_unpublished` / `.version_period_uncovered` / `.holiday_set_unpublished` /
  `.jurisdiction_mismatch` (jurisdiction compared vs `finance_pay_groups.statutory_country`).
  `work_calendar_working_days(uuid,date,date)` returns `{count:text, excluded:[{date,reason,lostFraction,
  holidayName?}]}` and raises `PR422 calendar.invalid_period` on `start>end`; a fully non-working range returns
  `count='0'`. Both are `stable security invoker`, `set search_path=pg_catalog,public`, revoked from
  `public/anon/authenticated`, executable by `service_role` only -- so an F-02 `security invoker` RPC invoked by
  the service-role backend can call them with no F-CAL change.

## 4. UI inventory

| ID | Surface | Control | Wired to | Test |
|---|---|---|---|---|
| UI-PPR-001 | Run detail | pinned-policy chip (name/version/short checksum) | API-PPR-004 | vitest UT-PPR-U1 |
| UI-PPR-002 | Run detail | policy-evidence panel (component/source/costing arrays) | API-PPR-005 | vitest UT-PPR-U2 |
| UI-PPR-003 | Create-run | inline blocker on missing/ambiguous policy OR calendar (typed reason) | API-PPR-001 | vitest UT-PPR-U3 |
| UI-PPR-004 | Run detail | pinned work-calendar chip (calendar name/version + short holiday checksum + resolution scope), shown only when a `working_days` policy is pinned | API-PPR-004 | vitest UT-PPR-U4 |
| UI-PPR-005 | Run detail | working-days evidence rows in the evidence panel (per-employee numerator/denominator + period + excluded count), resolved names, no raw UUID | API-PPR-005 | vitest UT-PPR-U5 |

Vitest component tests cover these surfaces automatically. **Authenticated operator browser QA of UI-PPR-001..005
is a REQUIRED release gate** (passkey login is operator-only, not agent-automatable): the operator walks the
pinned-policy chip, the work-calendar chip, the evidence panel (policy + working-days rows), and the create-run
typed blockers at supported desktop widths + mobile, and records operator/date/env/browser/result in release
evidence. It is NOT merely a recorded limitation — release is blocked until this gate is signed off (§15).

## 5. API inventory (all POST-only)

| ID | Route | Perm key | F-02 change |
|---|---|---|---|
| API-PPR-001 | `/payroll/runs/create` | `finance.payroll.run.manage` | resolve + pin in create_run_tx; returns `payPolicy` |
| API-PPR-002 | `/payroll/runs/lock-inputs` | `finance.payroll.run.manage` | enforce R4 + write evidence in lock_inputs_tx |
| API-PPR-003 | `/payroll/runs/calculate` | `finance.payroll.run.manage` | derive inputs from manifest; consume snapshot |
| API-PPR-004 | `/payroll/runs/get` | `finance.payroll.view_all` | return pinned `payPolicy` |
| API-PPR-005 | `/payroll/runs/policy-evidence` (new) | `finance.payroll.view_all` | read evidence (Section 6d) |

### 5b. Source-to-table mapping (executable)

| Policy field / value | Resolved from | Status / effective rule |
|---|---|---|
| component `approved_hours` (approved_time) | `hr_timesheets` (+`hr_overtime_entries`,`hr_attendance_records`) | approved; work date in `[period_start,period_end]` at/under pay-group cutoff |
| component `salary_period` (approved_compensation) | `hr_employee_pay_items` | approved/active; effective by `reconciliation_key` |
| source `approved_leave` | `hr_leave_requests` (+`hr_leave_balances`) | status approved; employee_period |
| source `statutory_profile` | `hr_employee_statutory_profiles` | approved |
| source `payment_destination` | `finance_employee_bank_accounts` (primary, active) | version `payment_destination='primary_bank_account'`, `missing_bank_outcome='block_release'` |
| costing `cost_centre` | employee `cost_center` text (mig 20260711000001), validated vs `finance_cost_centers` | `required`, `missing_outcome='block_input_lock'` |
| `rate_source='employee_contract'` | `hr_contracts` (active) | contract rate |
| `rate_source='employee_assignment'` | `finance_employee_pay_group_assignments` | assignment rate |
| `eligibility_source='effective_employment'` | `app_users` active + employment dates | active on pay date |
| `eligibility_source='approved_compensation'` | has approved `hr_employee_pay_items` | -- |
| `eligibility_source='approved_time'` | has approved `hr_timesheets` | -- |
| **work calendar (`working_days` proration)** | `work_calendar_resolve(run.pay_group_id, period_start, period_end)` -> published/superseded version covering the whole period; F-CAL org-default fallback | resolved + pinned at create; consumed (never re-resolved) thereafter |
| **period denominator** | `work_calendar_working_days(pinned_version, period_start, period_end).count` | computed at create (must be > 0) + pinned; re-used per employee |
| **employment window (numerator clamp)** | `app_users.start_date` (date, nullable) + `app_users.end_date` (date, nullable) | INCLUSIVE clamp: `clampFrom=greatest(period_start, coalesce(start_date, period_start))`, `clampTo=least(period_end, coalesce(end_date, period_end))`. Null `start_date` ⇒ employed from period_start; null `end_date` ⇒ employed through period_end. Both boundary days COUNT (a day == start_date or == end_date is worked). Empty window (`clampFrom > clampTo`, i.e. `start_date > period_end` or `end_date < period_start`) ⇒ numerator 0 (no `work_calendar_working_days` call) |

### 5c. Calculation formulas (executable; `round2` = 2-dp half-up at each step)

Policy-governed INPUT derivation (feeds `finance_payroll_run_inputs` -> `computeRunLine`); computeRunLine
itself is unchanged and owns statutory math (DEC-PPR-009):
- **Full-period salary** (`salary_period`, no proration flag / whole-period employment): `basePay =
  round2(rate)` where `rate` from `rate_source` (monthly).
- **calendar_days proration** (`salary_period`, `rule_parameters.proration='calendar_days'`): `basePay =
  round2(rate * calendarDaysEmployedInPeriod / calendarDaysInPeriod)`.
- **working_days proration** (`salary_period`, `rule_parameters.proration='working_days'`) -- INTEGRATED via
  F-CAL (DEC-PPR-010, Rev 4): `denominator = work_calendar_working_days(pinnedWorkCalendarVersionId,
  period_start, period_end).count` (a NUMERIC decimal string; fractional days honored); `numerator =`
  `work_calendar_working_days(pinnedWorkCalendarVersionId, clampFrom, clampTo).count` where `clampFrom/clampTo`
  are the INCLUSIVE employment clamp from §5b (`app_users.start_date/end_date`), else `0` when the clamp window
  is empty; `basePay = round2(rate * numerator / denominator)`. **`denominator=0` (F-CAL returns `count='0'`,
  does not raise) is detected by `create_run_tx` and fail-closed as `calendar.zero_working_days` at CREATE
  (FL-PPR-011)** — it can never reach calc. Both `count`s are exact decimals (F-CAL clamps `worked =
  greatest(0, pattern - holiday)`), so `numerator <= denominator` always.
- **approved_hours** (`approved_hours`): `componentAmount = round2(approvedHours * rate)`; `approvedHours`
  from `hr_timesheets` (approved), `rate` from `rate_source`.
- **taxableAllowances / nonTaxableAllowances**: sum of approved `hr_employee_pay_items` whose
  `finance_pay_components` is taxable / non-taxable and whose component is eligible per the manifest.
- **approvedOtAmount**: approved `hr_overtime_entries` if the policy binds an OT component.
- **preTaxPensionDeductions / voluntaryDeductions**: approved deduction pay items of the matching kinds
  (reduce_chargeable / net) -- deductions carry negative sign into net; earnings positive.
- **eligibility exclusion**: a component/employee failing its `eligibility_source` is omitted from inputs.
Then `computeRunLine` (unchanged): `base=round2(basePay)`; `taxableGross=round2(base+taxableAllowances+
approvedOtAmount)`; `gross=round2(taxableGross+nonTaxableAllowances)`; NIS on `weeklyInsurable=
taxableGross/weeksInPeriod`; PAYE annualised by `payPeriods`; health surcharge; `net`. Every E2E expected
amount is derived from these formulas (E2E-PPR-013/014/018 give named numbers).

## 6. Data model and migration (`2026NNNN_finance_pay_policy_run_pin.sql`, operator-applied)

**a) Pin columns on `finance_payroll_runs`:**
- `add column pay_policy_version_id uuid`, `pay_policy_checksum text`, `pay_policy_required boolean not null
  default false`.
- Store ONLY the version id (policy id derived from the version) -- resolves pin-consistency (finding #6);
  no separate `pay_policy_id`.
- FK: `pay_policy_version_id references finance_pay_policy_versions(id) on delete restrict`.
- Invariants:
  - checksum format: `check (pay_policy_checksum is null or pay_policy_checksum ~ '^[0-9a-f]{64}$')`.
  - **legacy discriminator (finding #7):** existing rows `pay_policy_required=false`; after adding the
    column, `alter ... alter column pay_policy_required set default true`; and
    `check (pay_policy_required = false or (pay_policy_version_id is not null and pay_policy_checksum is not
    null))`. Every new run (created via the RPC) sets `pay_policy_required=true` and carries the pin; legacy
    rows stay false/null.
  - index `finance_payroll_runs(pay_policy_version_id)`.

**a2) Work-calendar pin columns on `finance_payroll_runs` (nullable -- set only for a `working_days` policy):**
- `add column work_calendar_version_id uuid`, `holiday_calendar_version_id uuid`,
  `work_calendar_checksum text`, `holiday_calendar_checksum text`, `calendar_resolution jsonb`.
- FKs: `work_calendar_version_id references work_calendar_versions(id) on delete restrict`,
  `holiday_calendar_version_id references holiday_calendar_versions(id) on delete restrict` (immutable pin;
  mirrors `statutory_version_id`; F-02 references F-CAL tables read-only via FK, adds nothing to them).
- `calendar_resolution` holds `{payGroupId, periodStart, periodEnd, scope, assignmentId, periodDenominator,
  periodExcluded[]}` -- the pinned resolution INPUTS + period denominator/excluded evidence.
- checksum format checks on both `*_checksum` columns (`~ '^[0-9a-f]{64}$'` when not null).
- **all-or-nothing invariant:** `check ((work_calendar_version_id is null and holiday_calendar_version_id is
  null and work_calendar_checksum is null and holiday_calendar_checksum is null and calendar_resolution is
  null) or (all five not null))` -- a run is either calendar-pinned or not, never half-pinned.
- index `finance_payroll_runs(work_calendar_version_id)`.

**b) Evidence table `finance_payroll_run_policy_evidence` (ONE manifest row per snapshot -- finding #1):**
- `id uuid pk, input_snapshot_id uuid not null unique references finance_payroll_input_snapshots(id) on
  delete cascade, run_id uuid not null references finance_payroll_runs(id) on delete cascade,
  policy_version_id uuid not null references finance_pay_policy_versions(id) on delete restrict, checksum
  text not null check (checksum ~ '^[0-9a-f]{64}$'), manifest jsonb not null, created_at timestamptz not
  null default now()`.
- `unique(input_snapshot_id)` -> exactly one manifest per snapshot; `manifest` holds `{components[],
  sourceRules[], costingRules[], statutory{}}` arrays (derived, display-resolved policyId included).
- **Immutability (finding #11):** `before update` trigger raises; DELETE permitted (FK cascade for
  retention / E2E cleanup). RLS enabled, service-role write only.

**c) Resolution index:** `finance_pay_group_policy_assignments(pay_group_id, status, effective_from,
effective_to)`.

**d) Evidence read (finding #10):** `policy-evidence` defaults to the run's `current_input_snapshot_id`;
optionally accepts `inputSnapshotId` validated to belong to the run (history after relock). The evidence DTO
adds a `calendar` block when the run is calendar-pinned: `{workCalendarName, workCalendarVersionNo,
holidayCalendarName, holidayChecksumShort, resolution{scope,assignmentId}, periodDenominator, employees[]}`
(names display-resolved, no raw UUID) where `employees[]` is the R12 per-employee evidence.

**e) Per-employee calendar evidence `finance_payroll_run_calendar_evidence` (R12 -- ONE row per employee per
snapshot):**
- `id uuid pk, input_snapshot_id uuid not null references finance_payroll_input_snapshots(id) on delete
  cascade, run_id uuid not null references finance_payroll_runs(id) on delete cascade, employee_id text not
  null references app_users(id), work_calendar_version_id uuid not null references work_calendar_versions(id)
  on delete restrict, holiday_calendar_checksum text not null check (holiday_calendar_checksum ~
  '^[0-9a-f]{64}$'), period_denominator numeric not null check (period_denominator > 0), numerator numeric not
  null check (numerator >= 0), clamp_from date, clamp_to date, excluded jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()`.
- `unique(input_snapshot_id, employee_id)` -> exactly one calendar-evidence row per employee per snapshot;
  `check (numerator <= period_denominator)`.
- **Immutability (mirrors 6b):** `before update` trigger raises; DELETE permitted (FK cascade for retention /
  E2E cleanup). RLS enabled, service-role write only. Written only inside `finance_payroll_lock_inputs_tx`.

No back-fill, no seed, idempotent, fix-at-source. **No F-CAL object is created or altered.**

## 7. State machine

Run status unchanged. Create requires R1 pass (else no row). `draft -> input_locked` additionally requires
R4 pass. No lock-time policy-invalidation (N4).

## 8. Mutation ownership, lock order, failure matrix

**Ownership (one owner each, in-RPC, exact count):**
- SE-PPR-001 policy pin -> `finance_payroll_create_run_tx` (enriches `app_events 'payroll_run.created'`; no new event).
- SE-PPR-002 policy evidence -> exactly ONE row in `finance_payroll_lock_inputs_tx` (enriches
  `app_events 'payroll_run.inputs_locked'` with the evidence checksum).
- **SE-PPR-003 calendar pin -> `finance_payroll_create_run_tx`** (same commit as SE-PPR-001, only for a
  `working_days` policy): sets the five `a2)` columns from `work_calendar_resolve` + the period denominator
  from `work_calendar_working_days`; enriches the SAME `'payroll_run.created'` event (no new event).
- **SE-PPR-004 per-employee calendar evidence -> exactly ONE `finance_payroll_run_calendar_evidence` row per
  working_days employee in `finance_payroll_lock_inputs_tx`** (same commit as SE-PPR-002).
- Resolution (policy AND calendar) is internal (not a business mutation). Rejected create/lock -> ZERO
  business events + ZERO run/snapshot/policy-evidence/calendar-evidence rows (rollback).
- Conflict-outcome owners (finding #9): `create_review_finding`/`create_correction_candidate` ->
  execution/calc RPC inserts `finance_payroll_control_findings` (the existing creation owner, mig 421);
  `exclude_unapproved_input` -> omit input from snapshot; `block_employee_calculation` -> flag employee
  in snapshot, calc excludes; `block_input_lock` -> raise (fail-closed).

**Lock order (finding #8 -- separate for create vs lock):**
- Create: `pg_advisory_xact_lock(pay_group)` -> policy assignment `for share` -> policy version (read,
  immutable) -> **[working_days policy only] `work_calendar_resolve(...)` (unlocked F-CAL reads) THEN lock the
  resolved assignment: `select id, status, effective_from, effective_to, work_calendar_version_id from
  public.work_calendar_assignments where id = <resolutionPath.assignmentId> for share` and REVALIDATE the
  locked row — `status='active'`, its window still contains the whole period (`daterange(effective_from,
  coalesce(effective_to+1,'infinity'),'[)') @> [period_start,period_end]`), and `work_calendar_version_id ==`
  the resolved `workCalendarVersionId` — THEN `work_calendar_working_days(pinnedVersion, period)` for the
  period denominator** -> INSERT run (with both pins). **This `for share` closes the resolve→insert TOCTOU
  race:** F-CAL `end_assignment`/`cancel_assignment` take `for update` on that same row, so a concurrent
  end/cancel either commits BEFORE our `for share` (revalidation then fails → the run is rejected, not
  half-pinned) or blocks until our create commits. Any revalidation mismatch (row missing / cancelled /
  ended-out-of-window / version changed) fails closed with `calendar.unresolved` (missing/cancelled/ended) or
  `calendar.split_period` (no longer whole-period) — no run row. (Cannot lock a not-yet-inserted run row.)
  Ordering the calendar lock AFTER the policy read keeps a single deterministic acquisition order and avoids a
  cycle with F-CAL admin publishes. **The `for share` is a READ-ONLY lock on an F-CAL row (no write) — see N7b.**
- Input lock: run `for update` -> input snapshot insert -> policy-evidence insert -> **per-employee
  calendar-evidence inserts (working_days employees), each computed from the run's PINNED version**.
- F-01 assignment-end must take a compatible lock on the policy assignment row (`for update`) -- verify in F-01
  `admin_command_tx` during implementation; concurrency test C-PPR-002. F-CAL `end_assignment`/`cancel_assignment`
  already take `for update` on the work-calendar assignment row; our create's `for share` coordinates with them
  (C-PPR-003). F-CAL publishes/supersedes are immutable-forward (a pinned version row is never mutated), so no
  lock coordination with F-CAL VERSIONS is needed — only the assignment `for share` above.

**Failure matrix (exact `PR4xx -> HTTP`):**

| ID | Condition | Point | Code -> HTTP |
|---|---|---|---|
| FL-PPR-001 | no active assignment+version covering whole period (incl. version dates, finding #5) | create | `PR422 policy.missing` -> 422 |
| FL-PPR-002 | >1 covering active assignment (defensive; F-01 blocks overlap) | create | `PR409 policy.ambiguous` -> 409 |
| FL-PPR-003 | required source missing/unapproved, outcome `block_input_lock` | lock | `PR422 policy.source_missing:<type>` -> 422 |
| FL-PPR-004 | cost centre required and missing | lock | `PR422 policy.cost_centre_missing` -> 422 |
| FL-PPR-005 | working_days policy, no work-calendar assignment covers the whole period | create | `PR422 calendar.unresolved` -> 422 |
| FL-PPR-006 | working_days policy, calendar assignments intersect but none contains the whole period (ambiguous/adjacent) | create | `PR422 calendar.split_period` -> 422 |
| FL-PPR-007 | resolved work version not published | create | `PR422 calendar.version_unpublished` -> 422 |
| FL-PPR-008 | resolved holiday version not published | create | `PR422 calendar.holiday_set_unpublished` -> 422 |
| FL-PPR-009 | resolved version window does not cover the whole period | create | `PR422 calendar.version_period_uncovered` -> 422 |
| FL-PPR-010 | holiday jurisdiction != pay group `statutory_country` | create | `PR422 calendar.jurisdiction_mismatch` -> 422 |
| FL-PPR-011 | period denominator = 0 (fully non-working period) — **F-02-raised** | create | `PR422 calendar.zero_working_days` -> 422 |

FL-PPR-005/006/010 are raised by `work_calendar_resolve` and propagated verbatim by the F-02 RPC (the lib maps
`PR422 -> 422`). **FL-PPR-011 is OWNED BY F-02, not F-CAL:** `work_calendar_working_days` for a fully
non-working period returns `count='0'` (it does NOT raise) — so `create_run_tx` must itself test the period
denominator and `raise exception 'calendar.zero_working_days' using errcode='PR422'` when it is `0`
(fail closed, no run/pin). FL-PPR-007/008/009 are defensive `resolve` branches that valid F-CAL routes cannot
produce (F-CAL's `assign` rejects unpublished + window-uncovered versions); they are covered at unit/DB level
(U-PPR-007), not live E2E. F-02 adds no other calendar code and swallows none.

## 9. Permission matrix

Keys per Section 5 (all POST-only). Negative E2E: missing `finance.payroll.run.manage` -> 403 on
create/lock/calc; missing `finance.payroll.view_all` -> 403 on get/policy-evidence.

## 10. Cross-module

Reads F-01 tables (no writes; N7) **and F-CAL tables via its functions only (no writes; N7b).** Enriches
existing `app_events`/audit; toasts on Section 4 surfaces. Findings via the existing control-findings creation
owner. DEC-PPR-003 block-only v1 (no notification/message/ticket; no event on rejected tx).

## 11. Query, scale, concurrency

Policy resolution = one indexed lookup (Section 6c). Calendar resolution (working_days only) = one
`work_calendar_resolve` + one `for share` on the resolved assignment + one `work_calendar_working_days` at
create (period denominator). At lock, **exactly one `work_calendar_working_days` per working_days employee for
the numerator** (F-CAL fn is `stable`, reads one immutable version + its holidays; bounded by period length) —
i.e. an O(N) fan-out over employees. **Required benchmark PERF-PPR-001: lock-inputs on a `MAX_RUN_EMPLOYEES=2000`
working_days run** — record wall-clock + the working_days call count (must be exactly N, one per working_days
employee, no N² / no per-occurrence re-query) and assert it stays within the lock-inputs budget; if it regresses,
memoize identical `(version, clampFrom, clampTo)` windows (many employees share the full-period window) before
optimizing further. Evidence bounded by policy size + one calendar row per working_days employee. No per-employee
policy/calendar fan-out beyond that one numerator call (N3/N9). Lock order per Section 8; pinned F-CAL versions
are immutable so no concurrent-publish corruption is possible; the create `for share` handles concurrent
end/cancel (C-PPR-003).

## 12. UX / a11y

Section 4 surfaces have real empty/loading/error/disabled states; UI-PPR-003 shows the typed FL-PPR-001
reason inline; resolved names, no raw UUIDs; aria/keyboard/focus.

## 13. Test scope

Live suite `scripts/e2e/suites/payrollPayPolicyRun.mjs` (:8888) asserts Section 8 ownership, exact
`app_events.event_type`, and evidence via the service-role client; tagged + FK-safe cleanup. It provisions a
published F-CAL work calendar + pay-group assignment (through F-CAL's own routes -- NOT by writing F-CAL
tables directly) to exercise the `working_days` path, and asserts the pin columns + `finance_payroll_run_
calendar_evidence` rows. **Live E2E also covers the create-vs-calendar-end/cancel race (C-PPR-003) and asserts
never-half-pinned.** Unit/DB tests (policy resolver whole-period+version-date boundary, defensive ambiguity,
calendar_days + approved_hours math, **working_days numerator/denominator math incl. `app_users.start_date/
end_date` clamp with null + inclusive boundaries + zero/empty-window edges**, and **U-PPR-007 the route-
unreachable defensive resolve branches** — unpublished/holiday-unpublished/uncovered — driven at the DB-function
level). Plus **PERF-PPR-001 the 2000-employee lock-inputs benchmark** (assert exactly one `work_calendar_
working_days` per working_days employee, within budget) + vitest UI component tests. Authenticated operator
browser QA of UI-PPR-001..005 is a REQUIRED release gate (§4/§12). Full regression (all suites, incl.
`workCalendar` + `calendar`) = combined F-01+F-02 pre-merge gate. **The combined live regression passing AND the
operator browser-QA gate are hard preconditions to any merge or Pay-Policy un-feature-gate (N6).**

## 14. Decisions

| ID | Decision |
|---|---|
| DEC-PPR-001 | Pin at create; consume snapshot at calc; mirrors `statutory_version_id`. |
| DEC-PPR-002 | Fail-closed at create (missing/ambiguous policy; unresolved/split/unpublished/uncovered/jurisdiction/zero-denominator calendar) and lock (required source/costing). |
| DEC-PPR-003 | Block-only v1; no notification/message/ticket; no business event on a rejected tx. |
| DEC-PPR-004 | Retirement/assignment-end affect FUTURE runs only; pinned runs never invalidated; no back-fill. |
| DEC-PPR-005 | Whole-period coverage: assignment AND version effective window must cover `[period_start,period_end]`. |
| DEC-PPR-006 | One immutable evidence manifest per `input_snapshot_id` (unique); reopen -> new snapshot -> fresh manifest. |
| DEC-PPR-007 | Transactional RPC ownership (extend create/lock/calc RPCs); no JS compensating rollback. |
| DEC-PPR-008 | Release gate (no runtime flag); enable only after F-01+F-02 green, merged together. |
| DEC-PPR-009 | Run `statutory_version_id` authoritative for statutory math; policy governs earning inputs + statutory_profile requirement only. |
| DEC-PPR-010 | **(Rev 4)** `working_days` proration INTEGRATED via F-CAL now that it is delivered: resolve pay-group calendar for the whole period, pin version+holiday checksum+resolution inputs+period denominator at create, snapshot per-employee numerator/denominator/excluded at lock, consume the pin at calc. Supersedes the Rev 3 deferral. |
| DEC-PPR-011 | Pin stores `pay_policy_version_id` only (policy id derived); `pay_policy_required` invariant guards new runs. |
| DEC-PPR-012 | Calendar pin is CONDITIONAL: resolved+pinned only when the pinned policy binds >=1 `working_days` component; otherwise the five `a2)` columns stay null (all-or-nothing check). A non-working_days run needs no calendar. |
| DEC-PPR-013 | Denominator is period-level (one per run, pinned at create, must be > 0); numerator is per-employee (employment-clamped, snapshotted at lock). No-employment-intersection -> numerator 0 -> base pay 0 (not a failure). |
| DEC-PPR-014 | F-02 calls F-CAL read-only (`work_calendar_resolve`/`work_calendar_working_days`); it creates/alters NO F-CAL object (N7b). Site/location scope stays deferred in F-CAL; "company/site" == F-CAL organization-default fallback (N8). |
| DEC-PPR-015 | Calendar resolution/pin uses the same transactional-RPC ownership as the policy pin (no JS compensating rollback); a rejected create/lock rolls back both pins and all evidence atomically. |
| DEC-PPR-016 | **(Rev 4.1)** Create locks the resolved `work_calendar_assignments` row `for share` and revalidates status/whole-period-coverage/version BEFORE inserting the run — closes the resolve→insert TOCTOU vs F-CAL `end/cancel` (`for update`); read-only lock, permitted under N7b. Concurrency test C-PPR-003. |
| DEC-PPR-017 | **(Rev 4.1)** `calendar.zero_working_days` is F-02-OWNED: `work_calendar_working_days` returns `count='0'` and does not raise, so `create_run_tx` tests the period denominator and raises the code itself (FL-PPR-011). |
| DEC-PPR-018 | **(Rev 4.1)** Employment clamp uses exactly `app_users.start_date`/`end_date` (nullable), inclusive boundaries, null⇒period bound (§5b). |
| DEC-PPR-019 | **(Rev 4.1)** Route-unreachable resolver branches (`version_unpublished`/`holiday_set_unpublished`/`version_period_uncovered`, FL-PPR-007/008/009) are unit/DB-tested (U-PPR-007), not live E2E — live fixtures are always F-CAL-route-created. |
| DEC-PPR-020 | **(Rev 4.1)** Authenticated operator browser QA (UI-PPR-001..005) is a REQUIRED release gate; the 2000-employee lock-inputs benchmark PERF-PPR-001 (one `work_calendar_working_days` per working_days employee, no N²) is required. |

## 15. Approval

- [x] User CONDITIONALLY signed off Rev 4 (2026-07-20). Rev 4.1 folds in the five required corrections:
      DEC-PPR-016 (create `for share`+revalidate on the resolved assignment / TOCTOU + C-PPR-003 + N7b read-only
      lock), DEC-PPR-017 (F-02-owned `calendar.zero_working_days`; F-CAL returns `count='0'`), DEC-PPR-019
      (route-unreachable branches → unit/DB U-PPR-007, live fixtures route-created), E2E-PPR-041 real
      copy→publish→reassign correction lifecycle, DEC-PPR-018 (`app_users.start_date/end_date` null+inclusive),
      DEC-PPR-020 (operator browser QA REQUIRED gate + PERF-PPR-001 2000-emp benchmark). **Proceed to
      implementation without another design-review round.**
- [ ] Then: F-02 branch off `codex/payroll-policy-setup` (`3c917002`); migration (policy + calendar pin cols +
      `finance_payroll_run_calendar_evidence`) + policy resolver + **calendar resolve/`for share`/proration
      wiring (read-only F-CAL calls)** + RPC extensions + routes/UI + E2E (incl. C-PPR-003 + PERF-PPR-001);
      operator applies migration; live-verify on :8888. No F-CAL / Shared-Calendar file is edited.
- [ ] Then: combined F-01+F-02 full regression (incl. `workCalendar` + `calendar` suites) MUST pass **and the
      operator browser-QA gate signed off** -> only then enable the release gate, un-feature-gate the Pay-Policy
      UI, and merge both into `main`.
