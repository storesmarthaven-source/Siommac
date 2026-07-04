-- ============================================================================
-- SIOMAC — pending migrations bundle (permissions + workflow seeds + storage)
-- Generated for operator apply. Ordered by timestamp. All idempotent
-- (on conflict do nothing / if not exists), so safe to re-run.
-- NOTE: 20260731000001 had a column bug (permission_key) — FIXED to 'permission'.
-- ============================================================================

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260731000001_hr_attendance_permissions.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- HR Attendance & Timekeeping -- permissions (keys + DB grants)
-- ============================================================================
-- Keys: hr.attendance.{view,view_all,punch,correct}
--       hr.attendance.timesheets.{view,submit,approve}
--       hr.attendance.exceptions.{view,manage}
--       hr.attendance.compute.run
--       hr.attendance.policy.manage
--       hr.attendance.reports.{view,export}
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- employee: punch own time; view own records; submit own timesheet; view own exceptions
  ('employee',   'hr.attendance.view'),
  ('employee',   'hr.attendance.punch'),
  ('employee',   'hr.attendance.timesheets.view'),
  ('employee',   'hr.attendance.timesheets.submit'),
  ('employee',   'hr.attendance.exceptions.view'),

  -- manager: view all under dept; correct; approve timesheets; manage exceptions
  ('manager',    'hr.attendance.view'),
  ('manager',    'hr.attendance.view_all'),
  ('manager',    'hr.attendance.punch'),
  ('manager',    'hr.attendance.correct'),
  ('manager',    'hr.attendance.timesheets.view'),
  ('manager',    'hr.attendance.timesheets.submit'),
  ('manager',    'hr.attendance.timesheets.approve'),
  ('manager',    'hr.attendance.exceptions.view'),
  ('manager',    'hr.attendance.exceptions.manage'),
  ('manager',    'hr.attendance.reports.view'),

  -- hr_staff: view all; correct; manage exceptions; view reports
  ('hr_staff',   'hr.attendance.view'),
  ('hr_staff',   'hr.attendance.view_all'),
  ('hr_staff',   'hr.attendance.punch'),
  ('hr_staff',   'hr.attendance.correct'),
  ('hr_staff',   'hr.attendance.timesheets.view'),
  ('hr_staff',   'hr.attendance.timesheets.submit'),
  ('hr_staff',   'hr.attendance.timesheets.approve'),
  ('hr_staff',   'hr.attendance.exceptions.view'),
  ('hr_staff',   'hr.attendance.exceptions.manage'),
  ('hr_staff',   'hr.attendance.compute.run'),
  ('hr_staff',   'hr.attendance.reports.view'),
  ('hr_staff',   'hr.attendance.reports.export'),

  -- hr_manager: full attendance management including policy
  ('hr_manager', 'hr.attendance.view'),
  ('hr_manager', 'hr.attendance.view_all'),
  ('hr_manager', 'hr.attendance.punch'),
  ('hr_manager', 'hr.attendance.correct'),
  ('hr_manager', 'hr.attendance.timesheets.view'),
  ('hr_manager', 'hr.attendance.timesheets.submit'),
  ('hr_manager', 'hr.attendance.timesheets.approve'),
  ('hr_manager', 'hr.attendance.exceptions.view'),
  ('hr_manager', 'hr.attendance.exceptions.manage'),
  ('hr_manager', 'hr.attendance.compute.run'),
  ('hr_manager', 'hr.attendance.policy.manage'),
  ('hr_manager', 'hr.attendance.reports.view'),
  ('hr_manager', 'hr.attendance.reports.export'),

  -- admin: all
  ('admin',      'hr.attendance.view'),
  ('admin',      'hr.attendance.view_all'),
  ('admin',      'hr.attendance.punch'),
  ('admin',      'hr.attendance.correct'),
  ('admin',      'hr.attendance.timesheets.view'),
  ('admin',      'hr.attendance.timesheets.submit'),
  ('admin',      'hr.attendance.timesheets.approve'),
  ('admin',      'hr.attendance.exceptions.view'),
  ('admin',      'hr.attendance.exceptions.manage'),
  ('admin',      'hr.attendance.compute.run'),
  ('admin',      'hr.attendance.policy.manage'),
  ('admin',      'hr.attendance.reports.view'),
  ('admin',      'hr.attendance.reports.export'),

  -- superadmin: all
  ('superadmin', 'hr.attendance.view'),
  ('superadmin', 'hr.attendance.view_all'),
  ('superadmin', 'hr.attendance.punch'),
  ('superadmin', 'hr.attendance.correct'),
  ('superadmin', 'hr.attendance.timesheets.view'),
  ('superadmin', 'hr.attendance.timesheets.submit'),
  ('superadmin', 'hr.attendance.timesheets.approve'),
  ('superadmin', 'hr.attendance.exceptions.view'),
  ('superadmin', 'hr.attendance.exceptions.manage'),
  ('superadmin', 'hr.attendance.compute.run'),
  ('superadmin', 'hr.attendance.policy.manage'),
  ('superadmin', 'hr.attendance.reports.view'),
  ('superadmin', 'hr.attendance.reports.export')
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260731000002_workflow_hr_attendance_binding.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- HR Attendance & Timekeeping -- workflow binding
-- ============================================================================
-- Seeds: workflow_templates row + published v1 + module_workflow_bindings row
-- Module key: hr_attendance
-- Workflow type: hr_timesheet_approval
-- Trigger event: hr.timesheet.submitted
--
-- The engine throws "no published version" if this binding has none,
-- so we must publish v1 here. The null-binding fallback in submitTimesheet
-- (workflow == null -> status approved) handles the case where selectWorkflowBinding
-- returns null (e.g. binding deactivated).
-- ============================================================================

