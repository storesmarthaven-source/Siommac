-- ============================================================================
-- HR Overtime — workflow binding
-- ============================================================================
-- Seeds: workflow_templates row + published v1 + module_workflow_bindings row
-- Module key:    hr_overtime
-- Workflow type: hr_overtime_approval
-- Trigger event: hr.overtime.submitted
--
-- Approval step assigned to manager role (manager approves their team's OT).
-- hr_manager and admin are also implicitly able to approve via role grants.
-- Segregation of duties NOT required for OT (employee submits, manager approves).
--
-- sourceStatusMap: submitted → approved (complete), rejected (reject/cancel).
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":false,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":false,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":false,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. workflow_templates row
  select id into tpl_id from public.workflow_templates
    where template_key = 'hr_overtime_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('hr_overtime_approval', 'hr_overtime', 'hr_overtime_approval',
       'Overtime Approval',
       'Manager approval of an employee overtime entry before it can be included in payroll.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'hr_overtime', workflow_type = 'hr_overtime_approval',
          status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 — single Manager approval step
  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey',        'manager_approval',
          'stepName',       'Manager Approval',
          'stepType',       'approval',
          'sequenceNo',     1,
          'assignment',     jsonb_build_object('type', 'role', 'value', 'manager'),
          'dueDurationHours', 48,
          'required',       true,
          'decisionRules',  dr
        )
      ),
      'transitions', '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs', '[]'::jsonb,
      'sourceStatusMap', jsonb_build_object(
        'onStarted',   'submitted',
        'onCompleted', 'approved',
        'onReturned',  'submitted',
        'onRejected',  'rejected',
        'onCancelled', 'cancelled'
      ),
      'settings', base_settings
    ),
    now()
  )
  on conflict (template_id, version_no) do update
    set version_status = excluded.version_status,
        definition     = excluded.definition,
        published_at   = excluded.published_at
  returning id into ver_id;

  -- 3. global binding
  delete from public.module_workflow_bindings
    where module_key    = 'hr_overtime'
      and workflow_type  = 'hr_overtime_approval'
      and trigger_event  = 'hr.overtime.submitted'
      and scope_type     = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('hr_overtime', 'hr_overtime_approval', 'hr.overtime.submitted',
     tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run: NOTIFY pgrst, 'reload schema';
