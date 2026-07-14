-- ============================================================================
-- Finance Payroll — workflow source-transition receipt RPC (finding #1 exemplar)
-- Design: DECIDE_TX_DESIGN.md §5/§8. Depends on 150 (workflow_source_receipts).
-- Operator-applied; idempotent. After applying: NOTIFY pgrst, 'reload schema';
--
-- Converts the multi-write financePayrollAdapter (source UPDATE + hr_audit_log +
-- app_events + payroll_locking handoff) into ONE transactional, receipt-producing
-- operation keyed by transition_id. The workflow-outbox worker calls this BEFORE
-- workflow_finalize_transition_tx; the receipt is the proof finalize checks. A
-- retry returns the stored result and writes NOTHING → exactly-once observable
-- effects (no duplicate audit / event / handoff). SoD (creator != approver) is
-- enforced here, atomically, on the locked run.
--
-- NOTE: approval does NOT post GL here — GL/loan side-effects happen at lock time
-- (a separate action). This RPC only commits the approval/return/reject/cancel
-- source mutation + its audit/event/handoff intent.
-- ============================================================================

create or replace function public.finance_payroll_workflow_transition_tx(
  p_transition_id uuid,
  p_run_id        uuid,
  p_actor_id      text,
  p_target_status text,          -- approved | returned | rejected | cancelled
  p_comment       text,
  p_input_hash    text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_receipt   public.workflow_source_receipts%rowtype;
  v_run_status text;
  v_created_by text;
  v_run_no    text;
  v_new_status text;
  v_audit_action text;
  v_event_type text;
  v_severity  text;
  v_result    jsonb;
begin
  if p_target_status not in ('approved','returned','rejected','cancelled') then
    raise exception 'finance_payroll_transition: invalid target %', p_target_status using errcode = 'WF400';
  end if;

  -- Idempotency: a receipt for this transition means the effects already committed.
  select * into v_receipt from public.workflow_source_receipts where transition_id = p_transition_id;
  if found then
    if v_receipt.input_hash = p_input_hash then
      return v_receipt.result;
    end if;
    raise exception 'finance_payroll_transition: receipt input hash mismatch for %', p_transition_id using errcode = 'WF409';
  end if;

  -- Lock the source run + re-validate its state inside this transaction.
  select status, created_by, run_no into v_run_status, v_created_by, v_run_no
    from public.finance_payroll_runs where id = p_run_id for update;
  if not found then
    raise exception 'finance_payroll_transition: run % not found', p_run_id using errcode = 'WF404';
  end if;

  -- Map the workflow outcome to the run status + audit/event metadata.
  if p_target_status = 'approved' then
    if v_run_status <> 'pending_approval' then
      raise exception 'finance_payroll_transition: run % is % (expected pending_approval)', p_run_id, v_run_status using errcode = 'WF409';
    end if;
    if v_created_by is not null and v_created_by = p_actor_id then
      raise exception 'finance_payroll_transition: segregation of duties — creator cannot approve' using errcode = 'WF422';
    end if;
    v_new_status := 'approved'; v_audit_action := 'payroll_run.approved';
    v_event_type := 'finance.payroll.run.approved'; v_severity := 'success';
    update public.finance_payroll_runs set status = 'approved', approved_by = p_actor_id where id = p_run_id;
  elsif p_target_status = 'returned' then
    v_new_status := 'returned'; v_audit_action := 'payroll_run.returned';
    v_event_type := 'finance.payroll.run.returned'; v_severity := 'warning';
    update public.finance_payroll_runs set status = 'returned' where id = p_run_id;
  elsif p_target_status = 'rejected' then
    v_new_status := 'returned'; v_audit_action := 'payroll_run.rejected_by_workflow';
    v_event_type := 'finance.payroll.run.rejected'; v_severity := 'warning';
    update public.finance_payroll_runs set status = 'returned' where id = p_run_id;
  else -- cancelled
    v_new_status := 'cancelled'; v_audit_action := 'payroll_run.workflow_cancelled';
    v_event_type := 'finance.payroll.run.cancelled'; v_severity := 'warning';
    update public.finance_payroll_runs set status = 'cancelled' where id = p_run_id;
  end if;

  -- Atomic audit (immutable compliance row).
  insert into public.hr_audit_log
    (submodule_key, record_id, actor_id, action, previous_state, new_state, reason)
  values
    ('finance_payroll', p_run_id::text, nullif(p_actor_id, ''), v_audit_action,
     jsonb_build_object('status', v_run_status), jsonb_build_object('status', v_new_status), nullif(p_comment, ''));

  -- Atomic event (dedupe_key → belt-and-suspenders; the receipt already guards retries).
  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
  values
    (v_event_type, 'finance_payroll', 'payroll_run', p_run_id::text, nullif(p_actor_id, ''), v_severity,
     jsonb_build_object('runNo', v_run_no, 'approvedBy', case when p_target_status='approved' then p_actor_id end, 'reason', p_comment),
     'finance_payroll.' || v_event_type || ':' || p_transition_id::text);

  -- On approval, enqueue the payroll_locking handoff intent (was emitRunApprovedSideEffects).
  if p_target_status = 'approved' then
    insert into public.handoff_outbox
      (source_module, target_module, source_entity_type, source_entity_id, target_entity_type, payload, status, created_by)
    values
      ('finance_payroll', 'finance_payroll', 'payroll_run', p_run_id::text, 'payroll_locking',
       jsonb_build_object('runNo', v_run_no, 'approvedBy', p_actor_id), 'pending', nullif(p_actor_id, ''));
  end if;

  v_result := jsonb_build_object(
    'runId', p_run_id, 'runNo', v_run_no, 'status', v_new_status,
    'approvedBy', case when p_target_status = 'approved' then p_actor_id end);

  -- The receipt: proof the source mutation committed, keyed by transition_id.
  insert into public.workflow_source_receipts (transition_id, module_key, source_id, input_hash, result)
  values (p_transition_id, 'finance_payroll', p_run_id::text, p_input_hash, v_result);

  return v_result;
end
$fn$;

revoke all    on function public.finance_payroll_workflow_transition_tx(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finance_payroll_workflow_transition_tx(uuid, uuid, text, text, text, text) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
