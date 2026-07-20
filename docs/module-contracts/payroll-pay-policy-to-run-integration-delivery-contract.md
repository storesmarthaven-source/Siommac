# Payroll Pay-Policy-to-Run Integration (F-02) Delivery Contract -- Rev 3

**Status:** DRAFT (Rev 3) -- contract-first, awaiting sign-off. No implementation started.
**Rev history:** Rev 1 mis-scoped to legacy JS. Rev 2 rebuilt on the RPC/snapshot model. Rev 3
makes every source, formula, checksum, owner, lock order, and invariant executable (named columns/RPCs).
**Slice:** F-02 (successor to F-01; both merge together after both green).
**Branch (planned):** off `codex/payroll-policy-setup` tip (`490bf6af`) in the codex worktree.
**Author date:** 2026-07-19.

Purpose: make payroll runs deterministically resolve, pin, and CONSUME the governed pay policy so the
policy actually drives the numbers. Precondition to enabling the release gate.

---

## 1. Objective

- Create (`finance_payroll_create_run_tx`): resolve the one active assignment+version covering the WHOLE
  run period; pin `(pay_policy_version_id, pay_policy_checksum)` in the same commit; fail-closed otherwise.
- Input-lock (`finance_payroll_lock_inputs_tx`): enforce the pinned version's source + costing rules against
  the employee sources; write exactly ONE immutable policy-evidence manifest row bound to the new
  `input_snapshot_id`.
- Calculate (`finance_payroll_calculation_start_tx` + `computeRunLine`): derive each employee's earning
  inputs from the pinned components (basis/rate/eligibility) using the snapshot manifest, then run the
  existing statutory math on the run's pinned `statutory_version_id`.
- Retirement/assignment-end affect FUTURE runs only; a pinned run is never invalidated.

## 2. Scope (REQUIRED / FORBIDDEN)

REQUIRED R1..R10 as detailed in Sections 5b/5c/6/8. FORBIDDEN/DEFERRED:
- N1 Phase B run-policy types. N2 back-fill / retroactive re-resolution. N3 multi-policy blend / per-employee
  override. N4 lock-time invalidation of a pinned run. N5 rich UI beyond Section 4. N6 enabling the release
  gate / merging before F-01+F-02 both green. N7 any F-01 change or JS compensating rollback.
- **N8 `working_days` proration is DEFERRED** (no holiday-calendar source exists; see DEC-PPR-010). F-02
  supports full-period + `calendar_days` + `approved_hours` and fail-closes a run whose pinned component
  uses `working_days`.

Dependencies: F-01 (OK); execution RPCs `finance_payroll_create_run_tx` / `_lock_inputs_tx` /
`_calculation_start_tx` (migs 420/421, OK); `finance_payroll_runs.{pay_group_id,pay_date,period_start,
period_end,current_input_snapshot_id}` (OK); operator applies the F-02 migration (D3).

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

## 4. UI inventory

| ID | Surface | Control | Wired to | Test |
|---|---|---|---|---|
| UI-PPR-001 | Run detail | pinned-policy chip (name/version/short checksum) | API-PPR-004 | vitest UT-PPR-U1 |
| UI-PPR-002 | Run detail | policy-evidence panel (component/source/costing arrays) | API-PPR-005 | vitest UT-PPR-U2 |
| UI-PPR-003 | Create-run | inline blocker on missing/ambiguous policy | API-PPR-001 | vitest UT-PPR-U3 |

Browser QA of these is auth-gated (passkey login, not automatable) -- covered by vitest component tests;
authenticated browser QA is a documented limitation recorded in release evidence, not a silent skip.

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

### 5c. Calculation formulas (executable; `round2` = 2-dp half-up at each step)

Policy-governed INPUT derivation (feeds `finance_payroll_run_inputs` -> `computeRunLine`); computeRunLine
itself is unchanged and owns statutory math (DEC-PPR-009):
- **Full-period salary** (`salary_period`, no proration flag / whole-period employment): `basePay =
  round2(rate)` where `rate` from `rate_source` (monthly).
- **calendar_days proration** (`salary_period`, `rule_parameters.proration='calendar_days'`): `basePay =
  round2(rate * calendarDaysEmployedInPeriod / calendarDaysInPeriod)`.
- **working_days proration**: DEFERRED (N8/DEC-PPR-010) -- fail-closed until a holiday-calendar source exists.
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
optionally accepts `inputSnapshotId` validated to belong to the run (history after relock).

No back-fill, no seed, idempotent, fix-at-source.

## 7. State machine

Run status unchanged. Create requires R1 pass (else no row). `draft -> input_locked` additionally requires
R4 pass. No lock-time policy-invalidation (N4).

## 8. Mutation ownership, lock order, failure matrix

**Ownership (one owner each, in-RPC, exact count):**
- SE-PPR-001 pin -> `finance_payroll_create_run_tx` (enriches `app_events 'payroll_run.created'`; no new event).
- SE-PPR-002 evidence -> exactly ONE row in `finance_payroll_lock_inputs_tx` (enriches
  `app_events 'payroll_run.inputs_locked'` with the evidence checksum).
