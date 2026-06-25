-- ============================================================================
-- SIOMAC Settings & Preferences — core architecture (Spec §5–§7)
-- ============================================================================
-- Catalog-driven, scoped settings with governance + manifest review:
--   app_setting_catalog            — defines every setting (class/scope/perm/flags)
--   app_setting_values             — scoped overrides (global→module→site→dept→role→user)
--   app_setting_audit_log          — append-only change log
--   module_setting_profiles        — reusable setting packs (e.g. "Strict HSE Site")
--   module_setting_profile_values  — values inside a profile
--   module_settings_manifests      — per-module settings review record (build gate)
--   module_settings_manifest_sections
--   module_settings_review_approvals
-- Conventions: snake_case, platform-level (no module prefix), uuid PK,
-- app_users.id is TEXT, RLS enabled (service-role bypass), set_updated_at trigger.
-- Run manually, then: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- set_updated_at() already exists (declared by the workflow backbone migration);
-- re-declared idempotently here so this file stands alone if run first.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── app_setting_catalog ──────────────────────────────────────────────────────
create table if not exists public.app_setting_catalog (
  id           uuid primary key default gen_random_uuid(),

  setting_key  text unique not null,
  module_key   text not null,

  label        text not null,
  description  text,

  data_type    text not null check (data_type in (
                 'boolean','number','string','select','multi_select','json','duration','time','array')),

  default_value  jsonb not null,
  allowed_values jsonb,

  min_value    numeric,
  max_value    numeric,

  setting_class text not null default 'module_policy' check (setting_class in (
                 'system_security','system_policy','module_policy','safety_rule','workflow_rule',
                 'notification_rule','message_policy','file_policy','audit_policy',
                 'personal_preference','ui_preference')),

  scope        jsonb not null default '["global"]'::jsonb,

  user_override_allowed       boolean not null default false,
  role_override_allowed       boolean not null default false,
  site_override_allowed       boolean not null default false,
  department_override_allowed boolean not null default false,
  module_override_allowed     boolean not null default false,

  can_reduce_strictness          boolean not null default false,
  can_suppress_required_delivery boolean not null default false,

  is_critical  boolean not null default false,
  is_sensitive boolean not null default false,
  is_audited   boolean not null default true,
  is_active    boolean not null default true,

  requires_permission       text not null,
  minimum_manage_permission text,

  source_manifest_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists app_setting_catalog_module_idx on public.app_setting_catalog(module_key);
create index if not exists app_setting_catalog_active_idx on public.app_setting_catalog(is_active);
create index if not exists app_setting_catalog_class_idx  on public.app_setting_catalog(setting_class);

create trigger trg_app_setting_catalog_updated_at
  before update on public.app_setting_catalog
  for each row execute function public.set_updated_at();

alter table public.app_setting_catalog enable row level security;

-- ── app_setting_values ───────────────────────────────────────────────────────
create table if not exists public.app_setting_values (
  id          uuid primary key default gen_random_uuid(),

  setting_key text not null references public.app_setting_catalog(setting_key),

  scope_type  text not null check (scope_type in ('global','module','site','department','role','user')),
  scope_id    text,

  value       jsonb not null,

  updated_by  text references public.app_users(id),
  updated_at  timestamptz not null default now(),

  metadata    jsonb not null default '{}'::jsonb,

  unique (setting_key, scope_type, scope_id)
);

create index if not exists app_setting_values_key_scope_idx
  on public.app_setting_values(setting_key, scope_type, scope_id);

create trigger trg_app_setting_values_updated_at
  before update on public.app_setting_values
  for each row execute function public.set_updated_at();

alter table public.app_setting_values enable row level security;

-- ── app_setting_audit_log (append-only) ──────────────────────────────────────
create table if not exists public.app_setting_audit_log (
  id          uuid primary key default gen_random_uuid(),

  setting_key text not null,
  module_key  text not null,

  scope_type  text not null,
  scope_id    text,

  previous_value jsonb,
  new_value      jsonb,

  changed_by  text references public.app_users(id),
  changed_at  timestamptz not null default now(),

  reason      text,
  metadata    jsonb not null default '{}'::jsonb
);

create index if not exists app_setting_audit_key_idx        on public.app_setting_audit_log(setting_key);
create index if not exists app_setting_audit_module_idx     on public.app_setting_audit_log(module_key);
create index if not exists app_setting_audit_changed_at_idx on public.app_setting_audit_log(changed_at desc);

alter table public.app_setting_audit_log enable row level security;

-- ── module_setting_profiles ──────────────────────────────────────────────────
create table if not exists public.module_setting_profiles (
  id           uuid primary key default gen_random_uuid(),

  profile_name text not null,
  module_key   text not null,

  description  text,
  is_default   boolean not null default false,
  is_active    boolean not null default true,

  created_by   text references public.app_users(id),
  created_at   timestamptz not null default now(),

  metadata     jsonb not null default '{}'::jsonb
);

alter table public.module_setting_profiles enable row level security;

-- ── module_setting_profile_values ────────────────────────────────────────────
create table if not exists public.module_setting_profile_values (
  id          uuid primary key default gen_random_uuid(),

  profile_id  uuid not null references public.module_setting_profiles(id) on delete cascade,
  setting_key text not null references public.app_setting_catalog(setting_key),

  value       jsonb not null,

  created_at  timestamptz not null default now(),

  unique (profile_id, setting_key)
);

alter table public.module_setting_profile_values enable row level security;

-- ── module_settings_manifests ────────────────────────────────────────────────
create table if not exists public.module_settings_manifests (
  id           uuid primary key default gen_random_uuid(),

  module_key   text not null unique,
  module_label text not null,

  has_settings       boolean not null,
  reason_no_settings text,

  module_category text not null default 'standard' check (module_category in (
                    'standard','hse','safety_critical','compliance','finance','hr',
                    'communications','admin','system')),

  review_status text not null default 'draft' check (review_status in (
                  'draft','pending_review','approved','returned','deprecated')),

  requires_compliance_review boolean not null default false,
  requires_hse_review        boolean not null default false,
  requires_security_review   boolean not null default false,

  reviewed_by_product     boolean not null default false,
  reviewed_by_module_owner boolean not null default false,
  reviewed_by_engineering boolean not null default false,
  reviewed_by_super_admin boolean not null default false,
  reviewed_by_compliance  boolean not null default false,
  reviewed_by_hse         boolean not null default false,
  reviewed_by_security    boolean not null default false,

  settings_count          integer not null default 0,
  critical_settings_count integer not null default 0,
  user_preferences_count  integer not null default 0,

  manifest_version integer not null default 1,

  created_by  text references public.app_users(id),
  created_at  timestamptz not null default now(),

  approved_by text references public.app_users(id),
  approved_at timestamptz,

  returned_reason text,

  metadata jsonb not null default '{}'::jsonb,

  check (has_settings = true or reason_no_settings is not null)
);

create index if not exists module_settings_manifests_status_idx on public.module_settings_manifests(review_status);
create index if not exists module_settings_manifests_module_idx on public.module_settings_manifests(module_key);

alter table public.module_settings_manifests enable row level security;

-- ── module_settings_manifest_sections ────────────────────────────────────────
create table if not exists public.module_settings_manifest_sections (
  id          uuid primary key default gen_random_uuid(),

  manifest_id uuid not null references public.module_settings_manifests(id) on delete cascade,

  section_key text not null check (section_key in (
                'general','numbering','validation','workflow','notifications','messages','files',
                'permissions','assignment','automation','escalation','handoffs','audit_retention',
                'personal_preferences','critical_governance')),

  applies               boolean not null default false,
  reason_not_applicable text,

  reviewed boolean not null default false,

  metadata jsonb not null default '{}'::jsonb,

  unique (manifest_id, section_key),

  check (applies = true or reason_not_applicable is not null)
);

alter table public.module_settings_manifest_sections enable row level security;

-- ── module_settings_review_approvals ─────────────────────────────────────────
create table if not exists public.module_settings_review_approvals (
  id          uuid primary key default gen_random_uuid(),

  manifest_id uuid not null references public.module_settings_manifests(id) on delete cascade,

  reviewer_role text not null check (reviewer_role in (
                  'product_owner','module_owner','engineering','super_admin','compliance','hse','security')),

  reviewer_id text references public.app_users(id),

  decision    text not null check (decision in ('approved','returned','not_required')),

  comment     text,

  reviewed_at timestamptz not null default now(),

  metadata    jsonb not null default '{}'::jsonb
);

create index if not exists module_settings_review_manifest_idx on public.module_settings_review_approvals(manifest_id);

alter table public.module_settings_review_approvals enable row level security;

-- ============================================================================
-- After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================
