# Crew Payroll — Delivery Contract

**Slice states (2026-07-23):** CP1 ✅ · CP2 ✅ applied · CP3 ✅ applied · CP4 ✅ Live-verified ·
CP5 ✅ Live-verified · CP6 ✅ Live-verified (crewPayroll E2E 12/12) · CP7–CP9 Designed.
Nothing below is Implemented until its slice lands + is Live-verified + Regression-verified.

**M5 decision (CP6):** run-LEVEL crew evidence is frozen as a typed `crew` block inside the
input snapshot's `source_summary` (immutable with the snapshot; surfaced by policy-evidence,
run-workspace and input-readiness reads via `lib/finance/payroll/crewRun.ts`). No new table —
per-LINE roster/movement/asset evidence is CP7's calculation-evidence deliverable and will be
assessed against `finance_payroll_run_policy_evidence` there.

**Known cross-branch drift (not CP6 scope):** the live `finance_payroll_create_run_tx` now
enforces the creation-attestation gate (+ NOT NULL `statutory_version_id` seeds) from the
payroll-certification workstream; this branch's `runs/create` route predates it, so the legacy
financePayroll suite fails at run CREATE on this branch until that workstream merges. The
crewPayroll suite creates its fixture runs through the real RPC (with attestations) and is green.

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
