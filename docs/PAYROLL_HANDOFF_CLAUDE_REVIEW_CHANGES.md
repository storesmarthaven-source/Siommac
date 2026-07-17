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

## 7. Operator apply-order section (rewritten in round 2, corrected in round 3 — see §11.1 / §12.1)

**File:** `docs/PAYROLL_HANDOFF_README.md` — "Operator Migration Apply Order".

The first revision instructed re-applying the corrected source migrations before 420 on the live DB. Codex round-2 finding P0 proved that wrong: `create table if not exists` no-ops on an existing table (no new columns), and the sources' subsequent index statements on `period_start`/`period_end` then fail. The order splits into **Path A (existing DB)** — schema preflight (090 presence / 130 `entry_type` / remittance `period_year`) → 420–425 → **426 → 427** (the execution-aligned GL RPCs) → NOTIFY/rebuild/restart — and **Path B (clean install)** — all migrations in plain timestamp order. Round-3 correction: the round-2 draft told Path A to *re-apply the handoff-edited 140/141*, which (a) fails on a clean DB because those bodies declare `finance_payroll_calculation_versions%rowtype` before 420 creates it, and (b) is migration-history drift. Fixed by moving the updated GL bodies to new post-420 migrations 426/427 and reverting 140/141 to their applied content (§12.1). Verified: 420 retrofits every column/index the corrected sources define (run columns 12–20, month-uniqueness drop, scheduled/sequence keys 228/237, one-active disbursement/remittance indexes 259/265); `finance_remittances.period_year`/`period_month` predate the handoff so 420's remittance index works on the existing schema.

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

## 11. Round 2 — Codex FIX-THEN-SHIP findings, resolved (2026-07-17)

### 11.1 P0 — existing-DB migration procedure (RESOLVED)

Finding: the documented order re-applied `create table if not exists` sources whose index
statements reference columns the existing table lacks (`20260804000000` lines 80–86 on
`period_start`/`period_end`; `20260918000040` business keys), so the live upgrade could not run.

Fix: `PAYROLL_HANDOFF_README.md` apply order rewritten into **Path A (existing DB)** and
**Path B (clean install)** — see §7 above. On an existing database the corrected
table-definition sources are NOT applied; 420 is the forward upgrade (as its own header states),
followed by re-apply of only the two function-carrying GL migrations (140/141). `20260918000090`'s
non-rerunnable trigger is called out; it is applied only when the loans tables are absent.

### 11.2 P1 — deterministic scheduled-run collision across suites (RESOLVED)

Finding: `financeLookups`, `financeRemittances` (A3) and `payrollGl` all used
`seedDateFromTag(TAG, 21)` with a null pay group and default `scheduled` type. One shared harness
TAG per `run.mjs` invocation ⇒ identical `period_start`/`period_end`/`run_type` ⇒ unique-index
violation on migration 420's `finance_payroll_runs_scheduled_key`, with cleanup running only after
all suites.

Fix (two parts):
1. **Globally distinct salts assigned.** `financeLookups` 21→23, `financeRemittances` A3 21→24,
   `payrollGl` 21→25 — and one additional collision Codex's report did not list:
   `payrollStatutorySnapshot` used salt **61**, which `financePayroll`'s `seedRun(61, 'draft')`
   also uses (draft status is still covered by the partial index; only `cancelled` is excluded) —
   reassigned 61→66. Salt-space property: `seedDateFromTag` maps salt N into the disjoint day
   window `[N*1000, N*1000+999]`, so distinct salts can never produce the same date regardless
   of TAG. Full salt registry after fix: 11–17 (remittances/disbursements/payslipsEss), 23
   (lookups), 24 (remittances A3), 25 (GL), 33 (payGroups), 44 (overrides), 51–53 + 60–65
   (financePayroll), 66 (statutorySnapshot).
2. **Contract gate extended** (`scripts/e2e/payroll-contract-gate.mjs`): it now extracts every
   `periodStart|periodMonth: seedDateFromTag(TAG, N)` per suite and FAILS when the same salt
   appears in more than one file, naming both files. Same-file reuse stays legal (duplicate-key
   rejection and idempotent-replay tests intentionally reuse a period). Verified: gate passes on
   the fixed tree and correctly reports both files when a collision is reintroduced.

Round-2 residual (year-hash suites) was **fully resolved in round 3** — see §12.2/§12.3.

### 11.3 P2 — obsolete uniqueness comments (RESOLVED)

The `period_month is unique across the WHOLE table` comments in `financeLookups`,
`financeDisbursements` and `financeRemittances` now state the real model: `period_month` is a
reporting bucket; identity is (pay group, period_start, period_end, run_type); salts must be
globally unique and the contract gate enforces it.

### 11.4 Re-verification after round 2

`node --check` clean on the gate + 4 touched suites · contract gate **passed** (and correctly
fails when a collision is reintroduced — tested both directions) · no TypeScript touched, so the
earlier backend `tsc` result stands. Live gate (§10) remains the outstanding proof.

## 12. Round 3 — Codex FIX-THEN-SHIP findings, resolved (2026-07-17)

### 12.1 P0 — clean-install migration order invalid (RESOLVED)

