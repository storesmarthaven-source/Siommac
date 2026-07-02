-- ============================================================================
-- Central Workflow Engine — seed the Org-Structure change-approval workflow
-- ============================================================================
-- Routes high-risk Organization Structure changes through the central engine
-- (Phase B). Mirrors the hr_employee_change_approval seed:
--   • ONE template `hr_org_change_approval` (module_key = hr_org_structure,
--     workflow_type = hr_org_change_approval) — a single HR-Manager approval step.
--   • ONE published v1 version.
--   • ONE global binding per risky trigger event, so
--     startWorkflowForRecord({ moduleKey:'hr_org_structure', workflowType:
--     'hr_org_change_approval', triggerEvent:'hr.org.<entity>.<action>' }) resolves.
--
-- The registered hr_org_structure adapter (lib/workflow/orgAdapter.ts) applies the
-- approved change on completion (or marks it scheduled when effective-dated) and
-- sets the hr_org_change_requests status. sourceStatusMap is empty — the adapter
-- owns the envelope status. Idempotent. After applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  ev     text;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
  trigger_events text[] := array[
    'hr.org.org_unit.move', 'hr.org.org_unit.archive', 'hr.org.org_unit.delete', 'hr.org.org_unit.update',
    'hr.org.position.retire', 'hr.org.position.update',
    'hr.org.cost_center.retire', 'hr.org.cost_center.update'
  ];
begin
  -- 1. template (granular module_key = hr_org_structure)
  select id into tpl_id from public.workflow_templates where template_key = 'hr_org_change_approval';
  if tpl_id is null then
    insert into public.workflow_templates (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values ('hr_org_change_approval', 'hr_org_structure', 'hr_org_change_approval',
            'Org Structure Change Approval', 'Approval of high-risk organization structure changes.', 'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'hr_org_structure', workflow_type = 'hr_org_change_approval', status = 'active', current_version = 1
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
          'stepKey','org_approval','stepName','Org Change Approval','stepType','approval','sequenceNo',1,
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

  -- 3. one global binding per risky trigger event → the same template/version
  foreach ev in array trigger_events loop
    delete from public.module_workflow_bindings
      where module_key = 'hr_org_structure' and workflow_type = 'hr_org_change_approval' and trigger_event = ev
        and scope_type = 'global' and scope_id is null;
    insert into public.module_workflow_bindings
      (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
    values
      ('hr_org_structure', 'hr_org_change_approval', ev, tpl_id, ver_id, 'global', true, 100);
  end loop;
end $$;

-- After applying:  NOTIFY pgrst, 'reload schema';
