# Payroll Backend Handoff — Claude Review Change Log (for Codex review)

**Date:** 2026-07-17
**Branch:** `wf/payroll-handoff` (worktree `.claude/worktrees/wf-payroll`)
**Commit:** `3c526fe3` — "feat(payroll): backend execution handoff — command RPCs 420-425, services, routes, E2E + review fixes"
**Scope:** the Codex handoff zip (SIOMAC-Payroll-Backend-Handoff-2026-07-17) overlaid onto HEAD `a52abaf9`, plus Claude's review fixes on top. This document lists **only what Claude changed relative to the handoff content**, so Codex can review the deltas. Everything else in the commit is the handoff as shipped.

---

## 1. Migration renumbering 410–415 → 420–425 (collision fix)

**Why:** the handoff's `20260919000410_..415` collided with `20260919000410_messaging_pagination_search.sql`, which already exists (uncommitted in the main tree) and is **applied to the live DB**. Timestamps must be unique and monotonic past the applied set.

| Change | Files |
|---|---|
| Renamed 6 migration files `000410..000415` → `000420..000425` (same content order) | `supabase/migrations/20260919000420_finance_payroll_execution_foundation.sql` … `20260919000425_finance_payroll_export_tx.sql` |
| Fixed 4 internal provenance stamps still writing `'20260919000410'` into row `metadata` (backfill blocks in the foundation migration) → `'20260919000420'` | `20260919000420_...` lines ~610, ~1230, ~1478, ~1488 |
| Updated migration-number references in suites and docs (`financePayroll.mjs`, manifest "410-415" → "420-425", tech doc "migrations 410-411"/"410 and 414" → "420-421"/"420 and 424") | `scripts/e2e/suites/financePayroll.mjs`, `docs/PAYROLL_BACKEND_HANDOFF_MANIFEST.md`, `docs/PAYROLL_TECHNICAL_IMPLEMENTATION.md` |

**Review ask:** confirm no remaining reference to the withdrawn 410–415 numbering (`grep -rn "00041[0-5]"` over the repo returns nothing payroll-related).

---

## 2. Harness: `acquireActors` gains `opts.forceSynthetic` (5th param)

**File:** `scripts/e2e/harness.mjs` (the handoff did NOT ship a harness; HEAD's harness had only 4 params, so the handoff suites' 5th argument was silently ignored).

**Change:** signature is now
`acquireActors(role, count, extra = {}, filter = {}, opts = {})`.
When `opts.forceSynthetic` is true the real-roster pool query is skipped entirely — every requested actor is a **fresh synthetic user** (tagged, borrowed, returned in `createdIds` for cleanup). `extra`/`filter` semantics are unchanged; default behavior (no opts) is byte-for-byte the old behavior.

**Callers:** `financePayroll.mjs` (2 isolated salaried employees) and `payslipRender.mjs` (1 salaried employee) — both need employees whose payroll math is fully determined by suite-seeded rows.

**Review ask:** confirm the two call sites get isolated actors and that no other suite relies on the old positional meaning of a 5th argument (none found).

---

## 3. BUG FIX — `payrollRunSeed` TypeError in the shipped helper

**File:** `scripts/e2e/helpers/payrollRun.mjs` (shipped in the handoff).

**Defect:** `payrollRunSeed({ …, periodMonth, … })` destructures a `periodMonth` **parameter**, which shadows the module-level `periodMonth()` **function**; line `period_month: periodMonth(payDate)` therefore threw `TypeError: periodMonth is not a function` on **every call** (string or `undefined` is not callable). `node --check` cannot catch this; every suite using `payrollRunSeed` would have crashed at seed time.

**Fix:** renamed the module-level helper `periodMonth()` → `monthStart()` (3 internal call sites + the seed line). No behavioral change otherwise. Smoke-verified:

```js
payrollRunSeed({ periodMonth: '2026-03-01', run_no: 'RUN-X', status: 'draft' })
// → { period_month: '2026-03-01', run_type: 'scheduled', period_start: '2026-03-01',
//     period_end: '2026-03-31', sequence_no: 1, pay_frequency: 'monthly',
//     pay_date: '2026-03-31', weeks_in_period: 5, run_no: 'RUN-X', status: 'draft' }
```

