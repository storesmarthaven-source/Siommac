-- ============================================================================
-- Central Workflow Engine — seed the HR Employee-Master change-approval workflow
-- ============================================================================
-- Moves HR sensitive-change approvals onto the central engine (Spec §14):
--   • ONE template `hr_employee_change_approval` (module_key = hr_employee_master,
--     workflow_type = hr_change_approval) — a single HR-Manager approval step.
--   • ONE published v1 version (definition below).
--   • ONE global binding per change type, so createChangeRequest()'s
--     startWorkflowForRecord({ moduleKey:'hr_employee_master', workflowType:
--     'hr_change_approval', triggerEvent:'hr.employee.<type>' }) resolves to it.
--
-- The registered hr_employee_master adapter (lib/workflow/hrAdapters.ts) applies
-- the approved change to app_users on completion — so the engine owns the
-- lifecycle and hr_employee_change_requests stays the change envelope (its
-- workflow_id links the two). sourceStatusMap is empty: the custom adapter sets
-- the request status itself (in_review / applied / returned / rejected).
--
-- Idempotent: re-running updates v1 + replaces the bindings. After applying:
--   NOTIFY pgrst, 'reload schema';
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  ev     text;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
  trigger_events text[] := array[
    'hr.employee.status_change', 'hr.employee.department_transfer', 'hr.employee.site_transfer',
    'hr.employee.supervisor_change', 'hr.employee.role_change', 'hr.employee.employment_type_change',
    'hr.employee.contact_update'
  ];
begin
  -- 1. template (granular module_key = hr_employee_master)
  select id into tpl_id from public.workflow_templates where template_key = 'hr_employee_change_approval';
  if tpl_id is null then
    insert into public.workflow_templates (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values ('hr_employee_change_approval', 'hr_employee_master', 'hr_change_approval',
            'HR Employee Change Approval', 'Approval of sensitive Employee Master changes.', 'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'hr_employee_master', workflow_type = 'hr_change_approval', status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 (single HR-Manager approval step; linear → completes on approve)
  insert into public.workflow_template_versions (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey','hr_approval','stepName','HR Approval','stepType','approval','sequenceNo',1,
          'assignment', jsonb_build_object('type','role','value','hr_manager'),
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
    set version_status = excluded.version_status, definition = excluded.definition, published_at = excluded.published_at
  returning id into ver_id;

  -- 3. one global binding per change type → the same template/version
  foreach ev in array trigger_events loop
    delete from public.module_workflow_bindings
      where module_key = 'hr_employee_master' and workflow_type = 'hr_change_approval' and trigger_event = ev
        and scope_type = 'global' and scope_id is null;
    insert into public.module_workflow_bindings
      (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
    values
      ('hr_employee_master', 'hr_change_approval', ev, tpl_id, ver_id, 'global', true, 100);
  end loop;
end $$;

-- After applying:  NOTIFY pgrst, 'reload schema';
