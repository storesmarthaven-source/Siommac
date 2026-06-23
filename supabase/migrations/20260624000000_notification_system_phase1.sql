-- Notification System — Phase 1: schema foundations.
-- (See docs/notification-architecture.md.)
--   • Add action-tracking columns to notifications.
--   • notification_preferences + notification_mutes tables.
--   • Seed communications.admin (broadcast) permission.
--
-- NOTE: notifications.event_id is already uuid → app_events(id) (added by
-- 20260621100001_erp_communications_core.sql against the canonical uuid
-- app_events from 20260621100000_erp_backbone_core.sql). An earlier draft of
-- this file converted event_id to text to match a stale text-id app_events; that
-- was wrong for the canonical schema and has been removed.

-- ── 2. Action-aware columns on notifications ──────────────────────────────────
-- Read/unread = did the user see it. action_status = was the work actually done.
alter table public.notifications
  add column if not exists action_required boolean not null default false,
  add column if not exists action_status   text    not null default 'none'
      check (action_status in ('none','pending','completed','dismissed','expired','escalated')),
  add column if not exists due_at        timestamptz,
  add column if not exists escalated_at  timestamptz,
  add column if not exists completed_at  timestamptz,
  add column if not exists completed_by  text references public.app_users(id);

create index if not exists notifications_action_idx
  on public.notifications(user_id, action_required, action_status)
  where action_required;

-- ── 3. notification_preferences ───────────────────────────────────────────────
-- event_type = a specific event ('ptw.permit.expired') or '*' for the user default.
create table if not exists public.notification_preferences (
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
create policy "authenticated rw notification_preferences" on public.notification_preferences
  for all using (auth.role() = 'authenticated');

-- ── 4. notification_mutes (DND / snooze) ──────────────────────────────────────
-- scope: 'all' | 'module:<m>' | 'event:<type>'.  muted_until null = indefinite.
create table if not exists public.notification_mutes (
  user_id     text not null references public.app_users(id) on delete cascade,
  scope       text not null,
  muted_until timestamptz,
  created_at  timestamptz not null default now(),
  primary key (user_id, scope)
);
alter table public.notification_mutes enable row level security;
create policy "authenticated rw notification_mutes" on public.notification_mutes
  for all using (auth.role() = 'authenticated');

-- ── 5. communications.admin permission (admin broadcast) ──────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'communications.admin'),
  ('admin',      'communications.admin')
on conflict do nothing;
