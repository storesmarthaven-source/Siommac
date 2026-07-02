-- ============================================================================
-- Central Workflow Engine — seed the HR Requests approval workflow
-- ============================================================================
-- Mirrors 20260711000000_workflow_hr_change_bindings.sql.
--
-- ONE template `hr_request_approval` (module_key = hr_requests,
--   workflow_type = hr_request_approval) — a single HR-Manager approval step.
-- ONE published v1 version (engine throws if none exists — Appendix 8).
-- ONE global binding on trigger event `hr.request.submitted` so that
--   submitRequest()'s startWorkflowForRecord({ moduleKey:'hr_requests',
--   workflowType:'hr_request_approval', triggerEvent:'hr.request.submitted' })
--   resolves to it.
--
-- Only approvable request types start a workflow (decided at the app layer
-- in requestsCore.ts by checking requiresApproval in the catalogue).
-- Non-approvable types (profile_correction, general_inquiry) get null → plain
-- triage item resolved via fulfill/decide without engine involvement.
--
-- The registered hrRequestsAdapter (lib/workflow/hrAdapters.ts) updates
-- hr_requests.status on engine callbacks (onWorkflowCompleted → approved,
-- onWorkflowReturned → returned, onWorkflowRejected → rejected, etc.).
--
-- Idempotent: re-running updates v1 + replaces the binding.
-- After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. template
  select id into tpl_id from public.workflow_templates where template_key = 'hr_request_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('hr_request_approval', 'hr_requests', 'hr_request_approval',
       'HR Request Approval', 'Single HR-Manager approval for employee self-service requests.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'hr_requests', workflow_type = 'hr_request_approval',
          status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 (single HR-Manager approval step)
  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey',         'hr_approval',
          'stepName',        'HR Approval',
          'stepType',        'approval',
          'sequenceNo',      1,
          'assignment',      jsonb_build_object('type', 'role', 'value', 'hr_manager'),
          'dueDurationHours', 48,
          'required',        true,
          'decisionRules',   dr
        )
      ),
      'transitions',    '[]'::jsonb,
      'notifications',  '[]'::jsonb,
      'handoffs',       '[]'::jsonb,
      'sourceStatusMap', '{}'::jsonb,
      'settings',       base_settings
    ),
    now()
  )
  on conflict (template_id, version_no) do update
    set version_status = excluded.version_status,
        definition     = excluded.definition,
        published_at   = excluded.published_at
  returning id into ver_id;

  -- 3. one global binding for the shared trigger event
  delete from public.module_workflow_bindings
    where module_key = 'hr_requests'
      and workflow_type = 'hr_request_approval'
      and trigger_event = 'hr.request.submitted'
      and scope_type = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('hr_requests', 'hr_request_approval', 'hr.request.submitted', tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run:  NOTIFY pgrst, 'reload schema';