- Resolution is internal (not a business mutation). Rejected create/lock -> ZERO business events (rollback).
- Conflict-outcome owners (finding #9): `create_review_finding`/`create_correction_candidate` ->
  execution/calc RPC inserts `finance_payroll_control_findings` (the existing creation owner, mig 421);
  `exclude_unapproved_input` -> omit input from snapshot; `block_employee_calculation` -> flag employee
  in snapshot, calc excludes; `block_input_lock` -> raise (fail-closed).

**Lock order (finding #8 -- separate for create vs lock):**
- Create: `pg_advisory_xact_lock(pay_group)` -> assignment `for share` -> version (read, immutable) ->
  INSERT run. (Cannot lock a not-yet-inserted run row.)
- Input lock: run `for update` -> input snapshot insert -> evidence insert.
- F-01 assignment-end must take a compatible lock on the assignment row (`for update`) -- verify in F-01
  `admin_command_tx` during implementation; concurrency test C-PPR-002.

**Failure matrix (exact `PR4xx -> HTTP`):**

| ID | Condition | Point | Code -> HTTP |
|---|---|---|---|
| FL-PPR-001 | no active assignment+version covering whole period (incl. version dates, finding #5) | create | `PR422 policy.missing` -> 422 |
| FL-PPR-002 | >1 covering active assignment (defensive; F-01 blocks overlap) | create | `PR409 policy.ambiguous` -> 409 |
| FL-PPR-003 | required source missing/unapproved, outcome `block_input_lock` | lock | `PR422 policy.source_missing:<type>` -> 422 |
| FL-PPR-004 | cost centre required and missing | lock | `PR422 policy.cost_centre_missing` -> 422 |
| FL-PPR-005 | pinned component uses `working_days` (N8) | create or lock | `PR422 policy.working_days_unsupported` -> 422 |

## 9. Permission matrix

Keys per Section 5 (all POST-only). Negative E2E: missing `finance.payroll.run.manage` -> 403 on
create/lock/calc; missing `finance.payroll.view_all` -> 403 on get/policy-evidence.

## 10. Cross-module

Reads F-01 tables (no writes; N7). Enriches existing `app_events`/audit; toasts on Section 4 surfaces.
Findings via the existing control-findings creation owner. DEC-PPR-003 block-only v1 (no
notification/message/ticket; no event on rejected tx).

## 11. Query, scale, concurrency

Resolution = one indexed lookup (Section 6c). Evidence bounded by policy size. Scale unchanged
(`MAX_RUN_EMPLOYEES=2000`); no per-employee policy fan-out (N3). Lock order per Section 8.

## 12. UX / a11y

Section 4 surfaces have real empty/loading/error/disabled states; UI-PPR-003 shows the typed FL-PPR-001
reason inline; resolved names, no raw UUIDs; aria/keyboard/focus.

## 13. Test scope

Live suite `scripts/e2e/suites/payrollPayPolicyRun.mjs` (:8888) asserts Section 8 ownership, exact
`app_events.event_type`, and evidence via the service-role client; tagged + FK-safe cleanup. Unit tests
(resolver whole-period+version-date boundary, defensive ambiguity, proration math, approved_hours) +
vitest UI component tests. Full 69-suite regression = combined F-01+F-02 pre-merge gate.

## 14. Decisions

| ID | Decision |
|---|---|
| DEC-PPR-001 | Pin at create; consume snapshot at calc; mirrors `statutory_version_id`. |
| DEC-PPR-002 | Fail-closed at create (missing/ambiguous/working_days) and lock (required source/costing). |
| DEC-PPR-003 | Block-only v1; no notification/message/ticket; no business event on a rejected tx. |
| DEC-PPR-004 | Retirement/assignment-end affect FUTURE runs only; pinned runs never invalidated; no back-fill. |
| DEC-PPR-005 | Whole-period coverage: assignment AND version effective window must cover `[period_start,period_end]`. |
| DEC-PPR-006 | One immutable evidence manifest per `input_snapshot_id` (unique); reopen -> new snapshot -> fresh manifest. |
| DEC-PPR-007 | Transactional RPC ownership (extend create/lock/calc RPCs); no JS compensating rollback. |
| DEC-PPR-008 | Release gate (no runtime flag); enable only after F-01+F-02 green, merged together. |
| DEC-PPR-009 | Run `statutory_version_id` authoritative for statutory math; policy governs earning inputs + statutory_profile requirement only. |
| DEC-PPR-010 | `working_days` proration DEFERRED (no holiday-calendar source); fail-closed until one is delivered. |
| DEC-PPR-011 | Pin stores `pay_policy_version_id` only (policy id derived); `pay_policy_required` invariant guards new runs. |

## 15. Approval

- [ ] User signs off Rev 3 (Sections 5b/5c/6/8 executable specifics; N8/DEC-PPR-010 working_days deferral).
- [ ] Then: F-02 branch; migration + resolver + RPC extensions + routes/UI + E2E; operator applies migration;
      live-verify on :8888.
- [ ] Then: combined F-01+F-02 full regression -> enable release gate -> merge both into `main`.
