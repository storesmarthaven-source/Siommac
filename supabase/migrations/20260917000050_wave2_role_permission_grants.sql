-- ============================================================================
-- 20260917000050_wave2_role_permission_grants.sql
--
-- DB grant sync for Wave 2A Finance (AP + Overview) granular keys and the
-- HR Contract Management keys.
--
-- Root cause: role_permissions is the RUNTIME authority (loadRolePermissions
-- falls back to the static ROLE_PERMISSIONS map only when a role has NO rows).
-- Wave 2A Chunk 0 catalogued the new finance.overview.* / finance.ap.* keys
-- and granted them in the static map, but never synced the DB — so every new
-- endpoint returned 403 for finance roles. Same for hr.contracts.* (shipped
-- by the Contract Management backend without any grant rows).
--
-- Grants mirror the static ROLE_PERMISSIONS map exactly (the catalogued
-- intent). superadmin needs no rows (allow-all in code).
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- (role grants are also cached in-process for 30s — no server restart needed)
-- ============================================================================

-- ── finance_staff — overview view/export + AP day-to-day ────────────────────
insert into public.role_permissions (role_name, permission) values
  ('finance_staff', 'finance.overview.view'),
  ('finance_staff', 'finance.overview.export'),
  ('finance_staff', 'finance.ap.view'),
  ('finance_staff', 'finance.ap.manage'),
  ('finance_staff', 'finance.ap.vendors.create'),
  ('finance_staff', 'finance.ap.bills.create'),
  ('finance_staff', 'finance.ap.bills.edit'),
  ('finance_staff', 'finance.ap.bills.submit'),
  ('finance_staff', 'finance.ap.payment.record')
on conflict do nothing;

-- ── finance_manager — full overview + full AP (incl. SoD-gated actions) ─────
insert into public.role_permissions (role_name, permission) values
  ('finance_manager', 'finance.overview.view'),
  ('finance_manager', 'finance.overview.export'),
  ('finance_manager', 'finance.overview.kpi.drill'),
  ('finance_manager', 'finance.overview.approvals.inline'),
  ('finance_manager', 'finance.ap.view'),
  ('finance_manager', 'finance.ap.manage'),
  ('finance_manager', 'finance.ap.approve'),
  ('finance_manager', 'finance.ap.vendors.create'),
  ('finance_manager', 'finance.ap.vendors.update'),
  ('finance_manager', 'finance.ap.bills.create'),
  ('finance_manager', 'finance.ap.bills.edit'),
  ('finance_manager', 'finance.ap.bills.submit'),
  ('finance_manager', 'finance.ap.bills.approve'),
  ('finance_manager', 'finance.ap.bills.void'),
  ('finance_manager', 'finance.ap.payment.record'),
  ('finance_manager', 'finance.ap.payment.run.manage'),
  ('finance_manager', 'finance.ap.payment.run.process'),
  ('finance_manager', 'finance.ap.duplicate.resolve'),
  ('finance_manager', 'finance.ap.reports.export'),
  ('finance_manager', 'finance.ap.bills.import')
on conflict do nothing;

-- ── admin — all Wave 2A finance keys + all HR Contract Management keys ──────
insert into public.role_permissions (role_name, permission) values
  ('admin', 'finance.overview.view'),
  ('admin', 'finance.overview.export'),
  ('admin', 'finance.overview.kpi.drill'),
  ('admin', 'finance.overview.approvals.inline'),
  ('admin', 'finance.ap.view'),
  ('admin', 'finance.ap.manage'),
  ('admin', 'finance.ap.approve'),
  ('admin', 'finance.ap.vendors.create'),
  ('admin', 'finance.ap.vendors.update'),
  ('admin', 'finance.ap.bills.create'),
  ('admin', 'finance.ap.bills.edit'),
  ('admin', 'finance.ap.bills.submit'),
  ('admin', 'finance.ap.bills.approve'),
  ('admin', 'finance.ap.bills.void'),
  ('admin', 'finance.ap.payment.record'),
  ('admin', 'finance.ap.payment.run.manage'),
  ('admin', 'finance.ap.payment.run.process'),
  ('admin', 'finance.ap.duplicate.resolve'),
  ('admin', 'finance.ap.reports.export'),
  ('admin', 'finance.ap.bills.import'),
  ('admin', 'hr.contracts.view'),
  ('admin', 'hr.contracts.manage'),
  ('admin', 'hr.contracts.terminate'),
  ('admin', 'hr.contracts.template.manage')
on conflict do nothing;

-- ── HR roles — Contract Management (mirrors hr.compensation.* precedent) ────
insert into public.role_permissions (role_name, permission) values
  ('hr_staff', 'hr.contracts.view'),
  ('hr_staff', 'hr.contracts.manage')
on conflict do nothing;

insert into public.role_permissions (role_name, permission) values
  ('hr_manager', 'hr.contracts.view'),
  ('hr_manager', 'hr.contracts.manage'),
  ('hr_manager', 'hr.contracts.terminate'),
  ('hr_manager', 'hr.contracts.template.manage')
on conflict do nothing;

-- After applying, run: NOTIFY pgrst, 'reload schema';
