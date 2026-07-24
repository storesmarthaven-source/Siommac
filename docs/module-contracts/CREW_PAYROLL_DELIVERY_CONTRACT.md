# Crew Payroll — Delivery Contract

**Slice states (2026-07-24):** CP1 ✅ · CP2 ✅ applied · CP3 ✅ applied · CP4 ✅ Live-verified ·
CP5 ✅ Live-verified · CP6 ✅ Live-verified · CP7a ✅ Live-verified · **CP7b ✅ Live-verified**
(mig 20260921000000 APPLIED + probe-verified; crewPayroll 16/16 twice consecutively, tags
`TEST-E2E-1784864521220`/`-1784864711246`; financePayroll 137/137; one earlier 12/16 run did not
reproduce over four subsequent runs — consistent with a transient service-client fetch failure,
messages not captured) · **CP8 ✅ Implemented + data-contract Live-verified** (conditional
sections CrewPopulationControls / CrewInputReconciliation / CrewCostAllocation in the normal run
workspace, rendered only when `workspace.crew != null`; server-resolved `crewEmployeeNames` so no
raw ids render; vitest C1–C5 + crewPayroll 16/16 ×2 asserting the workspace contract incl. names;
browser journey = CP9) · CP9 Designed.
**Known gap (accepted until CP9/sign-off):** the F-01 policy wizard UI does not yet author
`per_qualifying_day` components (BE route + types accept them; a crew policy version's component
is currently seeded/managed via the governed API, not the wizard screen). Recorded here per
No-Band-Aids — not stubbed in the UI.
Nothing below is Implemented until its slice lands + is Live-verified + Regression-verified.

**CP7b rate model (user-locked 2026-07-24): `employee_contract` ONLY.** The policy governs HOW
(a `per_qualifying_day`/`crew_movement`/`employee_contract` component on the pinned version); the
crew assignment's canonical `hr_contracts` record governs WHAT rate (status active + effective
for every attributed qualifying date, `compensation_period='daily'`, `TTD`, amount > 0). Rates
resolve ONCE at input lock; per-allocation evidence
`{assignmentId, contractId, compensationAmount, currency, period, effectiveFrom, effectiveTo,
qualifyingDates, qualifyingDays, earningAmount=round2(rate×days)}` freezes into the snapshot as
one `crew_day_rate` input row per allocation; (re)calculation consumes only frozen rows. Seven
typed lock blockers (`crew.day_rate.contract_missing|contract_employee_mismatch|
contract_not_active|contract_not_effective|rate_period_invalid|currency_invalid|
rate_amount_invalid`) fail the lock atomically — no snapshot, no partial earnings. NO policy
rate table, NO override, NO dormant rate fields. `project`/`standby_callout` remain outside the
authorable unions (no engine).

**CP7a scope (delivered) vs CP7b (deferred, needs a locked rate decision):**
CP7a = calculation-stage crew EVIDENCE + findings, no earnings change: (1) qualifying-day
derivation from the FROZEN movement/assignment id sets only (movements are immutable; a
movement or correction recorded after lock is not in the set — CPE-25), with operational-
timezone date attribution and set-semantics dedupe (mobilize+embark same day, cross-midnight
disembark — CPE-20); (2) the §14.8 statutory gate enforced AT INPUT LOCK (frozen
`blockers.incompleteStatutoryProfile`; excluded crew employees get no snapshot lines, so the
publish population invariant holds) surfaced as an HR-owned BLOCKER finding
`crew_statutory_profile_incomplete` (CPE-21); (3) unapproved OT frozen at lock as
`excludedUnapprovedOvertime` and materialized as the ADVISORY finding
`crew_unapproved_overtime_excluded` — advisory findings never alter a computed line (CPE-19/24);
(4) per-line evidence in the immutable version line's `breakdown.crew` (qualifying dates, frozen
source ids, day boundary, per-assignment client/contract/asset/work-order/cost-centre allocation
whose day totals reconcile — CPE-23 day-level/CPE-26).
CP7b = the `per_qualifying_day` EARNINGS basis: expanding the component
calculation-basis/eligibility-source allowlists (migration), a TTD day-rate model
(policy_band vs employee_contract — **needs a user-locked decision**, like the client-FK
decision), engine + tests, and currency-level client/asset/work-order↔GL reconciliation.
No dormant rate inputs ship before that decision. A real HSE/medical/competency feed into
findings is likewise deferred (spec says "may"); CPE-24's invariant is proven via the advisory
OT finding leaving pay untouched.

