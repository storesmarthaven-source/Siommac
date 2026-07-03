-- ============================================================================
-- HR Shift / Roster Scheduling — Core tables (greenfield)
-- Shift templates, rotation patterns, coverage requirements
-- ============================================================================
-- These are the building blocks for rosters. A roster (20260803000001) owns
-- many shift_assignments; assignments reference templates; coverage_requirements
-- declare required headcount that gap-detection compares against.
--
-- app_users.id is TEXT — all user FKs are text.
-- RLS enabled on every table + service_role grants.
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── Shift templates ───────────────────────────────────────────────────────────
create table if not exists public.hr_shift_templates (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  starts_at        time not null,
  ends_at          time not null,
  crosses_midnight boolean not null default false,
  break_minutes    int not null default 0,
  paid_hours       numeric(5,2) not null,
  colour           text,
  site_id          text references public.project_sites(id) on delete set null,
  is_active        boolean not null default true,
  created_by       text references public.app_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists hr_shift_templates_site_idx    on public.hr_shift_templates(site_id);
create index if not exists hr_shift_templates_active_idx  on public.hr_shift_templates(is_active);

alter table public.hr_shift_templates enable row level security;
grant select, insert, update, delete on public.hr_shift_templates to service_role;

drop trigger if exists trg_hr_shift_templates_updated_at on public.hr_shift_templates;
create trigger trg_hr_shift_templates_updated_at
  before update on public.hr_shift_templates
  for each row execute function public.set_updated_at();

-- ── Rotation patterns ─────────────────────────────────────────────────────────
-- pattern jsonb: array of { dayIndex: number, shiftTemplateCode: string | 'off' }
create table if not exists public.hr_rotation_patterns (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  cycle_days  int not null check (cycle_days > 0),
  pattern     jsonb not null default '[]',
  is_active   boolean not null default true,
  created_by  text references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists hr_rotation_patterns_active_idx on public.hr_rotation_patterns(is_active);

alter table public.hr_rotation_patterns enable row level security;
grant select, insert, update, delete on public.hr_rotation_patterns to service_role;

drop trigger if exists trg_hr_rotation_patterns_updated_at on public.hr_rotation_patterns;
create trigger trg_hr_rotation_patterns_updated_at
  before update on public.hr_rotation_patterns
  for each row execute function public.set_updated_at();

-- ── Coverage requirements ─────────────────────────────────────────────────────
-- Declares required headcount per site/dept/position/shift.
-- Gap detection compares assignments against this.
create table if not exists public.hr_coverage_requirements (
  id                  uuid primary key default gen_random_uuid(),
  site_id             text references public.project_sites(id) on delete cascade,
  department_id       text references public.departments(id) on delete set null,
  position_id         uuid references public.hr_positions(id) on delete set null,
  shift_template_id   uuid not null references public.hr_shift_templates(id) on delete cascade,
  required_headcount  int not null check (required_headcount > 0),
  day_of_week         int check (day_of_week between 0 and 6),  -- null = every day
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists hr_coverage_requirements_site_idx  on public.hr_coverage_requirements(site_id);
create index if not exists hr_coverage_requirements_shift_idx on public.hr_coverage_requirements(shift_template_id);
create index if not exists hr_coverage_requirements_active_idx on public.hr_coverage_requirements(is_active);

alter table public.hr_coverage_requirements enable row level security;
grant select, insert, update, delete on public.hr_coverage_requirements to service_role;

drop trigger if exists trg_hr_coverage_requirements_updated_at on public.hr_coverage_requirements;
create trigger trg_hr_coverage_requirements_updated_at
  before update on public.hr_coverage_requirements
  for each row execute function public.set_updated_at();

-- After applying, run: NOTIFY pgrst, 'reload schema';
