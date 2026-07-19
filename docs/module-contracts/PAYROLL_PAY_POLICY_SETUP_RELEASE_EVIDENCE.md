# Payroll Pay-Policy Setup Release Evidence

**Current status:** Implemented; 7/13 live E2E — blocked at digest function gate
**Branch/commit:** `codex/payroll-policy-setup` / `e2265596`
**Database target:** `gaflqcwcrvnusnlghwej.supabase.co`
**Worktree:** `C:\Users\MSI Laptop\.codex\worktrees\3977\Siomac`
**Server used for E2E:** `http://localhost:8894`
**Evidence timestamp:** 2026-07-19

---

## 1. Scope and traceability

- Contract: `PAYROLL_PAY_POLICY_SETUP_IMPLEMENTATION.md`
- Phase A: local TT/TTD standard salary and hourly shift policy setup.
- Phase B deferral: crew/run-policy integration.

---

## 2. Migration 600 apply evidence

**Status: APPLIED (coordinator-verified 2026-07-19)**

| Object | Status |
|---|---|
| `finance_pay_policies` | OK |
| `finance_pay_policy_versions` | OK |
| `finance_pay_policy_components` | OK |
| `finance_pay_policy_source_rules` | OK |
| `finance_pay_policy_costing_rules` | OK |
| `finance_pay_group_policy_assignments` | OK |
| `finance_pay_policy_command_receipts` | OK (PK is `request_key text`, not `id uuid`) |
| `finance_pay_policy_preflight` RPC | EXISTS — WF404 for bogus version |
| `role_permissions` grants | 25 rows matching `finance.payroll.policies.*` (7 keys, 3-5 roles each) |

Note: `finance_pay_policy_command_receipts` has no `id` column — PK is `request_key text`.
Earlier probe used `.select('id')` which failed; `.select('*')` returns OK.

---

## 3. Live E2E run 1 — after migration apply, before digest fix

**Run:** 2026-07-19, Server: http://localhost:8894, Tag: TEST-E2E-1784498748485

```
Total: 13   Passed: 7   Failed: 6   Time: 24.1s

[PASS] provision real roles and canonical dependencies
[PASS] all 16 endpoints require authentication and deny a real employee
[PASS] strict create rejects unknown fields and unsupported Phase B type
[PASS] create draft returns exact shape and exact business side effects
[PASS] same key/same payload returns original; changed payload conflicts
[PASS] update enforces optimistic concurrency and typed rule compatibility
[PASS] list/get/version/assignment reads return exact frontend contracts
[FAIL] preflight returns exact proof and submit creates one central workflow
         -> function digest(text, unknown) does not exist
[FAIL] non-assignee is denied; HR then Finance approve two workflow steps
         -> cascade from submit failure
[FAIL] preparer cannot activate; independent activation writes exact side effects
         -> only approved versions can be activated (cascade)
[FAIL] new version is an atomic governed copy with exact idempotent effects
         -> new versions require an active policy (cascade)
[FAIL] assignment is effective-dated, idempotent, overlap-safe and endable
         -> assignment requires an active version (cascade)
[FAIL] retirement closes future use and is exactly once
         -> only active policies can be retired (cascade)
```

**Single root cause:** `finance_pay_policy_preflight` line 285:
  `encode(digest(manifest::text,'sha256'),'hex')`
pgcrypto on this instance provides `digest(bytea,text)` only — no `digest(text,text)`.
The literal `'sha256'` resolves as PostgreSQL type `unknown`, so the call is
`digest(text,unknown)` — no matching overload.

Fix: `encode(digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex')`
(same pattern as migration 20260919000425). Fixed in source migration commit `e2265596`.

---

## 4. Operator gate — digest fix apply

Source migration corrected in commit `e2265596`. Live function must be re-deployed.