**M5 decision (CP6):** run-LEVEL crew evidence is frozen as a typed `crew` block inside the
input snapshot's `source_summary` (immutable with the snapshot; surfaced by policy-evidence,
run-workspace and input-readiness reads via `lib/finance/payroll/crewRun.ts`). No new table —
per-LINE roster/movement/asset evidence is CP7's calculation-evidence deliverable and will be
assessed against `finance_payroll_run_policy_evidence` there.

## CP4–CP6 Checkpoint (2026-07-24) — FROZEN before CP7

**Checkpoint commits (branch `payroll-mockup-reskin`):** `43c48c72` (CP1–CP5) · `3a8498ea` (CP6).
**CP7 is NOT started.** CP7 touches calculation + immutable evidence — the same high-risk area
the payroll-certification workstream is actively changing on the shared live DB. Proceeding now
would recreate exactly the branch/DB drift that produced the 97-test baseline incompatibility
below. No further shared-DB changes from this branch until the freeze lifts.

### Live migration verification evidence (service-role probe, 2026-07-24T01:19:55Z)
| Check | Result |
|---|---|
| `hr_crew_assignments` | EXISTS; full 21-column select OK (id, assignment_no, employee_id, pay_group_id, policy_assignment_id, role, client_id, contract_id, asset_id, work_order_id, cost_center, contract_rate_reference, effective_from, effective_to, status, approval_state, approved_by, approved_at, created_by, created_at, updated_at) |
| `hr_crew_movements` | EXISTS; full 17-column select OK (id, movement_no, employee_id, movement_type, occurred_at, operational_timezone, asset_id, source_system, source_reference, approval_state, approved_by, approved_at, corrects_movement_id, correction_reason, created_by, created_at, updated_at) |
| `finance_pay_policy_versions.rotation_pattern_id` + `day_boundary` | present, selectable |
| `role_permissions` (finance_manager) | all 4 crew keys granted: assignments.manage, evidence.view, movements.correct, movements.record |
| Behavioral proof migrations are live | same-asset overlap exclusion, idempotent `(source_system,source_reference)` dedupe and 3-value `day_boundary` all exercised green by the E2E below |

### Exact SHA-256 checksums (as committed at `3a8498ea`)
| File | SHA-256 |
|---|---|
| `supabase/migrations/20260920000000_crew_payroll_core.sql` | `b4e9da8400ca6fe745099af0a020ef4db15244803def39a2ec2461f7661cc9c7` |
| `supabase/migrations/20260920000001_crew_payroll_permissions.sql` | `ad0215f82a39478bce37569269e404ffcbcb1abcae6494e1377ad13388ac0bd7` |
| `netlify/functions/lib/hr/crewAssignments.ts` | `9554bfa9ff4fe831dfa68ae57ae701ef10b4a2d51614c4d5eaa61e8c02f0e82f` |
| `netlify/functions/lib/hr/crewMovements.ts` | `c948915fabf633d74255fca1c2b0559e3e399789692a992ffc563164bf5f65e7` |
| `netlify/functions/routes/hrCrew.ts` | `eac8021a66f7f08bfcca5fd3f7633c3e9c25f71efb3d16bf6a2c0a7f90642f96` |
| `netlify/functions/lib/finance/payroll/crewRun.ts` | `6ff95af8184352eba54591a1e553a0a9ecfc861aaf2ba83af9ec828f2fafea34` |
| `scripts/e2e/suites/crewPayroll.mjs` | `ee6ebb55fcbc548e3b00d1884a0b30ae93483a605c90abf101f5902b6439aba6` |

Note: the DEPLOYED definition of `finance_payroll_create_run_tx` on the live DB cannot be read
through PostgREST (no pg_proc access) and does NOT match this branch's migration 711 — see the
baseline incompatibility below. Its live behavior is characterized only by probe: it accepts
`p_attestations` and rejects creation unless all three creation attestations are true.

### E2E results (live dev server :8888, worktree build)
- CP4/CP5 initial pass: **6/6 green** (tag `TEST-E2E-1784853410626`) — CPE-01/02/04/05/06 + 401/403.
- CP4–CP6 full suite: **crewPayroll 12/12 green** (tag `TEST-E2E-1784854797404`) — adds
  CPE-15/16/17/18/22/27(pos+neg), exact-count side-effect and frozen-snapshot assertions.

