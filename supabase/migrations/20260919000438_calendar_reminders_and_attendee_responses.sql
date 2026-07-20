-- ============================================================================
-- Calendar reminders, overdue delivery, and attendee responses
--
-- Depends on:
--   20260917000310_calendar_module.sql
--   app_events, audit_logs, notifications, notification_preferences,
--   notification_mutes, and notification_deliveries
--
-- All browser access remains mediated by authenticated Netlify APIs. Tables
-- have RLS enabled with no client policies; transaction functions are
-- security-invoker and executable only by service_role.
-- ============================================================================

begin;

-- Attendee responses retain when the current response was recorded.
alter table public.calendar_activity_attendees
  add column if not exists responded_at timestamptz;

-- Per-user reminder offsets. A user may independently configure an entry they
-- can read; the API performs that authorization before calling the RPC.
create table if not exists public.calendar_reminders (
  id                 uuid primary key default gen_random_uuid(),
  calendar_entry_id  uuid not null references public.calendar_entries(id) on delete cascade,
  user_id            text not null references public.app_users(id) on delete cascade,
  offset_minutes     integer not null
                       check (offset_minutes between 0 and 525600),
  enabled            boolean not null default true,
  created_by         text not null references public.app_users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint uq_calendar_reminder_offset
    unique (calendar_entry_id, user_id, offset_minutes)
);

create index if not exists calendar_reminders_user_idx
  on public.calendar_reminders (user_id, enabled);
create index if not exists calendar_reminders_entry_idx
  on public.calendar_reminders (calendar_entry_id);

drop trigger if exists trg_calendar_reminders_updated_at on public.calendar_reminders;
create trigger trg_calendar_reminders_updated_at
  before update on public.calendar_reminders
  for each row execute function public.set_calendar_updated_at();

-- Durable claim ledger. The unique dedupe key makes service retries and
-- overlapping scheduled invocations safe.
create table if not exists public.calendar_reminder_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  calendar_entry_id  uuid not null references public.calendar_entries(id) on delete cascade,
  reminder_id        uuid references public.calendar_reminders(id) on delete set null,
  user_id            text not null references public.app_users(id) on delete cascade,
  delivery_kind      text not null check (delivery_kind in ('reminder', 'overdue')),
  occurrence_key     text not null,
  scheduled_for      timestamptz not null,
  delivered_at       timestamptz not null default now(),
  event_type         text not null,
  app_event_id       uuid references public.app_events(id) on delete set null,
  notification_id    text references public.notifications(id) on delete set null,
  dedupe_key         text not null unique,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists calendar_reminder_deliveries_entry_idx
  on public.calendar_reminder_deliveries (calendar_entry_id, delivery_kind);
create index if not exists calendar_reminder_deliveries_user_idx
  on public.calendar_reminder_deliveries (user_id, delivered_at desc);

alter table public.calendar_reminders enable row level security;
alter table public.calendar_reminder_deliveries enable row level security;

revoke all on table public.calendar_reminders from anon, authenticated;
revoke all on table public.calendar_reminder_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.calendar_reminders to service_role;
grant select, insert, update, delete on table public.calendar_reminder_deliveries to service_role;

