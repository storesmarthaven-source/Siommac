-- ============================================================================
-- Central Workflow Engine — add the transfer_promotion binding
-- ============================================================================
-- Adds ONE global binding for hr.employee.transfer_promotion pointing at the
-- existing hr_employee_change_approval template + its published v1 version.
-- The hr_employee_master adapter already calls applyApprovedChange() on
-- completion — no new adapter code needed; the new applyChange branch handles
-- the bundled transfer/promotion apply logic.
--
-- module_key MUST be 'hr_employee_master' (NOT 'hr') — that is what
-- createChangeRequest passes to startWorkflowForRecord (see routes/hr.ts).
--
-- Mirrors 20260711000000_workflow_hr_change_bindings.sql pattern exactly.
-- Idempotent: delete-then-insert for the single trigger event.
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
begin
  -- Resolve the existing published template
  select id into tpl_id
    from public.workflow_templates
    where template_key = 'hr_employee_change_approval';

  if tpl_id is null then
    raise exception 'workflow_templates row hr_employee_change_approval not found — apply 20260711000000 first';
  end if;

  -- Resolve the published v1 version
  select id into ver_id
    from public.workflow_template_versions
    where template_id = tpl_id
      and version_no  = 1
      and version_status = 'published';

  if ver_id is null then
    raise exception 'No published v1 for hr_employee_change_approval — check 20260711000000 applied correctly';
  end if;

  -- Add the binding for the new trigger event (delete-then-insert = idempotent)
  delete from public.module_workflow_bindings
    where module_key    = 'hr_employee_master'
      and workflow_type = 'hr_change_approval'
      and trigger_event = 'hr.employee.transfer_promotion'
      and scope_type    = 'global'
      and scope_id      is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('hr_employee_master', 'hr_change_approval', 'hr.employee.transfer_promotion',
     tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run:  NOTIFY pgrst, 'reload schema';
