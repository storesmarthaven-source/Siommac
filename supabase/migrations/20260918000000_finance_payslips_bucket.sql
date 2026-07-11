-- ============================================================================
-- Finance Payroll — Payslip PDF storage (Wave 1)
-- Private `payslips` bucket for rendered payslip PDFs + a render-timestamp column.
-- Mirrors 20260808000004_finance_disbursements_bucket.sql (server/service_role +
-- signed-URL access only — payslips are sensitive personal data).
-- signedPayslipUrl() already reads from this bucket; without it, download fails.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('payslips', 'payslips', false, 5242880)  -- 5 MB per payslip
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- service_role manages objects (server render/upload + signed-URL reads). No public read.
drop policy if exists "payslips_service_all" on storage.objects;
create policy "payslips_service_all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'payslips')
  with check (bucket_id = 'payslips');

-- Render tracking on the (otherwise immutable) payslip row. file_path is set on render;
-- pdf_rendered_at records when the PDF artifact was produced.
alter table public.finance_payslips
  add column if not exists pdf_rendered_at timestamptz,
  add column if not exists pdf_checksum    text;

-- After applying, run: NOTIFY pgrst, 'reload schema';
