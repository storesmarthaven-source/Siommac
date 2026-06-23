-- ============================================================================
-- ERP Communications Core
-- notifications (extended) · notification_deliveries
-- message_threads · message_participants · message_posts
-- tickets · ticket_comments · ticket_watchers · ticket_events
-- attachments · user_realtime_channels · communication_signals
-- ============================================================================

-- ── Extend notifications table ────────────────────────────────────────────────
-- The existing table has: id, user_id (text), type, title, body, is_read,
-- link, created_at. We add the ERP backbone columns.

alter table public.notifications
  add column if not exists event_id       uuid    references public.app_events(id) on delete set null,
  add column if not exists module         text,
  add column if not exists severity       text    not null default 'info',
  add column if not exists source_type    text,
  add column if not exists source_id      text,
  add column if not exists action_route   text,
  add column if not exists metadata       jsonb   not null default '{}'::jsonb,
  add column if not exists read_at        timestamptz,
  add column if not exists archived_at    timestamptz,
  add column if not exists expires_at     timestamptz,
  add column if not exists dedupe_key     text;

create unique index if not exists notifications_dedupe_uidx
  on public.notifications(user_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, is_read, created_at desc);

-- ── notification_deliveries ───────────────────────────────────────────────────

create table if not exists public.notification_deliveries (
  id                  uuid    primary key default gen_random_uuid(),
  notification_id     text    not null references public.notifications(id) on delete cascade,
  channel             text    not null check (channel in ('in_app','email','whatsapp')),
  status              text    not null default 'pending'
                              check (status in ('pending','sent','failed','skipped')),
  provider_message_id text,
  error               text,
  attempted_at        timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists nd_notification_idx
  on public.notification_deliveries(notification_id);

alter table public.notification_deliveries enable row level security;

-- ── message_threads ───────────────────────────────────────────────────────────

create table if not exists public.message_threads (
  id                  uuid    primary key default gen_random_uuid(),
  thread_type         text    not null default 'direct'
                              check (thread_type in ('direct','group','record','system')),
  subject             text    not null,
  source_module       text,
  source_entity_type  text,
  source_entity_id    text,
  created_by          text    references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  archived_at         timestamptz,
  metadata            jsonb   not null default '{}'::jsonb
);

create index if not exists mt_source_idx
  on public.message_threads(source_module, source_entity_type, source_entity_id)
  where source_entity_id is not null;

create index if not exists mt_created_at_idx
  on public.message_threads(created_at desc);

alter table public.message_threads enable row level security;

-- ── message_participants ──────────────────────────────────────────────────────

create table if not exists public.message_participants (
  thread_id   uuid  not null references public.message_threads(id) on delete cascade,
  user_id     text  not null references public.app_users(id) on delete cascade,
  role        text  not null default 'participant'
                    check (role in ('owner','participant','watcher')),
  last_read_at  timestamptz,
  archived_at   timestamptz,
  primary key (thread_id, user_id)
);

create index if not exists mp_user_idx
  on public.message_participants(user_id, archived_at);

alter table public.message_participants enable row level security;

-- ── message_posts ─────────────────────────────────────────────────────────────

create table if not exists public.message_posts (
  id              uuid    primary key default gen_random_uuid(),
  thread_id       uuid    not null references public.message_threads(id) on delete cascade,
  author_user_id  text    references public.app_users(id) on delete set null,
  body            text    not null,
  is_system       boolean not null default false,
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists mp_thread_idx
  on public.message_posts(thread_id, created_at desc);

alter table public.message_posts enable row level security;

-- ── tickets ───────────────────────────────────────────────────────────────────

create table if not exists public.tickets (
  id                  uuid    primary key default gen_random_uuid(),
  ticket_number       text    not null unique,
  source_module       text,
  source_entity_type  text,
  source_entity_id    text,
  requester_user_id   text    references public.app_users(id) on delete set null,
  assignee_user_id    text    references public.app_users(id) on delete set null,
  category            text    not null default 'general',
  priority            text    not null default 'medium'
                              check (priority in ('low','medium','high','critical')),
  status              text    not null default 'open'
                              check (status in (
                                'open','assigned','in_progress','waiting_requester',
                                'resolved','closed','reopened','cancelled'
                              )),
  sla_due_at          timestamptz,
  first_response_at   timestamptz,
  resolved_at         timestamptz,
  closed_at           timestamptz,
  resolution_code     text,
  subject             text    not null,
  description         text    not null,
  metadata            jsonb   not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create index if not exists tickets_status_sla_idx
  on public.tickets(status, sla_due_at);

create index if not exists tickets_requester_idx
  on public.tickets(requester_user_id, created_at desc);

create index if not exists tickets_assignee_idx
  on public.tickets(assignee_user_id, status);

alter table public.tickets enable row level security;

-- ── ticket_comments ───────────────────────────────────────────────────────────

create table if not exists public.ticket_comments (
  id              uuid    primary key default gen_random_uuid(),
  ticket_id       uuid    not null references public.tickets(id) on delete cascade,
  author_user_id  text    references public.app_users(id) on delete set null,
  body            text    not null,
  is_internal     boolean not null default false,
  is_system       boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists tc_ticket_idx
  on public.ticket_comments(ticket_id, created_at);

alter table public.ticket_comments enable row level security;

-- ── ticket_watchers ───────────────────────────────────────────────────────────

create table if not exists public.ticket_watchers (
  ticket_id   uuid  not null references public.tickets(id) on delete cascade,
  user_id     text  not null references public.app_users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (ticket_id, user_id)
);

alter table public.ticket_watchers enable row level security;

-- ── ticket_events ─────────────────────────────────────────────────────────────

create table if not exists public.ticket_events (
  id              uuid    primary key default gen_random_uuid(),
  ticket_id       uuid    not null references public.tickets(id) on delete cascade,
  event_type      text    not null,
  actor_user_id   text    references public.app_users(id) on delete set null,
  payload         jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists te_ticket_idx
  on public.ticket_events(ticket_id, created_at);

alter table public.ticket_events enable row level security;

-- ── attachments ───────────────────────────────────────────────────────────────

create table if not exists public.attachments (
  id            uuid    primary key default gen_random_uuid(),
  entity_type   text    not null,
  entity_id     text    not null,
  file_name     text    not null,
  mime_type     text    not null,
  storage_path  text    not null,
  uploaded_by   text    references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists attachments_entity_idx
  on public.attachments(entity_type, entity_id);

alter table public.attachments enable row level security;

-- ── user_realtime_channels ────────────────────────────────────────────────────
-- Each user gets a random channel_key per session. Supabase Realtime filter:
--   filter: "channel_key=eq.<key>"
-- The key has no business data — loss is a non-event (regenerate on next poll).

create table if not exists public.user_realtime_channels (
  user_id     text        primary key references public.app_users(id) on delete cascade,
  channel_key uuid        not null default gen_random_uuid(),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

alter table public.user_realtime_channels enable row level security;

-- ── communication_signals ─────────────────────────────────────────────────────
-- Lightweight Realtime trigger. Client subscribes filtered by channel_key
-- and calls /api/communications/summary when any signal arrives.
-- Rows contain NO business payload — safe for Realtime exposure.

create table if not exists public.communication_signals (
  id          uuid    primary key default gen_random_uuid(),
  channel_key uuid    not null,
  domain      text    not null
              check (domain in ('summary','notifications','messages','tickets','workflow','handoffs')),
  created_at  timestamptz not null default now()
);

create index if not exists cs_channel_key_idx
  on public.communication_signals(channel_key, created_at desc);

-- Signals older than 1 hour are useless — auto-expire via pg_cron (manual purge for now).
-- No FK to user_realtime_channels: signal rows outlive channel rotation.

alter table public.communication_signals enable row level security;

-- Allow Realtime: communication_signals is safe to expose (no PII, no business data).
-- Grant anon SELECT scoped to channel_key via RLS when Realtime policies are configured.
-- For now, service role handles inserts; RLS blocks direct reads by browsers.
