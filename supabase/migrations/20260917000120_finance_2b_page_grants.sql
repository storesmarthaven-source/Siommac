-- ============================================================================
-- 20260917000120_finance_2b_page_grants.sql
--
-- role_permissions grants for the 8 NEW permission keys introduced by the
-- Wave 2B per-page fleet (Statutory / Remittances / Disbursements / Budgets).
-- BE + FE catalogues + permissionMeta already carry these keys.
--
-- role_permissions is the RUNTIME authority for BOTH backend enforcement AND
-- frontend can() (the FE loads the user's resolved permissions from the server,
-- which reads this table — the static ROLE_PERMISSIONS maps are fallback/docs).
-- A route-enforced key ungranted here 403s.
--
-- All 8 are manage/approve-level actions. finance_staff is view-only for
-- budgets/statutory/disbursements and lacks the approve-level siblings, so the
-- keys go to finance_manager + admin only (consistent with the existing
-- finance.budgets.manage / finance.disbursement.approve / finance.remittances.approve
-- / finance.statutory.manage holders). superadmin needs no rows (allow-all in code).
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('finance_manager', 'finance.statutory.nis_class.delete'),
  ('finance_manager', 'finance.statutory.nis_class.import'),
  ('finance_manager', 'finance.remittances.mark_filed'),
  ('finance_manager', 'finance.budgets.bulk_upsert'),
  ('finance_manager', 'finance.budgets.copy_last_year'),
  ('finance_manager', 'finance.budgets.attachments.upload'),
  ('finance_manager', 'finance.budgets.attachments.delete'),
  ('finance_manager', 'finance.disbursement.bank_file.download'),
  ('admin',           'finance.statutory.nis_class.delete'),
  ('admin',           'finance.statutory.nis_class.import'),
  ('admin',           'finance.remittances.mark_filed'),
  ('admin',           'finance.budgets.bulk_upsert'),
  ('admin',           'finance.budgets.copy_last_year'),
  ('admin',           'finance.budgets.attachments.upload'),
  ('admin',           'finance.budgets.attachments.delete'),
  ('admin',           'finance.disbursement.bank_file.download')
on conflict do nothing;

-- Clean up orphaned camelCase budget grants from 20260807000001 (a latent F5
-- deviation; the keys were never catalogued/enforced until Wave 2B, which
-- standardised them to snake_case above). These rows grant keys that no longer
-- exist in the catalogue — harmless but tidy to remove.
delete from public.role_permissions
where permission in ('finance.budgets.bulkUpsert', 'finance.budgets.copyLastYear');

-- After applying, run: NOTIFY pgrst, 'reload schema';
