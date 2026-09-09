-- ============================================================================
-- Calendar entry taxonomy — user-facing kinds + managed category catalogue
--
-- `type` remains the behavioural storage family (`activity` or `task`).
-- `entry_kind` records the honest user-facing workflow inside that family:
-- event/meeting/reminder are activities; task is the native task workflow.
-- The legacy `deadline` kind remains readable for existing records and module
-- projections. New native due dates use `deadline_at` on an event or task so
-- the deadline supplements the scheduled span instead of replacing it.
-- Categories describe subject matter and never substitute for item behaviour.
-- ============================================================================

begin;

create table if not exists public.calendar_categories (
  id           uuid primary key default gen_random_uuid(),
  category_key text not null unique,
  name         text not null,
  icon_name    text not null,
  scope        text not null default 'system' check (scope in ('system', 'organisation')),
  sort_order   integer not null default 100,
  is_active    boolean not null default true,
  created_by   text references public.app_users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint chk_calendar_category_key check (category_key ~ '^[a-z][a-z0-9_]{1,47}$'),
  constraint chk_calendar_category_name check (char_length(btrim(name)) between 1 and 80)
);

drop trigger if exists trg_calendar_categories_updated_at on public.calendar_categories;
create trigger trg_calendar_categories_updated_at
  before update on public.calendar_categories
  for each row execute function public.set_calendar_updated_at();

insert into public.calendar_categories (category_key, name, icon_name, scope, sort_order) values
  ('general',          'General',             'CalendarDays', 'system',  10),
  ('operations',       'Operations',          'Briefcase',    'system',  20),
  ('field_operations', 'Field Operations',    'MapPin',       'system',  30),
  ('safety_hse',       'Safety / HSE',        'ShieldCheck',  'system',  40),
  ('toolbox_talk',     'Toolbox Talk',        'HardHat',      'system',  50),
  ('training',         'Training',            'GraduationCap','system',  60),
  ('maintenance',      'Maintenance',         'Wrench',       'system',  70),
  ('project_milestone','Project / Milestone', 'Flag',         'system',  80),
  ('compliance',       'Compliance',          'BadgeCheck',   'system',  90),
  ('hr_people',        'HR / People',          'UsersRound',   'system', 100),
  ('finance_payroll',  'Finance / Payroll',   'WalletCards',  'system', 110),
  ('company_event',    'Company Event',       'PartyPopper',  'system', 120),
  ('leave_absence',    'Leave / Absence',     'Palmtree',     'system', 130)
on conflict (category_key) do update set
  name = excluded.name,
  icon_name = excluded.icon_name,
  scope = excluded.scope,
  sort_order = excluded.sort_order;

alter table public.calendar_entries
  add column if not exists entry_kind text,
  add column if not exists category_id uuid references public.calendar_categories(id),
  add column if not exists availability text,
  add column if not exists deadline_at timestamptz;

update public.calendar_entries
set entry_kind = case
  when source_module = 'meetings' then 'meeting'
  when type = 'task' then 'task'
  else 'event'
end
where entry_kind is null;

update public.calendar_entries
set category_id = (select id from public.calendar_categories where category_key = 'general')
where category_id is null;

update public.calendar_entries
set availability = case when type = 'activity' then 'busy' else null end
where availability is null and type = 'activity';

alter table public.calendar_entries
  alter column entry_kind set not null,
  alter column category_id set not null;

create or replace function public.set_calendar_entry_kind()
returns trigger
language plpgsql
as $$
begin
  if new.entry_kind is null then
    new.entry_kind := case
      when new.source_module = 'meetings' then 'meeting'
      when new.type = 'task' then 'task'
      else 'event'
    end;
  end if;
  if new.category_id is null then
    select id into new.category_id from public.calendar_categories where category_key = 'general';
  end if;
  if new.type = 'activity' and new.availability is null then
    new.availability := 'busy';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_calendar_entries_kind on public.calendar_entries;
create trigger trg_calendar_entries_kind
  before insert on public.calendar_entries
  for each row execute function public.set_calendar_entry_kind();

alter table public.calendar_entries drop constraint if exists calendar_entries_entry_kind_check;
alter table public.calendar_entries add constraint calendar_entries_entry_kind_check
  check (entry_kind in ('event', 'meeting', 'task', 'deadline', 'reminder'));

alter table public.calendar_entries drop constraint if exists calendar_entries_kind_family_check;
alter table public.calendar_entries add constraint calendar_entries_kind_family_check
  check (
    (type = 'activity' and entry_kind in ('event', 'meeting', 'reminder'))
    or
    (type = 'task' and entry_kind in ('task', 'deadline'))
  );

alter table public.calendar_entries drop constraint if exists calendar_entries_availability_check;
alter table public.calendar_entries add constraint calendar_entries_availability_check
  check (availability is null or availability in ('busy', 'free', 'tentative', 'out_of_office'));

alter table public.calendar_entries drop constraint if exists calendar_entries_deadline_kind_check;
alter table public.calendar_entries add constraint calendar_entries_deadline_kind_check
  check (deadline_at is null or entry_kind in ('event', 'task'));

