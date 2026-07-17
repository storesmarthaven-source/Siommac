-- ============================================================================
-- Finance — Payroll Bank Disbursements (F2)
-- Tables: finance_disbursements (header), finance_disbursement_lines (per-employee)
-- Spec §F2 / Payroll Bank Disbursement
-- ============================================================================
-- Lifecycle: draft → submitted → approved → file_generated → paid → cancelled
-- SoD: creator ≠ approver (enforced in the lib adapter).
-- Net pay per employee is derived from finance_payslips joined to
-- finance_payroll_run_lines (net column).
-- ============================================================================
-- This migration is OPERATOR-APPLIED only — DO NOT run from application code.
-- After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── finance_disbursements (disbursement header per payroll run) ───────────────
create table if not exists public.finance_disbursements (
  id               uuid primary key default gen_random_uuid(),
  disbursement_no  text unique not null,
  payroll_run_id   uuid not null references public.finance_payroll_runs(id) on delete restrict,
  status           text not null default 'draft'
                     check (status in ('draft','submitted','approved','file_generated','paid','cancelled')),
  total_amount     numeric(15,2) not null default 0,
  employee_count   int not null default 0,
  bank_file_path   text,           -- storage path to the generated ACH/EFT file
  currency         text not null default 'TTD',
  approved_by      text references public.app_users(id) on delete set null,
  created_by       text references public.app_users(id) on delete set null,
  cancelled_by     text references public.app_users(id) on delete set null,
  cancel_reason    text,
  workflow_id      uuid references public.workflow_instances(id) on delete set null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists finance_disbursements_run_idx
  on public.finance_disbursements(payroll_run_id);
create unique index if not exists finance_disbursements_one_active_run_uidx
  on public.finance_disbursements(payroll_run_id)
  where status <> 'cancelled';
create index if not exists finance_disbursements_status_idx
  on public.finance_disbursements(status);
create index if not exists finance_disbursements_workflow_idx
  on public.finance_disbursements(workflow_id) where workflow_id is not null;

alter table public.finance_disbursements enable row level security;
grant select, insert, update, delete on public.finance_disbursements to service_role;

drop trigger if exists trg_finance_disbursements_updated_at on public.finance_disbursements;
create trigger trg_finance_disbursements_updated_at
  before update on public.finance_disbursements
  for each row execute function public.set_updated_at();

-- ── finance_disbursement_lines (per-employee lines within a disbursement) ─────
-- Each row = one employee's net pay to be disbursed to their bank account.
create table if not exists public.finance_disbursement_lines (
  id                             uuid primary key default gen_random_uuid(),
  disbursement_id                uuid not null references public.finance_disbursements(id) on delete cascade,
  employee_id                    text not null references public.app_users(id) on delete restrict,
  bank_account_id                uuid references public.finance_employee_bank_accounts(id) on delete restrict,
  bank_name_snapshot             text,
  branch_snapshot                text,
  account_type_snapshot          text,
  account_number_snapshot        text,
  account_number_masked_snapshot text,
  transit_number_snapshot        text,
  routing_snapshot_checksum      text,
  net_amount                     numeric(12,2) not null,
  metadata                       jsonb not null default '{}'::jsonb,
  created_at                     timestamptz not null default now(),
  unique (disbursement_id, employee_id),
  constraint finance_disbursement_lines_account_type_snapshot_ck
    check (
      account_type_snapshot is null
      or account_type_snapshot in ('savings','chequing')
    )
);

create index if not exists fin_disb_lines_disb_idx
  on public.finance_disbursement_lines(disbursement_id);
create index if not exists fin_disb_lines_employee_idx
  on public.finance_disbursement_lines(employee_id);

alter table public.finance_disbursement_lines enable row level security;
grant select, insert, update, delete on public.finance_disbursement_lines to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
