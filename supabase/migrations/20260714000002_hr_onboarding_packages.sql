-- ============================================================================
-- HR Onboarding — packages → DB (Phase 4)
-- ============================================================================
-- Moves onboarding packages from the code constant (lib/hr/onboardingPackages.ts,
-- DELETED in this phase) into DB template tables, so packages become admin-editable
-- and so Custom Onboarding Actions (Phase 5) can FK a real package. Seeded from the
-- former code constant in 20260714000003_hr_onboarding_packages_seed.sql.
-- app_users.id is TEXT → created_by/updated_by are TEXT. Operator-applied; after
-- applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── packages ────────────────────────────────────────────────────────────────────
create table if not exists public.hr_onboarding_packages (
  id                     uuid primary key default gen_random_uuid(),
  package_key            text unique not null,
  package_name           text not null,
  description            text,
  worker_types           jsonb not null default '[]'::jsonb,
  default_sla_days       int  not null default 10,
  default_owner_role     text,
  applies_to_departments jsonb not null default '[]'::jsonb,
  applies_to_sites       jsonb not null default '[]'::jsonb,
  status                 text not null default 'draft'
                           check (status in ('draft','active','retired')),
  version_no             int  not null default 1,
  metadata               jsonb not null default '{}'::jsonb,
  created_by             text references public.app_users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_by             text references public.app_users(id) on delete set null,
  updated_at             timestamptz
);

-- ── task templates ────────────────────────────────────────────────────────────--
create table if not exists public.hr_onboarding_task_templates (
  id                uuid primary key default gen_random_uuid(),
  package_id        uuid not null references public.hr_onboarding_packages(id) on delete cascade,
  task_key          text not null,
  task_title        text not null,
  owner_role        text not null,
  module_key        text,
  due_rule          jsonb not null default '{}'::jsonb,
  is_required       boolean not null default true,
  is_blocking       boolean not null default false,
  requires_evidence boolean not null default false,
  dependency_keys   jsonb not null default '[]'::jsonb,
  sort_order        int not null default 0,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (package_id, task_key)
);
create index if not exists hr_onboarding_task_templates_pkg_idx on public.hr_onboarding_task_templates(package_id);

-- ── handoff templates ─────────────────────────────────────────────────────────--
create table if not exists public.hr_onboarding_handoff_templates (
  id               uuid primary key default gen_random_uuid(),
  package_id       uuid not null references public.hr_onboarding_packages(id) on delete cascade,
  handoff_key      text not null,
  target_module    text not null,
  handoff_type     text not null,
  trigger_rule     jsonb not null default '{}'::jsonb,
  payload_template jsonb not null default '{}'::jsonb,
  is_required      boolean not null default true,
  sort_order       int not null default 0,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  unique (package_id, handoff_key)
);
create index if not exists hr_onboarding_handoff_templates_pkg_idx on public.hr_onboarding_handoff_templates(package_id);

-- ── RLS + grants (backend-only via service_role) ────────────────────────────────
alter table public.hr_onboarding_packages         enable row level security;
alter table public.hr_onboarding_task_templates    enable row level security;
alter table public.hr_onboarding_handoff_templates enable row level security;
grant select, insert, update, delete on table public.hr_onboarding_packages         to service_role;
grant select, insert, update, delete on table public.hr_onboarding_task_templates    to service_role;
grant select, insert, update, delete on table public.hr_onboarding_handoff_templates to service_role;

-- ── updated_at trigger (packages are mutable via the package editor) ─────────────
drop trigger if exists trg_hr_onboarding_packages_updated_at on public.hr_onboarding_packages;
create trigger trg_hr_onboarding_packages_updated_at before update on public.hr_onboarding_packages
  for each row execute function public.set_updated_at();

-- After applying:  NOTIFY pgrst, 'reload schema';