### Baseline incompatibility — financePayroll 40 passed / 97 FAILED on this branch
The live DB's `finance_payroll_create_run_tx` and run seeds have moved ahead of this branch:
run creation now demands three creation attestations (`purposeScopeAndDatesReviewed`,
`preflightLimitationsAcknowledged`, `separationOfDutiesAcknowledged`) and
`finance_payroll_runs.statutory_version_id` is NOT NULL for direct seeds. This branch's
`runs/create` route and the legacy suite helpers predate both, so ~97 financePayroll tests fail
at run CREATE and cascade (`requires a run id`). Verified: **zero** of the 100 failure messages
reference crew / policy-evidence / workspace / input-readiness surfaces.
**Resolution is NOT assumed.** Whether/when another workstream's merge restores this baseline is
unverified. The crew branch will: (1) wait for WP-3/WP-4 to land the FINAL create-run, workspace,
error-envelope and capability contracts on main; (2) rebase onto that committed main state;
(3) adapt crew code to those contracts (required creation attestations, authoritative workspace
action capabilities, typed errors, atomic loading/error behavior, and the then-current
`payrollRuns.ts` + migration-711 calculation logic).

### CP7 entry gates — ALL SATISFIED 2026-07-24 (post-rebase onto main `cc3df4a2`)
The branch was rebased onto main after WP-1..6 landed (typed error envelope, server-computed
run actions, persisted creation attestations, atomic workspace gate, P1-8/P1-9 semantics) and
the crew code adapted: workspace DTO carries BOTH `actions` (P0-2) and `crew` (CP6);
`routes/hrCrew.ts` emits the shared `PayrollApiErrorEnvelope` (typed dotted codes — the crew
libs' `crew.assignment_overlap` convention lifts directly); the E2E creates runs through the
normal HTTP `runs/create` route with the three strict creation attestations (RPC shortcut
REMOVED) and asserts `error.code === 'crew.assignment_overlap'` + correlationId on CPE-02.
| Gate | Result |
|---|---|
| 1. BE + FE typechecks | BE clean; FE clean except 2 pre-existing errors in `src/ui/widgets/WidgetBoardZone.tsx` — file byte-identical to main, 0 errors from the main checkout; worktree node_modules-junction realpath artifact, not code |
| 2. `payrollCreateAttestations` | 7/7 green (tag `TEST-E2E-1784857060921`) |
| 3. `financePayroll` | **137/137 green** — baseline restored (tag `TEST-E2E-1784857111675`) |
| 4. `crewPayroll` twice | 12/12 (tag `TEST-E2E-1784857486050`) then 12/12 (tag `TEST-E2E-1784857629094`) |
| 5. Ordinary runs → `crew: null` | asserted 3 ways in-suite: input-readiness on the standard group, standard-run workspace, standard-run policy-evidence |
| 6. Crew run via normal HTTP route | `createRunFixture` now calls `finance/payroll/runs/create` with attestations; no direct-RPC path remains in the suite |
Frontend vitest after rebase: 474/474. **CP7 may start.**

Authoritative spec: **§14 "Pay Policies and Conditional Work-Pattern Controls"** and **§9.4**
of the payroll-enterprise `CLAUDE_IMPLEMENTATION_SPEC.md`. Where this contract and an older
doc disagree, §14/§9.4 win.

## 0. Boundary (non-negotiable)
- Crew/offshore/marine/rotation is **NOT a second payroll engine**. It is a **conditional
  capability of the normal Payroll Run page**, enabled by the **resolved pay-policy version's
  typed capabilities**, and backed by **real HR crew assignment + movement data**.
- **One run, one state machine, one run page.** Do NOT fork a crew run flow. (§14.1, §14.7)
- **No `crew-*` routes, page identifiers, or generic crew navigation labels.** Crew/offshore/
  marine/rotation/movement/asset terminology appears only after the resolved policy enables it.
  (§9.4 line 471) The prior off-spec `finance/payroll/runs/crew-workspace` route + `crew*` files
  were reverted for exactly this reason.
- Server resolves the policy version from **pay group + pay date**; a processor cannot pick a
  policy inside a run. A change is a new effective assignment/version + new/correction run. (§14.1)
- **Do not fabricate movement data from attendance.** Attendance (`hr_attendance_records`)
  supports **payable-day** evidence only; embark/disembark/transfer come from
  `hr_crew_movements` once that domain exists. (user directive + §14.2)
- **Delivery scope = local TT employees paid in TTD.** Expat/foreign-worker, reciprocal
  agreements, foreign currency, split-currency are **deferred** — no dormant inputs/columns/UI
  until explicitly approved. (§14.1)

## 1. Delivery states
Designed → Implemented → Live-verified → Regression-verified → Released. Never call a slice
"done" while merely Designed/Implemented. Each slice below lands independently and is verified
against the live dev server before the next starts (build order §14.10 / this doc §9).

## 2. Data model
### 2.1 Reuse (do NOT copy into policy-owned tables) — §14.2
`hr_rotation_patterns`, `hr_shift_templates`, `hr_rosters`, `hr_shift_assignments`,
`hr_attendance_records`/`hr_timesheets`, `finance_pay_groups` + effective membership,
`finance_pay_components`, `hr_employee_pay_items`, the approved statutory-version model.

### 2.2 Existing pay-policy tables (F-01/F-02 — extend, don't re-create)
`finance_pay_policies`, `finance_pay_policy_versions`, `finance_pay_policy_components`,
`finance_pay_policy_source_rules`, `finance_pay_policy_costing_rules`,
`finance_pay_group_policy_assignments`, `finance_payroll_run_policy_evidence` (run snapshot).

### 2.3 Schema changes (CP2) — §14.3
| Change | Table | Detail |
|---|---|---|
| M1 | `finance_pay_policies` | Expand `policy_type` allowlist → `standard_salary \| hourly_shift \| project \| offshore_rotation \| marine_voyage \| standby_callout`. Data migration keeps existing rows. |
| M2 | `finance_pay_policy_versions` | Add nullable **work/rotation-pattern FK** (`rotation_pattern_id` → `hr_rotation_patterns`) + any day-boundary/offshore-day fields not already present. Approved/active versions stay immutable. |
| M3 (NEW) | `hr_crew_assignments` | employee (text→app_users), pay group FK, policy-assignment FK, role, TTD contract/rate refs, effective from/to, status, approval evidence. Canonical dimension FKs (all uuid): **client → `finance_ar_customers`** (nullable ONLY where policy/work type permits — never free-form text), **contract → `hr_contracts`**, **asset → `ops_assets`**, **work order → `ops_work_orders`**, cost centre → `app_users.cost_center` code. **Site: NO column** — derived from `ops_assets.site_id` for display/reconciliation only (canonical `ops_sites` is a future Ops slice; if no asset, site absent). **Prevent overlapping active assignments where policy disallows simultaneous asset allocation.** (Decisions locked 2026-07-23.) |
| M4 (NEW) | `hr_crew_movements` | employee, `embark \| disembark \| transfer \| mobilize \| demobilize`, occurred ts + operational tz, canonical asset/site, source system/reference, approval state, actor/time. **Unique source business key (idempotent import).** Index (employee,time) + (asset,time). Correction never overwrites — reversal/correction relationship column. |
| M5 | run snapshot/evidence | Assess `finance_payroll_run_policy_evidence`. If it can't retain roster/movement/asset evidence per line, add a crew-evidence extension (immutable, one per run/calc version). Manifest = evidence, not an editable rule store. |
All mutable tables: `created_at`, `updated_at` + canonical update trigger; user FK = `text`
→ `app_users(id)`; **RLS enabled, service-role grant only**; canonical client/contract/site/asset
FKs (no free-form `vessel_name`/`platform_name`/`client_name` as permanent identity).

## 3. Typed rule contract additions (CP2/CP7) — §14.4
Extend the allowlisted unions (validate at API boundary AND activation tx; reject unknown combos):
- `PayCalculationBasis` += `per_qualifying_day \| per_approved_shift \| approved_event \| policy_multiplier`
- `PayEligibilitySource` += `roster_movement_time \| active_asset_assignment \| shift_template \| crew_movement \| approved_callout \| approved_holiday_shift`
Adding a basis = calculation-engine code + tests, not a data-only change.

## 4. Endpoint inventory (POST-only, `requirePermission`) — §14.6
| ID | Route | Gate | Mutation? | Owner slice |
|----|-------|------|-----------|-------------|
| EP-CA-1 | `hr/crew/assignments/list` | view crew evidence | read | CP4 |
| EP-CA-2 | `hr/crew/assignments/create` | manage crew assignments | write | CP4 |
| EP-CA-3 | `hr/crew/assignments/update` | manage crew assignments | write | CP4 |
| EP-CA-4 | `hr/crew/assignments/end` | manage crew assignments | write | CP4 |
| EP-CM-1 | `hr/crew/movements/list` | view crew evidence | read | CP5 |
| EP-CM-2 | `hr/crew/movements/record` | record crew movements | write | CP5 |
| EP-CM-3 | `hr/crew/movements/correct` | correct crew movements | write | CP5 |
| EP-RUN | extend existing run preflight / input-snapshot / **run-workspace read** | `finance.payroll.view_all` (read); existing run gates (write) | mixed | CP6 |
No new run route, no crew-workspace route. Crew data rides the **existing** run-workspace read
contract as conditional fields, surfaced only when the resolved policy enables the capability.

## 5. Permissions (CP3) — §14.8
New catalogue keys (exact strings TBD against the catalogue, registered + drift-guarded):
`finance.payroll.crew.assignments.manage`, `finance.payroll.crew.movements.record`,
`finance.payroll.crew.movements.correct`, `finance.payroll.crew.evidence.view`.
Preparer ≠ activation approver retained. Only employees with approved local PAYE/NIS/Health
Surcharge profiles pass; unsupported classifications are **rejected**, not accepted-and-ignored.

## 6. §2 side-effect ownership (exact-count assertions)
Each write has exactly ONE owner emitting app_events + audit_logs (+ notifications/findings/
outbox where rules require). Assert EXACT counts (no `>= 1` where the contract says one):
| Mutation | app_events | audit_logs | other |
|---|---|---|---|
| assignment create/update/end | 1 each | 1 each | — |
| movement record | 1 | 1 | idempotent replay ⇒ +0 |
| movement correct | 1 | 1 | reversal/correction row; original untouched |
| policy activation (existing) | 1 | 1 | workflow decision, notifications, supersede prior |
| run calc (existing, extended) | 1 per calc version | ≥1 | crew findings materialized atomically |

## 7. Run creation / calculation extension (CP6/CP7) — §14.5
- Preflight (crew-enabled policy): roster publication, expected crew, assignment/movement/
  approved-time/leave reconciliation totals, missing/overlapping assignment counts, rate/statutory
  gaps, TTD bank/disbursement readiness, client/asset/work-order/GL allocation readiness.
- Run create writes run + policy snapshot + app_event + audit atomically. Input lock snapshots
  every source id/version/checksum. **Calc reads ONLY frozen snapshots + manifest** — never
  re-reads mutable policy mid-calc.
- Per-line evidence: qualifying date/event, source ids, component rule, TTD rate source/version,
  amount, costing dims; crew policies also retain roster/movement/asset evidence.
- **One source event ≠ duplicate earnings** (cross-midnight, mobilize/demobilize dedupe).
- Mismatches → normalized `finance_payroll_control_findings`. **HSE/medical/competency alerts
  create review findings but NEVER auto-suppress earned pay** — any pay effect needs an authorized
  payroll/employment decision.

## 8. Frontend (CP8) — §14.7
Normal run page conditionally renders crew sections from **typed workspace data** only when the
policy capability enables them:
```
src/components/sections/Finance/payroll/run/
  CrewPopulationControls.tsx     // crew population: role, client/asset, rotation, qualifying days
  CrewInputReconciliation.tsx    // roster vs movement vs approved time/leave reconciliation
  CrewCostAllocation.tsx         // client/asset/work-order costing
```
Reuse the approved run shell. No standalone crew page, no generic crew nav. TanStack Query;
server-side draft persistence w/ optimistic concurrency; URL-persisted tab state; paginated +
server-filtered worker lists.

## 9. Delivery order (§14.10) — slice gates
CP2 migration → CP3 permissions → CP4 assignment cmds → CP5 movement cmds (idempotent import) →
CP6 run preflight/snapshot/read → CP7 calc evidence → CP8 FE conditional sections → CP9 full live
E2E, then typecheck + `npm run test:e2e` once at the final gate. **Each slice live-verified before
the next.** Migrations require operator application; flag before any live/E2E step.

## 10. Non-goals / deferred
Expat/foreign-worker, reciprocal agreements, foreign currency, split-currency; a second payroll
engine; crew-* routes/nav; faking movements from attendance. E2E matrix: `CREW_PAYROLL_E2E_MATRIX.md`.