do $$
declare
  tpl_id uuid;
  ver_id uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. template
  select id into tpl_id from public.workflow_templates
    where template_key = 'hr_timesheet_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('hr_timesheet_approval', 'hr_attendance', 'hr_timesheet_approval',
       'HR Timesheet Approval', 'Manager approval of employee timesheets.', 'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'hr_attendance', workflow_type = 'hr_timesheet_approval', status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 -- single manager-approval step; linear, completes on approve
  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey', 'manager_approval',
          'stepName', 'Manager Approval',
          'stepType', 'approval',
          'sequenceNo', 1,
          'assignment', jsonb_build_object('type', 'department_manager'),
          'dueDurationHours', 72,
          'required', true,
          'decisionRules', dr
        )
      ),
      'transitions', '[]'::jsonb,
      'notifications', '[]'::jsonb,
      'handoffs', '[]'::jsonb,
      'sourceStatusMap', jsonb_build_object(
        'onStarted',   'in_review',
        'onCompleted', 'approved',
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
    where module_key = 'hr_attendance'
      and workflow_type = 'hr_timesheet_approval'
      and trigger_event = 'hr.timesheet.submitted'
      and scope_type = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('hr_attendance', 'hr_timesheet_approval', 'hr.timesheet.submitted', tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260802000003_finance_statutory_permissions.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance statutory + pay-components — permissions (keys + DB grants)
-- ============================================================================
-- Phase 1 (Finance foundation) scope ONLY. HR compensation/overtime/statutory-
-- capture keys and the payroll-run/NIS-verify keys are catalogued + granted in
-- their own phases (they enforce nothing yet — no accept-and-drop).
--
-- Keys:
--   finance.statutory.{view,manage,approve,reports.view,reports.export}
--   finance.payroll.components.{view,manage}
--
-- Column is `permission` (NOT permission_key — that column does not exist;
-- loadRolePermissions selects `permission`). Grants go ONLY to roles that
-- exist (finance_staff/finance_manager created in 20260802000000).
--
-- Segregation: finance_manager holds both `manage` and `approve`; creator ≠
-- final approver is enforced at the action layer (assertDifferentApprover),
-- so approving a draft requires a second finance_manager (or admin override).
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- finance_staff: review-only on statutory; can view the component catalogue.
  ('finance_staff',   'finance.statutory.view'),
  ('finance_staff',   'finance.payroll.components.view'),

  -- finance_manager: full statutory lifecycle + component management + reports.
  ('finance_manager', 'finance.statutory.view'),
  ('finance_manager', 'finance.statutory.manage'),
  ('finance_manager', 'finance.statutory.approve'),
  ('finance_manager', 'finance.statutory.reports.view'),
  ('finance_manager', 'finance.statutory.reports.export'),
  ('finance_manager', 'finance.payroll.components.view'),
  ('finance_manager', 'finance.payroll.components.manage'),

  -- admin: all Phase-1 finance keys.
  ('admin',           'finance.statutory.view'),
  ('admin',           'finance.statutory.manage'),
  ('admin',           'finance.statutory.approve'),
  ('admin',           'finance.statutory.reports.view'),
  ('admin',           'finance.statutory.reports.export'),
  ('admin',           'finance.payroll.components.view'),
  ('admin',           'finance.payroll.components.manage'),

  -- superadmin: all Phase-1 finance keys.
  ('superadmin',      'finance.statutory.view'),
  ('superadmin',      'finance.statutory.manage'),
  ('superadmin',      'finance.statutory.approve'),
  ('superadmin',      'finance.statutory.reports.view'),
  ('superadmin',      'finance.statutory.reports.export'),
  ('superadmin',      'finance.payroll.components.view'),
  ('superadmin',      'finance.payroll.components.manage')
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260802000004_workflow_finance_statutory_binding.sql
-- ╚══════════════════════════════════════════════════════════════════════════
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

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260802000007_hr_compensation_overtime_permissions.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- HR Compensation + Overtime — permission grants
-- ============================================================================
-- Per §9 of COMPENSATION_PAYROLL_PREP_IMPLEMENTATION_BRIEF.
-- Keys:
--   hr.compensation.{view,manage,approve,reports.view,reports.export}   (5 keys)
--   hr.overtime.{view,submit,approve,manage,reports.view,reports.export} (6 keys)
-- Total: 11 HR compensation/overtime keys (not counting hr.employee.statutory.*)
--
-- Grants:
--   employee      → hr.overtime.submit
--   manager       → hr.overtime.{view,approve,reports.view}
--   hr_staff      → hr.compensation.{view,manage} + hr.overtime.{view,manage,reports.view}
--   hr_manager    → ALL hr.compensation.* + hr.overtime.*
--   admin         → ALL
--   superadmin    → ALL (already allow-all by resolution order)
--   finance_staff → (no new HR grants; their existing keys unchanged)
--   finance_manager→ (no new HR grants)
--
-- NOTE: role_permissions column is `permission` (not permission_key).
-- ============================================================================

-- employee: can submit their own overtime
insert into public.role_permissions (role_name, permission) values
  ('employee', 'hr.overtime.submit')
on conflict (role_name, permission) do nothing;

-- manager: view + approve overtime + view OT reports for their team
insert into public.role_permissions (role_name, permission) values
  ('manager', 'hr.overtime.view'),
  ('manager', 'hr.overtime.approve'),
  ('manager', 'hr.overtime.reports.view')
on conflict (role_name, permission) do nothing;

-- hr_staff: manage compensation inputs + manage overtime (no approve on either)
insert into public.role_permissions (role_name, permission) values
  ('hr_staff', 'hr.compensation.view'),
  ('hr_staff', 'hr.compensation.manage'),
  ('hr_staff', 'hr.overtime.view'),
  ('hr_staff', 'hr.overtime.manage'),
  ('hr_staff', 'hr.overtime.reports.view')
on conflict (role_name, permission) do nothing;

-- hr_manager: ALL compensation + ALL overtime keys
insert into public.role_permissions (role_name, permission) values
  ('hr_manager', 'hr.compensation.view'),
  ('hr_manager', 'hr.compensation.manage'),
  ('hr_manager', 'hr.compensation.approve'),
  ('hr_manager', 'hr.compensation.reports.view'),
  ('hr_manager', 'hr.compensation.reports.export'),
  ('hr_manager', 'hr.overtime.view'),
  ('hr_manager', 'hr.overtime.submit'),
  ('hr_manager', 'hr.overtime.approve'),
  ('hr_manager', 'hr.overtime.manage'),
  ('hr_manager', 'hr.overtime.reports.view'),
  ('hr_manager', 'hr.overtime.reports.export')
on conflict (role_name, permission) do nothing;

-- admin: ALL compensation + ALL overtime keys
insert into public.role_permissions (role_name, permission) values
  ('admin', 'hr.compensation.view'),
  ('admin', 'hr.compensation.manage'),
  ('admin', 'hr.compensation.approve'),
  ('admin', 'hr.compensation.reports.view'),
  ('admin', 'hr.compensation.reports.export'),
  ('admin', 'hr.overtime.view'),
  ('admin', 'hr.overtime.submit'),
  ('admin', 'hr.overtime.approve'),
  ('admin', 'hr.overtime.manage'),
  ('admin', 'hr.overtime.reports.view'),
  ('admin', 'hr.overtime.reports.export')
on conflict (role_name, permission) do nothing;

-- superadmin: ALL compensation + ALL overtime keys
-- (superadmin is already allow-all by loadRolePermissions, but we seed the rows
--  so the drift-guard test can compare the catalogue against the DB)
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hr.compensation.view'),
  ('superadmin', 'hr.compensation.manage'),
  ('superadmin', 'hr.compensation.approve'),
  ('superadmin', 'hr.compensation.reports.view'),
  ('superadmin', 'hr.compensation.reports.export'),
  ('superadmin', 'hr.overtime.view'),
  ('superadmin', 'hr.overtime.submit'),
  ('superadmin', 'hr.overtime.approve'),
  ('superadmin', 'hr.overtime.manage'),
  ('superadmin', 'hr.overtime.reports.view'),
  ('superadmin', 'hr.overtime.reports.export')
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260802000008_workflow_hr_compensation_binding.sql
-- ╚══════════════════════════════════════════════════════════════════════════
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

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260802000009_workflow_hr_overtime_binding.sql
-- ╚══════════════════════════════════════════════════════════════════════════
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

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260802000011_nis_profile_permissions.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- NIS Profile Permissions — HR capture + Finance verify (Phase 2.5)
-- ============================================================================
-- New keys (§9):
--   hr.employee.statutory.view    — HR can view the statutory profile section
--   hr.employee.statutory.capture — HR can create/update NIS profile data
--   finance.payroll.nis.view      — Finance can view pending NIS profiles
--   finance.payroll.nis.verify    — Finance Manager can verify a NIS profile
--   finance.payroll.nis.manage    — Finance Manager can manage NIS profiles
--
-- Grants (column is `permission`, NOT `permission_key`):
--   hr_staff, hr_manager  → hr.employee.statutory.{view,capture}
--   finance_staff         → finance.payroll.nis.view
--   finance_manager       → finance.payroll.nis.{view,verify,manage}
--   admin, superadmin     → ALL five keys
--
-- `on conflict (role_name, permission) do nothing` — idempotent.
-- Roles finance_staff/finance_manager were created in 20260802000000.
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- HR staff: capture NIS data for employees
  ('hr_staff',         'hr.employee.statutory.view'),
  ('hr_staff',         'hr.employee.statutory.capture'),

  -- HR manager: same capture keys (full HR set)
  ('hr_manager',       'hr.employee.statutory.view'),
  ('hr_manager',       'hr.employee.statutory.capture'),

  -- Finance staff: can review/view pending NIS profiles
  ('finance_staff',    'finance.payroll.nis.view'),

  -- Finance manager: full NIS verification lifecycle
  ('finance_manager',  'finance.payroll.nis.view'),
  ('finance_manager',  'finance.payroll.nis.verify'),
  ('finance_manager',  'finance.payroll.nis.manage'),

  -- Admin: all five keys
  ('admin',            'hr.employee.statutory.view'),
  ('admin',            'hr.employee.statutory.capture'),
  ('admin',            'finance.payroll.nis.view'),
  ('admin',            'finance.payroll.nis.verify'),
  ('admin',            'finance.payroll.nis.manage'),

  -- Superadmin: all five keys
  ('superadmin',       'hr.employee.statutory.view'),
  ('superadmin',       'hr.employee.statutory.capture'),
  ('superadmin',       'finance.payroll.nis.view'),
  ('superadmin',       'finance.payroll.nis.verify'),
  ('superadmin',       'finance.payroll.nis.manage')
on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260802000012_workflow_finance_nis_profile_verification.sql
-- ╚══════════════════════════════════════════════════════════════════════════
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

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260803000002_hr_roster_permissions.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- HR Roster Scheduling — permissions (keys + DB grants)
-- ============================================================================
-- Keys catalogued here (ALSO reported to the main session for the four TS
-- catalogues that the main session owns):
--   hr.roster.view             — see rosters for their scope
--   hr.roster.view_own         — employee self-view of own published shifts
--   hr.roster.manage           — create/edit/assign/generate
--   hr.roster.publish          — lock + notify assignees
--   hr.roster.templates.manage — shift templates + rotation patterns + coverage
--
-- Column is `permission` (NOT permission_key — that column does not exist).
-- Only roles that exist in public.roles:
--   employee, manager, hr_staff, hr_manager, admin, superadmin
-- (finance_staff, finance_manager, hse_staff are valid roles but don't need
-- roster grants at this time.)
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- employee: self-view of own published shifts only
  ('employee',    'hr.roster.view_own'),

  -- manager: manage rosters + publish + view for their scope
  ('manager',     'hr.roster.view'),
  ('manager',     'hr.roster.manage'),
  ('manager',     'hr.roster.publish'),
  ('manager',     'hr.roster.templates.manage'),

  -- hr_staff: manage + view; NOT publish or templates
  ('hr_staff',    'hr.roster.view'),
  ('hr_staff',    'hr.roster.manage'),

  -- hr_manager: full roster authority
  ('hr_manager',  'hr.roster.view'),
  ('hr_manager',  'hr.roster.view_own'),
  ('hr_manager',  'hr.roster.manage'),
  ('hr_manager',  'hr.roster.publish'),
  ('hr_manager',  'hr.roster.templates.manage'),

  -- admin: all roster keys
  ('admin',       'hr.roster.view'),
  ('admin',       'hr.roster.view_own'),
  ('admin',       'hr.roster.manage'),
  ('admin',       'hr.roster.publish'),
  ('admin',       'hr.roster.templates.manage'),

  -- superadmin: all roster keys
  ('superadmin',  'hr.roster.view'),
  ('superadmin',  'hr.roster.view_own'),
  ('superadmin',  'hr.roster.manage'),
  ('superadmin',  'hr.roster.publish'),
  ('superadmin',  'hr.roster.templates.manage')

on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260804000000_hr_documents_storage_limit.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- HR Employee Documents -- storage bucket size limit (server-side enforcement)
-- ============================================================================
-- The `hr-employee-documents` private bucket backs employee document uploads
-- (presigned upload/read via routes/hr.ts, HR_DOC_BUCKET). The 15 MB cap was
-- previously enforced ONLY as a client-side warning; a direct upload against the
-- presigned URL could exceed it. This sets the limit at the storage layer, which
-- Supabase Storage enforces on the object PUT regardless of the client-reported
-- fileSize on commit. Root-cause fix -- no reliance on client-supplied size.
--
-- Mirrors the pattern in 20260731000003_hr_attendance_storage_policies.sql.
-- allowed_mime_types is left NULL (unrestricted) to avoid rejecting document
-- types that already upload successfully; only the size cap is added here.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'hr-employee-documents',
  'hr-employee-documents',
  false,
  15728640  -- 15 MB (15 * 1024 * 1024) -- matches the client-side limit
)
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- service_role manages objects (presigned URL generation + server reads).
-- Idempotent: drop-then-create so re-applying is safe even if a policy pre-exists.
drop policy if exists "hr_employee_documents_service_all" on storage.objects;
create policy "hr_employee_documents_service_all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'hr-employee-documents')
  with check (bucket_id = 'hr-employee-documents');

-- No public read access -- all access via presigned signed URLs only.

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260804000001_payroll_run_permissions.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Payroll — Phase 3 Stage 2 — Run Permissions (Spec §9)
-- Keys: finance.payroll.{view_own, view_all, run.manage, reports.view, reports.export}
-- Grants: employee, finance_staff, finance_manager, admin, superadmin
--
-- Stage 3 keys (approve, lock, export) are NOT added here.
-- ============================================================================

-- ── Catalogue the 5 payroll run keys in role_permissions ─────────────────────

-- employee → view_own (see own payslip line; full payslip gated in stage 3)
insert into public.role_permissions (role_name, permission) values
  ('employee', 'finance.payroll.view_own')
on conflict do nothing;

-- finance_staff → view_all + run.manage + reports.view
insert into public.role_permissions (role_name, permission)
  select 'finance_staff', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view'
  ]) as p
