-- ============================================================================
-- Message Center — Rich Add-On (additive, builds on erp_communications_core +
-- messaging_enhance). NOTHING here drops or rebuilds existing messaging tables.
--
-- Every statement is idempotent (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT
-- EXISTS / CREATE INDEX IF NOT EXISTS) so it is safe to re-run.
--
-- Already present (NOT re-declared here):
--   message_participants.last_read_at        — erp_communications_core
--   message_threads.subject (now nullable)   — 20260628200000_message_thread_subject_optional
--   message_attachments.post_id (nullable)   — 20260625600000_message_attachments_nullable_post
--
-- New capability surface: thread priority/action-required, participant mute +
-- activity, post system-events + replies + delivery state, rich attachment
-- typing/preview/scan, pins, per-thread drafts, per-post receipts, presence.
-- ============================================================================

-- ── 5.1 message_threads: priority + action-required ──────────────────────────

alter table public.message_threads
  add column if not exists action_required boolean not null default false;

alter table public.message_threads
  add column if not exists priority text not null default 'normal';

-- CHECK added separately + guarded so re-runs don't error on an existing constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'message_threads_priority_chk'
  ) then
    alter table public.message_threads
      add constraint message_threads_priority_chk
      check (priority in ('normal','important','urgent','action_required'));
  end if;
end $$;

create index if not exists mt_action_required_idx
  on public.message_threads(action_required)
  where action_required = true;

-- ── 5.2 message_participants: mute + activity tracking ───────────────────────
-- last_read_at already exists. Add the rest.

alter table public.message_participants
  add column if not exists last_opened_at      timestamptz,
  add column if not exists muted_until         timestamptz,
  add column if not exists notifications_muted boolean not null default false;

-- ── 5.3 message_posts: system events, replies, priority, delivery state ──────

alter table public.message_posts
  add column if not exists post_type            text    not null default 'message',
  add column if not exists system_event_type    text,
  add column if not exists system_event_payload jsonb   not null default '{}'::jsonb,
  add column if not exists priority             text    not null default 'normal',
  add column if not exists reply_to_post_id     uuid    references public.message_posts(id),
  add column if not exists delivery_status      text    default 'sent';

