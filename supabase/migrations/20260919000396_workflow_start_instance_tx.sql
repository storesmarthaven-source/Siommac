-- ============================================================================
-- Atomic Workflow Creation -- explicit-start wrapper (finding #3, Shape E).
-- Design rationale:
--   netlify/functions/lib/workflow/SUBMIT_TX_DESIGN.md  (section 2d, section 7)
-- Contract:
--   netlify/functions/lib/workflow/START_INSTANCE_CONTRACT.md
-- Depends on 20260919000210 (wf_internal schema + workflow_request_receipts) and
-- 20260919000211 (_create_instance / _claim_request / _record_request).
-- Operator-applied; idempotent (create or replace). After applying, run:
--   NOTIFY pgrst, reload schema
-- ============================================================================
-- public.workflow_start_instance_tx -- explicit-start wrapper.
--
-- Implements design section 2d: "_create_instance with a template_version
-- directly (no binding, no source update)."  Auth (source-existence + module-
-- specific permission) is the ROUTE job (design section 7).  This wrapper:
--   1. Validates required inputs with clean WF422.
--   2. Optionally deduplicates via _claim_request/_record_request when the
--      caller supplies a non-blank p_request_key (see section 3 -- callers
--      that are not retried business-record mutations may omit the key, but
--      the routes for E1/E2/E3 REQUIRE it so the FE can retry safely).
--   3. Calls _create_instance in explicit (no-binding) mode.
--   4. Returns the _create_instance result jsonb
--      { workflowId, workflowNo, currentStepKey, firstTasks }.
--
-- SIDE-EFFECT OWNERSHIP (design section 4):
--   The primitive owns: workflow_instances, workflow_tasks, workflow_audit_log
--   (workflow.started) and app_events (workflow.started + workflow.task.assigned
--   per task). Notification delivery (in-app rows) is handled post-commit by
--   the TS wrapper via the event_rules pipeline from the primitives app_events.
--   This wrapper owns: NOTHING extra (no source-status update, no handoffs --
--   those belong to Shape-A/B wrappers).
--
-- Custom SQLSTATEs -> HTTP (rpcHttpError in service.ts):
--   WF404 not-found  WF409 conflict/config-changed  WF422 invalid input.
-- ============================================================================

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
  -- 1. Required scalar inputs -- surface clean WF422 before reaching the primitive.
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

  -- 2. Optional idempotency receipt.
  --    A blank / null key means no deduplication (caller accepts at-least-once).
  --    A non-blank key enables exactly-once semantics via _claim_request.
  --    _claim_request handles the null/blank case internally (returns proceed).
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

  -- 3. Create the instance -- explicit mode (no binding_id; primitive validates
  --    the version directly and rejects any template_id cross-check via the
  --    version row itself).
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

  -- 4. Record receipt on success (same txn; _record_request is a no-op for blank key).
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

-- Grants: service_role only (backend). The function is in the public schema
-- so PostgreSQL grants EXECUTE to PUBLIC by default; revoke that and grant
-- only to the Netlify backend service_role so PostgREST row-level enforcement
-- cannot be bypassed by anon/authenticated callers directly.
revoke all on function public.workflow_start_instance_tx(
  uuid, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.workflow_start_instance_tx(
  uuid, text, text, text, text, text, text, text, text, text, text, jsonb, jsonb, text
) to service_role;

-- After applying: run NOTIFY pgrst, reload schema
-- Verify: select proname from pg_proc where proname = workflow_start_instance_tx
