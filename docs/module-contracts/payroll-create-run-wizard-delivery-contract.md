# Create-Run Wizard — Delivery Contract (Slices 0–4)

**Goal:** the New Payroll Run wizard faithfully matches `mockups/payroll-enterprise/create-run.html`
(full-page, 7 steps) with **only backend-honored fields** — no accept-and-drop.

**Delivery states:** Designed → Implemented → Live-verified → Regression-verified → Released.
NEVER label a slice "done" while merely Implemented (unapplied migration = not verified).

**Hard constraint (why 1–4 are not yet built):** DB migrations are **operator-applied** (Supabase SQL
editor) — this environment has no direct Postgres/DDL path. So Slices 1–4 cannot be live-verified by
the agent; each must be built **with** an operator who applies its migration and runs its E2E.

---

## Slice 0 — Foundation ✅ LIVE-VERIFIED (frontend), committed `6997fcf6`
- Full-page `.pcrw` wizard (`PayNewRunWizard.tsx` + `payrunWizard.css`), mounted in-place in
  `PayrollCommandCenter` like `PayRunDetailPage`.
- **Fixed the createRun contract bug**: route requires `idempotencyKey`+`runType`+`periodStart`+
  `periodEnd`; the old modal sent `periodMonth` → zod-failed. `CreateRunArgs` + submit now send the
  exact contract (caller-owned idem key, runType, derived period start/end, sourceRunId for corrections).
- Backed steps real (Run Type, Pay Group, Period & Dates, Statutory read-only, Population counts,
  Review + confirmations). Unbacked steps render honest "pending — Slice N" states.
- Gate: `typecheck:frontend` 0; Vite transforms module+CSS (200). No DB change.

---

## Slice 1 — Run metadata  ·  Designed  ·  RISK: HIGH (transactional RPC)
Fields: reason code, payroll owner (≠ creator), time/OT cut-off, approval deadline, funding date,
release window, internal description.

**Migration** `..._finance_payroll_run_metadata.sql`
- `alter table finance_payroll_runs add column payroll_owner_id text references app_users(id)`,
  `reason_code text`, `ot_cutoff_date date`, `approval_deadline timestamptz`,
  `funding_date date`, `release_window text`, `internal_description text`.
- New lookup `finance_payroll_reason_codes (code pk, label, run_type, active)` + idempotent seed.
- **Extend `finance_payroll_create_run_tx`** (mig 711): add the new params AFTER the existing ones
  (keep positional order), **add each to the `v_hash` jsonb** (idempotency correctness), insert into
  the new columns. Do NOT reorder existing params. Do NOT touch the policy/calendar pin blocks.
  Default owner = `p_actor_id` when null. `security invoker` + `set search_path` unchanged.

**Route** `financePayroll.ts` `/payroll/runs/create` — extend the zod object with the optional
metadata; pass through `createPayrollRun` → `createPayrollRunCommand` → RPC params.

**Frontend** — replace the Step-1 read-only owner/run-number and the Step-3 "pending" cut-offs with
real fields: reason-code `<select>` (from a `reasonCodes` list endpoint or the lookup), owner picker
(app_users with the payroll role), the four extra dates, description `<textarea>`.

**E2E** `payrollCreateRunMeta.mjs` — create with metadata → assert row columns; idempotency: same key
+ same metadata = dedupe, same key + different metadata = PR409; reason-code FK invalid → 422.

---

## Slice 2 — Population reconciliation  ·  Designed  ·  RISK: MED (read-only, additive)
Step-5 per-rule table + department distribution + prior-run comparison.

**Route** new `POST /payroll/runs/population-reconciliation { payGroupId, periodStart, periodEnd }`
returning:
```
{ rules: [{ key, label, count, rule, ownerRole, state:'included'|'review'|'blocker'|'warning', action }],
  departments: [{ departmentId, name, count }],
  priorRun: { runId|null, releasedPopulation, added, removed, proposed } }
```
- Reuse the population-preview query for the base counts; add: per-rule breakdown (new hires,
  terminations, missing pay basis, missing statutory profile, missing primary bank account), department
  group-by on `app_users.department_id`, and a diff vs the last `released` run for the pay group.
- No mutation → cannot break create. E2E `payrollPopulationRecon.mjs`: seed a pay group + employees
  with each defect → assert the exact rule rows + dept totals + prior-run deltas.

---

## Slice 3 — Input-source readiness  ·  Designed  ·  RISK: MED (read-only, additive)
Step-6 six-source pre-lock readiness.

**Route** new `POST /payroll/runs/input-readiness { payGroupId, periodStart, periodEnd }` returning
per source `{ key, label, records, freshnessAt, ownerRole, state:'ready'|'pending'|'review' }` for:
base compensation, overtime, timesheets, leave/absences, loans/advances, one-time adjustments.
- Aggregate count + max(updated_at) freshness + count-of-pending-approval per source against the
  period window. Read-only. E2E `payrollInputReadiness.mjs` asserts counts/state per seeded source.

---

## Slice 4 — Pre-lock financial estimate  ·  Designed  ·  RISK: HIGH ·  RECOMMEND: DEFER / post-calc
Step-7 estimated gross/net/deductions/employer cost + prior-month deltas **before** calculation.

- This needs a **preview-calc engine** approximating PAYE/NIS/HS on unlocked inputs — a correctness
  trap (must not diverge from the real calc). The real figures already exist one step later via
  `getWorkspace`/calc-versions after Calculate.
- **Recommendation:** do NOT build a second calc engine. Either (a) show the estimate panel only
  after the first Calculate (real numbers, zero new backend), or (b) if a pre-lock estimate is truly
  required, spec it as its own module slice with the calc team, reusing the real calc lib in a
  "dry-run, no-persist" mode — never a parallel re-implementation.

---

## Build order when resumed (each WITH operator apply + E2E)
1 → verify create still works (regression on `payrollPayPolicyRun` + `financePayroll`) → 2 → 3 →
decide 4 (recommend post-calc). Full `npm run test:e2e` green before any slice is "Released".
