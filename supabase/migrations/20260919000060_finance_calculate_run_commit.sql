-- ============================================================================
-- Finance Payroll -- atomic calculate-run commit (audit remediation 2b)
-- ============================================================================
-- calculateRun computed lines/warnings/totals in JS, then persisted them as
-- SEPARATE PostgREST calls: delete lines -> delete warnings -> chunked insert
-- lines -> chunked insert warnings -> update run totals+status. A crash mid-chain
-- (or a chunk that failed after others committed) left partial lines with stale
-- run totals. supabase-js cannot wrap those calls in one transaction.
--
-- This function is the SINGLE commit path: it runs atomically, so any failure
-- rolls back the whole recompute and the run keeps its prior committed state.
-- The heavy T&T PAYE/NIS/health-surcharge math stays in JS; this only PERSISTS
-- the already-computed rows. Typed jsonb_to_recordset (explicit column lists) so
-- table DEFAULTS (id, created_at, updated_at) apply -- never NULL'd out.
--
-- ASCII only + idempotent (create or replace); service_role execute only.
-- ============================================================================

create or replace function public.finance_calculate_run_commit(
  p_run_id   uuid,
  p_lines    jsonb,
  p_warnings jsonb,
  p_totals   jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status text;
begin
  -- Lock the run and RE-VALIDATE its status inside this transaction. The JS status
  -- check happens before the compute, so a concurrent submit/approve could move the
  -- run to pending_approval/approved between the check and this commit; without the
  -- lock the commit would silently overwrite it back to 'calculated'. FOR UPDATE
  -- serializes concurrent calculates/transitions on the same run.
  select status into v_status
  from public.finance_payroll_runs
  where id = p_run_id
  for update;
  if not found then
    raise exception 'finance_calculate_run_commit: run % not found', p_run_id
      using errcode = 'no_data_found';
  end if;
  if v_status not in ('input_locked', 'calculated', 'returned') then
    raise exception 'finance_calculate_run_commit: run % is in status % and cannot be (re)calculated', p_run_id, v_status
      using errcode = 'check_violation';
  end if;

  -- Clear the prior recompute (idempotent: a re-calculate rebuilds from scratch).
  delete from public.finance_payroll_run_lines    where run_id = p_run_id;
  delete from public.finance_payroll_run_warnings where run_id = p_run_id;

  insert into public.finance_payroll_run_lines (
    run_id, employee_id, base, taxable_gross, gross, nis_employee, nis_employer,
    health_surcharge, chargeable_income, paye, voluntary_deductions, net, breakdown,
    department_id, cost_center_id, nis_number_masked, nis_status, nis_class_no,
    opening_ytd_nis_employee, opening_ytd_nis_employer)
  select
    p_run_id, x.employee_id, x.base, x.taxable_gross, x.gross, x.nis_employee, x.nis_employer,
    x.health_surcharge, x.chargeable_income, x.paye, x.voluntary_deductions, x.net,
    coalesce(x.breakdown, '{}'::jsonb),
    x.department_id, x.cost_center_id, x.nis_number_masked, x.nis_status, x.nis_class_no,
    coalesce(x.opening_ytd_nis_employee, 0), coalesce(x.opening_ytd_nis_employer, 0)
  from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as x(
    run_id uuid, employee_id text, base numeric, taxable_gross numeric, gross numeric,
    nis_employee numeric, nis_employer numeric, health_surcharge numeric,
    chargeable_income numeric, paye numeric, voluntary_deductions numeric, net numeric,
    breakdown jsonb, department_id text, cost_center_id uuid, nis_number_masked text,
    nis_status text, nis_class_no int, opening_ytd_nis_employee numeric,
    opening_ytd_nis_employer numeric);

  insert into public.finance_payroll_run_warnings (
    run_id, employee_id, warning_type, severity, message, metadata)
  select
    p_run_id, w.employee_id, w.warning_type, coalesce(w.severity, 'warning'),
    w.message, coalesce(w.metadata, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_warnings, '[]'::jsonb)) as w(
    run_id uuid, employee_id text, warning_type text, severity text, message text,
    metadata jsonb);

  update public.finance_payroll_runs set
    status             = 'calculated',
    gross_total        = (p_totals->>'grossTotal')::numeric,
    deduction_total    = (p_totals->>'deductionTotal')::numeric,
    net_total          = (p_totals->>'netTotal')::numeric,
    nis_employer_total = (p_totals->>'nisEmployerTotal')::numeric,
    employee_count     = (p_totals->>'employeeCount')::int,
    updated_at         = now()
  where id = p_run_id;

  if not found then
    raise exception 'finance_calculate_run_commit: run % not found', p_run_id
      using errcode = 'no_data_found';
  end if;
end
$fn$;

revoke all    on function public.finance_calculate_run_commit(uuid, jsonb, jsonb, jsonb) from public;
revoke all    on function public.finance_calculate_run_commit(uuid, jsonb, jsonb, jsonb) from anon;
revoke all    on function public.finance_calculate_run_commit(uuid, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.finance_calculate_run_commit(uuid, jsonb, jsonb, jsonb) to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
