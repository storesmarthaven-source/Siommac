-- ============================================================================
-- Finance Payroll -- ATOMIC GL POST (audit remediation P0-3, part 1 of 2)
-- ============================================================================
-- postRunGl previously issued separate PostgREST writes (header, then lines,
-- then run-link) with a best-effort compensating delete: two concurrent posts
-- could BOTH create journals before either linked the run, and a failed link
-- left a posted journal orphaned. post_payroll_gl_tx does the whole accounting
-- mutation in ONE transaction with a row lock on the run. A partial unique
-- index additionally guarantees at most ONE posted payroll journal per run.
-- The REVERSE function is in migration 20260918000141 (split to stay under the
-- SQL editor's input-size limit). Service_role only. Idempotent / re-runnable.
-- ============================================================================

create unique index if not exists fgj_one_posted_payroll_journal_per_run
  on public.finance_gl_journals ((metadata->>'payrollRunId'))
  where source_module = 'finance_payroll' and status = 'posted'
    and metadata ? 'payrollRunId';

create or replace function public.post_payroll_gl_tx(
  p_run_id     uuid,
  p_journal_no text,
  p_entry_date date,
  p_memo       text,
  p_actor      text,
  p_lines      jsonb,
  p_metadata   jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $post_gl$
declare
  v_run          record;
  v_journal_id   uuid;
  v_total_debit  numeric(15,2) := 0;
  v_total_credit numeric(15,2) := 0;
  v_count        int := 0;
  v_line         jsonb;
  v_line_no      int := 0;
begin
  select id, status, gl_journal_id into v_run
    from public.finance_payroll_runs where id = p_run_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_run.status not in ('locked', 'exported') then
    return jsonb_build_object('status', 'not_lockable', 'current', v_run.status);
  end if;
  if v_run.gl_journal_id is not null then
    return jsonb_build_object('status', 'already_posted', 'journal_id', v_run.gl_journal_id);
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_count := v_count + 1;
    v_total_debit  := v_total_debit  + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
  end loop;
  if v_count < 2 then
    return jsonb_build_object('status', 'invalid_lines', 'message', 'A journal must have at least 2 lines.');
  end if;
  if abs(v_total_debit - v_total_credit) > 0.005 then
    return jsonb_build_object('status', 'unbalanced', 'total_debit', v_total_debit, 'total_credit', v_total_credit);
  end if;

  insert into public.finance_gl_journals
    (journal_no, entry_date, memo, status, source_module, source_ref,
     posted_at, posted_by, created_by, metadata)
  values
    (p_journal_no, p_entry_date, p_memo, 'posted', 'finance_payroll',
     coalesce(p_metadata->>'runNo', null),
     now(), p_actor, p_actor,
     p_metadata || jsonb_build_object('payrollRunId', p_run_id::text))
  returning id into v_journal_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    insert into public.finance_gl_journal_lines
      (journal_id, line_no, account_code, debit, credit, description)
    values
      (v_journal_id, v_line_no, v_line->>'account_code',
       coalesce((v_line->>'debit')::numeric, 0),
       coalesce((v_line->>'credit')::numeric, 0),
       v_line->>'description');
  end loop;

  update public.finance_payroll_runs
     set gl_journal_id = v_journal_id, gl_posted_at = now()
   where id = p_run_id;

  return jsonb_build_object(
    'status', 'posted', 'journal_id', v_journal_id, 'journal_no', p_journal_no,
    'total_debit', v_total_debit, 'total_credit', v_total_credit);
end;
$post_gl$;

revoke all on function public.post_payroll_gl_tx(uuid, text, date, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.post_payroll_gl_tx(uuid, text, date, text, text, jsonb, jsonb) to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
