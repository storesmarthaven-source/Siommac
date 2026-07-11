-- ============================================================================
-- Finance Payroll — per-bank direct-credit (ACH) files (Wave 6)
-- ============================================================================
-- A disbursement's net-pay lines are grouped BY BANK and one structured
-- direct-credit file is generated per bank (header + detail + trailer with a
-- control count/total). Each generated file is recorded here.
-- Also adds transit_number to employee bank accounts (branch transit for the file).
-- Single-tenant: NO organization_id. app_users.id is TEXT.
-- ============================================================================

create table if not exists public.finance_disbursement_bank_files (
  id              uuid primary key default gen_random_uuid(),
  disbursement_id uuid not null references public.finance_disbursements(id) on delete cascade,
  bank_name       text not null,
  bank_code       text not null,                 -- resolved short code (RBL/FCB/SCOTIA/RBC/OTHER)
  format          text not null default 'direct_credit_csv',
  file_path       text not null,                 -- private 'disbursements' bucket path
  employee_count  int not null,
  total_amount    numeric(14,2) not null,
  checksum        text,
  created_by      text references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique(disbursement_id, bank_code)
);
create index if not exists finance_disbursement_bank_files_disb_idx on public.finance_disbursement_bank_files(disbursement_id);
alter table public.finance_disbursement_bank_files enable row level security;
grant select, insert, update, delete on public.finance_disbursement_bank_files to service_role;

-- Branch transit / routing number for ACH detail records (nullable; app-validated).
alter table public.finance_employee_bank_accounts
  add column if not exists transit_number text;

-- After applying, run: NOTIFY pgrst, 'reload schema';
