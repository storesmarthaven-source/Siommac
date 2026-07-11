-- ============================================================================
-- Finance Payroll -- ATOMIC GL REVERSE (audit remediation P0-3, part 2 of 2)
-- ============================================================================
-- Companion to 20260918000140 (post). reverse_payroll_gl_tx locks the run + the
-- original journal, writes a mirror (debit/credit swapped) reversing journal,
-- marks the original reversed, and unlinks the run -- all in one transaction,
-- so concurrent/duplicate reversals lose on the lock. Split into its own file
-- to stay under the SQL editor's input-size limit. Service_role only.
-- Idempotent / re-runnable.
-- ============================================================================

create or replace function public.reverse_payroll_gl_tx(
  p_run_id               uuid,
  p_reversing_journal_no text,
  p_entry_date           date,
  p_actor                text,
  p_reason               text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $rev_gl$
declare
  v_run           record;
  v_orig          record;
  v_reversing_id  uuid;
begin
  select id, run_no, gl_journal_id into v_run
    from public.finance_payroll_runs where id = p_run_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_run.gl_journal_id is null then
    return jsonb_build_object('status', 'not_posted');
  end if;

  select id, journal_no, status, source_ref, memo into v_orig
    from public.finance_gl_journals where id = v_run.gl_journal_id for update;
  if not found or v_orig.status <> 'posted' then
    return jsonb_build_object('status', 'not_reversible', 'current', coalesce(v_orig.status, 'missing'));
  end if;

  insert into public.finance_gl_journals
    (journal_no, entry_date, memo, status, source_module, source_ref,
     posted_at, posted_by, created_by, reversal_of, metadata)
  values
    (p_reversing_journal_no, p_entry_date,
     'Reversal of ' || v_orig.journal_no || case when p_reason is not null and p_reason <> '' then ' - ' || p_reason else '' end,
     'posted', 'finance_payroll', v_orig.source_ref,
     now(), p_actor, p_actor, v_orig.id,
     jsonb_build_object('reversalOf', v_orig.id::text))
  returning id into v_reversing_id;

  insert into public.finance_gl_journal_lines
    (journal_id, line_no, account_code, debit, credit, description)
  select v_reversing_id, line_no, account_code, credit, debit, description
    from public.finance_gl_journal_lines
   where journal_id = v_orig.id
   order by line_no;

  update public.finance_gl_journals
     set status = 'reversed', reversed_at = now()
   where id = v_orig.id;

  update public.finance_payroll_runs
     set gl_journal_id = null, gl_posted_at = null
   where id = p_run_id;

  return jsonb_build_object(
    'status', 'reversed', 'reversing_journal_id', v_reversing_id,
    'reversing_journal_no', p_reversing_journal_no, 'original_journal_id', v_orig.id);
end;
$rev_gl$;

revoke all on function public.reverse_payroll_gl_tx(uuid, text, date, text, text) from public, anon, authenticated;
grant execute on function public.reverse_payroll_gl_tx(uuid, text, date, text, text) to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