-- Atomically replace one user's offsets. Locking the calendar entry serializes
-- concurrent settings writes; an identical retry is a true no-op.
create or replace function public.calendar_replace_reminders_tx(
  p_calendar_entry_id uuid,
  p_user_id           text,
  p_actor_user_id     text,
  p_offsets           integer[]
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_entry          public.calendar_entries%rowtype;
  v_offsets        integer[];
  v_previous       integer[];
  v_event_id       uuid;
  v_now            timestamptz := now();
begin
  if p_calendar_entry_id is null
     or p_user_id is null or btrim(p_user_id) = ''
     or p_actor_user_id is null or btrim(p_actor_user_id) = '' then
    raise exception 'calendar reminders: entry, user, and actor are required'
      using errcode = 'CA422';
  end if;
  if p_user_id is distinct from p_actor_user_id then
    raise exception 'calendar reminders: users may only replace their own reminders'
      using errcode = 'CA403';
  end if;

  select * into v_entry
  from public.calendar_entries
  where id = p_calendar_entry_id
  for update;
  if not found then
    raise exception 'calendar reminders: entry not found' using errcode = 'CA404';
  end if;
  if v_entry.status in ('done', 'cancelled') then
    raise exception 'calendar reminders: completed or cancelled tasks cannot be changed'
      using errcode = 'CA422';
  end if;

  select coalesce(array_agg(distinct value order by value), '{}'::integer[])
  into v_offsets
  from unnest(coalesce(p_offsets, '{}'::integer[])) as value;

  if cardinality(v_offsets) > 5
     or exists (
       select 1 from unnest(v_offsets) as value
       where value < 0 or value > 525600
     ) then
    raise exception 'calendar reminders: invalid offsets' using errcode = 'CA422';
  end if;

  select coalesce(array_agg(offset_minutes order by offset_minutes), '{}'::integer[])
  into v_previous
  from public.calendar_reminders
  where calendar_entry_id = p_calendar_entry_id
    and user_id = p_user_id
    and enabled = true;

  if v_previous = v_offsets then
    return jsonb_build_object('changed', false, 'offsetMinutes', to_jsonb(v_offsets));
  end if;

  delete from public.calendar_reminders
  where calendar_entry_id = p_calendar_entry_id and user_id = p_user_id;

  insert into public.calendar_reminders
    (calendar_entry_id, user_id, offset_minutes, enabled, created_by)
  select p_calendar_entry_id, p_user_id, value, true, p_actor_user_id
  from unnest(v_offsets) as value;

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload)
  values
    ('calendar.reminders.updated', 'calendar', v_entry.type,
     p_calendar_entry_id::text, p_actor_user_id, 'info',
     jsonb_build_object(
       'previousOffsetMinutes', to_jsonb(v_previous),
       'offsetMinutes', to_jsonb(v_offsets)
     ))
  returning id into v_event_id;

  insert into public.audit_logs
    (action, table_name, record_id, user_id, changes, created_at)
  values
    ('calendar.reminders.updated', 'calendar_entry', p_calendar_entry_id::text,
     p_actor_user_id,
     jsonb_build_object(
       'previousOffsetMinutes', to_jsonb(v_previous),
       'offsetMinutes', to_jsonb(v_offsets),
       'eventId', v_event_id
     ),
     v_now);

  return jsonb_build_object(
    'changed', true,
    'eventId', v_event_id,
    'offsetMinutes', to_jsonb(v_offsets)
  );
end;
$fn$;

-- Record an attendee response, its event, and its audit row in one transaction.
-- Repeating the same response is a no-op; a later different response is a new
-- auditable state transition.
create or replace function public.calendar_attendee_respond_tx(
  p_calendar_entry_id uuid,
  p_user_id           text,
  p_response_status   text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_attendee        public.calendar_activity_attendees%rowtype;
  v_entry           public.calendar_entries%rowtype;
  v_event_id        uuid;
  v_dedupe_key      text;
  v_now             timestamptz := now();
begin
  if p_calendar_entry_id is null or p_user_id is null or btrim(p_user_id) = '' then
    raise exception 'calendar response: entry and user are required' using errcode = 'CA422';
  end if;
  if p_response_status not in ('accepted', 'declined', 'tentative') then
    raise exception 'calendar response: invalid response status' using errcode = 'CA422';
  end if;

  select * into v_attendee
  from public.calendar_activity_attendees
  where calendar_entry_id = p_calendar_entry_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'calendar response: invitation not found' using errcode = 'CA404';
  end if;

  select * into v_entry
  from public.calendar_entries
  where id = p_calendar_entry_id
  for share;
  if not found or v_entry.type <> 'activity' then
    raise exception 'calendar response: activity not found' using errcode = 'CA404';
  end if;

  if v_attendee.response_status = p_response_status
     and v_attendee.responded_at is not null then
    return jsonb_build_object(
      'changed', false,
      'ownerUserId', v_entry.owner_user_id
    );
  end if;

  update public.calendar_activity_attendees
  set response_status = p_response_status, responded_at = v_now
  where id = v_attendee.id;

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload)
  values
    ('calendar.activity.response_changed', 'calendar', 'activity',
     p_calendar_entry_id::text, p_user_id, 'info',
     jsonb_build_object(
       'attendeeUserId', p_user_id,
       'previousResponseStatus', v_attendee.response_status,
       'responseStatus', p_response_status,
       'respondedAt', v_now
     ))
  returning id into v_event_id;

  v_dedupe_key :=
    'calendar.activity.response_changed:' || p_calendar_entry_id::text || ':' ||
    p_user_id || ':' || v_event_id::text;

  insert into public.audit_logs
    (action, table_name, record_id, user_id, changes, created_at)
  values
    ('calendar.activity.response_changed', 'calendar_entry',
     p_calendar_entry_id::text, p_user_id,
     jsonb_build_object(
       'previousResponseStatus', v_attendee.response_status,
       'responseStatus', p_response_status,
       'respondedAt', v_now,
       'eventId', v_event_id
     ),
     v_now);

  return jsonb_build_object(
    'changed', true,
    'eventId', v_event_id,
    'ownerUserId', v_entry.owner_user_id,
    'dedupeKey', v_dedupe_key
  );
