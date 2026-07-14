-- ============================================================================
-- Reconcile hr_employee_change_requests.change_type CHECK with the code's
-- authoritative CHANGE_TYPES (netlify/functions/lib/hr/changeApproval.ts).
-- ============================================================================
-- The original constraint (migration 20260702000001) predates `transfer_promotion`
-- (and, on older DBs, `contact_update`). Because that table is created with
-- `create table if not exists`, editing the source migration never re-applies the
-- constraint to an already-created table — so the LIVE DB still rejects
-- `transfer_promotion`, failing ~28 E2E tests (HR Employee Master submits +
-- Transfers). This ALTER brings the live constraint up to the full code set.
-- `salary_change` is retained for any historical rows although the code no longer
-- emits it. Operator-applied; idempotent. After applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

alter table public.hr_employee_change_requests
  drop constraint if exists hr_employee_change_requests_change_type_check;

alter table public.hr_employee_change_requests
  add constraint hr_employee_change_requests_change_type_check
  check (change_type in ('role_change','department_transfer','site_transfer',
                         'supervisor_change','status_change','employment_type_change',
                         'salary_change','contact_update','transfer_promotion'));

-- After applying:  NOTIFY pgrst, 'reload schema';
