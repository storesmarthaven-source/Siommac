-- ============================================================================
-- HR Compensation — workflow binding
-- ============================================================================
-- Seeds: workflow_templates row + published v1 + module_workflow_bindings row
-- Module key:    hr_compensation
-- Workflow type: hr_compensation_change_approval
-- Trigger event: hr.compensation.item.submitted
--
-- Approval step assigned to hr_manager role.
-- Segregation of duties (creator ≠ approver) enforced in the adapter
-- (hrCompensationAdapter.ts → assertDifferentApprover), not in the template.
--
-- The engine throws "no published version" with no published template version,
-- so we publish v1 here. sourceStatusMap drives the pay-item status on each
-- workflow event.
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. workflow_templates row
  select id into tpl_id from public.workflow_templates
    where template_key = 'hr_compensation_change_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('hr_compensation_change_approval', 'hr_compensation', 'hr_compensation_change_approval',
       'HR Compensation Change Approval',
       'HR Manager approval of a new compensation pay item (allowance or deduction) before it becomes active.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'hr_compensation', workflow_type = 'hr_compensation_change_approval',
          status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 — single HR Manager approval step
  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey',        'hr_manager_approval',
          'stepName',       'HR Manager Approval',
          'stepType',       'approval',
          'sequenceNo',     1,
          'assignment',     jsonb_build_object('type', 'role', 'value', 'hr_manager'),
          'dueDurationHours', 72,
          'required',       true,
          'decisionRules',  dr
        )
      ),
      'transitions', '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs', '[]'::jsonb,
      'sourceStatusMap', jsonb_build_object(
        'onStarted',   'pending_approval',
        'onCompleted', 'active',
        'onReturned',  'draft',
        'onRejected',  'rejected',
        'onCancelled', 'draft'
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
    where module_key    = 'hr_compensation'
      and workflow_type  = 'hr_compensation_change_approval'
      and trigger_event  = 'hr.compensation.item.submitted'
      and scope_type     = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('hr_compensation', 'hr_compensation_change_approval', 'hr.compensation.item.submitted',
     tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run: NOTIFY pgrst, 'reload schema';
