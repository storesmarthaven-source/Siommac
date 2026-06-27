-- ============================================================================
-- HR Onboarding — Account / Work-Email provisioning (Phase 6)
-- ============================================================================
-- HR-created employees (routes/hr.ts) get an app_users row but NO Supabase Auth
-- login. Provisioning creates the login + a work email and sends an invite link
-- (set-own-password). app_users gains provisioning state; a token table backs the
-- invite (sha256 token hash, expiry, single-use). app_users.id is TEXT → user FKs
-- are TEXT. Operator-applied; after applying: NOTIFY pgrst.
-- ============================================================================

alter table public.app_users
  add column if not exists work_email      text,
  add column if not exists account_status  text,   -- null=unset · 'invited' · 'active' · 'disabled'
  add column if not exists provisioned_at  timestamptz,
  add column if not exists provisioned_by  text references public.app_users(id) on delete set null;

comment on column public.app_users.work_email     is 'Generated company work email (Onboarding provisioning).';
comment on column public.app_users.account_status is 'Login account state: invited / active / disabled.';

-- ── invite tokens (set-own-password) ────────────────────────────────────────────
create table if not exists public.hr_onboarding_account_invites (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null references public.app_users(id) on delete cascade,
  case_id     uuid references public.hr_onboarding_cases(id) on delete set null,
  token_hash  text not null unique,                 -- sha256(raw token); raw is emailed, never stored
  work_email  text,
  delivery    text,                                 -- 'email' | 'surfaced'
  status      text not null default 'pending'
                check (status in ('pending','accepted','expired','revoked')),
  expires_at  timestamptz not null,
  created_by  text references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);
create index if not exists hr_onboarding_account_invites_user_idx on public.hr_onboarding_account_invites(user_id, status);

alter table public.hr_onboarding_account_invites enable row level security;
grant select, insert, update, delete on table public.hr_onboarding_account_invites to service_role;

-- ── permission grant (catalogued in lib/permissions.ts + src/lib/permissions.ts) ──
insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.onboarding.provision_account'),
  ('admin','hr.onboarding.provision_account'),
  ('hr_manager','hr.onboarding.provision_account')
on conflict do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';