create index if not exists calendar_entries_kind_idx on public.calendar_entries (entry_kind);
create index if not exists calendar_entries_category_idx on public.calendar_entries (category_id);
create index if not exists calendar_entries_deadline_at_idx
  on public.calendar_entries (deadline_at)
  where deadline_at is not null;

-- Create the card and its Calendar-owned satellites as one unit. API routes do
-- permission checks and normalization first; this transaction is the final
-- integrity boundary so an attendee/reminder failure cannot leave a partial
-- card behind.
create or replace function public.calendar_entry_create_tx(
  p_actor_id text,
  p_entry jsonb,
  p_attendee_user_ids text[] default '{}'::text[],
  p_reminder_offsets integer[] default '{}'::integer[]
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_type text := p_entry->>'type';
  v_all_day boolean := coalesce((p_entry->>'allDay')::boolean, true);
  v_category_id uuid;
begin
  if nullif(btrim(p_actor_id), '') is null
    or p_entry is null
    or jsonb_typeof(p_entry) <> 'object'
    or v_type not in ('task', 'activity')
    or nullif(btrim(p_entry->>'title'), '') is null then
    raise exception 'calendar_entry_create: actor and a valid entry are required' using errcode = '22023';
  end if;
  if not exists(select 1 from public.app_users where id = p_actor_id and status = 'active') then
    raise exception 'calendar_entry_create: active actor not found' using errcode = 'P0002';
  end if;
  if cardinality(p_attendee_user_ids) > 200
    or cardinality(p_reminder_offsets) > 5
    or exists(select 1 from unnest(p_reminder_offsets) value where value < 0 or value > 525600) then
    raise exception 'calendar_entry_create: invalid attendees or reminder offsets' using errcode = '22023';
  end if;
  if exists(
    select 1 from unnest(p_attendee_user_ids) user_id
    left join public.app_users user_record on user_record.id = user_id and user_record.status = 'active'
    where user_record.id is null or user_id = p_actor_id
  ) then
    raise exception 'calendar_entry_create: every attendee must be another active user' using errcode = '22023';
  end if;

  v_category_id := nullif(p_entry->>'categoryId', '')::uuid;
  if v_category_id is null then
    select id into v_category_id from public.calendar_categories where category_key = 'general' and is_active;
  end if;
  if v_category_id is null or not exists(select 1 from public.calendar_categories where id = v_category_id and is_active) then
    raise exception 'calendar_entry_create: active category not found' using errcode = '22023';
  end if;

  insert into public.calendar_entries(
    id, type, entry_kind, category_id, calendar_collection_id, availability,
    title, title_icon_type, title_icon_value, notes, color_key, custom_color, location_label,
    all_day, starts_on, ends_on, starts_at, ends_at, deadline_at,
    owner_user_id, assignee_user_id, department_id, visibility,
    status, priority, recurrence_rule, recurrence_series_id,
    created_by, created_at, updated_at
  ) values (
    v_id, v_type, p_entry->>'entryKind', v_category_id,
    (p_entry->>'calendarId')::uuid,
    case when v_type = 'activity' then coalesce(p_entry->>'availability', 'busy') end,
    btrim(p_entry->>'title'), nullif(p_entry->>'titleIconType', ''), nullif(p_entry->>'titleIconValue', ''), nullif(p_entry->>'notes', ''),
    nullif(p_entry->>'colorKey', ''), nullif(p_entry->>'customColor', ''), nullif(p_entry->>'locationLabel', ''),
    v_all_day,
    case when v_all_day then (p_entry->>'startsOn')::date end,
    case when v_all_day then nullif(p_entry->>'endsOn', '')::date end,
    case when not v_all_day then (p_entry->>'startsAt')::timestamptz end,
    case when not v_all_day then nullif(p_entry->>'endsAt', '')::timestamptz end,
    nullif(p_entry->>'deadlineAt', '')::timestamptz,
    p_actor_id, nullif(p_entry->>'assigneeUserId', ''), nullif(p_entry->>'departmentId', ''),
    coalesce(p_entry->>'visibility', 'personal'),
    case when v_type = 'task' then 'not_started' end,
    case when v_type = 'task' then coalesce(p_entry->>'priority', 'medium') end,
    nullif(p_entry->>'recurrenceRule', ''), nullif(p_entry->>'recurrenceSeriesId', '')::uuid,
    p_actor_id, now(), now()
  );

  insert into public.calendar_activity_attendees(calendar_entry_id, user_id, response_status)
  select v_id, user_id, 'invited'
  from (select distinct unnest(p_attendee_user_ids) as user_id) attendees;

  insert into public.calendar_reminders(calendar_entry_id, user_id, offset_minutes, created_by)
  select v_id, p_actor_id, offset_minutes, p_actor_id
  from (select distinct unnest(p_reminder_offsets) as offset_minutes) reminders;

  return jsonb_build_object('id', v_id);
end;
$$;

revoke all on function public.calendar_entry_create_tx(text,jsonb,text[],integer[]) from public, anon, authenticated;
grant execute on function public.calendar_entry_create_tx(text,jsonb,text[],integer[]) to service_role;

alter table public.calendar_categories enable row level security;
revoke all on table public.calendar_categories from anon, authenticated;
grant select, insert, update, delete on table public.calendar_categories to service_role;

commit;