on conflict do nothing;

-- finance_manager → all five
insert into public.role_permissions (role_name, permission)
  select 'finance_manager', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view',
    'finance.payroll.reports.export'
  ]) as p
on conflict do nothing;

-- admin → all five
insert into public.role_permissions (role_name, permission)
  select 'admin', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view',
    'finance.payroll.reports.export'
  ]) as p
on conflict do nothing;

-- superadmin inherits everything via loadRolePermissions → PERMISSION_KEYS;
-- no rows needed but add for completeness so DB is authoritative
insert into public.role_permissions (role_name, permission)
  select 'superadmin', p from unnest(array[
    'finance.payroll.view_own',
    'finance.payroll.view_all',
    'finance.payroll.run.manage',
    'finance.payroll.reports.view',
    'finance.payroll.reports.export'
  ]) as p
on conflict do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260804000003_payroll_approve_permissions.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Payroll — Phase 3 Stage 3 — Approve / Lock / Export Permissions
-- Keys: finance.payroll.{approve, lock, export}
-- Grants: finance_manager, admin, superadmin (NOT finance_staff — SoD)
-- Spec §9 / §10
-- ============================================================================

-- ── Catalogue the 3 stage-3 keys for role_permissions ────────────────────────

-- finance_manager → approve + lock + export (SoD: finance_staff does NOT get these)
insert into public.role_permissions (role_name, permission)
  select 'finance_manager', p from unnest(array[
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export'
  ]) as p
