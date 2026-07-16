create or replace function public.workflow_start_instance_tx(
  p_template_version_id uuid,
  p_module_key          text,
  p_workflow_type       text,
  p_source_record_id    text,
  p_source_record_ref   text    default null,
  p_trigger_event       text    default 'manual.start',
  p_requested_by        text    default null,
  p_owner_id            text    default null,
  p_site_id             text    default null,
  p_department_id       text    default null,
  p_priority            text    default 'medium',
  p_source_snapshot     jsonb   default '{}'::jsonb,
  p_assignees           jsonb   default '{}'::jsonb,
  p_request_key         text    default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_receipt_key text;
  v_hash        text;
  v_claim       jsonb;
  v_res         jsonb;
begin
  if p_module_key is null or btrim(p_module_key) = '' then
    raise exception 'workflow_start_instance_tx: module_key is required' using errcode = 'WF422';
  end if;
  if p_workflow_type is null or btrim(p_workflow_type) = '' then
    raise exception 'workflow_start_instance_tx: workflow_type is required' using errcode = 'WF422';
  end if;
  if p_source_record_id is null or btrim(p_source_record_id) = '' then
    raise exception 'workflow_start_instance_tx: source_record_id is required' using errcode = 'WF422';
  end if;
  if p_template_version_id is null then
    raise exception 'workflow_start_instance_tx: template_version_id is required' using errcode = 'WF422';
  end if;

  v_receipt_key := nullif(btrim(coalesce(p_request_key, '')), '');
  if v_receipt_key is not null then
    v_hash := md5((jsonb_build_object(
      'version',  p_template_version_id,
      'module',   p_module_key,
      'type',     p_workflow_type,
      'source',   p_source_record_id,
      'trigger',  coalesce(p_trigger_event, 'manual.start'),
      'actor',    coalesce(p_requested_by, '')
    ))::text);
    v_claim := wf_internal._claim_request(v_receipt_key, v_hash);
    if v_claim->>'status' = 'duplicate' then
      return coalesce(
        nullif(v_claim->'result', 'null'::jsonb),
        jsonb_build_object('workflowId', v_claim->>'workflowId', 'duplicate', true)
      );
    end if;
  end if;

  v_res := wf_internal._create_instance(
    p_binding_id             => null,
    p_template_id            => null,
    p_template_version_id    => p_template_version_id,
    p_module_key             => p_module_key,
    p_workflow_type          => p_workflow_type,
    p_source_record_id       => p_source_record_id,
    p_source_record_ref      => p_source_record_ref,
    p_trigger_event          => coalesce(nullif(btrim(coalesce(p_trigger_event, '')), ''), 'manual.start'),
    p_requested_by           => p_requested_by,
    p_owner_id               => p_owner_id,
    p_site_id                => p_site_id,
    p_department_id          => p_department_id,
    p_priority               => coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'medium'),
    p_source_snapshot        => coalesce(p_source_snapshot, '{}'::jsonb),
    p_assignees              => coalesce(p_assignees, '{}'::jsonb),
    p_supersedes_workflow_id => null
  );

  if v_receipt_key is not null then
    perform wf_internal._record_request(
      p_request_key  => v_receipt_key,
      p_request_hash => v_hash,
      p_operation    => 'workflow_start_instance',
      p_module_key   => p_module_key,
      p_source_id    => p_source_record_id,
      p_workflow_id  => (v_res->>'workflowId')::uuid,
      p_result       => v_res
    );
  end if;

  return v_res;
end
$fn$;

revoke all on function public.workflow_start_instance_tx(
  uuid, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.workflow_start_instance_tx(
  uuid, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text
) to service_role;
