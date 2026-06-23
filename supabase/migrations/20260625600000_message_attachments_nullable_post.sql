-- Migration: make message_attachments.post_id nullable so an attachment can be
-- pre-uploaded before its post is created, then linked on send.
--
-- Re-runnable (IF EXISTS / column already nullable guards).

-- 1. Drop the NOT NULL constraint
alter table public.message_attachments
  alter column post_id drop not null;

-- 2. Ensure index exists (idempotent)
create index if not exists ma_post_idx
  on public.message_attachments(post_id);

-- 3. Add uploaded_by index for pruning orphans (attachments with post_id IS NULL)
create index if not exists ma_orphan_idx
  on public.message_attachments(uploaded_by, created_at)
  where post_id is null;
