-- ============================================================================
-- Finance Payroll — employee-loan approval workflow binding (Wave 5)
-- ============================================================================
-- Seeds: workflow_templates row + published v1 + module_workflow_bindings row
-- Module key:     finance_loan
-- Workflow type:  finance_loan_approval
-- Trigger event:  finance.loan.submitted
--
-- Approval step assigned to finance_manager. Segregation of duties (creator ≠
-- approver) enforced in the adapter (financeLoanAdapter.ts → assertDifferentApprover).
--
-- sourceStatusMap:
--   onStarted   → pending_approval  (already set at submit time)
--   onCompleted → active
--   onReturned  → draft
--   onRejected  → rejected
--   onCancelled → cancelled
-- ============================================================================

do $$
declare
  tpl_id  uuid;
  ver_id  uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  select id into tpl_id from public.workflow_templates where template_key = 'finance_loan_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('finance_loan_approval', 'finance_loan', 'finance_loan_approval',
       'Finance Employee Loan Approval',
       'Finance Manager approval of an employee loan / salary advance before it becomes active and starts auto-deducting from payroll.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'finance_loan', workflow_type = 'finance_loan_approval',
          status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey',           'finance_manager_loan_approval',
          'stepName',          'Finance Manager Loan Approval',
          'stepType',          'approval',
          'sequenceNo',        1,
          'assignment',        jsonb_build_object('type', 'role', 'value', 'finance_manager'),
          'dueDurationHours',  72,
          'required',          true,
          'decisionRules',     dr
        )
      ),
      'transitions',   '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs',      '[]'::jsonb,
      'sourceStatusMap', jsonb_build_object(
        'onStarted',   'pending_approval',
        'onCompleted', 'active',
        'onReturned',  'draft',
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

  delete from public.module_workflow_bindings
    where module_key    = 'finance_loan'
      and workflow_type  = 'finance_loan_approval'
      and trigger_event  = 'finance.loan.submitted'
      and scope_type     = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('finance_loan', 'finance_loan_approval', 'finance.loan.submitted',
     tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run: NOTIFY pgrst, 'reload schema';
