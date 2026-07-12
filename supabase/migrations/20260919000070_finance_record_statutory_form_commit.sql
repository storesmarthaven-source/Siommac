-- ============================================================================
-- Finance Payroll -- atomic statutory-form record (audit remediation 2c)
-- ============================================================================
-- recordStatutoryForm superseded prior generations then inserted the new row as
-- TWO separate PostgREST calls, and the supersede was SWALLOWED (try/catch, no
-- error check). Two failure modes corrupted the "current" form set:
--   * supersede fails silently, insert succeeds  -> TWO 'generated' rows / identity
--   * supersede succeeds, insert throws          -> ZERO 'generated' rows / identity
--
-- This function does supersede + insert in ONE transaction: either the old row is
-- superseded AND the new row exists, or neither changes (the prior 'generated' row
-- is preserved). Identity = form_type + tax_year + employee_id (null-aware) and,
-- when supplied, period_start -- matching the JS supersede filter exactly. The
-- artifact upload stays outside the txn (object storage is external); only the DB
-- row set is made consistent.
--
-- ASCII only + idempotent (create or replace); service_role execute only.
-- ============================================================================

create or replace function public.finance_record_statutory_form_commit(p_form jsonb)
returns public.finance_statutory_forms
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_form_type    text := p_form->>'form_type';
  v_tax_year     int  := nullif(p_form->>'tax_year', '')::int;
  v_employee_id  text := p_form->>'employee_id';
  v_period_start date := nullif(p_form->>'period_start', '')::date;
  v_row public.finance_statutory_forms;
begin
  if v_form_type is null then
    raise exception 'finance_record_statutory_form_commit: form_type is required';
  end if;
  if coalesce(p_form->>'file_path', '') = '' then
    raise exception 'finance_record_statutory_form_commit: file_path is required';
  end if;

  -- Serialize concurrent generations of the SAME identity. Without this, two requests
  -- can both run the supersede then both insert, leaving duplicate 'generated' rows
  -- for one identity. The advisory lock is transaction-scoped (auto-released on
  -- commit/rollback); the loser waits, then supersedes the winner's row before its own
  -- insert -> exactly one current form.
  perform pg_advisory_xact_lock(hashtextextended(
    v_form_type || '|' || coalesce(v_tax_year::text, '') || '|' ||
    coalesce(v_employee_id, '') || '|' || coalesce(v_period_start::text, ''), 0));

  -- Supersede prior generations of the same identity (all-or-nothing with the insert).
  update public.finance_statutory_forms set status = 'superseded'
  where status = 'generated'
    and form_type = v_form_type
    and tax_year is not distinct from v_tax_year
    and employee_id is not distinct from v_employee_id
    and (v_period_start is null or period_start = v_period_start);

  insert into public.finance_statutory_forms (
    form_type, tax_year, period_start, period_end, employee_id, run_id, scope,
    format, file_path, data_file_path, totals, checksum, generated_by, metadata)
  values (
    v_form_type, v_tax_year, v_period_start,
    nullif(p_form->>'period_end', '')::date,
    v_employee_id, nullif(p_form->>'run_id', '')::uuid,
    coalesce(p_form->>'scope', case when v_employee_id is not null then 'employee' else 'employer' end),
    coalesce(p_form->>'format', 'pdf'), p_form->>'file_path', p_form->>'data_file_path',
    coalesce(p_form->'totals', '{}'::jsonb), p_form->>'checksum', p_form->>'generated_by',
    coalesce(p_form->'metadata', '{}'::jsonb))
  returning * into v_row;

  return v_row;
end
$fn$;

revoke all    on function public.finance_record_statutory_form_commit(jsonb) from public;
revoke all    on function public.finance_record_statutory_form_commit(jsonb) from anon;
revoke all    on function public.finance_record_statutory_form_commit(jsonb) from authenticated;
grant execute on function public.finance_record_statutory_form_commit(jsonb) to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