on conflict do nothing;

-- admin → approve + lock + export
insert into public.role_permissions (role_name, permission)
  select 'admin', p from unnest(array[
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export'
  ]) as p
on conflict do nothing;

-- superadmin inherits everything via loadRolePermissions → PERMISSION_KEYS;
-- add for DB completeness
insert into public.role_permissions (role_name, permission)
  select 'superadmin', p from unnest(array[
    'finance.payroll.approve',
    'finance.payroll.lock',
    'finance.payroll.export'
  ]) as p
on conflict do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════════════
-- ║ 20260804000004_workflow_finance_payroll_binding.sql
-- ╚══════════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Finance Payroll — workflow binding
-- ============================================================================
-- Seeds: workflow_templates row + published v1 + module_workflow_bindings row
-- Module key:     finance_payroll
-- Workflow type:  finance_payroll_approval
-- Trigger event:  finance.payroll.run.submitted
--
-- Approval step is assigned to finance_manager role.
-- Segregation of duties (creator ≠ approver) is enforced in the adapter
-- (financePayrollAdapter.ts → assertDifferentApprover), NOT in the template.
--
-- sourceStatusMap:
--   onStarted   → pending_approval  (already set at submit time)
--   onCompleted → approved
--   onReturned  → returned
--   onRejected  → returned
--   onCancelled → cancelled
-- ============================================================================

