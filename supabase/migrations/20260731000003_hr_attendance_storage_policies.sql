-- ============================================================================
-- HR Attendance & Timekeeping -- private storage bucket + policies
-- ============================================================================
-- Creates the hr-attendance-photos private bucket for punch-evidence photos.
-- Presigned upload/read URLs are generated server-side (routes/hrAttendance.ts).
-- Signed URLs only; the bucket is NOT public.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hr-attendance-photos',
  'hr-attendance-photos',
  false,
  6291456,  -- 6 MB
  array['image/jpeg','image/jpg','image/png','image/webp']
)
on conflict (id) do update
  set public              = excluded.public,
      file_size_limit     = excluded.file_size_limit,
      allowed_mime_types  = excluded.allowed_mime_types;

-- service_role can manage objects (used for presigned URL generation + server reads)
create policy "hr_attendance_photos_service_all"
  on storage.objects for all
  to service_role
  using (bucket_id = 'hr-attendance-photos')
  with check (bucket_id = 'hr-attendance-photos');

-- No public read access -- all access via presigned signed URLs only

-- After applying, run: NOTIFY pgrst, 'reload schema';
