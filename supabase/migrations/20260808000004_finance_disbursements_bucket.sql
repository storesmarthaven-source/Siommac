-- ============================================================================
-- Finance Bank Disbursement -- private storage bucket for generated bank files
-- ============================================================================
-- F2's generateBankFile() uploads the ACH/EFT bank file (CSV) to the
-- `disbursements` bucket via presigned/server writes. Private bucket; access is
-- server-side (service_role) + signed URLs only. Without this the generate-file
-- action (and its E2E) cannot run. Mirrors 20260804000000_hr_documents_storage_limit.sql
-- and 20260731000003_hr_attendance_storage_policies.sql.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('disbursements', 'disbursements', false, 10485760)  -- 10 MB
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- service_role manages objects (presigned generation + server reads/writes).
drop policy if exists "disbursements_service_all" on storage.objects;
create policy "disbursements_service_all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'disbursements')
  with check (bucket_id = 'disbursements');

-- No public read access -- all access via presigned signed URLs only.
-- After applying, run: NOTIFY pgrst, 'reload schema';
