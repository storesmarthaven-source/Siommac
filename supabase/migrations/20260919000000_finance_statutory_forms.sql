-- ============================================================================
-- Finance Payroll -- statutory forms store + employer TIN (Wave 7 foundation)
-- ============================================================================
-- Generated year-end / period statutory forms (BIR TD4 + TD4 Summary, NIBTT
-- NI184/NI187) are recorded here (one row per generated artifact), mirroring the
-- finance_disbursement_bank_files pattern: generate -> upload to a private
-- bucket -> record a row -> signed-url download. Figures always derive from
-- LOCKED runs + the active statutory version (never hand-edited).
-- Also adds the employee BIR file number (TIN) needed for the TD4 employee block.
-- Single-tenant: NO organization_id. app_users.id is TEXT. ASCII + idempotent.
-- ============================================================================

create table if not exists public.finance_statutory_forms (
  id             uuid primary key default gen_random_uuid(),
  form_type      text not null check (form_type in ('td4','td4_summary','ni184','ni187')),
  tax_year       int,                         -- TD4 / TD4 Summary (calendar tax year)
  period_start   date,                        -- NI184 / NI187 (contribution period)
  period_end     date,
  employee_id    text references public.app_users(id) on delete set null,  -- null for employer-level forms
  run_id         uuid references public.finance_payroll_runs(id) on delete set null,
  scope          text not null default 'employee' check (scope in ('employee','employer')),
  format         text not null default 'pdf',
  file_path      text not null,               -- private 'statutory-forms' bucket key (PDF)
  data_file_path text,                         -- optional CSV / data-file key
  totals         jsonb not null default '{}'::jsonb,
  checksum       text,
  status         text not null default 'generated' check (status in ('generated','superseded')),
  generated_by   text references public.app_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  metadata       jsonb not null default '{}'::jsonb
);

create index if not exists finance_statutory_forms_type_year_idx on public.finance_statutory_forms(form_type, tax_year);
create index if not exists finance_statutory_forms_employee_idx  on public.finance_statutory_forms(employee_id);
create index if not exists finance_statutory_forms_run_idx       on public.finance_statutory_forms(run_id);

alter table public.finance_statutory_forms enable row level security;
grant select, insert, update, delete on public.finance_statutory_forms to service_role;

-- Private bucket for the generated form artifacts (server writes + signed URLs only).
insert into storage.buckets (id, name, public, file_size_limit)
values ('statutory-forms', 'statutory-forms', false, 10485760)  -- 10 MB
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists "statutory_forms_service_all" on storage.objects;
create policy "statutory_forms_service_all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'statutory-forms')
  with check (bucket_id = 'statutory-forms');

-- Employee BIR file number (TIN) for the TD4 employee block.
alter table public.hr_employee_statutory_profiles
  add column if not exists bir_file_number text;

-- After applying, run: NOTIFY pgrst, 'reload schema';
