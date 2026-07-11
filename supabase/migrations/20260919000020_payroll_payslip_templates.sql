-- ============================================================================
-- payroll_payslip_templates -- Payslip Studio saved designs (Phase 1)
-- ============================================================================
-- Named payslip layouts authored in the embedded Payslip Studio. `design` is the
-- full, self-contained Design JSON (logos embedded as data-URIs). One active
-- default at a time. Soft-delete via status='archived' -- business rows are never
-- hard-deleted. Single-tenant: NO organization_id. app_users.id is TEXT, so the
-- created_by / updated_by FK columns are text. ASCII + idempotent.
-- Conventions: snake_case, module-prefixed (payroll_*), uuid pk, RLS, timestamps.
-- ============================================================================

create table if not exists public.payroll_payslip_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  design      jsonb not null,
  is_default  boolean not null default false,
  status      text not null default 'active' check (status in ('active','archived')),
  created_by  text references public.app_users(id) on delete set null,
  updated_by  text references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

-- Exactly one active default template at a time (partial unique index).
create unique index if not exists one_default_payroll_payslip_template
  on public.payroll_payslip_templates (is_default)
  where is_default and status = 'active';

create index if not exists idx_payroll_payslip_templates_status
  on public.payroll_payslip_templates (status);

-- updated_at maintenance (canonical platform trigger fn).
drop trigger if exists trg_payroll_payslip_templates_updated on public.payroll_payslip_templates;
create trigger trg_payroll_payslip_templates_updated
  before update on public.payroll_payslip_templates
  for each row execute function public.set_updated_at();

-- RLS -- enabled on every table. Reads/writes go through the authenticated
-- Netlify functions (service role); no anon/public policy.
alter table public.payroll_payslip_templates enable row level security;
grant select, insert, update, delete on public.payroll_payslip_templates to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
