-- HSE attachments: storage bucket + RLS policies on the platform attachments table.
-- Files are uploaded directly to Storage via a presigned URL; the attachments
-- row records the metadata (entity_type, entity_id, file_name, storage_path).

-- Private bucket for HSE documents/evidence.
insert into storage.buckets (id, name, public)
values ('hse-attachments', 'hse-attachments', false)
on conflict (id) do nothing;

-- The attachments table already exists (RLS enabled, no policies). Add them.
-- Reads/writes flow through the service-role backend, but authenticated access
-- is allowed for any future direct reads.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'attachments'
      and policyname = 'authenticated rw attachments'
  ) then
    create policy "authenticated rw attachments" on public.attachments
      for all using (auth.role() = 'authenticated');
  end if;
end $$;
