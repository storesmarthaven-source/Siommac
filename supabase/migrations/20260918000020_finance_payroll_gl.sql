-- ============================================================================
-- Finance Payroll — General Ledger posting (Wave 2)
-- Component/line → GL account mapping + posting linkage on the run.
-- Journals are written to the existing finance_gl_journals/lines (JE-YYYY-NNNN,
-- draft→posted→reversed, must balance). Payroll is the first GL poster.
-- ============================================================================

-- Maps each standard payroll journal line to a GL account code (soft ref to
-- finance_gl_accounts.code — no FK, per the GL contract). component_id/department_id
-- are reserved for future per-component / per-department overrides; Wave 2 uses the
-- base mapping (both null).
create table if not exists public.finance_payroll_gl_mappings (
  id            uuid primary key default gen_random_uuid(),
  mapping_key   text not null
                  check (mapping_key in (
                    'salary_expense','overtime_expense','allowance_expense','employer_nis_expense',
                    'net_pay_clearing','paye_payable','nis_employee_payable','nis_employer_payable',
                    'health_surcharge_payable','deductions_payable')),
  account_code  text not null,                        -- soft ref finance_gl_accounts.code
  component_id  uuid,                                 -- future: per-component override
  department_id uuid,                                 -- future: per-department override
  active        boolean not null default true,
  created_by    text references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One BASE mapping per key (component_id & department_id null); overrides added later.
create unique index if not exists finance_payroll_gl_mappings_base_idx
  on public.finance_payroll_gl_mappings(mapping_key)
  where component_id is null and department_id is null;

alter table public.finance_payroll_gl_mappings enable row level security;
grant select, insert, update, delete on public.finance_payroll_gl_mappings to service_role;

-- Posting linkage on the run: which journal posted this run, and when.
alter table public.finance_payroll_runs
  add column if not exists gl_journal_id uuid references public.finance_gl_journals(id) on delete set null,
  add column if not exists gl_posted_at  timestamptz;

-- After applying, run: NOTIFY pgrst, 'reload schema';
