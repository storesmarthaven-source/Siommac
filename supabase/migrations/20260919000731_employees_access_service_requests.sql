-- ============================================================================
-- Migration: 20260919000731_employees_access_service_requests
--
-- Evolves support_tickets into a capability-routed service-request queue and
-- wires in the employees.access.* permission keys.
--
-- ⚠ OPERATOR ACTION REQUIRED: Apply this migration to the production database
-- before deploying the backend code that references the new columns/tables.
--
-- Changes:
--   1. Add contract columns to support_tickets (additive; no existing rows touched)
--   2. Add is_internal column to ticket_replies
--   3. Create org_account_support_config table
--   4. Insert account_support queue into ticket_queues (if table exists)
--   5. Insert account support request types into ticket_request_types (if table exists)
--   6. Grant employees.access.* keys in role_permissions
-- ============================================================================

-- ── 1. Extend support_tickets ─────────────────────────────────────────────────

alter table public.support_tickets
  -- priority was referenced in code but never added to the original table DDL
  add column if not exists priority                  text not null default 'medium'
                                                     check (priority in ('low','medium','high','critical')),
  add column if not exists subject_type              text,
  add column if not exists subject_id                text references public.app_users(id) on delete set null,
  add column if not exists service_domain            text not null default 'general',
  add column if not exists requested_action          text,
  add column if not exists requested_completion_date date,
  add column if not exists requester_org             text,
  add column if not exists capability_target         text,
  add column if not exists assigned_user_id          text references public.app_users(id) on delete set null,
  add column if not exists resolution_notes          text;

-- Index for capability routing lookups
create index if not exists idx_support_tickets_category_status
  on public.support_tickets (category, status)
  where status not in ('closed', 'resolved', 'deleted');

create index if not exists idx_support_tickets_subject_id
  on public.support_tickets (subject_id)
  where subject_id is not null;

create index if not exists idx_support_tickets_assigned_user
  on public.support_tickets (assigned_user_id)
  where assigned_user_id is not null;

-- ── 2. Extend ticket_replies ──────────────────────────────────────────────────

alter table public.ticket_replies
  add column if not exists is_internal boolean not null default false;

-- ── 3. Org account-support ownership config ───────────────────────────────────
-- Single-row table (enforced by app layer) that records how the organisation
-- routes account support requests (HR-managed, shared, dedicated team, external admin).

create table if not exists public.org_account_support_config (
  id               uuid primary key default gen_random_uuid(),
  ownership_model  text not null default 'hr_managed'
                   check (ownership_model in ('hr_managed', 'shared', 'dedicated_team', 'external_admin')),
  capability_target text,        -- e.g. queue code or team slug
  assigned_user_id  text references public.app_users(id) on delete set null,
  notes             text,
  updated_by        text references public.app_users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- RLS: read = any authenticated employee; write = admin/hr_manager (enforced at API layer)
alter table public.org_account_support_config enable row level security;

drop policy if exists "org_account_support_config_select" on public.org_account_support_config;
create policy "org_account_support_config_select"
  on public.org_account_support_config for select
  using (true);   -- read-gate enforced at API layer (requirePermission)

drop policy if exists "org_account_support_config_all" on public.org_account_support_config;
create policy "org_account_support_config_all"
  on public.org_account_support_config for all
  using (true)
  with check (true);  -- write-gate enforced at API layer (requirePermission + requireUser)

-- updated_at trigger
create or replace function public.touch_org_account_support_config()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_org_account_support_config_updated_at on public.org_account_support_config;
create trigger trg_org_account_support_config_updated_at
  before update on public.org_account_support_config
  for each row execute function public.touch_org_account_support_config();

-- ── 4. Add account_support queue to ticket_queues (if the table exists) ───────

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ticket_queues'
  ) then
    -- Columns per 20260919000440_ticket_center_backend.sql:
    --   ticket_queues(code pk, label not null, module not null, handler_permission not null, ...)
    -- `module` is 'platform': account support is capability-routed, not owned by a
    -- named IT or HR department.
    insert into public.ticket_queues (code, label, module, handler_permission)
    values ('account_support', 'Account Support', 'platform', 'employees.access.view')
    on conflict (code) do nothing;
  end if;
end $$;

-- ── 5. Add account support request types (if the table exists) ───────────────

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ticket_request_types'
  ) then
    -- Columns per 20260919000440_ticket_center_backend.sql: the label column is `label`
    -- (not `name`), and category / response_target_minutes / resolution_target_minutes
    -- are NOT NULL. `code` is the primary key, so that is the only valid conflict target.
    -- Account-access requests carry personal security context, so is_confidential = true.
    insert into public.ticket_request_types (
      code, queue_code, label, description, category, default_priority,
      response_target_minutes, resolution_target_minutes, system_tags, is_confidential
    )
    values
      ('password_reset',    'account_support', 'Password reset',
       'Request a password reset for an employee account.', 'account_support', 'medium',
       120, 480, array['Account','Password'], true),
      ('mfa_setup',         'account_support', 'MFA setup assistance',
       'Help setting up multi-factor authentication.', 'account_support', 'medium',
       240, 1440, array['Account','MFA'], true),
      ('account_unlock',    'account_support', 'Account unlock or restore',
       'Restore a locked or suspended account.', 'account_support', 'high',
       60, 240, array['Account','Restore'], true),
      ('activation_resend', 'account_support', 'Resend activation email',
       'Resend the account activation email.', 'account_support', 'low',
       480, 2880, array['Account','Activation'], false),
      ('permission_change', 'account_support', 'Permission change request',
       'Request a change to an employee''s permission grants.', 'account_support', 'medium',
       480, 2880, array['Account','Permissions'], true),
      ('session_revoke',    'account_support', 'Session revocation',
       'Revoke active sessions for a user.', 'account_support', 'high',
       60, 240, array['Account','Sessions'], true),
      ('device_revoke',     'account_support', 'Device revocation',
       'Revoke trusted devices for a user.', 'account_support', 'medium',
       120, 480, array['Account','Devices'], true),
      ('require_mfa',       'account_support', 'Require MFA enrolment',
       'Require a user to enrol in multi-factor authentication.', 'account_support', 'medium',
       240, 1440, array['Account','MFA'], true)
    on conflict (code) do nothing;
  end if;