-- System-event posts (participant_added, thread_archived, …) carry no body —
-- they render from system_event_payload. Allow NULL body so they can be stored.
alter table public.message_posts
  alter column body drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'message_posts_post_type_chk') then
    alter table public.message_posts add constraint message_posts_post_type_chk
      check (post_type in ('message','system_event'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'message_posts_system_event_type_chk') then
    alter table public.message_posts add constraint message_posts_system_event_type_chk
      check (system_event_type is null or system_event_type in (
        'participant_added','participant_removed','participant_left',
        'participant_role_changed','thread_created','thread_archived',
        'thread_reopened','thread_muted','thread_unmuted'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'message_posts_priority_chk') then
    alter table public.message_posts add constraint message_posts_priority_chk
      check (priority in ('normal','important','urgent','action_required'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'message_posts_delivery_status_chk') then
    alter table public.message_posts add constraint message_posts_delivery_status_chk
      check (delivery_status in ('sending','sent','delivered','read','failed'));
  end if;
end $$;

create index if not exists mp_reply_to_idx
  on public.message_posts(reply_to_post_id)
  where reply_to_post_id is not null;

create index if not exists mp_post_type_idx
  on public.message_posts(thread_id, post_type, created_at);

-- ── 5.4 message_attachments: rich typing, previews, scan state ───────────────

alter table public.message_attachments
  add column if not exists attachment_type text,
  add column if not exists file_extension  text,
  add column if not exists thumbnail_path  text,
  add column if not exists preview_path    text,
  add column if not exists width           integer,
  add column if not exists height          integer,
  add column if not exists page_count      integer,
  add column if not exists upload_status   text not null default 'uploaded',
  add column if not exists scan_status     text default 'pending',
  add column if not exists metadata        jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'message_attachments_type_chk') then
    alter table public.message_attachments add constraint message_attachments_type_chk
      check (attachment_type is null or attachment_type in (
        'image','video','audio','pdf','word','excel','powerpoint',
        'text','archive','document','other'
      ));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'message_attachments_upload_status_chk') then
    alter table public.message_attachments add constraint message_attachments_upload_status_chk
      check (upload_status in ('queued','uploading','uploaded','failed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'message_attachments_scan_status_chk') then
    alter table public.message_attachments add constraint message_attachments_scan_status_chk
      check (scan_status in ('pending','clean','blocked','failed'));
  end if;
end $$;

create index if not exists ma_thread_type_idx
  on public.message_attachments(attachment_type);

-- ── 5.5 message_pins ─────────────────────────────────────────────────────────

create table if not exists public.message_pins (
  id          uuid    primary key default gen_random_uuid(),
  thread_id   uuid    not null references public.message_threads(id) on delete cascade,
  post_id     uuid    references public.message_posts(id) on delete cascade,
  pin_type    text    not null check (pin_type in ('thread','post')),
  visibility  text    not null default 'thread' check (visibility in ('thread','personal')),
  pinned_by   text    not null references public.app_users(id),
  pinned_at   timestamptz not null default now(),
  note        text,
  unpinned_at timestamptz,
  unpinned_by text    references public.app_users(id),
  metadata    jsonb   not null default '{}'::jsonb
);

create index if not exists message_pins_thread_idx
  on public.message_pins(thread_id) where unpinned_at is null;

create index if not exists message_pins_post_idx
  on public.message_pins(post_id) where unpinned_at is null;

alter table public.message_pins enable row level security;

-- ── 5.6 message_thread_drafts ────────────────────────────────────────────────

create table if not exists public.message_thread_drafts (
  thread_id        uuid    not null references public.message_threads(id) on delete cascade,
  user_id          text    not null references public.app_users(id) on delete cascade,
  body             text,
  reply_to_post_id uuid    references public.message_posts(id),
  updated_at       timestamptz not null default now(),
  metadata         jsonb   not null default '{}'::jsonb,
  primary key (thread_id, user_id)
);

alter table public.message_thread_drafts enable row level security;

-- ── 5.7 message_post_receipts ────────────────────────────────────────────────

create table if not exists public.message_post_receipts (
  post_id      uuid    not null references public.message_posts(id) on delete cascade,
  user_id      text    not null references public.app_users(id) on delete cascade,
  delivered_at timestamptz,
  read_at      timestamptz,
  primary key (post_id, user_id)
);

create index if not exists mpr_user_idx
  on public.message_post_receipts(user_id);

alter table public.message_post_receipts enable row level security;

-- ── 5.8 user_presence ────────────────────────────────────────────────────────
-- Read only through authenticated APIs (CLAUDE.md §2: no new direct browser
-- Supabase reads). RLS stays service-role only; the Online-Now strip and
-- typing state are served by /api/communications/messages/online + presence.

create table if not exists public.user_presence (
  user_id         text    primary key references public.app_users(id) on delete cascade,
  status          text    not null default 'offline' check (status in ('online','away','offline')),
  last_seen_at    timestamptz not null default now(),
  active_thread_id uuid,
  metadata        jsonb   not null default '{}'::jsonb
);

create index if not exists user_presence_status_idx
  on public.user_presence(status, last_seen_at desc)
  where status <> 'offline';

alter table public.user_presence enable row level security;

-- ── communication_signals: extend allowed domains for the rich event surface ─
-- The core CHECK allowed: summary, notifications, messages, tickets, workflow,
-- handoffs. The rich Message Center fires fine-grained reasons via emitSignal
-- using domain='messages' (the existing domain) + a reason carried out-of-band,
-- so no domain CHECK change is required. (Documented here intentionally.)
