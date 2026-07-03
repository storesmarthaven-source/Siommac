-- ============================================================================
-- Finance Statutory — workflow binding
-- ============================================================================
-- Seeds: workflow_templates row + published v1 + module_workflow_bindings row
-- Module key: finance_statutory
-- Workflow type: finance_statutory_approval
-- Trigger event: finance.statutory.version.submitted
--
-- Approval step is assigned to finance_manager role.
-- Segregation of duties (creator ≠ approver) is enforced in the adapter
-- (financeAdapters.ts → assertDifferentApprover) and the service layer,
-- NOT in the workflow template itself.
--
-- The engine throws "no published version" if the binding has no published
-- template version, so we must publish v1 here.
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
    where template_key = 'finance_statutory_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('finance_statutory_approval', 'finance_statutory', 'finance_statutory_approval',
       'Finance Statutory Configuration Approval',
       'Finance Manager approval of a new or updated statutory rate version before activation.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'finance_statutory', workflow_type = 'finance_statutory_approval', status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 — single Finance Manager approval step; linear, completes on approve
  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey', 'finance_manager_approval',
          'stepName', 'Finance Manager Approval',
          'stepType', 'approval',
          'sequenceNo', 1,
          'assignment', jsonb_build_object('type', 'role', 'value', 'finance_manager'),
          'dueDurationHours', 72,
          'required', true,
          'decisionRules', dr
        )
      ),
      'transitions', '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs', '[]'::jsonb,
      'sourceStatusMap', jsonb_build_object(
        'onStarted',   'pending_approval',
        'onCompleted', 'approved',
        'onReturned',  'draft',
        'onRejected',  'draft',
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
    where module_key   = 'finance_statutory'
      and workflow_type = 'finance_statutory_approval'
      and trigger_event = 'finance.statutory.version.submitted'
      and scope_type    = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('finance_statutory', 'finance_statutory_approval', 'finance.statutory.version.submitted',
     tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run: NOTIFY pgrst, 'reload schema';
