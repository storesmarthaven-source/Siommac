# Payroll Pay-Policy Setup Release Evidence

**Final status:** Implemented; Live Verification Blocked
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
- Target-module waiver count: `0`.
- Missing matrix rows: `0`.

## 2. Evidence status

| Area | Status | Evidence |
|---|---|---|
| Workspace/base | Verified | Clean worktree based on `f4659c3f`; isolated branch created. |
| Existing backend capability | Verified | Pay groups/components/statutory/workflow reusable; no policy model exists. |
| Migration namespace | Verified at base | Scanned all committed filenames through `20260919000460`; selected `20260919000600`. |
| Database apply | Blocked | No `.env`, linked project, or migration target exists in this worktree. |
| Static verification | Passed | Frontend/backend typechecks, E2E `node --check`, and `git diff --check`. |
| Frontend regression | Passed | `npm run test:frontend -- --run`: 27 files, 338 tests passed. |
| Live target E2E | Blocked before execution | `npm run test:e2e -- payrollPayPolicies`: `Could not read .env at project root`. |
| Browser verification | Blocked | No trusted server from this worktree; the observed Vite process belongs to a different checkout. |

## 3. Change, database, mutation, security, UX, command and operations evidence

- Sixteen authenticated POST endpoints are mounted under `/api/finance/payroll/policies`.
- Strict DTO schemas reject Phase B values, unknown fields, actor/status/checksum injection, and
  invalid typed component/source combinations.
- Atomic RPCs own draft create/update, version copy, submit, workflow source transition,
  activation, pay-group assignment/end, and retirement. Receipts bind request keys to content
  hashes. Business events and audit rows are mandatory; workflow tasks, notifications, and
  handoffs are written for the transitions defined by the delivery contract.
- The frontend uses Netlify API hooks only. It exposes the directory, five-step persisted
  create/edit wizard, preflight, submission, activation, version copy/compare, pay-group
  assignment/end, retirement, seven detail tabs, and explicit loading/empty/error states.
- The focused unit test covers the salary/hourly T&T source presets and all wizard step gates.
- The live E2E suite covers all sixteen endpoints, positive/negative permissions, exact response
  shapes, lifecycle transitions, idempotency, side effects, overlap/concurrency gates, and exact
  cleanup. It is written and syntax-checked but could not execute without a target environment.

## 4. Operator plan

1. Apply `supabase/migrations/20260919000600_finance_pay_policy_setup.sql`.
2. Execute `NOTIFY pgrst, 'reload schema';`.
3. Rebuild backend and restart `dev:netlify` from this checkout.
4. Run target and dependent suites, then the full final gate once.
5. Verify RLS/grants/functions/constraints and exact side-effect counts against the linked target.

## 5. Final declaration

Final verdict: **IMPLEMENTED — NOT LIVE-VERIFIED; OPERATOR GATE REQUIRED**
