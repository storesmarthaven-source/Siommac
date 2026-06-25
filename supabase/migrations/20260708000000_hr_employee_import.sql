-- ============================================================================
-- HR Employee Master — Import Employees (v36 §8)
-- ============================================================================
-- Staging tables for the 7-step import wizard (upload → map → policy → validate
-- → resolve → commit → report). Rows are uploaded as JSON (the browser parses
-- the CSV/XLSX), staged + validated here, then committed into app_users + the HR
-- satellites via the shared provisioning path. Backend-only (service-role,
-- gated by hr.employees.import.* in the API) — sensitive bulk identity data, so
-- (statutory lesson) grant the service role EXPLICITLY and add NO public policy.
--
-- app_users.id is TEXT → employee FKs are TEXT. Run manually, then NOTIFY pgrst.
-- ============================================================================

-- ── batches ─────────────────────────────────────────────────────────────────
create table if not exists public.hr_employee_import_batches (
  id                    uuid primary key default gen_random_uuid(),
  batch_no              text unique not null,                       -- nextRef('HRI')
  uploaded_by           text references public.app_users(id) on delete set null,
  file_name             text,
  file_type             text,                                       -- csv | xlsx
  import_mode           text not null default 'create'
                          check (import_mode in ('create','update','create_update')),
  status                text not null default 'uploaded'
                          check (status in ('uploaded','mapped','validated','committing','committed','failed','cancelled')),
  total_rows            integer not null default 0,
  ready_rows            integer not null default 0,
  warning_rows          integer not null default 0,
  blocked_rows          integer not null default 0,
  duplicate_rows        integer not null default 0,
  created_rows          integer not null default 0,
  updated_rows          integer not null default 0,
  failed_rows           integer not null default 0,
  skipped_rows          integer not null default 0,
  mapping               jsonb not null default '{}'::jsonb,
  policy                jsonb not null default '{}'::jsonb,
  default_site_id       text,
  default_department_id text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  committed_at          timestamptz
);
create index if not exists hr_import_batches_status_idx on public.hr_employee_import_batches(status);

-- ── rows ────────────────────────────────────────────────────────────────────
create table if not exists public.hr_employee_import_rows (
  id                 uuid primary key default gen_random_uuid(),
  batch_id           uuid not null references public.hr_employee_import_batches(id) on delete cascade,
  row_no             integer not null,
  raw_data           jsonb not null default '{}'::jsonb,
  mapped_data        jsonb not null default '{}'::jsonb,
  status             text not null default 'pending'
                       check (status in ('pending','ready','warning','blocked','duplicate','skipped','created','updated','failed')),
  severity           text check (severity in ('info','warning','error')),
  resolution         text,                                          -- edit | ignore | skip | merge | assign
  target_employee_id text references public.app_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);
create index if not exists hr_import_rows_batch_idx on public.hr_employee_import_rows(batch_id, status);
create unique index if not exists hr_import_rows_batch_rowno_uq on public.hr_employee_import_rows(batch_id, row_no);

-- ── per-row errors (append-only) ──────────────────────────────────────────────
create table if not exists public.hr_employee_import_row_errors (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references public.hr_employee_import_batches(id) on delete cascade,
  row_id              uuid not null references public.hr_employee_import_rows(id) on delete cascade,
  field_key           text,
  error_code          text not null,
  severity            text not null default 'error' check (severity in ('info','warning','error')),
  message             text,
  resolution_required boolean not null default false,
  created_at          timestamptz not null default now()
);
create index if not exists hr_import_row_errors_batch_idx on public.hr_employee_import_row_errors(batch_id);
create index if not exists hr_import_row_errors_row_idx   on public.hr_employee_import_row_errors(row_id);

-- ── RLS + grants (backend-only via service_role; grant writes EXPLICITLY) ──────
alter table public.hr_employee_import_batches   enable row level security;
alter table public.hr_employee_import_rows      enable row level security;
alter table public.hr_employee_import_row_errors enable row level security;

grant select, insert, update, delete on table public.hr_employee_import_batches    to service_role;
grant select, insert, update, delete on table public.hr_employee_import_rows       to service_role;
grant select, insert, update, delete on table public.hr_employee_import_row_errors to service_role;

-- ── updated_at triggers (mutable tables only) ─────────────────────────────────
drop trigger if exists trg_hr_import_batches_updated_at on public.hr_employee_import_batches;
create trigger trg_hr_import_batches_updated_at
  before update on public.hr_employee_import_batches
  for each row execute function public.set_updated_at();

drop trigger if exists trg_hr_import_rows_updated_at on public.hr_employee_import_rows;
create trigger trg_hr_import_rows_updated_at
  before update on public.hr_employee_import_rows
  for each row execute function public.set_updated_at();

-- ── permission seed (v36 §12 import keys) — full HR roles only ─────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin','hr.employees.import'),('admin','hr.employees.import'),('hr_manager','hr.employees.import'),
  ('superadmin','hr.employees.import.upload'),('admin','hr.employees.import.upload'),('hr_manager','hr.employees.import.upload'),
  ('superadmin','hr.employees.import.map'),('admin','hr.employees.import.map'),('hr_manager','hr.employees.import.map'),
  ('superadmin','hr.employees.import.validate'),('admin','hr.employees.import.validate'),('hr_manager','hr.employees.import.validate'),
  ('superadmin','hr.employees.import.commit'),('admin','hr.employees.import.commit'),('hr_manager','hr.employees.import.commit'),
  ('superadmin','hr.employees.import.report.download'),('admin','hr.employees.import.report.download'),('hr_manager','hr.employees.import.report.download')
on conflict do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';
