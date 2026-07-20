# Payroll Pay-Policy-to-Run Integration (F-02) -- E2E Matrix -- Rev 3

Suite `scripts/e2e/suites/payrollPayPolicyRun.mjs` at `:8888`. Pairs with the Rev 3 delivery contract.
Assertions use the exact `PR4xx -> HTTP` contract and exact `app_events.event_type` values; side-effects
verified via the service-role client against named tables. Rows tagged `h.TAG`; FK-safe cleanup.

Exact tables/events asserted: `finance_payroll_runs` (pin cols), `finance_payroll_run_policy_evidence`
(one manifest per `input_snapshot_id`), `finance_payroll_control_findings` (conflict findings),
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
| E2E-PPR-007 | working_days deferral (N8/FL-PPR-005) | pinned component uses `working_days` proration | create or lock -> `PR422 policy.working_days_unsupported`; no snapshot. |
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

## Unit tests (states F-01 makes impossible live, + pure math)

| ID | Proves |
|---|---|
| U-PPR-001 | resolver defensive `>1 row` ambiguity branch (F-01 blocks overlap live). |
| U-PPR-002 | editing an `approved`/`active` version is REJECTED (`draft_command_tx` filters `status='draft'`) -> no checksum drift possible. |
| U-PPR-003 | whole-period predicate incl. version + assignment effective windows (boundary math). |
| U-PPR-004 | calendar_days proration + approved_hours math to the cent; `working_days` returns the deferred error. |

## vitest UI component tests

| ID | Proves |
|---|---|
| UT-PPR-U1 | pinned-policy chip renders name/version/short checksum; empty state when no pin. |
| UT-PPR-U2 | evidence panel renders component/source/costing arrays; loading/empty/error states. |
| UT-PPR-U3 | create-run inline blocker shows the typed `policy.missing`/`policy.working_days_unsupported` reason. |

(Authenticated end-to-end browser QA is passkey-gated and not automatable; recorded as a limitation in
release evidence -- the live E2E + vitest component tests are the behavioral proof.)

## Concurrency

- C-PPR-001: F-01 overlap constraint under concurrent assignment creation (2nd rejected).
- C-PPR-002: run input-lock vs F-01 assignment-end -- assignment-end takes `for update`; the pinned version
  is immutable, so lock is never corrupted.

Coverage: every REQUIRED R1-R10, every FL-PPR, all five conflict outcomes, and DEC-PPR-004/005/006/009/010
each map to >=1 named test.