Ready-to-run SQL: `supabase/_apply_preflight_digest_fix.sql` (absolute path:
`C:\Users\MSI Laptop\.codex\worktrees\3977\Siomac\supabase\_apply_preflight_digest_fix.sql`)

The file already includes CREATE OR REPLACE FUNCTION, REVOKE, GRANT, and NOTIFY pgrst.

Option A — Supabase dashboard (recommended):
1. Open https://supabase.com/dashboard/project/gaflqcwcrvnusnlghwej/editor
2. Paste and run the full contents of _apply_preflight_digest_fix.sql

Option B — psql (requires DB password from Dashboard > Settings > Database):
  "C:\Program Files\PostgreSQL\18\bin\psql.exe" \
    "postgresql://postgres:<PWD>@db.gaflqcwcrvnusnlghwej.supabase.co:5432/postgres" \
    -f "C:\Users\MSI Laptop\.codex\worktrees\3977\Siomac\supabase\_apply_preflight_digest_fix.sql"

Path note: migration 600 and the _apply_*.sql file exist ONLY in this worktree branch,
not on main. Always use absolute paths or cd to the worktree first.

After applying:
1. npm run build:backend (from worktree)
2. Start dev server on port 8894 (NOT 8888)
3. BASE_URL=http://localhost:8894 npm run test:e2e -- payrollPayPolicies (expect 13/13)
4. BASE_URL=http://localhost:8894 npm run test:e2e (full regression)
5. npm run test:e2e:coverage
6. npx tsc --noEmit
7. Update this doc with actual results

---

## 5. Code review summary

| Component | Status | Notes |
|---|---|---|
| `20260919000600_finance_pay_policy_setup.sql` | Fixed e2265596 | digest() to convert_to() form. |
| `netlify/functions/routes/financePayPolicies.ts` | Clean | 16 routes, permission-first, strict Zod. |
| `netlify/functions/lib/finance/payPolicies.ts` | Clean | Content-derived SHA-256 idempotency keys. |
| `netlify/functions/lib/workflow/outboxWorker.ts` | Clean | Adapter parameters match RPC signature. |
| `scripts/e2e/suites/payrollPayPolicies.mjs` | Fixed 11fab9a9 | h.mustDelete throughout, FK-safe order. |
| `docs/generated/CODEBASE_INDEX.json` | Regenerated 11fab9a9 | 16 pay-policy routes in index. |

---

## 6. Browser verification

Chrome access was denied during this session. The live E2E is the behavioral proof.
Once the digest fix is applied and suite reaches 13/13, the operator should verify:
- Finance > Payroll > Pay Policies renders the directory.
- New Policy wizard is interactive (all 5 steps).
- Submit flow completes (requires digest fix).

---

## 7. Commits on this branch

| SHA | Message |
|---|---|
| 3a91afd0 | docs: define pay-policy setup phase A contract |
| a8087e5c | feat: add governed pay-policy setup |
| 11fab9a9 | fix: E2E cleanup FK-order + regenerate codebase index |
| 7064b055 | docs: release evidence partial E2E (2/13, pre-migration) |
| e2265596 | fix: digest(text,unknown) -> convert_to()::bytea in preflight |

---

## 8. Final gate status

| Gate | Status |
|---|---|
| npm run build:backend | PASSED (zero errors) |
| npm run test:frontend --run | PASSED (27 files, 338 tests) |
| npm run test:e2e -- payrollPayPolicies | 7/13 — BLOCKED (digest fix pending) |
| npm run test:e2e (full regression) | NOT RUN — pending 13/13 target suite |
| npm run test:e2e:coverage | NOT RUN |
| Browser verification | NOT DONE (Chrome access denied; E2E is proof) |

**Verdict: IMPLEMENTED — 7/13 LIVE VERIFY; OPERATOR DIGEST-FIX GATE REQUIRED**

Once operator applies supabase/_apply_preflight_digest_fix.sql and target suite
reaches 13/13, run full regression and update this doc to advance to Live-Verified.
