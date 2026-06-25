-- ============================================================================
-- HR Employee Master — satellite tables (Phase 1)
-- ============================================================================
-- Net-new HR structures layered ON TOP of the existing identity model. They do
-- NOT fork employees: every employee FK is app_users.id (TEXT). Workflow links
-- reuse the existing workflow_instances (uuid). Conventions mirror the HSE
-- tables: uuid PK, created_at/updated_at, RLS enabled (service-role bypass, no
-- policies), CHECK enums, hr_ prefix. Run manually + NOTIFY pgrst.
-- ============================================================================

-- ── hr_positions — job positions (richer than the free-text app_users.position) ─
create table if not exists public.hr_positions (
  id                    uuid primary key default gen_random_uuid(),
  position_key          text unique not null,
  title                 text not null,
  department_id         text,                                   -- departments.id (text), no FK
  site_id               text,
  default_supervisor_id text references public.app_users(id) on delete set null,
  is_safety_critical    boolean not null default false,
  is_active             boolean not null default true,
  created_by            text references public.app_users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  metadata              jsonb not null default '{}'::jsonb
);
create index if not exists hr_positions_active_idx on public.hr_positions(is_active);
alter table public.hr_positions enable row level security;

-- ── hr_employee_assignments — time-versioned role/site/dept/supervisor history ──
create table if not exists public.hr_employee_assignments (
  id              uuid primary key default gen_random_uuid(),
  employee_id     text not null references public.app_users(id) on delete cascade,
  position_id     uuid references public.hr_positions(id) on delete set null,
  department_id   text,
  site_id         text,
  supervisor_id   text references public.app_users(id) on delete set null,
  assignment_type text not null default 'primary'
                  check (assignment_type in ('primary','secondary','acting','temporary')),
  effective_from  date not null,
  effective_to    date,
  is_current      boolean not null default true,
  created_by      text references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  workflow_id     uuid references public.workflow_instances(id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb
);
create index if not exists hr_assignments_employee_idx on public.hr_employee_assignments(employee_id, is_current);
create index if not exists hr_assignments_supervisor_idx on public.hr_employee_assignments(supervisor_id) where supervisor_id is not null;
alter table public.hr_employee_assignments enable row level security;

-- ── hr_employee_status_history — the richer HR lifecycle (status auth stays) ────
create table if not exists public.hr_employee_status_history (
  id              uuid primary key default gen_random_uuid(),
  employee_id     text not null references public.app_users(id) on delete cascade,
  previous_status text,
  new_status      text not null
                  check (new_status in ('draft','pending_onboarding','active','probation',
                                        'on_leave','suspended','inactive','terminated','archived')),
  reason          text,
  effective_date  date,
  changed_by      text references public.app_users(id) on delete set null,
  changed_at      timestamptz not null default now(),
  workflow_id     uuid references public.workflow_instances(id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb
);
create index if not exists hr_status_history_employee_idx on public.hr_employee_status_history(employee_id, changed_at desc);
alter table public.hr_employee_status_history enable row level security;

-- ── hr_employee_change_requests — sensitive changes routed through workflow ─────
create table if not exists public.hr_employee_change_requests (
  id              uuid primary key default gen_random_uuid(),
  change_no       text unique not null,                          -- nextRef('HRC')
  employee_id     text not null references public.app_users(id) on delete cascade,
  change_type     text not null
                  check (change_type in ('role_change','department_transfer','site_transfer',
                                         'supervisor_change','status_change','employment_type_change',
                                         'salary_change','contact_update')),
  requested_by    text references public.app_users(id) on delete set null,
  previous_value  jsonb,
  requested_value jsonb,
  status          text not null default 'draft'
                  check (status in ('draft','submitted','in_review','returned','approved','rejected','cancelled','applied')),
  workflow_id     uuid references public.workflow_instances(id) on delete set null,
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,
  applied_at      timestamptz,
  metadata        jsonb not null default '{}'::jsonb
);
create index if not exists hr_change_req_employee_idx on public.hr_employee_change_requests(employee_id, status);
create index if not exists hr_change_req_status_idx on public.hr_employee_change_requests(status);
alter table public.hr_employee_change_requests enable row level security;

-- ── hr_audit_log — immutable HR audit trail (per submodule) ────────────────────
create table if not exists public.hr_audit_log (
  id             uuid primary key default gen_random_uuid(),
  employee_id    text references public.app_users(id) on delete set null,
  submodule_key  text not null,
  record_id      text,
  actor_id       text references public.app_users(id) on delete set null,
  action         text not null,
  previous_state jsonb,
  new_state      jsonb,
  reason         text,
  ip_address     text,
  user_agent     text,
  created_at     timestamptz not null default now(),
  metadata       jsonb not null default '{}'::jsonb
);
create index if not exists hr_audit_employee_idx on public.hr_audit_log(employee_id, created_at desc);
create index if not exists hr_audit_submodule_idx on public.hr_audit_log(submodule_key, created_at desc);
alter table public.hr_audit_log enable row level security;
