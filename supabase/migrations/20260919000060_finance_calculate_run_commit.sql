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
-- P3 audit addition: accepts optional p_event (app_events row) and p_audit
-- (hr_audit_log row) as JSONB objects, inserting them inside the same
-- transaction. This makes the audit trail atomic with the business commit:
-- either the lines/warnings/totals + event + audit all land together, or none
-- do. Notification delivery (Realtime/push) happens outside this function via
-- deliverEventNotifications() after the RPC returns.
--
-- Returns: the app_events.id of the inserted event row (null if p_event is null).
--
-- ASCII only + idempotent (drop old 4-arg signature + create-or-replace 6-arg);
-- service_role execute only.
-- ============================================================================

-- Drop the prior 4-arg signature so the new 6-arg version is the sole overload.
-- (Postgres treats a new parameter list as a DIFFERENT function, not a replacement.)
drop function if exists public.finance_calculate_run_commit(uuid, jsonb, jsonb, jsonb);

create or replace function public.finance_calculate_run_commit(
  p_run_id   uuid,
  p_lines    jsonb,
  p_warnings jsonb,
  p_totals   jsonb,
  p_event    jsonb DEFAULT NULL,
  p_audit    jsonb DEFAULT NULL
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status   text;
  v_event_id uuid;
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

  -- P3: atomic audit trail -- insert hr_audit_log row inside this transaction.
  -- The audit row is non-nullable for compliance; a missing submodule_key or action
  -- would raise a NOT NULL violation and roll back the whole commit (correct behavior).
  if p_audit is not null then
    insert into public.hr_audit_log (
      employee_id, submodule_key, record_id, actor_id, action,
      previous_state, new_state, reason)
    values (
      nullif(p_audit->>'employee_id', ''),
      p_audit->>'submodule_key',
      nullif(p_audit->>'record_id', ''),
      nullif(p_audit->>'actor_id', ''),
      p_audit->>'action',
      p_audit->'previous_state',
      p_audit->'new_state',
      nullif(p_audit->>'reason', ''));
  end if;

  -- P3: atomic event row -- insert app_events inside this transaction.
  -- Returns the generated uuid so JS can use it when delivering notifications.
  if p_event is not null then
    insert into public.app_events (
      event_type, source_module, source_entity_type, source_entity_id,
      actor_user_id, site_id, department_id, severity, payload, dedupe_key)
    values (
      p_event->>'event_type',
      p_event->>'source_module',
      p_event->>'source_entity_type',
      p_event->>'source_entity_id',
      nullif(p_event->>'actor_user_id', ''),
      nullif(p_event->>'site_id', ''),
      nullif(p_event->>'department_id', ''),
      coalesce(nullif(p_event->>'severity', ''), 'info'),
      coalesce(p_event->'payload', '{}'::jsonb),
      nullif(p_event->>'dedupe_key', ''))
    returning id into v_event_id;
  end if;

  return v_event_id;
end
$fn$;

revoke all    on function public.finance_calculate_run_commit(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
revoke all    on function public.finance_calculate_run_commit(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from anon;
revoke all    on function public.finance_calculate_run_commit(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.finance_calculate_run_commit(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
