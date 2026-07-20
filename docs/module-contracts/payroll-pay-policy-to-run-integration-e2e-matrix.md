# Payroll Pay-Policy-to-Run Integration (F-02) -- E2E Matrix -- Rev 4.1

Suite `scripts/e2e/suites/payrollPayPolicyRun.mjs` at `:8888`. Pairs with the Rev 4.1 delivery contract
(conditional-sign-off corrections: create `for share`/C-PPR-003, F-02-owned zero-denominator, route-unreachable
branches → U-PPR-007, real correction lifecycle E2E-PPR-041, `app_users.start_date/end_date` clamp, browser-QA
required gate, PERF-PPR-001 benchmark).
Assertions use the exact `PR4xx -> HTTP` contract and exact `app_events.event_type` values; side-effects
verified via the service-role client against named tables. Rows tagged `h.TAG`; FK-safe cleanup. The
`working_days` cases provision a published F-CAL work calendar + pay-group assignment **through F-CAL's own
authenticated routes** (never by writing F-CAL tables directly) so the resolver exercises real published data.

Exact tables/events asserted: `finance_payroll_runs` (policy + **calendar** pin cols),
`finance_payroll_run_policy_evidence` (one manifest per `input_snapshot_id`),
**`finance_payroll_run_calendar_evidence` (one row per working_days employee per `input_snapshot_id`)**,
`finance_payroll_control_findings` (conflict findings),
`app_events.event_type in ('payroll_run.created','payroll_run.inputs_locked','payroll_run.calculated')`.

## Live E2E

