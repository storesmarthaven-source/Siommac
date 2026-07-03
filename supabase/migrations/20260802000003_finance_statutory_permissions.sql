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
