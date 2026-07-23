# Payroll Security / Database Audit (certification §5)

Baseline `86842af3` → audited on the WP-1..WP-5 remediation commits. Two halves:
**static checks** (proven from the repo + behavioral probes, below) and the
**runtime catalog** (operator runs `scripts/sql/payroll_security_audit.sql` and
pastes each result set into §B).

## A. Static checks — results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 5.2 | Browser code has NO direct Supabase access to payroll business data | ✅ **FIXED** — `src/api/payroll.ts` was a dead legacy direct-Supabase module (reads on `payroll_runs`/`payroll_entries`/`hourly_rates` + a browser-side `approvePayrollRun` WRITE). Zero call sites (every exported function grepped: 0 consumers); reachable only via the `@api` barrel re-export. **Deleted** along with dead `src/api/schemas/payroll.ts` + both barrel lines; frontend tsc clean after removal. | this commit |
| 5.8 | `app_users.id` references are text in payroll tables | ✅ zero `uuid … references public.app_users` matches in any payroll/finance/crew migration | grep over `supabase/migrations/*payroll*/…finance*/…crew*` |
| 5.8-obs | Platform-domain observation (OUT of payroll scope) | ⚠️ early platform migrations (`20260620000000` workflow/handoff, `20260620000002` HSE) declare uuid `app_users` FKs. Behavioral probe: `audit_logs.user_id` accepts text ✅; `workflow_tasks.approver_id` **rejected a text equality probe** (ambiguous — empty error body). Owned by the workflow platform, not payroll; needs its own verification item. | probe script, this session |
| 5.10-prep | EXPLAIN targets | Templates (a)–(e) included in the audit SQL for the register, work-queue, P1-9 overlap probe, report history, and 1,100-line calc support. | `scripts/sql/payroll_security_audit.sql` |

Notes:
- The Supabase **April 2026 Data-API exposure change** is why §B checks grants +
  API visibility explicitly instead of inferring from RLS (doc §5 warning).
- The crew tables (`hr_crew_assignments`/`hr_crew_movements`, mig `20260920000000`)
  were created with RLS enabled + service-role-only grants; §B re-verifies at runtime.
- `finance_payroll_create_run_tx` grants were hardened to service-role-only by the
  applied `_apply_20260919000720_create_run_attestations.sql`; §B's 5.5 block
  verifies every other payroll function the same way.

## B. Runtime catalog — operator results (paste per block)

Run `scripts/sql/payroll_security_audit.sql` block-by-block against the dev DB:

- **5.1 RLS**: expect `rls_enabled = true` for every row. → _pending operator run_
- **5.3 anon/authenticated grants**: expect **zero rows**. → _pending_
- **5.4 service_role grants**: review list. → _pending_
- **5.5/5.6 functions**: expect `security_definer=false` (or documented reason),
  `search_path` pinned, `anon/auth execute=false`, `service execute=true`. → _pending_
- **5.7 buckets/policies**: payslips/statutory-forms/report buckets private;
  no cross-employee read path. → _pending_
- **5.9 indexes**: FK/state/idempotency/effective-date/keyset coverage. → _pending_
- **5.10 EXPLAIN (ANALYZE, BUFFERS)**: attach plans for (a)–(e). → _pending_

Every ❌/⚠️ from §B becomes a certification defect with owner + evidence (doc §11
record format); none may be silently accepted.

## C. Security test matrix (per-endpoint)
The behavioral matrix (401/403/participant-scope/SoD/deny-overrides/self-only
payslips/immutable access evidence) is owned by the §7 fixture + §8 certification
suite — not duplicated here.