Finding: Path B applied `20260918000140`/`141` (the handoff-updated GL RPCs) in timestamp order,
i.e. BEFORE `20260919000420`. But those updated functions declare
`finance_payroll_calculation_versions%rowtype` and read `current_calculation_version_id` /
`finance_payroll_calculation_version_lines` — objects 420 creates. `%ROWTYPE` resolves the composite
type at CREATE time, so `CREATE FUNCTION` fails on a clean DB. (Correct: the tables don't exist yet.)

Fix — the updated GL RPC bodies moved to NEW migrations that run AFTER 420:
- `supabase/migrations/20260919000426_finance_payroll_gl_atomic_v2.sql` (post) and
  `...427_finance_payroll_gl_reverse_tx_v2.sql` (reverse) carry the execution-aligned functions.
  Their bodies are byte-identical to the handoff's 140/141 changes (verified by diff); only the file
  header/placement changed.
- `20260918000140`/`141` were **reverted to their original applied content** (`git checkout a52abaf9`),
  so no already-applied migration is edited — this removes the migration-history-drift Codex flagged
  (the previous Path A re-applied edited 140/141; that instruction is gone).
- **Path A (existing DB):** preflight → 420–425 → **426 → 427**. No 140/141 re-apply.
- **Path B (clean install):** plain timestamp order works end-to-end — original 140/141 create the
  first-generation RPCs (valid pre-420, they reference nothing from the execution model), 420–425
  build the execution schema, then 426/427 replace the GL RPCs. Verified: 426/427 are the only GL
  functions that touch calculation-version objects, and they sort after 420.

### 12.2 P1 — collision gate did not cover the whole collision class (RESOLVED)

Finding: the round-2 gate only matched the literal `periodStart: seedDateFromTag(TAG, N)` form. It
missed indirection (`const p = seedDateFromTag(...); … periodStart: p`), the `seedRun(salt)` pattern,
periods stored in variables, and the independent year-hash fixtures. So a reintroduced salt-61
collision would pass the gate.

Fix — **one central allocator** in `scripts/e2e/helpers/payrollRun.mjs`, exactly as Codex asked:
- `PAYROLL_PERIOD_SALTS` (salt space) and `PAYROLL_PERIOD_YEAR_BANDS` (year space) are the single
  registry. `payrollPeriod(suite, key, tag)` and `payrollPeriodYear(suite, tag)` are the only ways a
  suite gets a run period. Every seeded-fixture period site across **13 suites** was migrated to these.
- `assertPayrollPeriodAllocatorDisjoint()` runs at import AND in the gate. It proves: every salt is
  unique; every year band is mutually disjoint; and **no salt's year-window overlaps any year band**
  (`seedDateFromTag` day-windows → years, checked against each band). This is a structural proof, not
  a regex.
- The contract gate now (a) rejects any `periodStart|periodMonth|period: seedDateFromTag(...)` direct
  or via-variable, (b) rejects a suite using another suite's registry key/band, (c) requires every
  registered year-band suite to call `payrollPeriodYear('<itself>', TAG)`, and (d) rejects any local
  `yearFromTag`/`taxYearFromTag` (the private year allocators, now deleted). All four detectors were
  negative-tested (each fails when its violation is reintroduced, passes when clean).
- Empirical sweep: **zero cross-suite null-group period collisions across 5000 TAGs**.

### 12.3 P2 — the "~1/300" residual claim (RESOLVED, and the real risk fixed)

Codex is correct that the specific `payrollScale`↔`payslipTemplateApproval` "1/300" claim was
mathematically impossible (opposite-parity hashes over an even modulus can't be equal). That claim is
**removed**. More importantly, the *unification* above eliminated the whole class:
- The 5 year-hash suites (`payrollStatutoryForms`, `payslipTemplateApproval`, `payrollScale`,
  `payrollBackPay`, `payrollVarianceReports`) now draw their business year from `payrollPeriodYear`
  with **disjoint bands**: [2040,2099], [2200,2349], [2350,2499], [2500,2899], [2900,2989]. The old
  shared 2200–2499 range (scale + payslipTemplateApproval) is gone.
- A **real latent collision Codex's report did not list** was found and fixed: salt-space suites
  `payrollGl` (salt 25 → year-window ~2038–2041) and `payrollOverrides` (salt 44 → ~2090–2093) had
  windows overlapping `payrollStatutoryForms`' [2040,2099] band — a low-probability, TAG-deterministic
  flake. Both salts were moved into the low cluster (18/19 → ~2019/2022), and `payrollPayGroups`
  (salt 33 → ~2060, harmless because pay-group-scoped, but it tripped the strict assertion) moved to
  20. The disjointness assertion now guarantees no salt window can ever enter a year band.

### 12.4 Re-verification after round 3

`node --check` clean on the helper, gate, and all suites · contract gate **passed**, with all four
detectors + the disjointness assertion negative-tested · jest (permissions.drift, permissionMeta.sync,
payrollStatutory) 29/29 · vitest (permissions) 25/25 · empirical 5000-TAG sweep collision-free · GL
RPC bodies in 426/427 diff-identical to the reverted 140/141 changes · no TypeScript touched. Live
gate (§10) — now Path A `… → 425 → 426 → 427` — remains the outstanding proof.

## 13. Merge notes for main

- Main holds **uncommitted** triage copies of `payslipRender.mjs`, `payrollGl.mjs`, `payrollScale.mjs`. The handoff versions on this branch **subsume** those fixes (forceSynthetic actors, scoped idempotency keys, seedDateFromTag salts) — on merge, **this branch's versions win**; discard main's uncommitted copies of those three files.
- Main also holds uncommitted messenger/Codex work — merge coordination required; do not merge without the user's go.
- `20260919000410_messaging_pagination_search.sql` stays untouched in main; nothing on this branch references it.
