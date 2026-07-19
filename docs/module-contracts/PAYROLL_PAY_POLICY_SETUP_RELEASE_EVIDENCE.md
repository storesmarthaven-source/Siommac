# Payroll Pay-Policy Setup Release Evidence

**Final status:** Implemented; live E2E partially executed — blocked at DDL gate
**Branch/commit:** `codex/payroll-policy-setup` / `11fab9a9`
**Database target:** `gaflqcwcrvnusnlghwej.supabase.co`
**Server origin and CWD:** `http://localhost:8894` from `C:\Users\MSI Laptop\.codex\worktrees\3977\Siomac`
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
| Database apply | Blocked | No `DATABASE_URL`, `SUPABASE_ACCESS_TOKEN`, or linked CLI project in this worktree or main tree. Supabase service role key cannot run DDL. See §5 for exact steps needed. |
| Static verification | Passed | Frontend/backend typechecks (tsc --noEmit), E2E `node --check`, and `git diff --check` all green. |
| Frontend regression | Passed | `npm run test:frontend -- --run`: 27 files, 338 tests passed. |
| Backend registration | Verified | 16 pay-policy routes present in `docs/generated/CODEBASE_INDEX.json`; server starts on port 8894 with no errors. |
| Live target E2E (partial) | 2/13 passed | `BASE_URL=http://localhost:8894 npm run test:e2e -- payrollPayPolicies`; see §3 for full results. All 11 failures share one root cause: migration 600 not applied. |
| Browser verification | Blocked | No trusted server accessible for passkey-gated login from this checkout. |

## 3. Live E2E results (run 2026-07-19, tag TEST-E2E-1784497673059)

```
── Finance Payroll Setup - Pay Policies Phase A ──────────────────────────────
Run: http://localhost:8894   Total: 13   Passed: 2   Failed: 11   Time: 18.8s

▸ Pay Policies - Setup and security
   ✓ provision real roles and canonical dependencies
   ✓ all 16 endpoints require authentication and deny a real employee

▸ Pay Policies - Draft, validation and idempotency
   ✗ strict create rejects unknown fields and unsupported Phase B type
        → unknown field must be 400  [got 403 — permission not seeded]
   ✗ create draft returns exact shape and exact business side effects
        → create failed: Forbidden  [migration 600 not applied]
   ✗ same key/same payload returns original; changed payload conflicts ...
        → expected success — Forbidden
   ✗ update enforces optimistic concurrency and typed rule compatibility
        → expected success — Forbidden

▸ Pay Policies - Reads, preflight and workflow
   ✗ list/get/version/assignment reads return exact frontend contracts
        → expected success — Forbidden
   ✗ preflight returns exact proof and submit creates one central workflow
        → expected success — Forbidden
   ✗ non-assignee is denied; HR then Finance approve the two workflow steps
        → Cannot read properties of null (reading '0')  [cascade from submit failure]

▸ Pay Policies - Activation, assignment and retirement
   ✗ preparer cannot activate; independent activation writes exact side effects
        → Forbidden
   ✗ new version is an atomic governed copy with exact idempotent effects
        → Forbidden
   ✗ assignment is effective-dated, idempotent, overlap-safe and endable
        → Forbidden
   ✗ retirement closes future use and is exactly once
        → expected success — Forbidden
```

**Root cause analysis:** Every failure is a `403 Forbidden` from `requirePermission()`. The
permission keys `finance.payroll.policies.{view,draft,submit,source_review,statutory_review,
activate,assign}` are seeded into `role_permissions` by migration 600. Until migration 600 is
applied to the live database, those keys do not exist, and all authenticated non-superadmin
actors are denied regardless of their role.

Passing tests confirm:
- Route registration: all 16 endpoints respond to POST (401 for unauthenticated).
- Auth guard: a real `employee`-role user is correctly denied all 16 endpoints (403).
- Platform infrastructure: `app_users`, `finance_pay_components`, `finance_pay_groups` tables
  are reachable and writable for test provisioning.

No code defects were found in the route, service, or E2E suite beyond the migration blocker.