end $$;

-- ── 6. Grant permission keys in role_permissions ─────────────────────────────
--
-- Resolution order: per-user DB override → role_permissions → deny.
-- The static ROLE_PERMISSIONS constant in permissions.ts is the seed reference;
-- this insert makes the keys LIVE for non-superadmin roles.
-- Superadmin gets all non-COMPLIANCE_GATED_KEYS in memory — no row needed.
--
-- employees.access.* grant matrix (per permission decision 2026-07-26):
--   employees.access.view               admin, hr_manager, hr_staff, manager
--   employees.access.request            admin, hr_manager, hr_staff, manager, employee, finance_*, hse_*
--   employees.access.reset_password     admin ONLY (hr_manager removed — HR may REQUEST, not execute)
--   employees.access.resend_activation  admin, hr_manager, hr_staff
--   employees.access.suspend            admin ONLY (step-up required)
--   employees.access.restore            admin ONLY (step-up required)
--   employees.access.revoke_sessions    admin ONLY (hr_manager removed)
--   employees.access.revoke_devices     admin ONLY (hr_manager removed)
--   employees.access.require_mfa        admin ONLY (hr_manager removed)
--   employees.access.permissions.view   admin, hr_manager, hr_staff
--   employees.access.permissions.manage admin ONLY (step-up required)
--
-- tickets.* new queue-management keys:
--   tickets.view_all      admin, hr_manager, hr_staff, manager
--   tickets.reply_internal admin, hr_manager, hr_staff, manager

insert into public.role_permissions (role_name, permission) values
  -- employees.access.view
  ('admin',       'employees.access.view'),
  ('hr_manager',  'employees.access.view'),
  ('hr_staff',    'employees.access.view'),
  ('manager',     'employees.access.view'),

  -- employees.access.request (self-service; granted to all authenticated roles)
  ('admin',       'employees.access.request'),
  ('hr_manager',  'employees.access.request'),
  ('hr_staff',    'employees.access.request'),
  ('manager',     'employees.access.request'),
  ('employee',    'employees.access.request'),
  ('finance_staff',    'employees.access.request'),
  ('finance_manager',  'employees.access.request'),
  ('hse_staff',        'employees.access.request'),

  -- employees.access.reset_password (admin ONLY; step-up required)
  ('admin',       'employees.access.reset_password'),

  -- employees.access.resend_activation
  ('admin',       'employees.access.resend_activation'),
  ('hr_manager',  'employees.access.resend_activation'),
  ('hr_staff',    'employees.access.resend_activation'),

  -- employees.access.suspend (admin ONLY; step-up required)
  ('admin',       'employees.access.suspend'),

  -- employees.access.restore (admin ONLY; step-up required)
  ('admin',       'employees.access.restore'),

  -- employees.access.revoke_sessions (admin ONLY; step-up required)
  ('admin',       'employees.access.revoke_sessions'),

  -- employees.access.revoke_devices (admin ONLY; step-up required)
  ('admin',       'employees.access.revoke_devices'),

  -- employees.access.require_mfa (admin ONLY; step-up required)
  ('admin',       'employees.access.require_mfa'),

  -- employees.access.permissions.view
  ('admin',       'employees.access.permissions.view'),
  ('hr_manager',  'employees.access.permissions.view'),
  ('hr_staff',    'employees.access.permissions.view'),

  -- employees.access.permissions.manage (admin ONLY; step-up required)
  ('admin',       'employees.access.permissions.manage'),

  -- tickets.view_all (queue-wide visibility)
  ('admin',       'tickets.view_all'),
  ('hr_manager',  'tickets.view_all'),
  ('hr_staff',    'tickets.view_all'),
  ('manager',     'tickets.view_all'),

  -- tickets.reply_internal (staff-only internal notes)
  ('admin',       'tickets.reply_internal'),
  ('hr_manager',  'tickets.reply_internal'),
  ('hr_staff',    'tickets.reply_internal'),
  ('manager',     'tickets.reply_internal')

on conflict (role_name, permission) do nothing;

-- Remove the 4 elevated account-control keys from hr_manager that were incorrectly
-- granted in an earlier migration (now admin-only per permission decision 2026-07-26).
delete from public.role_permissions
  where role_name = 'hr_manager'
    and permission in (
      'employees.access.reset_password',
      'employees.access.revoke_sessions',
      'employees.access.revoke_devices',
      'employees.access.require_mfa'
    );
