-- ============================================================================
-- Profile photo approval gate
-- ============================================================================
-- Employees submit a photo change; it stays PENDING (old photo still live)
-- until an authorized reviewer approves or rejects it from the Employee
-- Master profile drawer. Makes the "Submit for Review" claim in the Change
-- Profile Photo dialog literally true (previously the commit route applied
-- the photo immediately with no review step).
--
-- `hr.employees.photo_approve` is a normal cataloged permission key —
-- configurable per role via Settings → Permissions, not hardcoded to a
-- fixed role list. Column is role_name (NOT role — see appendix §11 item 4).
-- Idempotent via `add column if not exists` / `on conflict do nothing`.
-- ============================================================================

alter table public.app_users
  add column if not exists profile_image_pending_url         text,
  add column if not exists profile_image_pending_path         text,
  add column if not exists profile_image_pending_thumb_url    text,
  add column if not exists profile_image_pending_thumb_path   text,
  add column if not exists profile_image_pending_version      integer,
  add column if not exists profile_image_pending_submitted_at timestamptz;

insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hr.employees.photo_approve'),
  ('admin',      'hr.employees.photo_approve'),
  ('hr_manager', 'hr.employees.photo_approve')
on conflict do nothing;

-- After applying, run:  NOTIFY pgrst, 'reload schema';
