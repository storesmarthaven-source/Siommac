-- =============================================================================
-- Fix the stale key-format CHECK on the RBAC override tables.
--
-- The original constraint regex '^[a-z_]+\.[a-z_]+$' allowed only TWO dot-separated
-- segments, so every modern 3+ segment catalogue key — finance.statutory.approve,
-- finance.payroll.nis.verify, hr.attendance.timesheets.view, communications.messages.* —
-- failed with a check violation (SQLSTATE 23514). That surfaced in the Console as
-- "Failed to set permission" when granting/denying a per-user override (and would block
-- role_permissions grants the same way).
--
-- Widen both constraints to 2+ dot-separated [a-z_] segments. Idempotent.
-- Run in the Supabase SQL editor.
-- =============================================================================
begin;

alter table public.user_permissions drop constraint if exists user_permissions_key_format;
alter table public.user_permissions
  add constraint user_permissions_key_format check (permission ~ '^[a-z_]+(\.[a-z_]+)+$');

alter table public.role_permissions drop constraint if exists role_permissions_key_format;
alter table public.role_permissions
  add constraint role_permissions_key_format check (permission ~ '^[a-z_]+(\.[a-z_]+)+$');

commit;