do $$
declare
  tpl_id  uuid;
  ver_id  uuid;
  dr jsonb := '{"canApprove":true,"canReturn":true,"canReject":true,"canDelegate":false,"requireCommentOnApprove":false,"requireCommentOnReturn":true,"requireCommentOnReject":true,"requireAttachment":false}'::jsonb;
  base_settings jsonb := '{"allowReturn":true,"allowReject":true,"allowDelegate":false,"allowAdminOverride":true,"requireAuditAllTransitions":true}'::jsonb;
begin
  -- 1. workflow_templates row
  select id into tpl_id from public.workflow_templates
    where template_key = 'finance_payroll_approval';
  if tpl_id is null then
    insert into public.workflow_templates
      (template_key, module_key, workflow_type, name, description, status, is_active, current_version, definition)
    values
      ('finance_payroll_approval', 'finance_payroll', 'finance_payroll_approval',
       'Finance Payroll Run Approval',
       'Finance Manager approval of a calculated payroll run before it can be locked and payslips generated.',
       'active', true, 1, '{}'::jsonb)
    returning id into tpl_id;
  else
    update public.workflow_templates
      set module_key = 'finance_payroll', workflow_type = 'finance_payroll_approval',
          status = 'active', current_version = 1
      where id = tpl_id;
  end if;

  -- 2. published v1 — single Finance Manager approval step
  insert into public.workflow_template_versions
    (template_id, version_no, version_status, definition, published_at)
  values (
    tpl_id, 1, 'published',
    jsonb_build_object(
      'schemaVersion', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'stepKey',           'finance_manager_payroll_approval',
          'stepName',          'Finance Manager Payroll Approval',
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
        'onCompleted', 'approved',
        'onReturned',  'returned',
        'onRejected',  'returned',
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

  -- 3. global binding (idempotent: delete then insert)
  delete from public.module_workflow_bindings
    where module_key    = 'finance_payroll'
      and workflow_type  = 'finance_payroll_approval'
      and trigger_event  = 'finance.payroll.run.submitted'
      and scope_type     = 'global'
      and scope_id is null;

  insert into public.module_workflow_bindings
    (module_key, workflow_type, trigger_event, template_id, template_version_id, scope_type, is_active, priority)
  values
    ('finance_payroll', 'finance_payroll_approval', 'finance.payroll.run.submitted',
     tpl_id, ver_id, 'global', true, 100);
end $$;

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ── Reload PostgREST schema cache (clears intermittent 'schema cache' errors) ──
NOTIFY pgrst, 'reload schema';
