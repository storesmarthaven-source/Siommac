-- ============================================================================
-- Finance Disbursements & Bank Accounts — permissions (keys + DB grants)
-- ============================================================================
-- New keys:
--   finance.bank_accounts.view       — view bank account listings (masked)
--   finance.bank_accounts.manage     — create / update / deactivate own bank accounts
--   finance.disbursement.view        — view disbursements and per-employee lines
--   finance.disbursement.manage      — create, submit and cancel disbursements
--   finance.disbursement.approve     — approve submitted disbursements (SoD: creator cannot approve)
--
-- Grants:
--   employee:        bank_accounts.view + manage (own only — scoped in route layer)
--   finance_staff:   bank_accounts.view + disbursement.view + disbursement.manage
--   finance_manager: all five keys
--   admin:           all five keys
--   superadmin:      all five keys
--
-- Column is `permission` (NOT permission_key). On conflict do nothing.
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission)
values
  -- employee: self-manage own bank accounts only (route enforces self-scope)
  ('employee',        'finance.bank_accounts.view'),
  ('employee',        'finance.bank_accounts.manage'),

  -- finance_staff: view bank accounts, view and manage disbursements
  ('finance_staff',   'finance.bank_accounts.view'),
  ('finance_staff',   'finance.disbursement.view'),
  ('finance_staff',   'finance.disbursement.manage'),

  -- finance_manager: full lifecycle + approve
  ('finance_manager', 'finance.bank_accounts.view'),
  ('finance_manager', 'finance.bank_accounts.manage'),
  ('finance_manager', 'finance.disbursement.view'),
  ('finance_manager', 'finance.disbursement.manage'),
  ('finance_manager', 'finance.disbursement.approve'),

  -- admin: all five keys
  ('admin',           'finance.bank_accounts.view'),
  ('admin',           'finance.bank_accounts.manage'),
  ('admin',           'finance.disbursement.view'),
  ('admin',           'finance.disbursement.manage'),
  ('admin',           'finance.disbursement.approve'),

  -- superadmin: all five keys
  ('superadmin',      'finance.bank_accounts.view'),
  ('superadmin',      'finance.bank_accounts.manage'),
  ('superadmin',      'finance.disbursement.view'),
  ('superadmin',      'finance.disbursement.manage'),
  ('superadmin',      'finance.disbursement.approve')

on conflict (role_name, permission) do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
