-- ============================================================================
-- Finance Payroll — Phase 3 Stage 3
-- Tables: finance_payslips (§8.4), finance_payroll_exports (§8.5)
-- ============================================================================

-- ── finance_payslips (§8.4) ───────────────────────────────────────────────────
-- One row per employee per run; created only after the run is locked.
-- Privacy: employee sees only own; manager cannot see subordinate by default;
-- HR cannot see payslips unless explicitly granted; bulk export Finance-only.
-- Signed URLs (expiring) generated on demand; download audited.
create table if not exists public.finance_payslips (
  id             uuid primary key default gen_random_uuid(),
  payslip_no     text unique not null,
  run_id         uuid not null references public.finance_payroll_runs(id) on delete cascade,
  run_line_id    uuid not null references public.finance_payroll_run_lines(id) on delete cascade,
  employee_id    text not null references public.app_users(id) on delete restrict,
  file_path      text,
  generated_at   timestamptz not null default now(),
  generated_by   text references public.app_users(id) on delete set null,
  metadata       jsonb not null default '{}'::jsonb,
  unique(run_id, employee_id)
);
create index if not exists finance_payslips_employee_idx on public.finance_payslips(employee_id);
create index if not exists finance_payslips_run_idx      on public.finance_payslips(run_id);
alter table public.finance_payslips enable row level security;
grant select, insert, update, delete on public.finance_payslips to service_role;
-- No updated_at: payslips are immutable after generation.

-- ── finance_payroll_exports (§8.5) ───────────────────────────────────────────
-- One artifact per export action; re-export creates a new version (old is_current→false).
-- Only locked runs may be exported. Audited; does NOT disburse.
create table if not exists public.finance_payroll_exports (
  id             uuid primary key default gen_random_uuid(),
  export_no      text unique not null,
  run_id         uuid not null references public.finance_payroll_runs(id) on delete cascade,
  format         text not null check (format in ('csv','xlsx','pdf','json')),
  file_path      text not null,
  checksum       text,
  generated_by   text references public.app_users(id) on delete set null,
  generated_at   timestamptz not null default now(),
  is_current     boolean not null default true,
  metadata       jsonb not null default '{}'::jsonb
);
create index if not exists finance_payroll_exports_run_idx       on public.finance_payroll_exports(run_id);
create index if not exists finance_payroll_exports_current_idx   on public.finance_payroll_exports(run_id, is_current)
  where is_current = true;
alter table public.finance_payroll_exports enable row level security;
grant select, insert, update, delete on public.finance_payroll_exports to service_role;
-- Exports are immutable artifacts; no updated_at trigger needed.

-- After applying, run: NOTIFY pgrst, 'reload schema';
