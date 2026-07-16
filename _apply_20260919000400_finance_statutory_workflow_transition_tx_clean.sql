
create or replace function public.finance_statutory_workflow_transition_tx(
  p_transition_id uuid,
  p_version_id    uuid,
  p_actor_id      text,
  p_target_status text,
  p_comment       text,
  p_input_hash    text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_receipt      public.workflow_source_receipts%rowtype;
  v_status       text;
  v_created_by   text;
  v_label        text;
  v_effective    date;
  v_jurisdiction text;
  v_new_status   text;
  v_audit_action text;
  v_event_type   text;
  v_severity     text;
  v_result       jsonb;
begin
  if p_target_status not in ('approved','returned','rejected','cancelled') then
    raise exception 'finance_statutory_transition: invalid target %', p_target_status using errcode = 'WF400';
  end if;

  select * into v_receipt from public.workflow_source_receipts where transition_id = p_transition_id;
  if found then
    if v_receipt.input_hash = p_input_hash then
      return v_receipt.result;
    end if;
    raise exception 'finance_statutory_transition: receipt input hash mismatch for %', p_transition_id using errcode = 'WF409';
  end if;

  select status, created_by, label, effective_from, jurisdiction
    into v_status, v_created_by, v_label, v_effective, v_jurisdiction
    from public.finance_statutory_versions where id = p_version_id for update;
  if not found then
    raise exception 'finance_statutory_transition: version % not found', p_version_id using errcode = 'WF404';
  end if;

  if p_target_status = 'approved' then
    if v_status <> 'pending_approval' then
      raise exception 'finance_statutory_transition: version % is % (expected pending_approval)', p_version_id, v_status using errcode = 'WF409';
    end if;
    if v_created_by is not null and v_created_by = p_actor_id then
      raise exception 'finance_statutory_transition: segregation of duties — creator cannot approve' using errcode = 'WF422';
    end if;
    v_new_status := 'approved'; v_audit_action := 'statutory_version.approved';
    v_event_type := 'finance.statutory.version.approved'; v_severity := 'success';
    update public.finance_statutory_versions
       set status = 'approved', approved_by = p_actor_id where id = p_version_id;
  elsif p_target_status = 'returned' then
    v_new_status := 'draft'; v_audit_action := 'statutory_version.returned';
    v_event_type := 'finance.statutory.version.returned'; v_severity := 'warning';
    update public.finance_statutory_versions set status = 'draft' where id = p_version_id;
  elsif p_target_status = 'rejected' then
    v_new_status := 'draft'; v_audit_action := 'statutory_version.rejected';
    v_event_type := 'finance.statutory.version.rejected'; v_severity := 'warning';
    update public.finance_statutory_versions set status = 'draft' where id = p_version_id;
  else
    v_new_status := 'draft'; v_audit_action := 'statutory_version.workflow_cancelled';
    v_event_type := 'finance.statutory.version.cancelled'; v_severity := 'warning';
    update public.finance_statutory_versions set status = 'draft' where id = p_version_id;
  end if;

  insert into public.hr_audit_log
    (submodule_key, record_id, actor_id, action, previous_state, new_state, reason)
  values
    ('finance_statutory', p_version_id::text, nullif(p_actor_id, ''), v_audit_action,
     jsonb_build_object('status', v_status), jsonb_build_object('status', v_new_status), nullif(p_comment, ''));

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
  values
    (v_event_type, 'finance_statutory', 'statutory_version', p_version_id::text, nullif(p_actor_id, ''), v_severity,
     jsonb_build_object('label', v_label, 'effectiveFrom', v_effective, 'jurisdiction', v_jurisdiction,
                        'approvedBy', case when p_target_status = 'approved' then p_actor_id end,
                        'reason', p_comment),
     'finance_statutory.' || v_event_type || ':' || p_transition_id::text);

  if p_target_status = 'approved' then
    insert into public.handoff_outbox
      (source_module, target_module, source_entity_type, source_entity_id, target_entity_type, payload, status, created_by)
    values
      ('finance_statutory', 'finance_payroll', 'statutory_version', p_version_id::text, 'statutory_version',
       jsonb_build_object('action', 'statutory_version_approved', 'statutoryVersionId', p_version_id,
                          'label', v_label, 'effectiveFrom', v_effective, 'jurisdiction', v_jurisdiction,
                          'approvedBy', p_actor_id),
       'pending', nullif(p_actor_id, ''));
  end if;

  v_result := jsonb_build_object(
    'versionId', p_version_id, 'label', v_label, 'status', v_new_status,
    'approvedBy', case when p_target_status = 'approved' then p_actor_id end);

  insert into public.workflow_source_receipts (transition_id, module_key, source_id, input_hash, result)
  values (p_transition_id, 'finance_statutory', p_version_id::text, p_input_hash, v_result);

  return v_result;
end
$fn$;

revoke all    on function public.finance_statutory_workflow_transition_tx(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finance_statutory_workflow_transition_tx(uuid, uuid, text, text, text, text) to service_role;