## 4. Code review summary

| Component | Findings |
|---|---|
| `20260919000600_finance_pay_policy_setup.sql` | No defects found. RLS on every table; grants to service_role only; RPCs revoke public/anon/authenticated; btree_gist exclusion constraint correct; workflow template/binding correct. |
| `netlify/functions/routes/financePayPolicies.ts` | No defects. Permission-check-first pattern correct (schema validation fires after perm check); `body.args ?? body` envelope correct; all 16 routes strict-schema gated; Phase B enums rejected at Zod level. |
| `netlify/functions/lib/finance/payPolicies.ts` | No defects. Content-derived SHA-256 idempotency keys; camelCase→snake_case mapping correct; all 6 RPC call sites checked against migration signatures. |
| `netlify/functions/lib/workflow/outboxWorker.ts` | Adapter correct. `finance_pay_policy_workflow_transition_tx` parameters match migration signature. |
| `scripts/e2e/suites/payrollPayPolicies.mjs` | Fixed (commit `11fab9a9`): rewrote `onCleanup` to use `h.mustDelete()` with FK-safe order; `workflow_instances` deleted first to cascade-remove transitions before tasks (was silently FK-blocked). |
| `docs/generated/CODEBASE_INDEX.json` | Regenerated (commit `11fab9a9`); 16 pay-policy routes now present. |

## 5. Operator plan — required to complete live verification

**Blocking item: apply `supabase/migrations/20260919000600_finance_pay_policy_setup.sql`.**

This migration creates 7 tables, 6 RPCs, permission seeds, and the workflow template. It has NOT
been applied. All E2E tests after security/auth will fail until it is.

**Apply options (choose one):**

Option A — Supabase dashboard (no extra credentials):
1. Open `https://supabase.com/dashboard/project/gaflqcwcrvnusnlghwej/editor`
2. Paste and run the full contents of `supabase/migrations/20260919000600_finance_pay_policy_setup.sql`
3. Run: `NOTIFY pgrst, 'reload schema';`

Option B — Supabase CLI (requires Personal Access Token):
```
SUPABASE_ACCESS_TOKEN=<pat> npx supabase link --project-ref gaflqcwcrvnusnlghwej
SUPABASE_ACCESS_TOKEN=<pat> npx supabase db query --linked -f supabase/migrations/20260919000600_finance_pay_policy_setup.sql
SUPABASE_ACCESS_TOKEN=<pat> npx supabase db query --linked -c "NOTIFY pgrst, 'reload schema';"
```

Option C — psql direct (requires DB password from Supabase dashboard → Settings → Database):
```
"C:\Program Files\PostgreSQL\18\bin\psql.exe" \
  "postgresql://postgres:<DB_PASSWORD>@db.gaflqcwcrvnusnlghwej.supabase.co:5432/postgres" \
  -f "supabase/migrations/20260919000600_finance_pay_policy_setup.sql"
```

**After applying the migration:**
1. `NOTIFY pgrst, 'reload schema';` (or restart PostgREST via dashboard)
2. Rebuild and restart the worktree dev server: `npm run build:backend && npx netlify-cli dev --port 8894`
3. Run the target suite: `BASE_URL=http://localhost:8894 npm run test:e2e -- payrollPayPolicies`
4. Expected: 13/13 green (no other code defects found)
5. Run the full regression gate: `BASE_URL=http://localhost:8894 npm run test:e2e`
6. Verify `npm run test:e2e:coverage` passes (16 pay-policy routes now in index)
7. Update this document with actual results

## 6. Change, database, mutation, security, UX, command and operations evidence

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
  cleanup. Security and auth tests (2/13) have passed. Full suite is blocked by migration 600.

## 7. Final declaration

Final verdict: **IMPLEMENTED — PARTIAL LIVE VERIFY (2/13 E2E); OPERATOR MIGRATION GATE REQUIRED**

No code defects found in routes, service, RPCs, or E2E suite. Operator must apply
`20260919000600` (see §5) then re-run the full E2E gate (§5 steps 3–6) to complete
live verification and advance status to Live-Verified.
