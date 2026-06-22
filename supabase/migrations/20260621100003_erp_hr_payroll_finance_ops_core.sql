-- ============================================================================
-- ERP HR / Payroll / Finance / Operations skeleton tables
-- These tables exist to receive handoffs from Day 1. Full UI buildout in later phases.
-- ============================================================================

-- ── HR ────────────────────────────────────────────────────────────────────────

create table if not exists public.hr_cases (
  id                  uuid    primary key default gen_random_uuid(),
  ref                 text    not null unique,
  case_type           text    not null,   -- 'injury'|'disciplinary'|'return_to_work'|'training'
  employee_id         text    not null references public.app_users(id) on delete cascade,
  source_module       text,
  source_entity_type  text,
  source_entity_id    text,
  status              text    not null default 'open',
  assigned_to         text    references public.app_users(id) on delete set null,
  notes               text,
  payload             jsonb   not null default '{}'::jsonb,
  metadata            jsonb   not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,
  closed_at           timestamptz
);

create index if not exists hr_cases_employee_idx
  on public.hr_cases(employee_id, status);

create index if not exists hr_cases_source_idx
  on public.hr_cases(source_module, source_entity_id) where source_entity_id is not null;

alter table public.hr_cases enable row level security;

create table if not exists public.hr_training_assignments (
  id              uuid    primary key default gen_random_uuid(),
  employee_id     text    not null references public.app_users(id) on delete cascade,
  training_item   text    not null,
  due_date        date,
  completed_at    timestamptz,
  status          text    not null default 'pending',
  source_case_id  uuid    references public.hr_cases(id) on delete set null,
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists hr_ta_employee_idx
  on public.hr_training_assignments(employee_id, status);

alter table public.hr_training_assignments enable row level security;

create table if not exists public.hr_document_acknowledgements (
  id              uuid    primary key default gen_random_uuid(),
  document_ref    text    not null,
  employee_id     text    not null references public.app_users(id) on delete cascade,
  acknowledged_at timestamptz,
  expires_at      timestamptz,
  status          text    not null default 'pending',
  created_at      timestamptz not null default now(),
  unique (document_ref, employee_id)
);

alter table public.hr_document_acknowledgements enable row level security;

-- ── Payroll (extends existing payroll_approvals / payslips) ───────────────────

create table if not exists public.payroll_runs (
  id                      uuid    primary key default gen_random_uuid(),
  ref                     text    not null unique,   -- PAY-2026-0001
  period_from             date    not null,
  period_to               date    not null,
  pay_cycle               text    not null default 'monthly',
  run_by                  text    references public.app_users(id) on delete set null,
  approved_by             text    references public.app_users(id) on delete set null,
  status                  text    not null default 'draft'
                          check (status in ('draft','submitted','approved','published','cancelled')),
  total_gross             numeric(15,2) not null default 0,
  total_net               numeric(15,2) not null default 0,
  total_nis_employee      numeric(15,2) not null default 0,
  total_nis_employer      numeric(15,2) not null default 0,
  total_paye              numeric(15,2) not null default 0,
  total_health_surcharge  numeric(15,2) not null default 0,
  workflow_id             uuid    references public.workflow_instances(id) on delete set null,
  published_at            timestamptz,
  run_at                  timestamptz not null default now(),
  created_at              timestamptz not null default now()
);

create index if not exists payroll_runs_status_idx
  on public.payroll_runs(status, period_from desc);

alter table public.payroll_runs enable row level security;

create table if not exists public.payroll_run_lines (
  id                    uuid    primary key default gen_random_uuid(),
  run_id                uuid    not null references public.payroll_runs(id) on delete cascade,
  employee_id           text    not null references public.app_users(id) on delete cascade,
  gross_pay             numeric(15,2) not null default 0,
  nis_employee          numeric(15,2) not null default 0,
  nis_employer          numeric(15,2) not null default 0,
  paye                  numeric(15,2) not null default 0,
  health_surcharge      numeric(15,2) not null default 0,
  net_pay               numeric(15,2) not null default 0,
  hours_worked          numeric(8,2),
  days_worked           integer,
  adjustments           jsonb   not null default '[]'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists prl_run_idx
  on public.payroll_run_lines(run_id);

create index if not exists prl_employee_idx
  on public.payroll_run_lines(employee_id);

alter table public.payroll_run_lines enable row level security;

create table if not exists public.payroll_adjustments (
  id              uuid    primary key default gen_random_uuid(),
  employee_id     text    not null references public.app_users(id) on delete cascade,
  period_from     date    not null,
  period_to       date    not null,
  type            text    not null,   -- 'bonus'|'deduction'|'correction'|'allowance'
  amount          numeric(15,2) not null,
  reason          text    not null,
  applied_by      text    references public.app_users(id) on delete set null,
  source_module   text,
  source_entity_id text,
  applied_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists pa_employee_idx
  on public.payroll_adjustments(employee_id, period_from desc);

alter table public.payroll_adjustments enable row level security;

create table if not exists public.payroll_remittances (
  id          uuid    primary key default gen_random_uuid(),
  ref         text    not null unique,
  period_from date    not null,
  period_to   date    not null,
  authority   text    not null,   -- 'NIS'|'BIR_PAYE'|'BIR_HS'
  amount      numeric(15,2) not null,
  due_date    date    not null,
  paid_at     timestamptz,
  receipt_url text,
  status      text    not null default 'pending',
  created_at  timestamptz not null default now()
);

alter table public.payroll_remittances enable row level security;

-- ── Finance ───────────────────────────────────────────────────────────────────

create table if not exists public.finance_cost_centers (
  id              uuid    primary key default gen_random_uuid(),
  name            text    not null,
  department_id   text,
  annual_budget   numeric(15,2),
  currency        text    not null default 'TTD',
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

alter table public.finance_cost_centers enable row level security;

create table if not exists public.finance_cost_entries (
  id                  uuid    primary key default gen_random_uuid(),
  ref                 text    not null unique,
  source_module       text    not null,
  source_entity_type  text    not null,
  source_entity_id    text    not null,
  cost_center_id      uuid    references public.finance_cost_centers(id) on delete set null,
  amount              numeric(15,2) not null,
  currency            text    not null default 'TTD',
  description         text,
  status              text    not null default 'pending',
  approved_by         text    references public.app_users(id) on delete set null,
  approved_at         timestamptz,
  source_handoff_id   uuid    references public.handoff_outbox(id) on delete set null,
  metadata            jsonb   not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create index if not exists fce_source_idx
  on public.finance_cost_entries(source_module, source_entity_id);

alter table public.finance_cost_entries enable row level security;

create table if not exists public.finance_budget_lines (
  id              uuid    primary key default gen_random_uuid(),
  cost_center_id  uuid    not null references public.finance_cost_centers(id) on delete cascade,
  fiscal_year     integer not null,
  category        text    not null,
  budgeted        numeric(15,2) not null default 0,
  actual          numeric(15,2) not null default 0,
  currency        text    not null default 'TTD',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

create index if not exists fbl_cc_year_idx
  on public.finance_budget_lines(cost_center_id, fiscal_year);

alter table public.finance_budget_lines enable row level security;

-- ── Operations ────────────────────────────────────────────────────────────────

create table if not exists public.ops_work_orders (
  id                  uuid    primary key default gen_random_uuid(),
  ref                 text    not null unique,
  source_module       text,
  source_entity_type  text,
  source_entity_id    text,
  site_id             text,
  asset_id            uuid,   -- references ops_assets when created
  description         text    not null,
  priority            text    not null default 'medium',
  status              text    not null default 'open',
  due_date            date,
  assigned_to         text    references public.app_users(id) on delete set null,
  source_handoff_id   uuid    references public.handoff_outbox(id) on delete set null,
  metadata            jsonb   not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create index if not exists owo_status_idx
  on public.ops_work_orders(status, due_date);

create index if not exists owo_source_idx
  on public.ops_work_orders(source_module, source_entity_id) where source_entity_id is not null;

alter table public.ops_work_orders enable row level security;

create table if not exists public.ops_assets (
  id              uuid    primary key default gen_random_uuid(),
  name            text    not null,
  type            text    not null,
  site_id         text,
  serial_no       text,
  purchase_date   date,
  last_serviced   date,
  next_service    date,
  status          text    not null default 'active',
  cost_center_id  uuid    references public.finance_cost_centers(id) on delete set null,
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

alter table public.ops_assets enable row level security;

create table if not exists public.ops_inventory_items (
  id              uuid    primary key default gen_random_uuid(),
  name            text    not null,
  sku             text    unique,
  category        text,
  site_id         text,
  qty_on_hand     numeric(12,3) not null default 0,
  reorder_point   numeric(12,3),
  unit            text    not null default 'unit',
  unit_cost       numeric(15,2),
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

alter table public.ops_inventory_items enable row level security;

create table if not exists public.ops_inventory_movements (
  id          uuid    primary key default gen_random_uuid(),
  item_id     uuid    not null references public.ops_inventory_items(id) on delete cascade,
  movement    text    not null check (movement in ('in','out','adjust','transfer')),
  qty         numeric(12,3) not null,
  reference   text,
  note        text,
  actor_id    text    references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists oim_item_idx
  on public.ops_inventory_movements(item_id, created_at desc);

alter table public.ops_inventory_movements enable row level security;

-- ── Cross-module permission seeding ───────────────────────────────────────────

insert into public.role_permissions (role_name, permission) values
  -- Workflow
  ('superadmin', 'workflow.view'), ('superadmin', 'workflow.approve'),
  ('admin',      'workflow.view'), ('admin',      'workflow.approve'),
  ('manager',    'workflow.view'), ('manager',    'workflow.approve'),
  ('employee',   'workflow.view'),
  -- Communications
  ('superadmin', 'communications.view'), ('superadmin', 'tickets.manage'),
  ('admin',      'communications.view'), ('admin',      'tickets.manage'),
  ('manager',    'communications.view'), ('manager',    'tickets.manage'),
  ('employee',   'communications.view'),
  -- HR
  ('superadmin', 'hr.records.view'), ('superadmin', 'hr.records.manage'),
  ('admin',      'hr.records.view'), ('admin',      'hr.records.manage'),
  ('manager',    'hr.records.view'),
  -- Finance
  ('superadmin', 'finance.costs.view'), ('superadmin', 'finance.costs.approve'),
  ('admin',      'finance.costs.view'), ('admin',      'finance.costs.approve'),
  ('manager',    'finance.costs.view'),
  -- Operations
  ('superadmin', 'operations.workorders.view'), ('superadmin', 'operations.workorders.manage'),
  ('admin',      'operations.workorders.view'), ('admin',      'operations.workorders.manage'),
  ('manager',    'operations.workorders.view'), ('manager',    'operations.workorders.manage'),
  ('employee',   'operations.workorders.view'),
  -- Reports
  ('superadmin', 'reports.export'), ('admin', 'reports.export'), ('manager', 'reports.export'),
  -- Audit
  ('superadmin', 'audit.read'), ('admin', 'audit.read')
on conflict (role_name, permission) do nothing;
