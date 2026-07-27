-- ============================================================================
-- Calendar & Tasks — platform module (one shared source of dated items)
--
-- `calendar_entries` owns USER-created tasks + activities (and recurrence
-- masters). Module-owned DEADLINES are NOT copied here — source adapters project
-- them into the CalendarItemDTO at read time (single source of truth per module).
--
-- Recurrence is in scope: a master row carries an RRULE (`recurrence_rule`), the
-- backend expands occurrences server-side for a requested range (never unbounded,
-- never persisted per-occurrence), and per-occurrence edits/cancellations live in
-- `calendar_recurrence_exceptions`.
--
-- Platform-level → NO module prefix (like workflow/handoff tables). `app_users.id`
-- is TEXT, so all user FKs are text. RLS enabled; all access is service-role only
-- (the backend reads/writes via the service key — no direct browser reads).
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

begin;

-- ── shared updated_at trigger fn (this module's own, per house convention) ──
create or replace function public.set_calendar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── 1. calendar_entries — tasks + activities (+ recurrence masters) ──────────
create table if not exists public.calendar_entries (
  id                    uuid primary key default gen_random_uuid(),
  type                  text not null check (type in ('task', 'activity')),
  title                 text not null,
  notes                 text,

  -- All-day items use the date columns; timed items use the timestamptz columns.
  all_day               boolean not null default true,
  starts_on             date,
  ends_on               date,
  starts_at             timestamptz,
  ends_at               timestamptz,

  owner_user_id         text not null references public.app_users(id),
  assignee_user_id      text references public.app_users(id),
  department_id         text references public.departments(id) on delete set null,
  visibility            text not null default 'personal'
                          check (visibility in ('personal', 'team', 'org')),

  -- Tasks are actionable (status + priority not null); activities have neither.
  -- "overdue" is DERIVED (due date < today AND status not in done/cancelled) — never stored.
  status                text check (status in ('not_started', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled')),
  priority              text check (priority in ('low', 'medium', 'high')),
  completed_at          timestamptz,
  completed_by          text references public.app_users(id),

  -- Recurrence: master row carries the RRULE; series_id groups the series.
  recurrence_rule       text,
  recurrence_series_id  uuid,
  recurrence_parent_id  uuid references public.calendar_entries(id) on delete cascade,

  -- Optional link back to a source record (usually null for native entries).
  source_module         text,
  source_ref            text,

  created_by            text not null references public.app_users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Title sanity.
  constraint chk_calendar_title_len
    check (char_length(btrim(title)) between 1 and 200),
  -- All-day ⇒ date cols set, timestamptz cols null (and vice-versa).
  constraint chk_calendar_when
    check (
      (all_day     and starts_on is not null and starts_at is null and ends_at is null)
      or
      (not all_day and starts_at is not null and starts_on is null and ends_on is null)
    ),
  -- Date/time order sanity.
  constraint chk_calendar_date_order
    check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint chk_calendar_time_order
    check (ends_at is null or starts_at is null or ends_at >= starts_at),
  -- Task ⇒ status + priority not null; activity ⇒ both null.
  constraint chk_calendar_type_status
    check (
      (type = 'task'     and status is not null)
      or
      (type = 'activity' and status is null)
    ),
  constraint chk_calendar_type_priority
    check (
      (type = 'task'     and priority is not null)
      or
      (type = 'activity' and priority is null)
    ),
  -- Done ⇒ completed_at stamped.
  constraint chk_calendar_completed
    check (status is distinct from 'done' or completed_at is not null),
  -- A recurrence master must carry a series id.
  constraint chk_calendar_recurrence_series
    check (recurrence_rule is null or recurrence_series_id is not null)
);

create index if not exists calendar_entries_starts_on_idx    on public.calendar_entries (starts_on);
create index if not exists calendar_entries_starts_at_idx    on public.calendar_entries (starts_at);
create index if not exists calendar_entries_owner_idx        on public.calendar_entries (owner_user_id);
create index if not exists calendar_entries_assignee_idx     on public.calendar_entries (assignee_user_id);
create index if not exists calendar_entries_department_idx   on public.calendar_entries (department_id);
create index if not exists calendar_entries_status_idx       on public.calendar_entries (status);
create index if not exists calendar_entries_visibility_idx   on public.calendar_entries (visibility);
create index if not exists calendar_entries_series_idx       on public.calendar_entries (recurrence_series_id);
create index if not exists calendar_entries_source_idx       on public.calendar_entries (source_module, source_ref);

drop trigger if exists trg_calendar_entries_updated_at on public.calendar_entries;
create trigger trg_calendar_entries_updated_at
  before update on public.calendar_entries
  for each row execute function public.set_calendar_updated_at();

-- ── 2. calendar_activity_attendees — invitees for an activity ────────────────
create table if not exists public.calendar_activity_attendees (
  id                 uuid primary key default gen_random_uuid(),
  calendar_entry_id  uuid not null references public.calendar_entries(id) on delete cascade,
  user_id            text not null references public.app_users(id),
  response_status    text not null default 'invited'
                       check (response_status in ('invited', 'accepted', 'declined', 'tentative')),
  created_at         timestamptz not null default now(),
  constraint uq_calendar_attendee unique (calendar_entry_id, user_id)
);

create index if not exists calendar_attendees_user_idx  on public.calendar_activity_attendees (user_id);
create index if not exists calendar_attendees_entry_idx on public.calendar_activity_attendees (calendar_entry_id);

-- ── 3. calendar_recurrence_exceptions — per-occurrence override / cancel ─────
create table if not exists public.calendar_recurrence_exceptions (
  id                     uuid primary key default gen_random_uuid(),
  calendar_entry_id      uuid not null references public.calendar_entries(id) on delete cascade,
  series_id              uuid not null,
  occurrence_date        date not null,               -- local date key of the occurrence
  exception_type         text not null check (exception_type in ('cancelled', 'modified')),

  -- Replacement fields (used when exception_type = 'modified').
  replacement_title      text,
  replacement_notes      text,
  replacement_all_day    boolean,
  replacement_starts_on  date,
  replacement_ends_on    date,
  replacement_starts_at  timestamptz,
  replacement_ends_at    timestamptz,
  replacement_status     text check (replacement_status in ('not_started', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled')),

  created_by             text not null references public.app_users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint uq_calendar_exception unique (calendar_entry_id, occurrence_date)
);

create index if not exists calendar_exceptions_series_idx on public.calendar_recurrence_exceptions (series_id);
create index if not exists calendar_exceptions_entry_idx  on public.calendar_recurrence_exceptions (calendar_entry_id);

drop trigger if exists trg_calendar_exceptions_updated_at on public.calendar_recurrence_exceptions;
create trigger trg_calendar_exceptions_updated_at
  before update on public.calendar_recurrence_exceptions
  for each row execute function public.set_calendar_updated_at();

-- ── 3b. Reconcile an EARLIER-created table (idempotent) ──────────────────────
-- `create table if not exists` above is a no-op when the table already exists from
-- a prior apply, so it can't add the `priority` column or widen the status set on
-- an existing calendar_entries. These statements bring any existing table up to the
-- current shape and are no-ops on a fresh create. Backfills run first so the
-- tightened CHECKs below can be added even if rows already exist.
alter table public.calendar_entries add column if not exists priority text;
alter table public.calendar_entries add column if not exists department_id text references public.departments(id) on delete set null;
create index if not exists calendar_entries_department_idx on public.calendar_entries (department_id);

update public.calendar_entries set status = 'not_started' where status = 'open';
update public.calendar_entries set priority = 'medium' where type = 'task' and priority is null;

alter table public.calendar_entries drop constraint if exists calendar_entries_status_check;
alter table public.calendar_entries add constraint calendar_entries_status_check
  check (status is null or status in ('not_started', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'));

alter table public.calendar_entries drop constraint if exists calendar_entries_priority_check;
alter table public.calendar_entries add constraint calendar_entries_priority_check
  check (priority is null or priority in ('low', 'medium', 'high'));

alter table public.calendar_entries drop constraint if exists chk_calendar_type_priority;
alter table public.calendar_entries add constraint chk_calendar_type_priority
  check ((type = 'task' and priority is not null) or (type = 'activity' and priority is null));

alter table public.calendar_recurrence_exceptions drop constraint if exists calendar_recurrence_exceptions_replacement_status_check;
alter table public.calendar_recurrence_exceptions add constraint calendar_recurrence_exceptions_replacement_status_check
  check (replacement_status is null or replacement_status in ('not_started', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'));

-- ── 4. RLS — service-role only (backend mediates every read/write) ──────────
alter table public.calendar_entries               enable row level security;
alter table public.calendar_activity_attendees    enable row level security;
alter table public.calendar_recurrence_exceptions enable row level security;
-- No permissive client policies: authenticated clients are denied by default;
-- the service-role backend bypasses RLS. (No new direct browser Supabase reads.)

-- ── 5. Seed role_permission grants (mirror ROLE_PERMISSIONS in permissions.ts) ─
-- calendar.view + own task/activity management is part of the employee baseline;
-- calendar.manage + calendar.task.assign are management capabilities.
insert into public.role_permissions (role_name, permission) values
  -- everyone who has an app account can see the calendar + manage their own items
  ('employee','calendar.view'),('employee','calendar.task.manage_own'),('employee','calendar.activity.manage_own'),
  ('hr_staff','calendar.view'),('hr_staff','calendar.task.manage_own'),('hr_staff','calendar.activity.manage_own'),
  ('hse_staff','calendar.view'),('hse_staff','calendar.task.manage_own'),('hse_staff','calendar.activity.manage_own'),
  ('finance_staff','calendar.view'),('finance_staff','calendar.task.manage_own'),('finance_staff','calendar.activity.manage_own'),
  -- managers + module managers can assign tasks to their team and manage team items
  ('manager','calendar.view'),('manager','calendar.task.manage_own'),('manager','calendar.activity.manage_own'),
  ('manager','calendar.task.assign'),('manager','calendar.manage'),
  ('hr_manager','calendar.view'),('hr_manager','calendar.task.manage_own'),('hr_manager','calendar.activity.manage_own'),
  ('hr_manager','calendar.task.assign'),('hr_manager','calendar.manage'),
  ('finance_manager','calendar.view'),('finance_manager','calendar.task.manage_own'),('finance_manager','calendar.activity.manage_own'),
  ('finance_manager','calendar.task.assign'),('finance_manager','calendar.manage'),
  ('admin','calendar.view'),('admin','calendar.task.manage_own'),('admin','calendar.activity.manage_own'),
  ('admin','calendar.task.assign'),('admin','calendar.manage')
on conflict (role_name, permission) do nothing;

commit;
