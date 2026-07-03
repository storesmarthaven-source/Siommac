-- ============================================================================
-- Finance NIS Profile Verification — workflow binding (Phase 2.5)
-- ============================================================================
-- Template key : finance_nis_profile_verification
-- Module key   : finance_payroll
-- Trigger event: finance.nis.profile.submitted
--
-- Steps:
--   1. Finance Staff Review    (role: finance_staff)  — can return for HR correction
--   2. Finance Manager Verify  (role: finance_manager) — final verification
--
-- On completion → adapter sets nis_status='verified' + writes audit + event.
-- No second approval authority — central engine owns the lifecycle.
-- The engine throws if no published version exists, so we publish v1 here.
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  dr_review jsonb := '{"canApprove":true,"canReturn":true,"canReject":false,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":false,"requireAttachment":false}'::jsonb;
  dr_verify jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. workflow_templates row
  select id into tpl_id from public.workflow_templates
    where template_key = 'finance_nis_profile_verification';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('finance_nis_profile_verification', 'finance_payroll', 'finance_nis_profile_verification',
       'Finance NIS Profile Verification',
       'Finance reviews and verifies an employee NIS statutory profile submitted by HR. '
       'HR submits → Finance Staff reviews → Finance Manager verifies → profile marked verified.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key        = 'finance_payroll',
          workflow_type     = 'finance_nis_profile_verification',
          status            = 'active',
          current_version   = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 — two-step: Finance Staff review → Finance Manager verify
  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey',        'finance_staff_review',
          'stepName',       'Finance Staff Review',
          'stepType',       'approval',
          'sequenceNo',     1,
          'assignment',     jsonb_build_object('type', 'role', 'value', 'finance_staff'),
          'dueDurationHours', 48,
          'required',       true,
          'decisionRules',  dr_review
        ),
        jsonb_build_object(
          'stepKey',        'finance_manager_verify',
          'stepName',       'Finance Manager Verification',
          'stepType',       'approval',
          'sequenceNo',     2,
          'assignment',     jsonb_build_object('type', 'role', 'value', 'finance_manager'),
          'dueDurationHours', 72,
          'required',       true,
          'decisionRules',  dr_verify
        )
      ),
      'transitions', '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs', '[]'::jsonb,
      'sourceStatusMap', jsonb_build_object(
        'onStarted',   'pending_verification',
        'onCompleted', 'verified',
        'onReturned',  'pending_verification',
        'onRejected',  'not_available',
        'onCancelled', 'pending_verification'
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
    where module_key    = 'finance_payroll'
      and workflow_type = 'finance_nis_profile_verification'
      and trigger_event = 'finance.nis.profile.submitted'
      and scope_type    = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('finance_payroll', 'finance_nis_profile_verification', 'finance.nis.profile.submitted',
     tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run: NOTIFY pgrst, 'reload schema';
