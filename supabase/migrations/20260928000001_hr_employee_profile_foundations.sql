-- ============================================================================
-- Employee Profile S2A — required domain foundations
-- ============================================================================
-- Backing schema for fields the LOCKED drawer mockup displays that had no
-- source. Confirmed product data; nothing here is speculative.
--
-- Deliberately NOT created: an employer/organisation entity. The canonical
-- employer record already exists as the single-tenant `employerProfile` in the
-- settings KV (netlify/functions/lib/finance/employerProfile.ts), which owns
-- `legalName` and the statutory identifiers printed on TD4/NI184/NI187.
-- "Legal Employer" in the drawer reads THAT source. Duplicating it would have
-- created a second employer of record.
--
-- Operator-applied. The schema reload is executed by the migration itself.
-- ============================================================================

-- ── 1. Effective-dated working time on the canonical assignment model ───────
-- hr_employee_assignments is already the effective-dated employment record
-- (effective_from / effective_to / is_current), so contracted hours and FTE
-- belong here rather than flattened onto app_users, where a change would
-- destroy the prior value.

alter table public.hr_employee_assignments
  add column if not exists weekly_hours numeric(5,2),
  add column if not exists fte          numeric(4,3),
  -- The table was created without `updated_at` even though it is mutable, so a
  -- row edit left no modification trace. Adding it here (rather than in a later
  -- corrective migration) keeps the working-time fields and their audit trail
  -- in one change.
  add column if not exists updated_at   timestamptz;

comment on column public.hr_employee_assignments.weekly_hours
  is 'Contracted ordinary hours per week for this assignment period.';
comment on column public.hr_employee_assignments.fte
  is 'Full-time equivalent for this assignment period; 1.000 = full-time.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hr_assignments_weekly_hours_range'
  ) then
    alter table public.hr_employee_assignments
      add constraint hr_assignments_weekly_hours_range
      check (weekly_hours is null or (weekly_hours > 0 and weekly_hours <= 168));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'hr_assignments_fte_range'
  ) then
    alter table public.hr_employee_assignments
      add constraint hr_assignments_fte_range
      check (fte is null or (fte > 0 and fte <= 1.5));
  end if;
end $$;

drop trigger if exists trg_hr_employee_assignments_updated_at on public.hr_employee_assignments;
create trigger trg_hr_employee_assignments_updated_at
  before update on public.hr_employee_assignments
  for each row execute function public.set_updated_at();

-- ── 2. Normalized access assignments + scopes ───────────────────────────────
-- Scope is STORED, never inferred from a role label. An employee may hold more
-- than one access assignment, and each assignment carries its own explicit
-- organisation/department/site scope rows.

create table if not exists public.hr_employee_access_assignments (
  id                uuid primary key default gen_random_uuid(),
  employee_id       text not null references public.app_users(id) on delete cascade,
  access_profile_id uuid not null references public.hr_access_profiles(id) on delete restrict,
  assignment_type   text not null default 'profile'
                    check (assignment_type in ('profile','mandatory','delegated')),
  status            text not null default 'active'
                    check (status in ('active','suspended','revoked')),
  effective_from    date not null default current_date,
  effective_to      date,
  granted_by        text references public.app_users(id) on delete set null,
  granted_at        timestamptz not null default now(),
  revoked_by        text references public.app_users(id) on delete set null,
  revoked_at        timestamptz,
  workflow_id       uuid references public.workflow_instances(id) on delete set null,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,
  constraint hr_access_assignment_period check (effective_to is null or effective_to >= effective_from)
);

create index if not exists hr_access_assign_employee_idx
  on public.hr_employee_access_assignments(employee_id, status);
create index if not exists hr_access_assign_profile_idx
  on public.hr_employee_access_assignments(access_profile_id);
create unique index if not exists hr_access_assign_active_unique
  on public.hr_employee_access_assignments(employee_id, access_profile_id)
  where status = 'active';

alter table public.hr_employee_access_assignments enable row level security;
grant select, insert, update, delete on public.hr_employee_access_assignments to service_role;

drop trigger if exists trg_hr_employee_access_assignments_updated_at on public.hr_employee_access_assignments;
create trigger trg_hr_employee_access_assignments_updated_at
  before update on public.hr_employee_access_assignments
  for each row execute function public.set_updated_at();

