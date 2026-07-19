# Payroll Pay-Policy Setup Release Evidence

**Final status:** Implementing  
**Branch/commit:** `codex/payroll-policy-setup` / pending  
**Database target:** Unlinked isolated worktree  
**Server origin and CWD:** No trusted server from this checkout  
**Evidence timestamp:** 2026-07-19

## 1. Scope and traceability

- Contract: `PAYROLL_PAY_POLICY_SETUP_IMPLEMENTATION.md`
- Contract-to-code map: `PAYROLL_PAY_POLICY_SETUP_CONTRACT_TO_CODE_MAP.md`
- Matrix: `payroll-pay-policy-setup-e2e-matrix.md`
- Phase A: local TT/TTD standard salary and hourly shift policy setup.
- Phase B deferral: crew/run-policy integration.
- Target-module waiver count: pending; required final value `0`.
- Missing matrix rows: pending; required final value `0`.

## 2. Evidence status

| Area | Status | Evidence |
|---|---|---|
| Workspace/base | Verified | Clean worktree based on `f4659c3f`; isolated branch created. |
| Existing backend capability | Verified | Pay groups/components/statutory/workflow reusable; no policy model exists. |
| Migration namespace | Verified at base | Scanned all committed filenames through `20260919000460`; selected `20260919000600`. |
| Database apply | Blocked | No linked project/environment in this worktree. |
| API/unit/E2E/browser/full regression | Pending | Record exact commands and counts after implementation. |

## 3. Change, database, mutation, security, UX, command and operations evidence

To be completed from executable results at the final gate. No live database, server, browser,
test, or release claim may be inferred from implementation or typecheck alone.

## 4. Operator plan

1. Apply `supabase/migrations/20260919000600_finance_pay_policy_setup.sql`.
2. Execute `NOTIFY pgrst, 'reload schema';`.
3. Rebuild backend and restart `dev:netlify` from this checkout.
4. Run target and dependent suites, then the full final gate once.
5. Verify RLS/grants/functions/constraints and exact side-effect counts against the linked target.

## 5. Final declaration

Final verdict: **IMPLEMENTING — NOT YET LIVE-VERIFIED**
