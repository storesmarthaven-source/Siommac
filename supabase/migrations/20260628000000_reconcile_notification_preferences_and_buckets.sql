-- ─────────────────────────────────────────────────────────────────────────────
-- Reconcile drift surfaced by the E2E harness (scripts/e2e).
--
-- 1. notification_preferences: the live table had a legacy `type` column, so the
--    phase-1 migration's `create table if not exists` no-op'd and never created
--    the canonical `event_type` column the code + frontend use. It is a pure
--    preferences cache (no business data), so the safe fix is drop + recreate to
--    the canonical schema.
--
-- 2. message-attachments storage bucket: was missing, so presigned upload URLs
--    failed ("The related resource does not exist"). Created here for fresh DBs
--    (idempotent; already created via the storage API on the dev project).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. notification_preferences → canonical (event_type) ──────────────────────
drop table if exists public.notification_preferences cascade;

create table public.notification_preferences (
  user_id    text not null references public.app_users(id) on delete cascade,
  event_type text not null,
  in_app     boolean not null default true,
  email      boolean not null default false,
  whatsapp   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (user_id, event_type)
);

alter table public.notification_preferences enable row level security;
drop policy if exists "authenticated rw notification_preferences" on public.notification_preferences;
create policy "authenticated rw notification_preferences" on public.notification_preferences
  for all using (auth.role() = 'authenticated');

-- ── 2. message-attachments private bucket ─────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;
