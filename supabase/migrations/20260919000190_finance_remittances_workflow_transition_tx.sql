-- ============================================================================
-- Finance Remittances — workflow source-transition receipt RPC (finding #1)
-- Design: DECIDE_TX_DESIGN.md §5/§8. Depends on 150 (workflow_source_receipts).
-- Operator-applied; idempotent. After applying: NOTIFY pgrst, 'reload schema';
--
-- Converts the multi-write financeRemittancesAdapter (source UPDATE + hr_audit_log
-- + app_events) into ONE transactional, receipt-producing operation keyed by
-- transition_id. Approval mirrors approveRemittance (SoD creator != approver,
-- submitted → approved). return/reject/cancel roll the remittance back to draft
-- (adapter parity). A retry returns the stored result and writes NOTHING →
-- exactly-once observable effects. Notification delivery ('ready for payment')
-- happens after commit in the outbox worker (afterCommit), off the durable event.
-- ============================================================================

create or replace function public.finance_remittances_workflow_transition_tx(
  p_transition_id  uuid,
  p_remittance_id  uuid,
  p_actor_id       text,
  p_target_status  text,          -- approved | returned | rejected | cancelled
  p_comment        text,
  p_input_hash     text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_receipt      public.workflow_source_receipts%rowtype;
  v_status       text;
  v_created_by   text;
  v_remit_no     text;
  v_authority    text;
  v_total_due    numeric;
  v_new_status   text;
  v_audit_action text;
  v_event_type   text;
  v_severity     text;
  v_result       jsonb;
begin
  if p_target_status not in ('approved','returned','rejected','cancelled') then
    raise exception 'finance_remittances_transition: invalid target %', p_target_status using errcode = 'WF400';
  end if;

  -- Idempotency: an existing receipt means the effects already committed.
  select * into v_receipt from public.workflow_source_receipts where transition_id = p_transition_id;
  if found then
    if v_receipt.input_hash = p_input_hash then
      return v_receipt.result;
    end if;
    raise exception 'finance_remittances_transition: receipt input hash mismatch for %', p_transition_id using errcode = 'WF409';
  end if;

  -- Lock the source remittance + re-validate under this transaction.
  select status, created_by, remittance_no, authority, total_due
    into v_status, v_created_by, v_remit_no, v_authority, v_total_due
    from public.finance_remittances where id = p_remittance_id for update;
  if not found then
    raise exception 'finance_remittances_transition: remittance % not found', p_remittance_id using errcode = 'WF404';
  end if;

  if p_target_status = 'approved' then
    if v_status <> 'submitted' then
      raise exception 'finance_remittances_transition: remittance % is % (expected submitted)', p_remittance_id, v_status using errcode = 'WF409';
    end if;
    if v_created_by is not null and v_created_by = p_actor_id then
      raise exception 'finance_remittances_transition: segregation of duties — creator cannot approve' using errcode = 'WF422';
    end if;
    v_new_status := 'approved'; v_audit_action := 'remittance.approved';
    v_event_type := 'finance.remittance.approved'; v_severity := 'success';
    update public.finance_remittances set status = 'approved', approved_by = p_actor_id where id = p_remittance_id;
  else
    -- return / reject / cancel all roll the remittance back to draft (adapter parity).
    v_new_status := 'draft'; v_severity := 'warning';
    if p_target_status = 'returned' then
      v_audit_action := 'remittance.returned';          v_event_type := 'finance.remittance.returned';
    elsif p_target_status = 'rejected' then
      v_audit_action := 'remittance.rejected_by_workflow'; v_event_type := 'finance.remittance.rejected';
    else
      v_audit_action := 'remittance.workflow_cancelled';  v_event_type := 'finance.remittance.cancelled';
    end if;
    update public.finance_remittances set status = 'draft', approved_by = null where id = p_remittance_id;
  end if;

  insert into public.hr_audit_log
    (submodule_key, record_id, actor_id, action, previous_state, new_state, reason)
  values
    ('finance_remittances', p_remittance_id::text, nullif(p_actor_id, ''), v_audit_action,
     jsonb_build_object('status', v_status), jsonb_build_object('status', v_new_status), nullif(p_comment, ''));

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
  values
    (v_event_type, 'finance_remittances', 'remittance', p_remittance_id::text, nullif(p_actor_id, ''), v_severity,
     jsonb_build_object('remittanceNo', v_remit_no, 'authority', v_authority, 'totalDue', v_total_due, 'reason', p_comment),
     'finance_remittances.' || v_event_type || ':' || p_transition_id::text);

  v_result := jsonb_build_object(
    'remittanceId', p_remittance_id, 'remittanceNo', v_remit_no, 'authority', v_authority,
    'status', v_new_status, 'approvedBy', case when p_target_status = 'approved' then p_actor_id end);

  insert into public.workflow_source_receipts (transition_id, module_key, source_id, input_hash, result)
  values (p_transition_id, 'finance_remittances', p_remittance_id::text, p_input_hash, v_result);

  return v_result;
end
$fn$;

revoke all    on function public.finance_remittances_workflow_transition_tx(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finance_remittances_workflow_transition_tx(uuid, uuid, text, text, text, text) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
