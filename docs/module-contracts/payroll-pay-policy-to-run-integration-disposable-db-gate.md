# F-02 Pay-Policy-to-Run — Disposable-DB Apply & Verification Gate (OPERATOR-RUN)

This env has **no Docker / no psql / no direct Postgres** connection (`.env` is REST-only via
supabase-js; the Supabase CLI is unlinked), so the disposable-DB gate is run **by the operator**, not
the agent. Migration 711 changes `create_run_tx` **unconditionally** (no runtime flag — DEC-PPR-008),
so applying it to the shared DB before the 8 legacy suites are converted **breaks them**. Run this gate
on a **throwaway database** first; only land on the shared DB after it is fully green.

Artifacts under test:
- `supabase/migrations/20260919000710_finance_pay_policy_run_pin.sql` (pins + evidence tables) — already
  applied+verified on the shared DB.
- `supabase/migrations/20260919000711_finance_pay_policy_run_rpc.sql` (create + **lock** + **calc** RPCs)
  — **do NOT apply to the shared DB yet.**
- `scripts/e2e/helpers/payPolicyFixture.mjs` (`attachActivePolicy`) + the 8 converted suites.
- Baselines/diffs: `.f02-baseline/{create_run_tx,lock_inputs_tx,calculation_start_tx}.{orig|baseline,modified}.sql`.

---

## 0. Pre-apply drift check (repo-canonical 421 vs the live DB)

Migration **421** (`20260919000421_finance_payroll_execution_commands.sql`) is the **repository-canonical**
baseline for create/lock/calc — the last committed migration that defines them; nothing redefines them
after. The `.f02-baseline/*.baseline.sql` (lock/calc) and `.orig.sql` (create) are extracted verbatim from
421. This is a **source-of-truth diff against the repo**, NOT a `pg_get_functiondef` dump of a live DB.

Before applying 711 to **any** database (disposable OR shared), confirm that database has NOT drifted from
421 out of band:

```sql
-- run against the target DB; compare each output to the matching .f02-baseline file
select pg_get_functiondef('public.finance_payroll_create_run_tx(text,text,text,date,date,uuid,integer,uuid,text,numeric,uuid,date,date)'::regprocedure);
select pg_get_functiondef('public.finance_payroll_lock_inputs_tx(uuid,text,text,jsonb,integer,jsonb)'::regprocedure);
select pg_get_functiondef('public.finance_payroll_calculation_start_tx(uuid,text,text)'::regprocedure);
```

The live bodies must be **semantically identical to the 421 baselines** (modulo whitespace/`pg_catalog`
schema-qualification). If they differ, someone hand-edited the DB — **stop** and reconcile before applying
711 (711 is a `create or replace` from the 421 baseline; a drifted live def would be silently overwritten).

---

## 1. Provision a throwaway database

- A fresh Supabase project OR a local `supabase db` instance seeded to the **same migration baseline** the
  shared DB is on (through mig 429 + F-01 mig 600 + F-CAL 700/701 + F-02 710).
- Never point this at the shared project (`gaflqcwcrvnusnlghwej`).

## 2. Apply migrations in order, then reload PostgREST

Apply any not-yet-present, in filename order, ending with:
1. F-01 `...600_finance_pay_policy_setup.sql`
2. F-CAL `...700_shared_work_calendar.sql`, `...701_hr_work_calendar_grants.sql`
3. F-02 `...710_finance_pay_policy_run_pin.sql`
4. **F-02 `...711_finance_pay_policy_run_rpc.sql`** (this tranche)

Then `NOTIFY pgrst, 'reload schema';` (or restart PostgREST). Confirm the 3 functions exist with the exact
signatures in §0 and that `finance_payroll_run_policy_evidence` / `finance_payroll_run_calendar_evidence`
are present + service-role-writable.

## 3. Build backend + start :8888 (avoid stale dist)

