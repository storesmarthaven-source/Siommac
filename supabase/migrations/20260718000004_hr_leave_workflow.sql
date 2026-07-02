-- ============================================================================
-- HR Leave — workflow template + published version + binding
-- ============================================================================
-- Seeds the central engine with the Leave Request Approval workflow:
--   • ONE template `hr_leave_approval` (module_key = hr_leave)
--   • ONE published v1 version (single manager approval step)
--   • ONE global binding for trigger_event = 'hr.leave.requested'
--
-- The registered hr_leave adapter (lib/workflow/hrAdapters.ts) drives leave
-- request status on engine decisions. Idempotent.
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. template
  select id into tpl_id from public.workflow_templates where template_key = 'hr_leave_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('hr_leave_approval', 'hr_leave', 'hr_leave_approval',
       'Leave Request Approval', 'Manager approval of employee leave requests.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'hr_leave', workflow_type = 'hr_leave_approval', status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 (single manager approval step; linear → completes on approve)
  insert into public.workflow_template_versions (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey','leave_approval','stepName','Leave Approval','stepType','approval','sequenceNo',1,
          'assignment', jsonb_build_object('type','role','value','manager'),
          'dueDurationHours', 48, 'required', true, 'decisionRules', dr
        )
      ),
      'transitions', '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs', '[]'::jsonb,
      'sourceStatusMap', '{}'::jsonb,
      'settings', base_settings
    ),
    now()
  )
  on conflict (template_id, version_no) do update
    set version_status = excluded.version_status,
        definition = excluded.definition,
        published_at = excluded.published_at
  returning id into ver_id;

  -- 3. one global binding for the leave request trigger event
  delete from public.module_workflow_bindings
    where module_key = 'hr_leave'
      and workflow_type = 'hr_leave_approval'
      and trigger_event = 'hr.leave.requested'
      and scope_type = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('hr_leave', 'hr_leave_approval', 'hr.leave.requested', tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying: NOTIFY pgrst, 'reload schema';
