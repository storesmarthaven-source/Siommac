-- ============================================================================
-- Payroll Reports Center (F-12, Phase A) — 6/6: private artifacts bucket
-- ============================================================================
-- Protected Storage for generated report files. Private: all access is
-- server-side (service_role) + short-lived signed URLs (120s, issued by the
-- download route). Mirrors 20260808000004_finance_disbursements_bucket.sql.
-- The generation worker uploads to attempt-specific immutable paths
--   payroll-report-artifacts/<job_id>/<claim_token>/<sha256>.<ext>
-- Contract: §2 / §6A.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('payroll-report-artifacts', 'payroll-report-artifacts', false, 52428800)  -- 50 MB
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- service_role manages objects (server upload/read/remove); no public/anon read.
drop policy if exists "payroll_report_artifacts_service_all" on storage.objects;
create policy "payroll_report_artifacts_service_all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'payroll-report-artifacts')
  with check (bucket_id = 'payroll-report-artifacts');

-- No public read access — download is via 120-second signed URLs only.
-- After applying, run: NOTIFY pgrst, 'reload schema';
