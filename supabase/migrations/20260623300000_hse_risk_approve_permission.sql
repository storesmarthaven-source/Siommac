-- Seed the missing `hse.risk.approve` permission.
--
-- The Risk/JSA `/api/hse/risk-jsa/review` route guards approve/return/archive
-- with requirePermission('hse.risk.approve'), but that permission was never
-- seeded — so the approval path silently 403'd for every role. Grant it to the
-- approver roles (superadmin / admin / manager), mirroring workflow.approve.
--
-- Idempotent: ON CONFLICT DO NOTHING. Safe to re-run; existing overrides kept.

insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.risk.approve'),
  ('admin',      'hse.risk.approve'),
  ('manager',    'hse.risk.approve')
on conflict do nothing;