`dev:netlify` serves compiled `dist/`; backend changes 404/misbehave until rebuilt.
```
npm run build:backend
npm run dev:netlify           # restart if already running
```
No backend route changed in this tranche, but the fixture + suites hit the live stack — rebuild + restart
so a stale server can't yield a false pass.

## 4. The 8 converted legacy suites MUST stay green under 711

Each now seeds a non-working_days active policy via `attachActivePolicy` so `create_run_tx` can pin it, and
tears it down in FK-safe order. Run each and confirm green (create → lock → calc unaffected, base pay still
full-period, no new failures):
```
npm run test:e2e -- financePayroll
npm run test:e2e -- payrollControlCenter
npm run test:e2e -- payrollLoans
npm run test:e2e -- payrollOvertimeRules
npm run test:e2e -- payrollPayGroups
npm run test:e2e -- payrollScale
npm run test:e2e -- payrollStatutorySnapshot
npm run test:e2e -- payslipRender
```
Watch specifically for: `PR422 policy.pay_group_required` / `policy.missing` on create (⇒ a suite still
creates an unscoped run or the fixture didn't cover the period), and leftover
`finance_pay_policies`/`finance_pay_group_policy_assignments` rows after cleanup (⇒ FK-order or
`ctx.policyFixture.cleanup()` not wired).

## 5. Focused F-02 behaviour (payrollPayPolicyRun.mjs — SEPARATE, later slice)

The dedicated F-02 suite (E2E-PPR-001..043, C-PPR-003, PERF-PPR-001) that provisions via **real F-01 +
F-CAL routes** and asserts the manifest / per-employee calendar evidence / frozen working_days base pay is
**not part of this tranche** (see the review notes). When it lands, run it here too and assert, via the
service-role client:
- exactly ONE `finance_payroll_run_policy_evidence` per `input_snapshot_id` with the manifest arrays + checksum;
- exactly ONE `finance_payroll_run_calendar_evidence` per working_days employee (`unique(input_snapshot_id,
  employee_id)`), `numerator <= period_denominator`, employment-clamp boundaries;
- calc line base == `round2(rate * numerator/denominator)`; recalc leaves the pin + numbers unchanged;
- exactly one `payroll_run.inputs_locked` event carrying `evidenceChecksum` (enriched, not duplicated).

## 6. Idempotency + no-side-effects (this tranche)

- Re-issue an identical `lock-inputs` (same idempotency key) → replays the durable receipt; **no** second
  `finance_payroll_run_policy_evidence`/`finance_payroll_run_calendar_evidence` row, **no** duplicate event.
- Re-issue an identical `calculate` (same key) → one durable attempt; the pinned-policy/calendar identity is
  now folded into the request hash, so a **different** pin (impossible for an immutable pin, tested
  defensively) would surface as `PR409 ...used for different inputs`.
- Reopen → relock → a FRESH single manifest + fresh N calendar-evidence rows bound to the NEW snapshot;
  prior evidence retained; `current_input_snapshot_id` advances.

## 7. Cleanup verification

After the run: `node scripts/e2e/sweep-orphans.mjs` (or the harness sweeper) reports **zero** orphaned
`finance_pay_policies`, `finance_pay_group_policy_assignments`, `finance_payroll_run_policy_evidence`,
`finance_payroll_run_calendar_evidence` for the run's TAG.

## 8. Shared-DB landing (only after §0–§7 green on the disposable DB)

1. Re-run §0 drift check against the **shared** DB.
2. Apply `...711...sql` to the shared DB; `NOTIFY pgrst, 'reload schema';`.
3. Run the **full** `npm run test:e2e` regression **once** (incl. `workCalendar` + `calendar`) — the
   combined F-01+F-02 pre-merge gate.
4. Do **not** un-feature-gate the Pay-Policy UI or merge until that full regression AND the operator
   browser-QA gate (UI-PPR-001..005) are both green (N6 / DEC-PPR-008).
