-- ============================================================================
-- finance_payroll_runs -- payslip template selector (Phase 2)
-- ============================================================================
-- Adds template_id (nullable FK) so a pay run can record which Payslip Studio
-- layout to render payslips with.  NULL = use the active default template at
-- render time. ASCII, idempotent, <5KB. No new permissions (reuses
-- finance.payroll.run.manage for the set-template mutation).
-- ============================================================================

alter table public.finance_payroll_runs
  add column if not exists template_id uuid
    references public.payroll_payslip_templates(id) on delete set null;

comment on column public.finance_payroll_runs.template_id is
  'Payslip Studio template to use when rendering payslips. NULL = active default.';

create index if not exists idx_finance_payroll_runs_template_id
  on public.finance_payroll_runs (template_id)
  where template_id is not null;

-- After applying: NOTIFY pgrst, 'reload schema';
