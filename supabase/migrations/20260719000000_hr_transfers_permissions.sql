-- ============================================================================
-- HR Transfers & Promotions — role_permissions grants
-- ============================================================================
-- Adds hr.transfers.{view,request,approve,cancel} for the roles that need them.
-- Column is role_name (NOT role — see appendix §11 item 4).
-- Idempotent via on conflict do nothing.
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('superadmin',  'hr.transfers.view'),
  ('superadmin',  'hr.transfers.request'),
  ('superadmin',  'hr.transfers.approve'),
  ('superadmin',  'hr.transfers.cancel'),
  ('admin',       'hr.transfers.view'),
  ('admin',       'hr.transfers.request'),
  ('admin',       'hr.transfers.approve'),
  ('admin',       'hr.transfers.cancel'),
  ('hr_manager',  'hr.transfers.view'),
  ('hr_manager',  'hr.transfers.request'),
  ('hr_manager',  'hr.transfers.approve'),
  ('hr_manager',  'hr.transfers.cancel'),
  -- line managers may view and request for their direct reports; they cannot approve
  ('manager',     'hr.transfers.view'),
  ('manager',     'hr.transfers.request'),
  -- execution tier: request + view only
  ('hr_staff',    'hr.transfers.view'),
  ('hr_staff',    'hr.transfers.request')
on conflict do nothing;

-- After applying, run:  NOTIFY pgrst, 'reload schema';
