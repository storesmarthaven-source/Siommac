-- ============================================================================
-- HR Employee Documents -- storage bucket size limit (server-side enforcement)
-- ============================================================================
-- The `hr-employee-documents` private bucket backs employee document uploads
-- (presigned upload/read via routes/hr.ts, HR_DOC_BUCKET). The 15 MB cap was
-- previously enforced ONLY as a client-side warning; a direct upload against the
-- presigned URL could exceed it. This sets the limit at the storage layer, which
-- Supabase Storage enforces on the object PUT regardless of the client-reported
-- fileSize on commit. Root-cause fix -- no reliance on client-supplied size.
--
-- Mirrors the pattern in 20260731000003_hr_attendance_storage_policies.sql.
-- allowed_mime_types is left NULL (unrestricted) to avoid rejecting document
-- types that already upload successfully; only the size cap is added here.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'hr-employee-documents',
  'hr-employee-documents',
  false,
  15728640  -- 15 MB (15 * 1024 * 1024) -- matches the client-side limit
)
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- service_role manages objects (presigned URL generation + server reads).
-- Idempotent: drop-then-create so re-applying is safe even if a policy pre-exists.
drop policy if exists "hr_employee_documents_service_all" on storage.objects;
create policy "hr_employee_documents_service_all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'hr-employee-documents')
  with check (bucket_id = 'hr-employee-documents');

-- No public read access -- all access via presigned signed URLs only.