**Review ask:** verify `monthStart` semantics (`YYYY-MM-01` of the **pay date's** month) are the intended `period_month` reporting bucket.

---

## 4. Contract gate red → green: 3 HEAD suites' run fixtures wrapped in `payrollRunSeed`

**Why:** `scripts/e2e/payroll-contract-gate.mjs` (shipped) statically rejects ANY literal-object `from('finance_payroll_runs').insert({…})` in ANY suite. Three suites the handoff did not ship still seeded runs directly (8 sites) → the gate failed out of the box.

| File | Sites | Change |
|---|---|---|
| `scripts/e2e/suites/financeDisbursements.mjs` | 4 (approved, draft, staff, cancel runs) | `insert(payrollRunSeed({ …, periodMonth: seedDateFromTag(TAG, n), … }))` + import |
| `scripts/e2e/suites/financeLookups.mjs` | 1 | same; kept its explicit `pay_date` (salt 22) — `period_month` now derives from the pay date's month |
| `scripts/e2e/suites/financeRemittances.mjs` | 3 (approved, draft, A3 atomic) | same + import |

Each fixture now carries the complete execution identity (`run_type`, `period_start`, `period_end`, `sequence_no`, `pay_frequency`, `pay_date`, `weeks_in_period`). Original snake_case extras (`statutory_version_id`, `status`, `employee_count`, totals, `created_by`) pass through unchanged via the rest-spread.

**Review ask:** these three suites run against post-420 schema. Confirm the derived `period_start/end` (monthly, from the TAG-salted date) cannot collide across suites in one run (TAG-salted dates already guarantee distinct periods) and that `financeRemittances`' contribution-period assertions are insensitive to the added columns.

---

## 5. Dead code removed: TS export serializer

**File:** `netlify/functions/lib/finance/payroll/exportContent.ts` (shipped in the handoff).

**Change:** deleted the unused `buildPayrollExportContent()` + `PayrollExportLine` interface. `finance_payroll_record_export_tx` (migration 425) serializes the artifact in SQL and is the **single serializer authority**; the TS copy was unreferenced and also lacked the CSV quoting the SQL performs — a lurking second authority that would drift. Kept: `PayrollExportFormat` type and `payrollExportChecksum()` (used by `downloadRunExport` in `payrollRuns.ts` to re-verify SHA-256 of downloaded bytes).

**Review ask:** confirm no consumer expected the TS serializer (repo grep shows zero references).

---

## 6. Docs corrected: the "vitest discovery gap" was a false premise

**Files:** `docs/PAYROLL_TECHNICAL_IMPLEMENTATION.md` (§1A debt item 6), `docs/PAYROLL_HANDOFF_README.md`.

**Finding:** `tests/unit/payrollStatutory.test.ts` is a **Jest** test. The repo convention is `tests/**` = Jest (`package.json` jest `testMatch: **/tests/**/*.test.ts`, `npm run test:unit`), `src/**` = Vitest. Jest discovers it and **all 25 cases pass**. The handoff docs claimed it was undiscovered because Vitest excludes `tests/**` — true but irrelevant; nothing was ever supposed to run it under Vitest. Both docs now state the resolution; **no config was changed** (widening Vitest's include would have been ceremony).

---

## 7. Operator apply-order section added

**File:** `docs/PAYROLL_HANDOFF_README.md` — new section "Operator Migration Apply Order (2026-07-17)".

Exact per-file sequence: 7 corrected source migrations (20260804000000, 20260804000002, 20260805000000, 20260808000001, 20260918000040, 20260918000140, 20260918000141 — all idempotent/re-applicable), **plus two loan prerequisites flagged**: `20260918000090` (base loans tables) and **`20260918000130`** (`finance_loan_deductions.entry_type` — previously reported unapplied; the 423 reopen RPC reads `entry_type = 'payroll_deduction'`, so 423 breaks at runtime without it). Then 420→425 strictly in order, `NOTIFY pgrst`, `build:backend`, dev-server restart.

**Review ask:** confirm 090/130 are the only pre-420 dependencies the 420-425 bodies read (loan ledger via 423; `increment_ref_counter`, `finance_payroll_exports`, `finance_disbursements`, `finance_remittances`, workflow tables all predate and are live).

---

## 8. Verification evidence (worktree, static — no live DB access here)

| Gate | Result |
|---|---|
| Backend typecheck `tsc --noEmit -p netlify/functions/tsconfig.json` | clean (exit 0) |
| `node --check` on harness + gate + helpers + all payroll/finance suites | clean |
| `node scripts/e2e/payroll-contract-gate.mjs` | **passed** (was 8 violations before item 4) |
| `jest tests/unit/permissions.drift.test.ts tests/unit/permissionMeta.sync.test.ts` | 4/4 |
| `vitest run src/lib/permissions.test.ts` | 25/25 |
| `jest tests/unit/payrollStatutory.test.ts` | 25/25 |
| RPC ↔ wrapper parameter audit (all 9 payroll `sb.rpc()` call sites vs SQL definitions in 421–425) | exact match, param-for-param |
| Dollar-quote delimiter balance across 420–425 | all even/balanced |
| Frontend typecheck | main tree clean; worktree flags only `WidgetBoardZone.tsx` — environment artifact (relative `react → ./node_modules/preact/compat` alias needs local `node_modules`, absent in the worktree). Not a regression. |

**Not done here (needs main tree):** migration apply (operator), backend rebuild + dev restart, the 14 focused live payroll suites, full regression. The worktree intentionally has no `.env`.

---

## 9. Codex review caveats (2026-07-17) — accepted into the plan

1. **Renumbering safety precondition.** 420–425 renaming is safe only if 410–415 were never applied anywhere. The payroll 410–415 files arrived only in the handoff zip and never existed in `supabase/migrations/` on any branch, so no migration tooling could have applied them — but the operator MUST still confirm before applying: check the target DB's migration history (and `pg_proc` for `finance_payroll_create_run_tx` etc.) shows **no** payroll objects from a manual 410–415 apply. If any exist, STOP and reconcile deliberately (drop/re-create from 420–425 source) instead of applying on top. This pre-check is now step 0 of the operator apply order in `PAYROLL_HANDOFF_README.md`.
2. **Synthetic actors stay scoped.** `forceSynthetic` is used ONLY by the two deterministic payroll-math suites (`financePayroll`, `payslipRender`). All other suites (pay groups, loans, overrides, back pay, GL, scale, remittances, disbursements) continue to exercise real roster users and real pay-group membership so production-data assumptions stay tested. Do not spread `forceSynthetic` to integration suites.
3. **Static review ≠ execution proof.** Everything in §8 is static. PostgreSQL must still compile/execute all six migrations, and live runs must validate constraints, grants, PostgREST RPC signatures, advisory-lock behavior, idempotent replay, conflicting-payload PR409 and rollback-on-error. That is the Required Final Gate below.
4. **The original handoff zip is stale.** It carries the withdrawn 410–415 numbering, omits the three additional suites fixed in §4, and lacks the harness/helper fixes. The branch commit `3c526fe3` is the source of truth; a regenerated archive (`SIOMAC-Payroll-Backend-Handoff-2026-07-17-r2.zip`) is produced from this commit for Codex review. Do not work from the original zip.

## 10. Required Final Gate (live, from the MAIN tree after operator apply)

Run against a clean migrated database:

```
npm run build:backend:clean   # or build:backend if no :clean script
npm run dev:netlify
npm run test:e2e -- financePayroll
npm run test:e2e -- payslipRender
npm run test:e2e -- financeDisbursements
npm run test:e2e -- financeRemittances
npm run test:e2e -- financeLookups
```

Then rerun `financePayroll` and `payslipRender` a **second time** to prove cleanup and fixture isolation (no cross-run pollution, no leaked synthetic users, idempotency receipts scoped per attempt). Only after the targeted suites are green run the complete `npm run test:e2e` regression once.

## 11. Merge notes for main

- Main holds **uncommitted** triage copies of `payslipRender.mjs`, `payrollGl.mjs`, `payrollScale.mjs`. The handoff versions on this branch **subsume** those fixes (forceSynthetic actors, scoped idempotency keys, seedDateFromTag salts) — on merge, **this branch's versions win**; discard main's uncommitted copies of those three files.
- Main also holds uncommitted messenger/Codex work — merge coordination required; do not merge without the user's go.
- `20260919000410_messaging_pagination_search.sql` stays untouched in main; nothing on this branch references it.