end;
$fn$;

-- Claim and record one scheduled reminder/overdue delivery. The claim ledger,
-- app_event, audit, and optional in-app notification commit atomically. External
-- email/WhatsApp delivery remains post-commit in the backend worker.
create or replace function public.calendar_record_delivery_tx(
  p_calendar_entry_id uuid,
  p_reminder_id       uuid,
  p_user_id           text,
  p_delivery_kind     text,
  p_occurrence_key    text,
  p_scheduled_for     timestamptz,
  p_event_type        text,
  p_title             text,
  p_body              text,
  p_due_at            timestamptz,
  p_severity          text,
  p_metadata          jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_delivery_id     uuid;
  v_event_id        uuid;
  v_notification_id text;
  v_dedupe_key      text;
  v_pref            record;
  v_in_app          boolean := true;
  v_email           boolean := false;
  v_whatsapp        boolean := false;
  v_muted           boolean := false;
  v_now             timestamptz := now();
begin
  if p_calendar_entry_id is null
     or p_user_id is null or btrim(p_user_id) = ''
     or p_delivery_kind not in ('reminder', 'overdue')
     or p_occurrence_key is null or btrim(p_occurrence_key) = ''
     or p_scheduled_for is null
     or p_event_type is null or btrim(p_event_type) = ''
     or p_title is null or btrim(p_title) = '' then
    raise exception 'calendar delivery: invalid delivery claim' using errcode = 'CA422';
  end if;
  if p_severity not in ('info', 'success', 'warning', 'high', 'critical') then
    raise exception 'calendar delivery: invalid severity' using errcode = 'CA422';
  end if;
  if not exists (
    select 1 from public.calendar_entries where id = p_calendar_entry_id
  ) then
    raise exception 'calendar delivery: entry not found' using errcode = 'CA404';
  end if;
  if p_reminder_id is not null and not exists (
    select 1 from public.calendar_reminders
    where id = p_reminder_id
      and calendar_entry_id = p_calendar_entry_id
      and user_id = p_user_id
      and enabled = true
  ) then
    raise exception 'calendar delivery: reminder not found' using errcode = 'CA404';
  end if;

  v_dedupe_key :=
    'calendar.delivery:' || p_delivery_kind || ':' ||
    p_calendar_entry_id::text || ':' || p_user_id || ':' ||
    p_occurrence_key || ':' || p_scheduled_for::text;

  insert into public.calendar_reminder_deliveries
    (calendar_entry_id, reminder_id, user_id, delivery_kind, occurrence_key,
     scheduled_for, delivered_at, event_type, dedupe_key, metadata)
  values
    (p_calendar_entry_id, p_reminder_id, p_user_id, p_delivery_kind,
     p_occurrence_key, p_scheduled_for, v_now, p_event_type, v_dedupe_key,
     coalesce(p_metadata, '{}'::jsonb))
  on conflict (dedupe_key) do nothing
  returning id into v_delivery_id;

  if v_delivery_id is null then
    return jsonb_build_object(
      'claimed', false,
      'dedupeKey', v_dedupe_key
    );
  end if;

  select in_app, email, whatsapp into v_pref
  from public.notification_preferences
  where user_id = p_user_id and event_type = p_event_type;
  if not found then
    select in_app, email, whatsapp into v_pref
    from public.notification_preferences
    where user_id = p_user_id and event_type = '*';
  end if;
  if found then
    v_in_app := v_pref.in_app;
    v_email := v_pref.email;
    v_whatsapp := v_pref.whatsapp;
  end if;

  select exists (
    select 1
    from public.notification_mutes
    where user_id = p_user_id
      and scope in ('all', 'module:calendar', 'event:' || p_event_type)
      and (muted_until is null or muted_until > v_now)
  ) into v_muted;
  if v_muted then
    v_in_app := false;
    v_email := false;
    v_whatsapp := false;
  end if;

  insert into public.app_events
    (event_type, source_module, source_entity_type, source_entity_id,
     actor_user_id, severity, payload, dedupe_key)
  values
    (p_event_type, 'calendar',
     case when p_delivery_kind = 'overdue' then 'task' else 'calendar_entry' end,
     p_calendar_entry_id::text, null, p_severity,
     coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
       'deliveryKind', p_delivery_kind,
       'occurrenceKey', p_occurrence_key,
       'scheduledFor', p_scheduled_for,
       'dueAt', p_due_at,
       'recipientUserId', p_user_id
     ),
     v_dedupe_key)
  returning id into v_event_id;

  if v_in_app then
    insert into public.notifications
      (user_id, type, title, body, is_read, link, event_id, module, severity,
       source_type, source_id, action_route, metadata, dedupe_key,
       action_required, action_status, due_at, created_at)
    values
      (p_user_id, p_event_type, p_title, coalesce(p_body, ''), false,
       's-calendar', v_event_id, 'calendar', p_severity,
       'calendar_entry', p_calendar_entry_id::text, 's-calendar',
       coalesce(p_metadata, '{}'::jsonb), v_dedupe_key,
       p_delivery_kind = 'overdue',
       case when p_delivery_kind = 'overdue' then 'pending' else 'none' end,
       p_due_at, v_now)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
    returning id::text into v_notification_id;

    if v_notification_id is not null then
      insert into public.notification_deliveries
        (notification_id, channel, status, attempted_at)
      values
        (v_notification_id, 'in_app', 'sent', v_now);
    end if;
  end if;

  update public.calendar_reminder_deliveries
  set app_event_id = v_event_id,
      notification_id = v_notification_id
  where id = v_delivery_id;

  insert into public.audit_logs
    (action, table_name, record_id, user_id, changes, created_at)
  values
    (p_event_type, 'calendar_entry', p_calendar_entry_id::text, null,
     jsonb_build_object(
       'deliveryId', v_delivery_id,
       'deliveryKind', p_delivery_kind,
       'recipientUserId', p_user_id,
       'occurrenceKey', p_occurrence_key,
       'scheduledFor', p_scheduled_for,
       'notificationId', v_notification_id,
       'eventId', v_event_id
     ),
     v_now);

  return jsonb_build_object(
    'claimed', true,
    'notificationId', v_notification_id,
    'email', v_email,
    'whatsapp', v_whatsapp,
    'dedupeKey', v_dedupe_key,
    'eventId', v_event_id
  );
end;
$fn$;

revoke all on function public.calendar_replace_reminders_tx(
  uuid, text, text, integer[]
) from public, anon, authenticated;
grant execute on function public.calendar_replace_reminders_tx(
  uuid, text, text, integer[]
) to service_role;

revoke all on function public.calendar_attendee_respond_tx(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.calendar_attendee_respond_tx(
  uuid, text, text
) to service_role;

revoke all on function public.calendar_record_delivery_tx(
  uuid, uuid, text, text, text, timestamptz, text, text, text,
  timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.calendar_record_delivery_tx(
  uuid, uuid, text, text, text, timestamptz, text, text, text,
  timestamptz, text, jsonb
) to service_role;

notify pgrst, 'reload schema';

commit;
