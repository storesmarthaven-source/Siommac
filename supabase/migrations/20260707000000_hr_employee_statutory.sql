-- ============================================================================
-- HR Employee Master — statutory & payroll-readiness satellite (v36 §7.2)
-- ============================================================================
-- One row per employee holding Trinidad & Tobago statutory data + the HR-owned
-- payroll-readiness snapshot. HR captures/verifies these; Finance/Payroll owns
-- deduction calculation + remittance. Supporting documents (NIS card, TD1) live
-- in hr_employee_documents (doc_type), not inline here.
--
-- app_users.id is TEXT → employee_id is TEXT. Run manually, then NOTIFY pgrst.
-- ============================================================================

create table if not exists public.hr_employee_statutory (
  employee_id              text primary key references public.app_users(id) on delete cascade,

  -- NIS (National Insurance)
  nis_number               text,
  nis_status               text not null default 'pending'
                             check (nis_status in ('pending','registered','exempt','not_applicable')),
  nis_effective_date       date,

  -- BIR / PAYE
  bir_file_number          text,
  paye_applicable          boolean not null default true,
  td1_received             boolean not null default false,
  td1_effective_year       integer,

  -- Health Surcharge
  hs_applicable            boolean not null default true,
  hs_exemption_reason      text,
  hs_effective_date        date,
  hs_verification_required boolean not null default false,

  -- Payroll readiness (HR-owned snapshot; computed from the fields above)
  payroll_ready_status     text not null default 'pending'
                             check (payroll_ready_status in ('pending','ready','blocked')),
  missing_blockers         jsonb not null default '[]'::jsonb,
  finance_handoff_eligible boolean not null default false,

  verified_by              text references public.app_users(id) on delete set null,
  verified_at              timestamptz,
  updated_by               text references public.app_users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz
);

create index if not exists hr_employee_statutory_ready_idx
  on public.hr_employee_statutory(payroll_ready_status);

alter table public.hr_employee_statutory enable row level security;

-- Service-role (backend) bypasses RLS; statutory data is backend-only (sensitive,
-- gated by hr.employees.statutory.* — never a direct browser read).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hr_employee_statutory' and policyname='hr_employee_statutory_admin_read') then
    create policy "hr_employee_statutory_admin_read" on public.hr_employee_statutory for select using (true);
  end if;
end $$;

-- updated_at trigger (reuse the shared set_updated_at function).
drop trigger if exists trg_hr_employee_statutory_updated_at on public.hr_employee_statutory;
create trigger trg_hr_employee_statutory_updated_at
  before update on public.hr_employee_statutory
  for each row execute function public.set_updated_at();

-- After applying:  NOTIFY pgrst, 'reload schema';
