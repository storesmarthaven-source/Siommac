-- ============================================================================
-- 20260917000070_finance_2b_phase0_grants.sql
--
-- role_permissions grants for the 3 NEW permission keys introduced by the
-- Wave 2B Phase-0 attachments + bridges routes. Mirrors the static
-- ROLE_PERMISSIONS map exactly (BE + FE catalogues + permissionMeta already
-- carry these keys).
--
-- Root cause reminder: role_permissions is the RUNTIME authority
-- (loadRolePermissions falls back to the static map ONLY for a role with zero
-- rows). Every affected role already has rows, so a route-enforced key that is
-- not granted here 403s. superadmin needs no rows (allow-all in code).
--
-- Grant model (mirrors the sibling finance.expenses.*/finance.remittances.*
-- holders):
--   finance.expenses.receipt.upload             → finance_staff, finance_manager
--   finance.remittances.receipt.upload          → finance_staff, finance_manager, admin
--   finance.expenses.handoff.create_reimbursement → finance_manager
-- (admin holds no finance.expenses.* keys, so the expense keys are not granted
--  to admin — consistent with the existing catalogue.)
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- (role grants are also cached in-process for 30s — no server restart needed)
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('finance_staff',   'finance.expenses.receipt.upload'),
  ('finance_staff',   'finance.remittances.receipt.upload'),
  ('finance_manager', 'finance.expenses.receipt.upload'),
  ('finance_manager', 'finance.remittances.receipt.upload'),
  ('finance_manager', 'finance.expenses.handoff.create_reimbursement'),
  ('admin',           'finance.remittances.receipt.upload')
on conflict do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
