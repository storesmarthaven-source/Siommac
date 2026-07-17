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

drop function if exists public.reverse_payroll_gl_tx(
  uuid, text, date, text, text
);

create or replace function public.reverse_payroll_gl_tx(
  p_run_id          uuid,
  p_actor           text,
  p_reason          text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $rev_gl$
declare
  v_request_key   text;
  v_hash          text;
  v_receipt       public.finance_payroll_gl_command_receipts%rowtype;
  v_run           public.finance_payroll_runs%rowtype;
  v_orig          public.finance_gl_journals%rowtype;
  v_reversing_id  uuid;
  v_reversing_no  text;
  v_event_id      uuid;
  v_handoff_id    uuid;
  v_result        jsonb;
  v_year          integer := extract(year from current_date)::integer;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'reverse_payroll_gl: actor is required'
      using errcode = 'PR400';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reverse_payroll_gl: reason is required'
      using errcode = 'PR422';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'reverse_payroll_gl: idempotency key is required'
      using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users
     where id = p_actor and status = 'active'
  ) then
    raise exception 'reverse_payroll_gl: actor is not an active user'
      using errcode = 'PR403';
  end if;

  v_request_key :=
    p_actor || '|payroll_gl.reverse|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'runId', p_run_id,
    'actorId', p_actor,
    'reason', btrim(p_reason)
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  select *
    into v_receipt
    from public.finance_payroll_gl_command_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception 'reverse_payroll_gl: idempotency key was already used for a different request'
        using errcode = 'PR409';
    end if;
    return v_receipt.result || jsonb_build_object('duplicate', true);
  end if;

  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id
   for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_run.status <> 'locked' then
    return jsonb_build_object(
      'status', 'not_reversible',
      'current', v_run.status
    );
  end if;
  if v_run.gl_journal_id is null then
    return jsonb_build_object('status', 'not_posted');
  end if;

  select *
    into v_orig
    from public.finance_gl_journals
   where id = v_run.gl_journal_id
   for update;
  if not found
     or v_orig.status <> 'posted'
     or v_orig.source_module <> 'finance_payroll'
     or v_orig.source_ref is distinct from v_run.run_no
     or v_orig.metadata->>'payrollRunId' is distinct from v_run.id::text
     or v_orig.metadata->>'calculationVersionId'
       is distinct from v_run.current_calculation_version_id::text then
    return jsonb_build_object('status', 'not_reversible', 'current', coalesce(v_orig.status, 'missing'));
  end if;

  v_reversing_no := 'JE-' || v_year::text || '-' ||
    lpad(public.increment_ref_counter('JE', v_year)::text, 4, '0');

  insert into public.finance_gl_journals
    (journal_no, entry_date, memo, status, source_module, source_ref,
     posted_at, posted_by, created_by, reversal_of, metadata)
  values
    (v_reversing_no, current_date,
     'Reversal of ' || v_orig.journal_no || ' - ' || btrim(p_reason),
     'posted', 'finance_payroll', v_orig.source_ref,
     now(), p_actor, p_actor, v_orig.id,
     jsonb_build_object(
       'reversalOf', v_orig.id::text,
       'reversedPayrollRunId', v_run.id::text,
       'calculationVersionId', v_run.current_calculation_version_id,
       'originalPayrollControlChecksum',
         v_orig.metadata->>'payrollControlChecksum',
       'reversal', true
     ))
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

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  )
  values (
    'finance.payroll.gl.reversed', 'finance_payroll', 'payroll_run',
    v_run.id::text, p_actor, 'warning',
    jsonb_build_object(
      'runNo', v_run.run_no,
      'originalJournalId', v_orig.id,
      'originalJournalNo', v_orig.journal_no,
      'reversingJournalId', v_reversing_id,
      'reversingJournalNo', v_reversing_no,
      'reason', btrim(p_reason)
    ),
    'finance.payroll.gl.reversed:' || v_reversing_id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key, record_id, actor_id, action,
    previous_state, new_state, reason
  )
  values (
    'finance_payroll', v_run.id::text, p_actor,
    'payroll_run.gl_reversed',
    jsonb_build_object(
      'journalId', v_orig.id,
      'journalNo', v_orig.journal_no,
      'status', 'posted'
    ),
    jsonb_build_object(
      'journalId', null,
      'reversingJournalId', v_reversing_id,
      'reversingJournalNo', v_reversing_no,
      'status', 'reversed'
    ),
    btrim(p_reason)
  );

  insert into public.handoff_outbox (
    source_module,
    target_module,
    source_entity_type,
    source_entity_id,
    target_entity_type,
    target_entity_id,
    payload,
    status,
    created_by
  )
  values (
    'finance_payroll',
    'finance_gl',
    'payroll_run',
    v_run.id::text,
    'gl_reversal',
    v_reversing_id::text,
    jsonb_build_object(
      'runId', v_run.id,
      'runNo', v_run.run_no,
      'originalJournalId', v_orig.id,
      'reversingJournalId', v_reversing_id,
      'reversingJournalNo', v_reversing_no,
      'calculationVersionId', v_run.current_calculation_version_id,
      'eventId', v_event_id
    ),
    'pending',
    p_actor
  )
  returning id into v_handoff_id;

  v_result := jsonb_build_object(
    'status', 'reversed',
    'reversing_journal_id', v_reversing_id,
    'reversing_journal_no', v_reversing_no,
    'original_journal_id', v_orig.id,
    'event_id', v_event_id,
    'handoff_id', v_handoff_id,
    'duplicate', false
  );

  insert into public.finance_payroll_gl_command_receipts (
    request_key, request_hash, run_id, actor_id, command, journal_id, result
  )
  values (
    v_request_key, v_hash, v_run.id, p_actor, 'reverse',
    v_reversing_id, v_result
  );

  return v_result;
end;
$rev_gl$;

revoke all on function public.reverse_payroll_gl_tx(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.reverse_payroll_gl_tx(uuid, text, text, text)
  to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