create table if not exists public.hr_employee_access_scopes (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.hr_employee_access_assignments(id) on delete cascade,
  scope_type    text not null check (scope_type in ('organisation','department','site')),
  -- null scope_id with scope_type='organisation' means the whole organisation.
  scope_id      text,
  created_at    timestamptz not null default now(),
  constraint hr_access_scope_target check (scope_type = 'organisation' or scope_id is not null)
);

create index if not exists hr_access_scope_assignment_idx
  on public.hr_employee_access_scopes(assignment_id);
create unique index if not exists hr_access_scope_unique
  on public.hr_employee_access_scopes(assignment_id, scope_type, coalesce(scope_id, '*'));

alter table public.hr_employee_access_scopes enable row level security;
grant select, insert, update, delete on public.hr_employee_access_scopes to service_role;

-- ── 3. Typed readiness controls, instances, and blocking work items ─────────
-- Separates the RULE (control) from the per-employee STATE (instance) and from
-- the COLLABORATION RECORD used to resolve a failure (work item), exactly as
-- the readiness collaboration note requires.

create table if not exists public.hr_readiness_controls (
  id              uuid primary key default gen_random_uuid(),
  control_key     text unique not null,
  label           text not null,
  domain          text not null
                  check (domain in ('assignment','payroll','training','documents','statutory','access')),
  resolution_type text not null
                  check (resolution_type in ('field_correction','document_evidence','training_completion',
                                             'department_verification','support_request',
                                             'external_system_confirmation')),
  description     text,
  is_blocking     boolean not null default true,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

create index if not exists hr_readiness_controls_active_idx
  on public.hr_readiness_controls(is_active, sort_order);

alter table public.hr_readiness_controls enable row level security;
grant select, insert, update, delete on public.hr_readiness_controls to service_role;

drop trigger if exists trg_hr_readiness_controls_updated_at on public.hr_readiness_controls;
create trigger trg_hr_readiness_controls_updated_at
  before update on public.hr_readiness_controls
  for each row execute function public.set_updated_at();

create table if not exists public.hr_readiness_control_instances (
  id           uuid primary key default gen_random_uuid(),
  employee_id  text not null references public.app_users(id) on delete cascade,
  control_id   uuid not null references public.hr_readiness_controls(id) on delete cascade,
  state        text not null default 'open'
               check (state in ('open','assigned','waiting_for_information','submitted_for_review',
                                'in_review','ready','exception_approved','not_applicable')),
  -- 0..100 coverage for the control matrix; a binary control uses 0 or 100.
  percent      integer not null default 0 check (percent between 0 and 100),
  evaluated_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  unique (employee_id, control_id)
);

create index if not exists hr_readiness_instances_employee_idx
  on public.hr_readiness_control_instances(employee_id, state);

alter table public.hr_readiness_control_instances enable row level security;
grant select, insert, update, delete on public.hr_readiness_control_instances to service_role;

drop trigger if exists trg_hr_readiness_control_instances_updated_at on public.hr_readiness_control_instances;
create trigger trg_hr_readiness_control_instances_updated_at
  before update on public.hr_readiness_control_instances
  for each row execute function public.set_updated_at();

create table if not exists public.hr_readiness_work_items (
  id               uuid primary key default gen_random_uuid(),
  employee_id      text not null references public.app_users(id) on delete cascade,
  control_id       uuid not null references public.hr_readiness_controls(id) on delete cascade,
  instance_id      uuid references public.hr_readiness_control_instances(id) on delete cascade,
  owner_id         text references public.app_users(id) on delete set null,
  responsible_team text,
  status           text not null default 'open'
                   check (status in ('open','assigned','waiting_for_information','submitted_for_review',
                                     'in_review','ready','exception_approved','not_applicable')),
  severity         text not null default 'warning'
                   check (severity in ('critical','warning','info')),
  due_date         date,
  evidence_refs    jsonb not null default '[]'::jsonb,
  reviewer_id      text references public.app_users(id) on delete set null,
  decision         text check (decision in ('approved','returned','rejected')),
  decision_reason  text,
  correlation_id   text not null,
  workflow_id      uuid references public.workflow_instances(id) on delete set null,
  created_by       text references public.app_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  resolved_at      timestamptz
);

create index if not exists hr_readiness_work_employee_idx
  on public.hr_readiness_work_items(employee_id, status);
create index if not exists hr_readiness_work_due_idx
  on public.hr_readiness_work_items(due_date) where due_date is not null;
create index if not exists hr_readiness_work_owner_idx
  on public.hr_readiness_work_items(owner_id) where owner_id is not null;
create index if not exists hr_readiness_work_correlation_idx
  on public.hr_readiness_work_items(correlation_id);

alter table public.hr_readiness_work_items enable row level security;
grant select, insert, update, delete on public.hr_readiness_work_items to service_role;

drop trigger if exists trg_hr_readiness_work_items_updated_at on public.hr_readiness_work_items;
create trigger trg_hr_readiness_work_items_updated_at
  before update on public.hr_readiness_work_items
  for each row execute function public.set_updated_at();

create table if not exists public.hr_readiness_work_item_transitions (
  id             uuid primary key default gen_random_uuid(),
  work_item_id   uuid not null references public.hr_readiness_work_items(id) on delete cascade,
  from_status    text,
  to_status      text not null,
  actor_id       text references public.app_users(id) on delete set null,
  note           text,
  correlation_id text not null,
  created_at     timestamptz not null default now()
);

create index if not exists hr_readiness_transitions_item_idx
  on public.hr_readiness_work_item_transitions(work_item_id, created_at desc);

alter table public.hr_readiness_work_item_transitions enable row level security;
grant select, insert, update, delete on public.hr_readiness_work_item_transitions to service_role;

-- ── 4. Seed the control definitions the drawer's matrix renders ─────────────
insert into public.hr_readiness_controls (control_key, label, domain, resolution_type, description, sort_order)
select v.control_key, v.label, v.domain, v.resolution_type, v.description, v.sort_order
  from (values
    ('assignment.complete', 'Assignment', 'assignment', 'field_correction',
     'Department, site and supervisor are recorded on the current assignment.', 10),
    ('payroll.statutory_ready', 'Payroll', 'payroll', 'department_verification',
     'NIS, tax and pay setup are complete and confirmed by Payroll.', 20),
    ('training.evidence_current', 'Training', 'training', 'training_completion',
     'Required training evidence is present and unexpired.', 30)
  ) as v(control_key, label, domain, resolution_type, description, sort_order)
 where not exists (
   select 1 from public.hr_readiness_controls c where c.control_key = v.control_key
 );

-- ── 5. Permissions ─────────────────────────────────────────────────────────
-- A permission key is DEAD until role_permissions carries it, so the grants
-- ship in the SAME migration as the keys. Narrow by design: readiness review is
-- separate from readiness view, and access-assignment management is separate
-- from viewing it.

insert into public.role_permissions (role_name, permission)
select r.role_name, p.permission
  from (values ('hr_manager'), ('admin')) as r(role_name)
 cross join (values
   ('hr.employees.readiness.view'),
   ('hr.employees.readiness.follow_up'),
   ('hr.employees.access_assignments.view')
 ) as p(permission)
 where not exists (
   select 1 from public.role_permissions rp
    where rp.role_name = r.role_name and rp.permission = p.permission
 );

-- hr_staff coordinates but does not review or change access assignments.
insert into public.role_permissions (role_name, permission)
select 'hr_staff', p.permission
  from (values
   ('hr.employees.readiness.view'),
   ('hr.employees.readiness.follow_up'),
   ('hr.employees.access_assignments.view')
 ) as p(permission)
 where not exists (
   select 1 from public.role_permissions rp
    where rp.role_name = 'hr_staff' and rp.permission = p.permission
 );

-- Reviewing submitted readiness evidence and managing access assignments are
-- elevated: hr_manager and admin only, never hr_staff.
insert into public.role_permissions (role_name, permission)
select r.role_name, p.permission
  from (values ('hr_manager'), ('admin')) as r(role_name)
 cross join (values
   ('hr.employees.readiness.review'),
   ('hr.employees.access_assignments.manage')
 ) as p(permission)
 where not exists (
   select 1 from public.role_permissions rp
    where rp.role_name = r.role_name and rp.permission = p.permission
 );

-- ── 6. Expose the new objects to PostgREST ─────────────────────────────────
-- Executable, not a comment: a migration that needs a manual follow-up step is
-- a migration that ships half-applied.
notify pgrst, 'reload schema';
