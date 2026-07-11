-- ============================================================================
-- payroll_payslip_templates
-- Saved payslip designs authored in Payslip Studio. `design` is the full,
-- self-contained Design JSON (logos embedded as data-URIs).
-- Conventions: snake_case, module-prefixed (payroll_*), uuid pk, RLS, timestamps.
-- app_users.id is TEXT — FK columns are text.
-- ============================================================================

create table if not exists payroll_payslip_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  design      jsonb not null,
  is_default  boolean not null default false,
  status      text not null default 'active',        -- active | archived
  created_by  text references app_users(id),
  updated_by  text references app_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

-- Exactly one active default template at a time.
create unique index if not exists one_default_payroll_payslip_template
  on payroll_payslip_templates (is_default)
  where is_default and status = 'active';

create index if not exists idx_payroll_payslip_templates_status
  on payroll_payslip_templates (status);

-- updated_at maintenance (reuse the platform trigger fn; create if your repo
-- names it differently).
drop trigger if exists trg_payroll_payslip_templates_updated on payroll_payslip_templates;
create trigger trg_payroll_payslip_templates_updated
  before update on payroll_payslip_templates
  for each row execute function set_updated_at();

-- RLS — enabled on every table. Reads/writes go through the authenticated
-- Netlify functions (service role); add tenant/role policies to match the
-- platform's existing payroll tables.
alter table payroll_payslip_templates enable row level security;