| ID | Proves (ref) | Setup | Assertion |
|---|---|---|---|
| E2E-PPR-001 | provisioning | -- | finance user (`run.manage`), pay group, F-01 active version assigned, covering the period. |
| E2E-PPR-002 | resolve+pin (R1,R2) | assignment+version cover whole period | create -> DTO `payPolicy`; run `pay_policy_version_id/checksum/pay_policy_required=true`; exactly one `app_events 'payroll_run.created'` carrying the pin; no resolve event. |
| E2E-PPR-003 | whole-period vs pay_date-only (DEC-PPR-005) | assignment covers pay_date but not period_start | create -> `PR422 policy.missing` -> 422; no run row. |
| E2E-PPR-004 | assignment date boundary | effective_from=period_start, effective_to=period_end pass; move either in by 1 day fail | create passes / `policy.missing`. |
| E2E-PPR-005 | VERSION date boundary (finding #5) | assignment covers period but version.effective_to < period_end | create -> `policy.missing`; no run row. |
| E2E-PPR-006 | missing policy (FL-PPR-001) | group with no active assignment | create -> `PR422 policy.missing`; assert no run row AND no `app_events` for tag. |
| E2E-PPR-007 | working_days resolve+pin (R11/SE-PPR-003) | policy binds a `working_days` component; published work calendar assigned to the pay group covering the whole period | create -> run carries `work_calendar_version_id/holiday_calendar_version_id/work_calendar_checksum/holiday_calendar_checksum` + `calendar_resolution{scope,assignmentId,periodDenominator>0,periodExcluded[]}`; exactly one `payroll_run.created` (enriched, no new event); non-working_days policy leaves all five calendar cols NULL. |
| E2E-PPR-008 | one manifest per snapshot (R3,DEC-PPR-006) | pinned run | lock -> exactly ONE `finance_payroll_run_policy_evidence` row (`unique(input_snapshot_id)`) with component/source/costing arrays + checksum; `app_events 'payroll_run.inputs_locked'` carries the checksum. |
| E2E-PPR-009 | reopen THEN relock (R3,DEC-PPR-006) | locked run -> reopen -> relock | new `snapshot_no` gets a FRESH single manifest bound to the new `input_snapshot_id`; prior manifest retained; run `current_input_snapshot_id` advances. |
| E2E-PPR-010 | required approved_time missing (FL-PPR-003) | source_rule `approved_time` required, none, outcome block_input_lock | lock -> `PR422 policy.source_missing:approved_time`; no snapshot/evidence; status `draft`. |
| E2E-PPR-011 | approved_compensation missing (FL-PPR-003) | source_rule `approved_compensation` required, none | lock -> `PR422 policy.source_missing:approved_compensation`. |
| E2E-PPR-012 | approved_leave missing (FL-PPR-003) | source_rule `approved_leave` required, none | lock -> `PR422 policy.source_missing:approved_leave`. |
| E2E-PPR-013 | statutory_profile missing (R6) | required, none | lock -> `PR422 policy.source_missing:statutory_profile`. |
| E2E-PPR-014 | payment_destination missing | required, no `finance_employee_bank_accounts` primary | lock -> `PR422 policy.source_missing:payment_destination`. |
| E2E-PPR-015 | cost centre missing (FL-PPR-004) | costing_rule required, employee `cost_center` null | lock -> `PR422 policy.cost_centre_missing`. |
| E2E-PPR-016 | conflict outcome `exclude_unapproved_input` | source_rule outcome exclude | lock succeeds; excluded employee/input ABSENT from snapshot; count asserted. |
| E2E-PPR-017 | conflict outcome `create_review_finding` | source_rule outcome finding | lock succeeds; exactly one `finance_payroll_control_findings` row created by the execution RPC. |
| E2E-PPR-018 | conflict outcome `create_correction_candidate` | source_rule outcome correction | lock succeeds; exactly one control finding of the correction kind. |
| E2E-PPR-019 | conflict outcome `block_employee_calculation` | source_rule outcome block-employee | lock succeeds; employee flagged; calc excludes that employee's line. |
| E2E-PPR-020 | standard_salary EXACT amount (5c) | `salary_period`, calendar_days proration, known rate | calc -> line base = `round2(rate*daysEmployed/daysInPeriod)`, to the cent. |
| E2E-PPR-021 | hourly_shift EXACT amount (5c) | `approved_hours`, known hours+rate | calc -> component = `round2(hours*rate)`, to the cent. |
| E2E-PPR-022 | eligibility exclusion (5c) | component eligibility_source unmet for one employee | that employee's component omitted; others unaffected. |
| E2E-PPR-023 | calc consumes snapshot not live (R5,R7) | calculated run; then create a new live version | recalc -> lines unchanged; `pay_policy_version_id` unchanged. |
| E2E-PPR-024 | statutory relationship (R6,DEC-PPR-009) | policy requires statutory_profile; run pins statutory X | statutory math uses run `statutory_version_id`; policy does not override. |
| E2E-PPR-025 | recalc reuses pinned version (R7) | calculated run | new calc version -> same `pay_policy_version_id` + same manifest; no re-resolution. |
| E2E-PPR-026 | policy changes numbers (R10 headline) | two groups, two different policies | two runs -> different lines with NAMED expected amounts per policy. |
| E2E-PPR-027 | lock idempotency (R3) | pinned run | repeat identical lock (same key) -> original snapshot; no duplicate evidence/events. |
| E2E-PPR-028 | pinned run survives retirement then reopen+relock (R7,DEC-PPR-004) | locked run; retire policy / end assignment; reopen; relock | relock still succeeds on the pinned version (fresh manifest, same version); a NEW run for the group -> `policy.missing`. |
| E2E-PPR-029 | concurrent create vs assignment-end (Sec 11) | resolve begins; assignment ended concurrently | run created with valid pin OR clean `policy.missing`; never a half-pinned run. |
| E2E-PPR-030 | no side-effects on rejected ops (R9) | force FL-PPR-001/003/004/005 | zero run/snapshot/evidence rows AND zero `app_events` for the tag after each. |
| E2E-PPR-031 | no duplicate events (R9) | successful create then lock | exactly one `payroll_run.created` and one `payroll_run.inputs_locked` (enriched, not duplicated). |
| E2E-PPR-032 | access-control negatives (Sec 9) | real user missing each key | 403 on create/lock/calc without `run.manage`; 403 on get/evidence without `view_all`. |
| E2E-PPR-033 | read surface (R8) | pinned run + relock | run get returns exact `payPolicy`; policy-evidence defaults to `current_input_snapshot_id`, accepts explicit `inputSnapshotId` for history, resolves names (no raw UUID). |
| E2E-PPR-034 | calendar unresolved (FL-PPR-005) | working_days policy; pay group has NO covering work-calendar assignment | create -> `PR422 calendar.unresolved`; no run row; zero `app_events` for tag. |
| E2E-PPR-035 | calendar split-period (FL-PPR-006) | two adjacent pay-group calendar assignments jointly span the period, neither contains it | create -> `PR422 calendar.split_period`; no run row (never falls back to org). |
| E2E-PPR-036 | version unpublished / holiday-unpublished / uncovered (FL-PPR-007..009) — **NOT LIVE** | — | Valid F-CAL routes cannot assign a draft or window-uncovered version (F-CAL `assign` rejects both), so these `resolve` branches are route-unreachable. Covered at DB-function level in **U-PPR-007** — no live fixture (live fixtures are always F-CAL-route-created). |
| E2E-PPR-037 | jurisdiction mismatch (FL-PPR-010) | TT pay group route-assigned a non-TT holiday-set calendar (F-CAL `assign` allows it; `resolve` rejects) | create -> `PR422 calendar.jurisdiction_mismatch`; no run row. |
| E2E-PPR-038 | zero denominator — **F-02-raised** (FL-PPR-011/DEC-PPR-017) | working_days policy over a fully non-working range (all weekend/holiday) | `work_calendar_working_days` returns `count='0'` (does not raise) → `create_run_tx` detects it and raises `PR422 calendar.zero_working_days`; no run row/pin. |
| E2E-PPR-039 | working_days EXACT amount (R12/R13, 5c) | published calendar, known pattern+holidays, employee employed the WHOLE period, named rate | lock -> one `finance_payroll_run_calendar_evidence` row `numerator==denominator`, `excluded` matches the period; calc -> base = `round2(rate * numerator/denominator)` == `round2(rate)`, to the cent. |
| E2E-PPR-040 | employment-clamp numerator (R12/DEC-PPR-013) | employee starts mid-period (empFrom > period_start) | evidence `numerator < denominator` with `clamp_from=empFrom`; base = `round2(rate * numerator/denominator)` (named number); a NON-intersecting employee -> `numerator=0`, base `0.00`, no failure. |
| E2E-PPR-041 | calc consumes pinned calendar via the REAL correction lifecycle (R13/DEC-PPR-004) | calculated working_days run pinned to work-cal **vX**; correct the calendar the only legal way through F-CAL routes: `copy_version(vX)`→new draft → edit the draft (change a weekday/holiday) → `publish` (vX→**superseded**, **vY** published) → `end_assignment`/`cancel_assignment` the old assignment → `assign` the new published **vY** over a later window (a published version/holiday is never edited in place) | recalc of the LOCKED run -> lines + `numerator/denominator` UNCHANGED and run `work_calendar_version_id` still **vX** (immutable pin); a NEW run over a period the vY assignment covers pins **vY** and yields the corrected numbers. |
| E2E-PPR-042 | calendar evidence read (R8) | pinned working_days run | policy-evidence DTO `calendar` block returns resolved calendar/holiday NAMES + short holiday checksum + resolution scope + `periodDenominator` + per-employee `employees[]` (numerator/denominator/excludedCount), no raw UUID. |
| E2E-PPR-043 | one calendar-evidence row per employee per snapshot (R12) | working_days run, N employees, then reopen+relock | exactly N rows `unique(input_snapshot_id, employee_id)`; relock -> fresh N rows on the new snapshot, prior retained; no duplicates. |

## Unit tests (states F-01 makes impossible live, + pure math)

| ID | Proves |
|---|---|
| U-PPR-001 | resolver defensive `>1 row` ambiguity branch (F-01 blocks overlap live). |
| U-PPR-002 | editing an `approved`/`active` version is REJECTED (`draft_command_tx` filters `status='draft'`) -> no checksum drift possible. |
| U-PPR-003 | whole-period predicate incl. version + assignment effective windows (boundary math). |
| U-PPR-004 | calendar_days proration + approved_hours math to the cent. |
| U-PPR-005 | working_days math: `basePay=round2(rate*numerator/denominator)`; employment clamp `[max(start,empFrom),min(end,empTo)]`; empty window -> numerator 0 -> base 0; `numerator<=denominator`; fractional-day denominators honored. |
| U-PPR-006 | calendar pin all-or-nothing invariant + conditional pin (working_days policy pins; non-working_days leaves the five cols null); `period_denominator>0` guard. |
| U-PPR-007 | route-unreachable `resolve` branches, driven at the DB-function level (states an F-CAL route cannot create): assigned draft/non-published work version -> `calendar.version_unpublished`; referenced draft holiday version -> `calendar.holiday_set_unpublished`; assignment window not contained by the version window -> `calendar.version_period_uncovered`. Each raises its exact `PR422 calendar.*`. |
| U-PPR-008 | zero-denominator ownership: `work_calendar_working_days` over a fully non-working range returns `count='0'` and does NOT raise; the create path's own guard raises `calendar.zero_working_days` (DEC-PPR-017). |

## vitest UI component tests

| ID | Proves |
|---|---|
| UT-PPR-U1 | pinned-policy chip renders name/version/short checksum; empty state when no pin. |
| UT-PPR-U2 | evidence panel renders component/source/costing arrays; loading/empty/error states. |
| UT-PPR-U3 | create-run inline blocker shows the typed reason for `policy.missing` AND the calendar codes (`calendar.unresolved`/`.split_period`/`.zero_working_days`/…). |
| UT-PPR-U4 | work-calendar chip renders calendar name/version + short holiday checksum + scope; hidden when the run has no calendar pin (non-working_days). |
| UT-PPR-U5 | working-days evidence rows render per-employee numerator/denominator/period/excluded-count with resolved names (no raw UUID); loading/empty/error states. |

**Authenticated operator browser QA is a REQUIRED release gate** (passkey login is operator-only, not
agent-automatable): the operator walks UI-PPR-001..005 — pinned-policy chip, work-calendar chip, evidence
panel (policy + working-days rows), create-run typed blockers — at supported desktop widths + a mobile width,
and records operator/date/env/browser/result in release evidence. The vitest component tests are necessary but
NOT sufficient; release is blocked until this gate is signed off (contract §4/§12/§15).

## Concurrency

- C-PPR-001: F-01 overlap constraint under concurrent assignment creation (2nd rejected).
- C-PPR-002: run input-lock vs F-01 assignment-end -- assignment-end takes `for update`; the pinned version
  is immutable, so lock is never corrupted.
- **C-PPR-003 (create vs calendar end/cancel — DEC-PPR-016):** a working_days create resolves, then an F-CAL
  `end_assignment`/`cancel_assignment` of the RESOLVED assignment runs concurrently. The create's `for share` +
  revalidation yields EITHER a valid pinned run (end/cancel blocked behind the share lock until create commits)
  OR a clean `calendar.unresolved`/`calendar.split_period` (end/cancel committed first) — **never a half-pinned
  run**. Assert both interleavings (end-first and share-first) leave a consistent state and correct pin/no-pin.

## Performance

- **PERF-PPR-001 (2000-employee lock-inputs benchmark — DEC-PPR-020):** lock-inputs a `MAX_RUN_EMPLOYEES=2000`
  working_days run and assert (a) EXACTLY one `work_calendar_working_days` call per working_days employee (N
  calls, no N² / no per-occurrence re-query), and (b) wall-clock within the lock-inputs budget. Guards the
  once-per-employee calendar fan-out; if it regresses, memoize identical `(version, clampFrom, clampTo)` windows.

Coverage: every REQUIRED R1-R13, every FL-PPR-001..011, all five conflict outcomes, and
DEC-PPR-004/005/006/009/010/012..020 each map to >=1 named test. The `working_days` path (E2E-PPR-007, 034-043
+ U-PPR-005/006/007/008 + C-PPR-003 + PERF-PPR-001 + UT-PPR-U4/U5) provisions its F-CAL fixtures via F-CAL's
routes only (N7b: no direct F-CAL table writes, no F-CAL code change); route-unreachable branches (FL-PPR-007/
008/009) are unit/DB-only (U-PPR-007).
