-- ============================================================================
-- Meetings core — sessions, attendance, artifacts, transcript and outcomes.
--
-- Calendar remains the scheduling/RSVP source of truth. Communications remains
-- the discussion source of truth. Existing record_links is reused for related
-- ERP records. All access is mediated by authenticated Netlify functions using
-- the service role; there are intentionally no authenticated-client policies.
-- app_users.id is TEXT.
-- ============================================================================

begin;

create or replace function public.set_meetings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_ref text not null unique,
  calendar_entry_id uuid not null unique references public.calendar_entries(id) on delete restrict,
  discussion_thread_id uuid not null unique references public.message_threads(id) on delete restrict,
  organizer_user_id text not null references public.app_users(id) on delete restrict,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','scheduled','in_progress','processing','completed','cancelled','archived')),
  confidentiality text not null default 'internal' check (confidentiality in ('internal','restricted','confidential')),
  provider text not null default 'none' check (provider in ('none','external','microsoft_teams','zoom','google_meet')),
  provider_meeting_id text,
  join_url text,
  recording_policy text not null default 'off' check (recording_policy in ('off','optional','required')),
  transcript_policy text not null default 'off' check (transcript_policy in ('off','manual','automatic')),
  retention_status text not null default 'active' check (retention_status in ('active','legal_hold','pending_purge','purged')),
  retention_until timestamptz,
  version bigint not null default 1 check (version > 0),
  created_by text not null references public.app_users(id) on delete restrict,
  updated_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by text references public.app_users(id) on delete set null,
  cancellation_reason text,
  archived_at timestamptz,
  archived_by text references public.app_users(id) on delete set null,
  constraint meetings_ref_shape check (meeting_ref ~ '^MTG-[0-9]{4}-[0-9]{4,}$'),
  constraint meetings_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint meetings_provider_identity check (provider <> 'none' or provider_meeting_id is null),
  constraint meetings_cancelled_state check (status <> 'cancelled' or cancelled_at is not null),
  constraint meetings_archived_state check (status <> 'archived' or archived_at is not null),
  constraint meetings_retention_state check (retention_status <> 'purged' or archived_at is not null)
);

create index if not exists meetings_organizer_status_idx on public.meetings(organizer_user_id,status,updated_at desc);
create index if not exists meetings_status_updated_idx on public.meetings(status,updated_at desc);
create index if not exists meetings_retention_idx on public.meetings(retention_status,retention_until) where retention_until is not null;

create table if not exists public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  calendar_attendee_id uuid not null unique references public.calendar_activity_attendees(id) on delete restrict,
  user_id text not null references public.app_users(id) on delete restrict,
  role text not null default 'attendee' check (role in ('organizer','presenter','attendee','observer')),
  required boolean not null default true,
  added_by text not null references public.app_users(id) on delete restrict,
  added_at timestamptz not null default now(),
  removed_by text references public.app_users(id) on delete set null,
  removed_at timestamptz,
  unique(meeting_id,user_id),
  constraint meeting_participants_removed check ((removed_at is null and removed_by is null) or removed_at is not null)
);
create unique index if not exists meeting_one_organizer_idx on public.meeting_participants(meeting_id) where role='organizer' and removed_at is null;
create index if not exists meeting_participants_user_idx on public.meeting_participants(user_id,removed_at,meeting_id);

create table if not exists public.meeting_sessions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  occurrence_key text not null,
  status text not null default 'scheduled' check (status in ('scheduled','ready','live','processing','completed','processing_failed','cancelled')),
  scheduled_starts_at timestamptz,
  scheduled_ends_at timestamptz,
  actual_started_at timestamptz,
  actual_ended_at timestamptz,
  started_by text references public.app_users(id) on delete set null,
  ended_by text references public.app_users(id) on delete set null,
  transcript_status text check (transcript_status in ('queued','processing','ready','reviewed','failed')),
  failure_code text,
  failure_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(meeting_id,occurrence_key),
  constraint meeting_session_scheduled_order check (scheduled_ends_at is null or scheduled_starts_at is null or scheduled_ends_at >= scheduled_starts_at),
  constraint meeting_session_actual_order check (actual_ended_at is null or actual_started_at is null or actual_ended_at >= actual_started_at),
  constraint meeting_session_live_start check (status not in ('live','processing','completed') or actual_started_at is not null),
  constraint meeting_session_completed_end check (status <> 'completed' or actual_ended_at is not null)
);
create index if not exists meeting_sessions_meeting_idx on public.meeting_sessions(meeting_id,scheduled_starts_at desc);
create index if not exists meeting_sessions_status_idx on public.meeting_sessions(status,updated_at);

create table if not exists public.meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.meeting_sessions(id) on delete cascade,
  participant_id uuid references public.meeting_participants(id) on delete set null,
  user_id text references public.app_users(id) on delete set null,
  display_name text,
  joined_at timestamptz,
  left_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  consent_status text not null default 'not_required' check (consent_status in ('not_required','pending','granted','declined','revoked')),
  consent_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_attendance_identity check (user_id is not null or nullif(btrim(display_name),'') is not null),
  constraint meeting_attendance_time_order check (left_at is null or joined_at is null or left_at >= joined_at),
  constraint meeting_attendance_consent_time check (consent_status in ('not_required','pending') or consent_recorded_at is not null)
);
create unique index if not exists meeting_attendance_internal_uidx on public.meeting_attendance(session_id,user_id) where user_id is not null;
create index if not exists meeting_attendance_session_idx on public.meeting_attendance(session_id,joined_at);

create table if not exists public.meeting_artifacts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.meeting_sessions(id) on delete cascade,
  kind text not null check (kind in ('recording','audio','captions','transcript_source','minutes','supporting_file')),
  file_name text not null,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  object_path text not null unique,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  status text not null default 'reserved' check (status in ('reserved','uploading','scanning','processing','ready','rejected','failed','deleted')),
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','blocked','failed')),
  uploaded_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  retention_until timestamptz,
  deleted_at timestamptz,
  deleted_by text references public.app_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint meeting_artifact_ready check (status <> 'ready' or (ready_at is not null and scan_status='clean')),
  constraint meeting_artifact_deleted check (status <> 'deleted' or deleted_at is not null)
);
create index if not exists meeting_artifacts_session_idx on public.meeting_artifacts(session_id,kind,created_at);
create index if not exists meeting_artifacts_retention_idx on public.meeting_artifacts(retention_until) where retention_until is not null and deleted_at is null;

create table if not exists public.meeting_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.meeting_sessions(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  starts_at_ms bigint not null check (starts_at_ms >= 0),
  ends_at_ms bigint not null check (ends_at_ms >= starts_at_ms),
  speaker_user_id text references public.app_users(id) on delete set null,
  speaker_name text,
  body text not null,
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  redacted boolean not null default false,
  redaction_reason text,
  edited_by text references public.app_users(id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (to_tsvector('simple',coalesce(body,''))) stored,
  unique(session_id,sequence),
  constraint meeting_transcript_body check (char_length(btrim(body)) > 0),
  constraint meeting_transcript_redaction check (not redacted or nullif(btrim(redaction_reason),'') is not null)
);
create index if not exists meeting_transcript_time_idx on public.meeting_transcript_segments(session_id,starts_at_ms);
create index if not exists meeting_transcript_search_idx on public.meeting_transcript_segments using gin(search_vector);

create table if not exists public.meeting_chapters (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.meeting_sessions(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  title text not null,
  summary text,
  starts_at_ms bigint not null check (starts_at_ms >= 0),
  ends_at_ms bigint check (ends_at_ms is null or ends_at_ms >= starts_at_ms),
  source text not null default 'manual' check (source in ('manual','generated','hybrid')),
  created_by text references public.app_users(id) on delete set null,
  updated_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id,sequence),
  constraint meeting_chapter_title check (char_length(btrim(title)) between 1 and 200)
);
create index if not exists meeting_chapters_session_idx on public.meeting_chapters(session_id,starts_at_ms);

create table if not exists public.meeting_summary_versions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.meeting_sessions(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null check (status in ('queued','generating','generated','reviewed','published','rejected','failed')),
  source text not null check (source in ('manual','generated','hybrid')),
  short_summary text not null default '',
  decisions jsonb not null default '[]'::jsonb check (jsonb_typeof(decisions)='array'),
  key_takeaways jsonb not null default '[]'::jsonb check (jsonb_typeof(key_takeaways)='array'),
  provenance jsonb,
  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_by text references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  published_by text references public.app_users(id) on delete set null,
  published_at timestamptz,
  rejection_reason text,
  unique(session_id,version),
  constraint meeting_summary_reviewed check (status not in ('reviewed','published') or reviewed_at is not null),
  constraint meeting_summary_published check (status <> 'published' or published_at is not null),
  constraint meeting_summary_rejected check (status <> 'rejected' or nullif(btrim(rejection_reason),'') is not null)
);
create unique index if not exists meeting_summary_published_uidx on public.meeting_summary_versions(session_id) where status='published';
create index if not exists meeting_summary_session_idx on public.meeting_summary_versions(session_id,version desc);

create table if not exists public.meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  title text not null,
  description text,
  owner_user_id text references public.app_users(id) on delete set null,
  status text not null default 'open' check (status in ('open','covered','deferred','cancelled')),
  planned_minutes integer check (planned_minutes is null or planned_minutes > 0),
  chapter_id uuid references public.meeting_chapters(id) on delete set null,
  created_by text not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by text references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(meeting_id,sequence),
  constraint meeting_agenda_title check (char_length(btrim(title)) between 1 and 300)
);
create index if not exists meeting_agenda_meeting_idx on public.meeting_agenda_items(meeting_id,sequence);

create table if not exists public.meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  session_id uuid not null references public.meeting_sessions(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'proposed' check (status in ('proposed','accepted','rejected','in_progress','completed','cancelled')),
  destination text not null default 'meeting' check (destination in ('meeting','calendar_task','workflow_task','module_handoff')),
  owner_user_id text references public.app_users(id) on delete set null,
  due_at timestamptz,
  evidence_segment_id uuid references public.meeting_transcript_segments(id) on delete set null,
  evidence_starts_at_ms bigint check (evidence_starts_at_ms is null or evidence_starts_at_ms >= 0),
  evidence_ends_at_ms bigint check (evidence_ends_at_ms is null or evidence_ends_at_ms >= evidence_starts_at_ms),
  evidence_excerpt text,
  proposed_by text references public.app_users(id) on delete set null,
  proposed_by_generation boolean not null default false,
  accepted_by text references public.app_users(id) on delete set null,
  accepted_at timestamptz,
  rejected_by text references public.app_users(id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text,
  calendar_task_id uuid references public.calendar_entries(id) on delete set null,
  workflow_task_id uuid references public.workflow_tasks(id) on delete set null,
  handoff_id uuid references public.handoff_outbox(id) on delete set null,
  target_module text,
  target_record_type text,
  target_record_id text,
  created_at timestamptz not null default now(),
  updated_by text references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint meeting_action_title check (char_length(btrim(title)) between 1 and 300),
  constraint meeting_action_accepted check (status not in ('accepted','in_progress','completed') or accepted_at is not null),
  constraint meeting_action_rejected check (status <> 'rejected' or (rejected_at is not null and nullif(btrim(rejection_reason),'') is not null)),
  constraint meeting_action_destination_projection check (
    (destination='meeting' and calendar_task_id is null and workflow_task_id is null and handoff_id is null)
    or (destination='calendar_task' and (status='proposed' or calendar_task_id is not null))
    or (destination='workflow_task' and (status='proposed' or workflow_task_id is not null))
    or (destination='module_handoff' and (status='proposed' or handoff_id is not null))
  )
);
create index if not exists meeting_actions_meeting_idx on public.meeting_action_items(meeting_id,status,due_at);
create index if not exists meeting_actions_owner_idx on public.meeting_action_items(owner_user_id,status,due_at) where owner_user_id is not null;

create table if not exists public.meeting_labels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text,
  created_by text not null references public.app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_label_name check (char_length(btrim(name)) between 1 and 60),
  constraint meeting_label_color check (color is null or color ~ '^#[0-9A-Fa-f]{6}$')
);
create unique index if not exists meeting_labels_name_uidx on public.meeting_labels(lower(btrim(name)));

create table if not exists public.meeting_label_assignments (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  label_id uuid not null references public.meeting_labels(id) on delete cascade,
  assigned_by text not null references public.app_users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key(meeting_id,label_id)
);

create table if not exists public.meeting_command_receipts (
  actor_user_id text not null references public.app_users(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  meeting_id uuid references public.meetings(id) on delete cascade,
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key(actor_user_id,operation,idempotency_key)
);

-- Cross-table ownership/source invariants that ordinary foreign keys cannot express.
create or replace function public.validate_meeting_foundation_links()
returns trigger language plpgsql set search_path=public as $$
declare v_calendar_type text; v_thread_module text; v_thread_type text; v_thread_entity text;
begin
  select type into v_calendar_type from public.calendar_entries where id=new.calendar_entry_id;
  if v_calendar_type is distinct from 'activity' then raise exception 'Meeting calendar entry must be an activity'; end if;
  select thread_type,source_module,source_entity_id into v_thread_type,v_thread_module,v_thread_entity
    from public.message_threads where id=new.discussion_thread_id;
  if v_thread_type is distinct from 'record' or v_thread_module is distinct from 'meetings' or v_thread_entity is distinct from new.id::text then
    raise exception 'Meeting discussion thread must be a record thread linked to the meeting';
  end if;
  return new;
end;
$$;
drop trigger if exists meetings_foundation_links on public.meetings;
create constraint trigger meetings_foundation_links
after insert or update of calendar_entry_id,discussion_thread_id on public.meetings
deferrable initially deferred for each row execute function public.validate_meeting_foundation_links();

create or replace function public.validate_meeting_participant_calendar_link()
returns trigger language plpgsql set search_path=public as $$
declare v_entry uuid; v_user text; v_meeting_entry uuid;
begin
  select calendar_entry_id,user_id into v_entry,v_user from public.calendar_activity_attendees where id=new.calendar_attendee_id;
  select calendar_entry_id into v_meeting_entry from public.meetings where id=new.meeting_id;
  if v_entry is distinct from v_meeting_entry or v_user is distinct from new.user_id then
    raise exception 'Meeting participant must match the Calendar attendee';
  end if;
  return new;
end;
$$;
drop trigger if exists meeting_participant_calendar_link on public.meeting_participants;
create constraint trigger meeting_participant_calendar_link
after insert or update of meeting_id,calendar_attendee_id,user_id on public.meeting_participants
deferrable initially deferred for each row execute function public.validate_meeting_participant_calendar_link();

create or replace function public.validate_meeting_child_links()
returns trigger language plpgsql set search_path=public as $$
declare v_parent_meeting uuid; v_related_meeting uuid;
begin
  if tg_table_name='meeting_attendance' then
    if new.participant_id is null then return new; end if;
    select meeting_id into v_parent_meeting from public.meeting_sessions where id=new.session_id;
    select meeting_id into v_related_meeting from public.meeting_participants where id=new.participant_id;
  elsif tg_table_name='meeting_agenda_items' then
    if new.chapter_id is null then return new; end if;
    select meeting_id into v_parent_meeting from public.meetings where id=new.meeting_id;
    select s.meeting_id into v_related_meeting from public.meeting_chapters c join public.meeting_sessions s on s.id=c.session_id where c.id=new.chapter_id;
  elsif tg_table_name='meeting_action_items' then
    v_parent_meeting := new.meeting_id;
    select meeting_id into v_related_meeting from public.meeting_sessions where id=new.session_id;
    if v_parent_meeting is distinct from v_related_meeting then raise exception 'Action session must belong to its meeting'; end if;
    if new.evidence_segment_id is not null and not exists (
      select 1 from public.meeting_transcript_segments where id=new.evidence_segment_id and session_id=new.session_id
    ) then raise exception 'Action evidence must belong to its session'; end if;
    return new;
  else
    return new;
  end if;
  if v_parent_meeting is distinct from v_related_meeting then
    raise exception 'Meeting child relationship crosses meeting boundaries';
  end if;
  return new;
end;
$$;
drop trigger if exists meeting_attendance_parent_link on public.meeting_attendance;
create constraint trigger meeting_attendance_parent_link
after insert or update of session_id,participant_id on public.meeting_attendance
deferrable initially deferred for each row execute function public.validate_meeting_child_links();
drop trigger if exists meeting_agenda_chapter_link on public.meeting_agenda_items;
create constraint trigger meeting_agenda_chapter_link
after insert or update of meeting_id,chapter_id on public.meeting_agenda_items
deferrable initially deferred for each row execute function public.validate_meeting_child_links();
drop trigger if exists meeting_action_parent_links on public.meeting_action_items;
create constraint trigger meeting_action_parent_links
after insert or update of meeting_id,session_id,evidence_segment_id on public.meeting_action_items
deferrable initially deferred for each row execute function public.validate_meeting_child_links();

do $$ declare t text; begin
  foreach t in array array['meetings','meeting_sessions','meeting_attendance','meeting_artifacts','meeting_chapters','meeting_agenda_items','meeting_action_items','meeting_labels'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_'||t||'_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_meetings_updated_at()', 'trg_'||t||'_updated_at', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['meetings','meeting_participants','meeting_sessions','meeting_attendance','meeting_artifacts','meeting_transcript_segments','meeting_chapters','meeting_summary_versions','meeting_agenda_items','meeting_action_items','meeting_labels','meeting_label_assignments','meeting_command_receipts'] loop
    execute format('alter table public.%I enable row level security',t);
  end loop;
end $$;

-- Private artifact bucket. Upload/download URLs are short-lived and backend-issued.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('meeting-artifacts','meeting-artifacts',false,2147483648,array[
  'video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/webm','audio/wav',
  'text/plain','text/vtt','text/csv','application/json','application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "meeting artifacts: service role" on storage.objects;
create policy "meeting artifacts: service role" on storage.objects for all to service_role
using(bucket_id='meeting-artifacts') with check(bucket_id='meeting-artifacts');

insert into public.reference_counters(prefix,year,next_number)
values('MTG',extract(year from now())::integer,1) on conflict(prefix,year) do nothing;

-- Roles are flat; each existing application role receives a deliberate grant set.
insert into public.role_permissions(role_name,permission)
select r,p from unnest(array['employee','hr_staff','hse_staff','finance_staff','manager','hr_manager','finance_manager','admin']) r
cross join unnest(array[
  'meetings.view','meetings.create','meetings.manage_own','meetings.participants.manage',
  'meetings.recording.manage','meetings.recording.view','meetings.transcript.view',
  'meetings.summary.generate','meetings.summary.review','meetings.summary.publish',
  'meetings.actions.publish','meetings.comments.post','meetings.metrics.view'
]) p on conflict do nothing;
insert into public.role_permissions(role_name,permission)
select r,p from unnest(array['manager','hr_manager','finance_manager','admin']) r
cross join unnest(array['meetings.manage_team','meetings.transcript.export']) p on conflict do nothing;
insert into public.role_permissions(role_name,permission) values('admin','meetings.retention.manage') on conflict do nothing;
-- meetings.compliance_read is intentionally never role-seeded; it is assigned
-- explicitly to named compliance users by the existing permission administration flow.

-- Meetings lifecycle changes are first-class Communications system events, not
-- user-authored chat messages. Extend the canonical discriminator at the source.
alter table public.message_posts drop constraint if exists message_posts_system_event_type_chk;
alter table public.message_posts add constraint message_posts_system_event_type_chk
  check (system_event_type is null or system_event_type in (
    'participant_added','participant_removed','participant_left','participant_role_changed',
    'thread_created','thread_archived','thread_reopened','thread_muted','thread_unmuted',
    'meetings.meeting.updated','meetings.meeting.cancelled','meetings.meeting.archived',
    'meetings.participants.invited','meetings.participant.removed','meetings.participant.rsvp_changed',
    'meetings.session.started','meetings.session.ended','meetings.agenda.updated'
  ));

-- Atomic creation owns all cross-module invariants. p_payload is the canonical
-- create command envelope; every accepted key below is persisted or acted on.
create or replace function public.meetings_create_tx(
  p_actor_id text,
  p_idempotency_key text,
  p_payload jsonb
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_hash text; v_existing public.meeting_command_receipts%rowtype;
  v_meeting_id uuid := gen_random_uuid(); v_calendar_id uuid := gen_random_uuid();
  v_thread_id uuid := gen_random_uuid(); v_session_id uuid := gen_random_uuid();
  v_year integer := extract(year from now())::integer; v_number integer; v_ref text;
  v_participant jsonb; v_attendee_id uuid; v_result jsonb; v_now timestamptz := now();
  v_post_id uuid; v_event_id uuid;
  v_all_day boolean := coalesce((p_payload->'schedule'->>'allDay')::boolean,false);
begin
  if nullif(btrim(p_actor_id),'') is null or nullif(btrim(p_idempotency_key),'') is null or p_payload is null then
    raise exception 'meetings_create: actor, idempotency key and payload are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.app_users where id=p_actor_id and status='active') then
    raise exception 'meetings_create: active actor not found' using errcode='P0002';
  end if;
  if nullif(btrim(p_payload->>'title'),'') is null then
    raise exception 'meetings_create: title is required' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_payload) k where k<>all(array[
    'title','description','schedule','participants','labelIds','recordLinks','provider','joinUrl',
    'calendarId','categoryId','confidentiality','recordingPolicy','transcriptPolicy','retentionUntil','agendaItems','reminderOffsets'
  ])) then
    raise exception 'meetings_create: unsupported payload field' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_payload->'participants','[]'::jsonb)) <> 'array' then
    raise exception 'meetings_create: participants must be an array' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_payload->'agendaItems','[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_payload->'agendaItems','[]'::jsonb)) > 50 then
    raise exception 'meetings_create: agendaItems must be an array of at most 50 items' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_array_elements(coalesce(p_payload->'agendaItems','[]'::jsonb)) value
    left join public.app_users u on u.id=nullif(value->>'ownerUserId','') and u.status='active'
    where nullif(btrim(value->>'title'),'') is null
      or char_length(btrim(value->>'title')) > 300
      or (nullif(value->>'plannedMinutes','') is not null and (value->>'plannedMinutes')::integer <= 0)
      or (nullif(value->>'ownerUserId','') is not null and u.id is null)
  ) then
    raise exception 'meetings_create: invalid agenda item' using errcode='22023';
  end if;
  if p_payload->'schedule' is null or jsonb_typeof(p_payload->'schedule')<>'object' then
    raise exception 'meetings_create: schedule must be an object' using errcode='22023';
  end if;
  if coalesce(p_payload->'schedule'->>'visibility','personal')='team'
    and nullif(p_payload->'schedule'->>'departmentId','') is null then
    raise exception 'meetings_create: department visibility requires a department' using errcode='22023';
  end if;
  if nullif(p_payload->'schedule'->>'departmentId','') is not null
    and not exists(select 1 from public.departments where id=(p_payload->'schedule'->>'departmentId')) then
    raise exception 'meetings_create: department not found' using errcode='P0002';
  end if;
  if coalesce((p_payload->'schedule'->>'allDay')::boolean,false) then
    if nullif(p_payload->'schedule'->>'startsOn','') is null or nullif(p_payload->'schedule'->>'startsAt','') is not null or nullif(p_payload->'schedule'->>'endsAt','') is not null then
      raise exception 'meetings_create: invalid all-day schedule' using errcode='22023';
    end if;
  else
    if nullif(p_payload->'schedule'->>'startsAt','') is null or nullif(p_payload->'schedule'->>'endsAt','') is null or (p_payload->'schedule'->>'endsAt')::timestamptz <= (p_payload->'schedule'->>'startsAt')::timestamptz or nullif(p_payload->'schedule'->>'startsOn','') is not null or nullif(p_payload->'schedule'->>'endsOn','') is not null then
      raise exception 'meetings_create: invalid timed schedule' using errcode='22023';
    end if;
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_payload->'participants','[]'::jsonb)) value where value->>'userId'=p_actor_id) then
    raise exception 'meetings_create: organizer cannot be duplicated as participant' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_array_elements(coalesce(p_payload->'participants','[]'::jsonb)) value
    group by value->>'userId' having count(*)>1
  ) then
    raise exception 'meetings_create: duplicate participant' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_array_elements(coalesce(p_payload->'participants','[]'::jsonb)) value
    left join public.app_users u on u.id=value->>'userId' and u.status='active'
    where nullif(value->>'userId','') is null or u.id is null
  ) then
    raise exception 'meetings_create: participant must be an active user' using errcode='22023';
  end if;
  if coalesce(p_payload->>'transcriptPolicy','off')='automatic' and coalesce(p_payload->>'recordingPolicy','off')='off' then
    raise exception 'meetings_create: automatic transcript requires recording' using errcode='22023';
  end if;
  if (coalesce(p_payload->>'provider','none')='none' and nullif(p_payload->>'joinUrl','') is not null)
    or (coalesce(p_payload->>'provider','none')<>'none' and nullif(p_payload->>'joinUrl','') is null) then
    raise exception 'meetings_create: provider and joinUrl must be supplied together' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id||'|meetings.create|'||btrim(p_idempotency_key),0));
  v_hash := md5(jsonb_build_object('actorId',p_actor_id,'payload',p_payload)::text);
  select * into v_existing from public.meeting_command_receipts
   where actor_user_id=p_actor_id and operation='meetings.create' and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'meetings_create: idempotency key payload mismatch' using errcode='23000'; end if;
    if v_existing.response is null then raise exception 'meetings_create: incomplete prior command' using errcode='55000'; end if;
    return v_existing.response;
  end if;
  insert into public.meeting_command_receipts(actor_user_id,operation,idempotency_key,request_hash)
  values(p_actor_id,'meetings.create',btrim(p_idempotency_key),v_hash);

  v_number := public.increment_ref_counter('MTG',v_year);
  v_ref := 'MTG-'||v_year::text||'-'||lpad(v_number::text,4,'0');
  insert into public.calendar_entries(id,type,entry_kind,category_id,calendar_collection_id,availability,title,title_icon_type,title_icon_value,notes,all_day,starts_on,ends_on,starts_at,ends_at,
    owner_user_id,visibility,department_id,status,priority,recurrence_rule,recurrence_series_id,source_module,source_ref,created_by)
  values(v_calendar_id,'activity','meeting',nullif(p_payload->>'categoryId','')::uuid,(p_payload->>'calendarId')::uuid,'busy',btrim(p_payload->>'title'),nullif(p_payload->>'titleIconType',''),nullif(p_payload->>'titleIconValue',''),nullif(p_payload->>'description',''),v_all_day,
    case when v_all_day then (p_payload->'schedule'->>'startsOn')::date end,
    case when v_all_day then nullif(p_payload->'schedule'->>'endsOn','')::date end,
    case when not v_all_day then (p_payload->'schedule'->>'startsAt')::timestamptz end,
    case when not v_all_day then nullif(p_payload->'schedule'->>'endsAt','')::timestamptz end,
    p_actor_id,coalesce(p_payload->'schedule'->>'visibility','personal'),nullif(p_payload->'schedule'->>'departmentId',''),null,null,
    nullif(p_payload->'schedule'->>'recurrenceRule',''),
    case when nullif(p_payload->'schedule'->>'recurrenceRule','') is not null then gen_random_uuid() end,
    'meetings',v_ref,p_actor_id);

  insert into public.message_threads(id,thread_type,subject,source_module,source_entity_type,source_entity_id,
    created_by,metadata,next_message_sequence,version,last_post_at,last_post_preview)
  values(v_thread_id,'record',btrim(p_payload->>'title'),'meetings','meeting',v_meeting_id::text,p_actor_id,
    jsonb_build_object('meetingRef',v_ref),2,1,v_now,'Meeting created');
  insert into public.message_participants(thread_id,user_id,role,last_read_at,last_read_sequence)
  values(v_thread_id,p_actor_id,'owner',v_now,1);
  insert into public.message_posts(thread_id,author_user_id,body,is_system,post_type,system_event_type,
    system_event_payload,sequence,client_idempotency_key)
  values(v_thread_id,p_actor_id,null,true,'system_event','thread_created',
    jsonb_build_object('meetingId',v_meeting_id,'meetingRef',v_ref,'title',btrim(p_payload->>'title')),
    1,p_idempotency_key||':meeting-created') returning id into v_post_id;

  insert into public.meetings(id,meeting_ref,calendar_entry_id,discussion_thread_id,organizer_user_id,title,description,
    status,confidentiality,provider,provider_meeting_id,join_url,recording_policy,transcript_policy,retention_until,created_by)
  values(v_meeting_id,v_ref,v_calendar_id,v_thread_id,p_actor_id,btrim(p_payload->>'title'),nullif(p_payload->>'description',''),
    'scheduled',coalesce(p_payload->>'confidentiality','internal'),
    coalesce(p_payload->>'provider','none'),null,nullif(p_payload->>'joinUrl',''),
    coalesce(p_payload->>'recordingPolicy','off'),coalesce(p_payload->>'transcriptPolicy','off'),
    nullif(p_payload->>'retentionUntil','')::timestamptz,p_actor_id);

  insert into public.meeting_agenda_items(meeting_id,sequence,title,description,owner_user_id,planned_minutes,created_by,updated_by)
  select v_meeting_id,(item.ordinality - 1)::integer,btrim(item.value->>'title'),nullif(btrim(item.value->>'description'),''),
    nullif(item.value->>'ownerUserId',''),nullif(item.value->>'plannedMinutes','')::integer,p_actor_id,p_actor_id
  from jsonb_array_elements(coalesce(p_payload->'agendaItems','[]'::jsonb)) with ordinality as item(value,ordinality);

  insert into public.calendar_activity_attendees(id,calendar_entry_id,user_id,response_status,responded_at)
  values(gen_random_uuid(),v_calendar_id,p_actor_id,'accepted',v_now) returning id into v_attendee_id;
  insert into public.meeting_participants(meeting_id,calendar_attendee_id,user_id,role,required,added_by)
  values(v_meeting_id,v_attendee_id,p_actor_id,'organizer',true,p_actor_id);

  for v_participant in select value from jsonb_array_elements(coalesce(p_payload->'participants','[]'::jsonb)) loop
    if nullif(v_participant->>'userId','') is null then
      raise exception 'meetings_create: participant userId is required' using errcode='22023';
    end if;
    insert into public.calendar_activity_attendees(id,calendar_entry_id,user_id,response_status)
    values(gen_random_uuid(),v_calendar_id,v_participant->>'userId','invited') returning id into v_attendee_id;
    insert into public.meeting_participants(meeting_id,calendar_attendee_id,user_id,role,required,added_by)
    values(v_meeting_id,v_attendee_id,v_participant->>'userId',coalesce(v_participant->>'role','attendee'),coalesce((v_participant->>'required')::boolean,true),p_actor_id);
    insert into public.message_participants(thread_id,user_id,role) values(v_thread_id,v_participant->>'userId','participant');
  end loop;

  if jsonb_typeof(coalesce(p_payload->'reminderOffsets','[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_payload->'reminderOffsets','[]'::jsonb)) > 5 then
    raise exception 'meetings_create: reminderOffsets must be an array of at most 5 offsets' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'reminderOffsets','[]'::jsonb)) value
    where value::integer < 0 or value::integer > 525600) then
    raise exception 'meetings_create: invalid reminder offset' using errcode='22023';
  end if;
  insert into public.calendar_reminders(calendar_entry_id,user_id,offset_minutes,created_by)
  select v_calendar_id,p_actor_id,value::integer,p_actor_id
  from (select distinct value from jsonb_array_elements_text(coalesce(p_payload->'reminderOffsets','[]'::jsonb))) offsets;

  insert into public.message_event_outbox(event_type,thread_id,actor_id,payload,created_at)
  values('thread.created',v_thread_id,p_actor_id,jsonb_build_object(
    'threadId',v_thread_id,'postId',v_post_id,'sequence',1,
    'participantIds',(select coalesce(jsonb_agg(user_id),'[]'::jsonb) from public.message_participants where thread_id=v_thread_id),
    'priority','normal','sourceModule','meetings','sourceEntityId',v_meeting_id::text
  ),v_now);

  insert into public.meeting_sessions(id,meeting_id,occurrence_key,status,scheduled_starts_at,scheduled_ends_at)
  values(v_session_id,v_meeting_id,'master','scheduled',
    case when not v_all_day then (p_payload->'schedule'->>'startsAt')::timestamptz end,
    case when not v_all_day then nullif(p_payload->'schedule'->>'endsAt','')::timestamptz end);

  if jsonb_typeof(coalesce(p_payload->'labelIds','[]'::jsonb)) <> 'array' then
    raise exception 'meetings_create: labelIds must be an array' using errcode='22023';
  end if;
  insert into public.meeting_label_assignments(meeting_id,label_id,assigned_by)
  select v_meeting_id,(value #>> '{}')::uuid,p_actor_id
  from jsonb_array_elements(coalesce(p_payload->'labelIds','[]'::jsonb));

  if jsonb_typeof(coalesce(p_payload->'recordLinks','[]'::jsonb)) <> 'array' then
    raise exception 'meetings_create: recordLinks must be an array' using errcode='22023';
  end if;
  insert into public.record_links(source_module,source_record_type,source_record_id,source_record_no,source_title,
    source_deep_link,target_module,target_record_type,target_record_id,target_title,relationship_type,visibility,created_by)
  select 'meetings','meeting',v_meeting_id::text,v_ref,btrim(p_payload->>'title'),'/meetings/'||v_meeting_id::text,
    value->>'module',value->>'recordType',value->>'recordId',value->>'recordId',
    coalesce(value->>'relationship','related_to'),coalesce(p_payload->>'confidentiality','internal'),p_actor_id
  from jsonb_array_elements(coalesce(p_payload->'recordLinks','[]'::jsonb));

  insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,actor_user_id,severity,payload,dedupe_key)
  values('meetings.meeting.created','meetings','meeting',v_meeting_id::text,p_actor_id,'success',
    jsonb_build_object('meetingId',v_meeting_id,'meetingRef',v_ref,'calendarEntryId',v_calendar_id,'discussionThreadId',v_thread_id,'agendaItemCount',jsonb_array_length(coalesce(p_payload->'agendaItems','[]'::jsonb))),
    p_actor_id||':meetings.create:'||p_idempotency_key) returning id into v_event_id;
  insert into public.audit_logs(action,table_name,record_id,user_id,changes,created_at)
  values('meetings.meeting.created','meetings',v_meeting_id::text,p_actor_id,
    jsonb_build_object('meetingRef',v_ref,'calendarEntryId',v_calendar_id,'discussionThreadId',v_thread_id,'agendaItemCount',jsonb_array_length(coalesce(p_payload->'agendaItems','[]'::jsonb))),v_now);
  v_result:=jsonb_build_object('meetingId',v_meeting_id,'meetingRef',v_ref,'calendarEntryId',v_calendar_id,
    'discussionThreadId',v_thread_id,'sessionId',v_session_id,'eventId',v_event_id,'version',1,'deduplicated',false);
  update public.meeting_command_receipts set meeting_id=v_meeting_id,response=v_result,completed_at=now()
   where actor_user_id=p_actor_id and operation='meetings.create' and idempotency_key=btrim(p_idempotency_key);
  return v_result;
end;
$$;
revoke all on function public.meetings_create_tx(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.meetings_create_tx(text,text,jsonb) to service_role;

-- Shared transactional side effects for Meetings commands. The caller has
-- already locked and changed the aggregate; this helper serializes the record
-- thread, appends the immutable system timeline item, and writes the platform
-- event, audit row, and durable Communications outbox entry in the same tx.
create or replace function public.meetings_emit_command_side_effects(
  p_actor_id text,
  p_meeting_id uuid,
  p_event_type text,
  p_message text,
  p_payload jsonb,
  p_idempotency_key text
) returns uuid
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_meeting public.meetings%rowtype; v_sequence bigint; v_post_id uuid;
  v_event_id uuid; v_now timestamptz := now();
begin
  select * into v_meeting from public.meetings where id=p_meeting_id;
  if not found then raise exception 'meetings command: meeting not found' using errcode='P0002'; end if;

  update public.message_threads
  set next_message_sequence=next_message_sequence+1, version=version+1,
      last_post_at=v_now, last_post_preview=left(p_message,240)
  where id=v_meeting.discussion_thread_id
  returning next_message_sequence-1 into v_sequence;
  if not found then raise exception 'meetings command: discussion thread not found' using errcode='P0002'; end if;

  insert into public.message_posts(thread_id,author_user_id,body,is_system,post_type,
    system_event_type,system_event_payload,sequence,client_idempotency_key,created_at)
  values(v_meeting.discussion_thread_id,p_actor_id,p_message,true,'system_event',p_event_type,
    coalesce(p_payload,'{}'::jsonb),v_sequence,p_event_type||':'||p_idempotency_key,v_now)
  returning id into v_post_id;

  insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,
    actor_user_id,severity,payload,dedupe_key)
  values(p_event_type,'meetings','meeting',p_meeting_id::text,p_actor_id,'info',
    coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('meetingId',p_meeting_id,'postId',v_post_id),
    p_actor_id||':'||p_event_type||':'||p_idempotency_key)
  returning id into v_event_id;

  insert into public.audit_logs(action,table_name,record_id,user_id,changes,created_at)
  values(p_event_type,'meetings',p_meeting_id::text,p_actor_id,
    coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('eventId',v_event_id,'postId',v_post_id),v_now);

  insert into public.message_event_outbox(event_type,thread_id,actor_id,payload,created_at)
  values('message.created',v_meeting.discussion_thread_id,p_actor_id,jsonb_build_object(
    'threadId',v_meeting.discussion_thread_id,'postId',v_post_id,'sequence',v_sequence,
    'systemEventType',p_event_type,'sourceModule','meetings','sourceEntityId',p_meeting_id::text,
    'participantIds',(select coalesce(jsonb_agg(user_id),'[]'::jsonb)
      from public.message_participants where thread_id=v_meeting.discussion_thread_id and removed_at is null)
  ),v_now);
  return v_event_id;
end;
$$;
revoke all on function public.meetings_emit_command_side_effects(text,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.meetings_emit_command_side_effects(text,uuid,text,text,jsonb,text) to service_role;

create or replace function public.meetings_update_tx(
  p_actor_id text,
  p_idempotency_key text,
  p_meeting_id uuid,
  p_expected_version bigint,
  p_patch jsonb,
  p_scope text default 'series',
  p_occurrence_date date default null
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_hash text; v_existing public.meeting_command_receipts%rowtype;
  v_meeting public.meetings%rowtype; v_calendar public.calendar_entries%rowtype;
  v_schedule jsonb; v_all_day boolean; v_recording text; v_transcript text;
  v_provider text; v_join_url text; v_result jsonb; v_event_id uuid;
begin
  if nullif(btrim(p_actor_id),'') is null or nullif(btrim(p_idempotency_key),'') is null
     or p_meeting_id is null or p_expected_version is null or p_patch is null
     or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb then
    raise exception 'meetings_update: actor, idempotency key, meeting, expected version and non-empty patch are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.app_users where id=p_actor_id and status='active') then
    raise exception 'meetings_update: active actor not found' using errcode='P0002';
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k where k<>all(array[
    'title','description','schedule','labelIds','provider','joinUrl','confidentiality',
    'recordingPolicy','transcriptPolicy','retentionUntil'
  ])) then raise exception 'meetings_update: unsupported patch field' using errcode='22023'; end if;
  if p_scope not in ('series','occurrence') or (p_scope='occurrence')<>(p_occurrence_date is not null) then
    raise exception 'meetings_update: invalid recurrence scope' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor_id||'|meetings.update|'||btrim(p_idempotency_key),0));
  v_hash:=md5(jsonb_build_object('actorId',p_actor_id,'meetingId',p_meeting_id,
    'expectedVersion',p_expected_version,'patch',p_patch,'scope',p_scope,'occurrenceDate',p_occurrence_date)::text);
  select * into v_existing from public.meeting_command_receipts
   where actor_user_id=p_actor_id and operation='meetings.update' and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'meetings_update: idempotency key payload mismatch' using errcode='23000'; end if;
    if v_existing.response is null then raise exception 'meetings_update: incomplete prior command' using errcode='55000'; end if;
    return v_existing.response||jsonb_build_object('deduplicated',true);
  end if;

  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'meetings_update: meeting not found' using errcode='P0002'; end if;
  select * into v_calendar from public.calendar_entries where id=v_meeting.calendar_entry_id for update;
  if not found then raise exception 'meetings_update: calendar activity not found' using errcode='P0002'; end if;
  if v_meeting.version<>p_expected_version then raise exception 'meetings_update: version conflict' using errcode='MT409'; end if;
  if v_meeting.status in ('cancelled','archived') then raise exception 'meetings_update: meeting is immutable' using errcode='55000'; end if;
  if v_calendar.recurrence_rule is not null or p_scope='occurrence' or p_occurrence_date is not null then
    raise exception 'meetings_update: recurring meeting mutation is not supported' using errcode='0A000';
  end if;

  if p_patch ? 'title' and nullif(btrim(p_patch->>'title'),'') is null then
    raise exception 'meetings_update: title cannot be empty' using errcode='22023';
  end if;
  if p_patch ? 'labelIds' and jsonb_typeof(p_patch->'labelIds')<>'array' then
    raise exception 'meetings_update: labelIds must be an array' using errcode='22023';
  end if;
  v_schedule:=p_patch->'schedule';
  if p_patch ? 'schedule' then
    if jsonb_typeof(v_schedule)<>'object' then raise exception 'meetings_update: schedule must be an object' using errcode='22023'; end if;
    if coalesce(v_schedule->>'visibility','personal')='team' and nullif(v_schedule->>'departmentId','') is null then
      raise exception 'meetings_update: department-visible meetings require a department' using errcode='22023';
    end if;
    if nullif(v_schedule->>'departmentId','') is not null
      and not exists(select 1 from public.departments where id=(v_schedule->>'departmentId')) then
      raise exception 'meetings_update: department not found' using errcode='22023';
    end if;
    v_all_day:=coalesce((v_schedule->>'allDay')::boolean,false);
    if v_all_day then
      if nullif(v_schedule->>'startsOn','') is null or nullif(v_schedule->>'startsAt','') is not null or nullif(v_schedule->>'endsAt','') is not null
         or nullif(v_schedule->>'recurrenceRule','') is not null then
        raise exception 'meetings_update: invalid or recurring all-day schedule' using errcode='22023';
      end if;
    elsif nullif(v_schedule->>'startsAt','') is null or nullif(v_schedule->>'endsAt','') is null
       or (v_schedule->>'endsAt')::timestamptz <= (v_schedule->>'startsAt')::timestamptz
       or nullif(v_schedule->>'startsOn','') is not null or nullif(v_schedule->>'endsOn','') is not null
       or nullif(v_schedule->>'recurrenceRule','') is not null then
      raise exception 'meetings_update: invalid or recurring timed schedule' using errcode='22023';
    end if;
  end if;
  v_provider:=case when p_patch ? 'provider' then p_patch->>'provider' else v_meeting.provider end;
  v_join_url:=case when p_patch ? 'joinUrl' then nullif(p_patch->>'joinUrl','') else v_meeting.join_url end;
  v_recording:=case when p_patch ? 'recordingPolicy' then p_patch->>'recordingPolicy' else v_meeting.recording_policy end;
  v_transcript:=case when p_patch ? 'transcriptPolicy' then p_patch->>'transcriptPolicy' else v_meeting.transcript_policy end;
  if v_provider is null or (v_provider='none' and v_join_url is not null) or (v_provider<>'none' and v_join_url is null) then
    raise exception 'meetings_update: provider and joinUrl must be supplied together' using errcode='22023';
  end if;
  if v_transcript='automatic' and v_recording='off' then
    raise exception 'meetings_update: automatic transcript requires recording' using errcode='22023';
  end if;

  insert into public.meeting_command_receipts(actor_user_id,operation,idempotency_key,request_hash,meeting_id)
  values(p_actor_id,'meetings.update',btrim(p_idempotency_key),v_hash,p_meeting_id);
  update public.meetings set
    title=case when p_patch ? 'title' then btrim(p_patch->>'title') else title end,
    description=case when p_patch ? 'description' then nullif(p_patch->>'description','') else description end,
    provider=v_provider, join_url=v_join_url, recording_policy=v_recording, transcript_policy=v_transcript,
    confidentiality=case when p_patch ? 'confidentiality' then p_patch->>'confidentiality' else confidentiality end,
    retention_until=case when p_patch ? 'retentionUntil' then nullif(p_patch->>'retentionUntil','')::timestamptz else retention_until end,
    version=version+1,updated_by=p_actor_id
  where id=p_meeting_id returning * into v_meeting;

  update public.calendar_entries set
    title=v_meeting.title,notes=v_meeting.description,
    all_day=case when p_patch ? 'schedule' then v_all_day else all_day end,
    starts_on=case when p_patch ? 'schedule' and v_all_day then (v_schedule->>'startsOn')::date when p_patch ? 'schedule' then null else starts_on end,
    ends_on=case when p_patch ? 'schedule' and v_all_day then nullif(v_schedule->>'endsOn','')::date when p_patch ? 'schedule' then null else ends_on end,
    starts_at=case when p_patch ? 'schedule' and not v_all_day then (v_schedule->>'startsAt')::timestamptz when p_patch ? 'schedule' then null else starts_at end,
    ends_at=case when p_patch ? 'schedule' and not v_all_day then (v_schedule->>'endsAt')::timestamptz when p_patch ? 'schedule' then null else ends_at end,
    visibility=case when p_patch ? 'schedule' then coalesce(v_schedule->>'visibility',visibility) else visibility end,
    department_id=case when p_patch ? 'schedule' and coalesce(v_schedule->>'visibility',visibility)='team'
      then nullif(v_schedule->>'departmentId','') when p_patch ? 'schedule' then null else department_id end
  where id=v_meeting.calendar_entry_id;
  if p_patch ? 'schedule' then
    update public.meeting_sessions set
      scheduled_starts_at=case when not v_all_day then (v_schedule->>'startsAt')::timestamptz end,
      scheduled_ends_at=case when not v_all_day then (v_schedule->>'endsAt')::timestamptz end
    where meeting_id=p_meeting_id and occurrence_key='master' and status in ('scheduled','ready');
  end if;
  if p_patch ? 'title' then update public.message_threads set subject=v_meeting.title where id=v_meeting.discussion_thread_id; end if;
  if p_patch ? 'labelIds' then
    delete from public.meeting_label_assignments where meeting_id=p_meeting_id;
    insert into public.meeting_label_assignments(meeting_id,label_id,assigned_by)
    select p_meeting_id,(value #>> '{}')::uuid,p_actor_id from jsonb_array_elements(p_patch->'labelIds');
  end if;
  v_event_id:=public.meetings_emit_command_side_effects(p_actor_id,p_meeting_id,'meetings.meeting.updated',
    'Meeting details were updated.',jsonb_build_object('version',v_meeting.version,'patch',p_patch),p_idempotency_key);
  v_result:=jsonb_build_object('meetingId',p_meeting_id,'status',v_meeting.status,'version',v_meeting.version,
    'changed',true,'eventId',v_event_id,'deduplicated',false);
  update public.meeting_command_receipts set response=v_result,completed_at=now()
   where actor_user_id=p_actor_id and operation='meetings.update' and idempotency_key=btrim(p_idempotency_key);
  return v_result;
end;
$$;
revoke all on function public.meetings_update_tx(text,text,uuid,bigint,jsonb,text,date) from public,anon,authenticated;
grant execute on function public.meetings_update_tx(text,text,uuid,bigint,jsonb,text,date) to service_role;

create or replace function public.meetings_agenda_update_tx(
  p_actor_id text,
  p_idempotency_key text,
  p_meeting_id uuid,
  p_expected_version bigint,
  p_items jsonb
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_hash text; v_existing public.meeting_command_receipts%rowtype;
  v_meeting public.meetings%rowtype; v_item record; v_event_id uuid; v_result jsonb;
begin
  if nullif(btrim(p_actor_id),'') is null or nullif(btrim(p_idempotency_key),'') is null
    or p_meeting_id is null or p_expected_version is null or p_items is null
    or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>50 then
    raise exception 'meetings_agenda_update: actor, idempotency key, meeting, expected version and up to 50 items are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.app_users where id=p_actor_id and status='active') then
    raise exception 'meetings_agenda_update: active actor not found' using errcode='P0002';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_items) value
    left join public.app_users u on u.id=nullif(value->>'ownerUserId','') and u.status='active'
    where nullif(btrim(value->>'title'),'') is null
      or char_length(btrim(value->>'title')) > 300
      or coalesce(value->>'status','open') not in ('open','covered','deferred','cancelled')
      or (nullif(value->>'plannedMinutes','') is not null and (value->>'plannedMinutes')::integer <= 0)
      or (nullif(value->>'ownerUserId','') is not null and u.id is null)
  ) then raise exception 'meetings_agenda_update: invalid agenda item' using errcode='22023'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_items) value
    where nullif(value->>'id','') is not null
    group by value->>'id' having count(*)>1
  ) then raise exception 'meetings_agenda_update: duplicate agenda item id' using errcode='22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor_id||'|meetings.agenda.update|'||btrim(p_idempotency_key),0));
  v_hash:=md5(jsonb_build_object('actorId',p_actor_id,'meetingId',p_meeting_id,'expectedVersion',p_expected_version,'items',p_items)::text);
  select * into v_existing from public.meeting_command_receipts
  where actor_user_id=p_actor_id and operation='meetings.agenda.update' and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'meetings_agenda_update: idempotency key payload mismatch' using errcode='23000'; end if;
    if v_existing.response is null then raise exception 'meetings_agenda_update: incomplete prior command' using errcode='55000'; end if;
    return v_existing.response||jsonb_build_object('deduplicated',true);
  end if;

  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'meetings_agenda_update: meeting not found' using errcode='P0002'; end if;
  if v_meeting.version<>p_expected_version then raise exception 'meetings_agenda_update: version conflict' using errcode='MT409'; end if;
  if v_meeting.status in ('cancelled','archived') then raise exception 'meetings_agenda_update: meeting is immutable' using errcode='55000'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_items) value
    left join public.meeting_agenda_items item on item.id=(value->>'id')::uuid and item.meeting_id=p_meeting_id
    where nullif(value->>'id','') is not null and item.id is null
  ) then raise exception 'meetings_agenda_update: agenda item does not belong to this meeting' using errcode='22023'; end if;

  insert into public.meeting_command_receipts(actor_user_id,operation,idempotency_key,request_hash,meeting_id)
  values(p_actor_id,'meetings.agenda.update',btrim(p_idempotency_key),v_hash,p_meeting_id);

  delete from public.meeting_agenda_items existing
  where existing.meeting_id=p_meeting_id and not exists(
    select 1 from jsonb_array_elements(p_items) value
    where nullif(value->>'id','') is not null and (value->>'id')::uuid=existing.id
  );
  update public.meeting_agenda_items set sequence=sequence+1000000 where meeting_id=p_meeting_id;

  for v_item in select value,ordinality from jsonb_array_elements(p_items) with ordinality loop
    if nullif(v_item.value->>'id','') is null then
      insert into public.meeting_agenda_items(meeting_id,sequence,title,description,owner_user_id,status,planned_minutes,created_by,updated_by)
      values(p_meeting_id,(v_item.ordinality-1)::integer,btrim(v_item.value->>'title'),nullif(btrim(v_item.value->>'description'),''),
        nullif(v_item.value->>'ownerUserId',''),coalesce(v_item.value->>'status','open'),nullif(v_item.value->>'plannedMinutes','')::integer,p_actor_id,p_actor_id);
    else
      update public.meeting_agenda_items set sequence=(v_item.ordinality-1)::integer,title=btrim(v_item.value->>'title'),
        description=nullif(btrim(v_item.value->>'description'),''),owner_user_id=nullif(v_item.value->>'ownerUserId',''),
        status=coalesce(v_item.value->>'status','open'),planned_minutes=nullif(v_item.value->>'plannedMinutes','')::integer,
        updated_by=p_actor_id where id=(v_item.value->>'id')::uuid and meeting_id=p_meeting_id;
    end if;
  end loop;

  update public.meetings set version=version+1,updated_by=p_actor_id where id=p_meeting_id returning * into v_meeting;
  v_event_id:=public.meetings_emit_command_side_effects(p_actor_id,p_meeting_id,'meetings.agenda.updated',
    'Meeting agenda was updated.',jsonb_build_object('version',v_meeting.version,'itemCount',jsonb_array_length(p_items)),p_idempotency_key);
  v_result:=jsonb_build_object('meetingId',p_meeting_id,'version',v_meeting.version,'eventId',v_event_id,'deduplicated',false);
  update public.meeting_command_receipts set response=v_result,completed_at=now()
  where actor_user_id=p_actor_id and operation='meetings.agenda.update' and idempotency_key=btrim(p_idempotency_key);
  return v_result;
end;
$$;
revoke all on function public.meetings_agenda_update_tx(text,text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.meetings_agenda_update_tx(text,text,uuid,bigint,jsonb) to service_role;

create or replace function public.meetings_cancel_tx(
  p_actor_id text,p_idempotency_key text,p_meeting_id uuid,p_expected_version bigint,
  p_reason text,p_scope text default 'series',p_occurrence_date date default null
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_hash text; v_existing public.meeting_command_receipts%rowtype;
  v_meeting public.meetings%rowtype; v_calendar public.calendar_entries%rowtype;
  v_result jsonb; v_event_id uuid; v_now timestamptz:=now();
begin
  if nullif(btrim(p_actor_id),'') is null or nullif(btrim(p_idempotency_key),'') is null or p_meeting_id is null
     or p_expected_version is null or nullif(btrim(p_reason),'') is null then
    raise exception 'meetings_cancel: actor, idempotency key, meeting, expected version and reason are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.app_users where id=p_actor_id and status='active') then raise exception 'meetings_cancel: active actor not found' using errcode='P0002'; end if;
  if p_scope not in ('series','occurrence') or (p_scope='occurrence')<>(p_occurrence_date is not null) then raise exception 'meetings_cancel: invalid recurrence scope' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id||'|meetings.cancel|'||btrim(p_idempotency_key),0));
  v_hash:=md5(jsonb_build_object('actorId',p_actor_id,'meetingId',p_meeting_id,'expectedVersion',p_expected_version,
    'reason',btrim(p_reason),'scope',p_scope,'occurrenceDate',p_occurrence_date)::text);
  select * into v_existing from public.meeting_command_receipts where actor_user_id=p_actor_id and operation='meetings.cancel' and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'meetings_cancel: idempotency key payload mismatch' using errcode='23000'; end if;
    if v_existing.response is null then raise exception 'meetings_cancel: incomplete prior command' using errcode='55000'; end if;
    return v_existing.response||jsonb_build_object('deduplicated',true);
  end if;
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'meetings_cancel: meeting not found' using errcode='P0002'; end if;
  select * into v_calendar from public.calendar_entries where id=v_meeting.calendar_entry_id for update;
  if v_meeting.version<>p_expected_version then raise exception 'meetings_cancel: version conflict' using errcode='MT409'; end if;
  if v_meeting.status in ('cancelled','archived','completed') then raise exception 'meetings_cancel: invalid meeting state' using errcode='55000'; end if;
  if v_calendar.recurrence_rule is not null or p_scope='occurrence' or p_occurrence_date is not null then raise exception 'meetings_cancel: recurring meeting mutation is not supported' using errcode='0A000'; end if;
  insert into public.meeting_command_receipts(actor_user_id,operation,idempotency_key,request_hash,meeting_id)
  values(p_actor_id,'meetings.cancel',btrim(p_idempotency_key),v_hash,p_meeting_id);
  update public.meetings set status='cancelled',cancelled_at=v_now,cancelled_by=p_actor_id,
    cancellation_reason=btrim(p_reason),version=version+1,updated_by=p_actor_id where id=p_meeting_id returning * into v_meeting;
  update public.meeting_sessions set status='cancelled' where meeting_id=p_meeting_id and status in ('scheduled','ready');
  v_event_id:=public.meetings_emit_command_side_effects(p_actor_id,p_meeting_id,'meetings.meeting.cancelled',
    'Meeting cancelled: '||btrim(p_reason),jsonb_build_object('reason',btrim(p_reason),'version',v_meeting.version),p_idempotency_key);
  v_result:=jsonb_build_object('meetingId',p_meeting_id,'status',v_meeting.status,'version',v_meeting.version,'changed',true,'eventId',v_event_id,'deduplicated',false);
  update public.meeting_command_receipts set response=v_result,completed_at=now() where actor_user_id=p_actor_id and operation='meetings.cancel' and idempotency_key=btrim(p_idempotency_key);
  return v_result;
end;
$$;
revoke all on function public.meetings_cancel_tx(text,text,uuid,bigint,text,text,date) from public,anon,authenticated;
grant execute on function public.meetings_cancel_tx(text,text,uuid,bigint,text,text,date) to service_role;

create or replace function public.meetings_archive_tx(
  p_actor_id text,p_idempotency_key text,p_meeting_id uuid,p_expected_version bigint
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_hash text; v_existing public.meeting_command_receipts%rowtype;
  v_meeting public.meetings%rowtype; v_result jsonb; v_event_id uuid; v_now timestamptz:=now();
begin
  if nullif(btrim(p_actor_id),'') is null or nullif(btrim(p_idempotency_key),'') is null or p_meeting_id is null or p_expected_version is null then raise exception 'meetings_archive: required argument missing' using errcode='22023'; end if;
  if not exists(select 1 from public.app_users where id=p_actor_id and status='active') then raise exception 'meetings_archive: active actor not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id||'|meetings.archive|'||btrim(p_idempotency_key),0));
  v_hash:=md5(jsonb_build_object('actorId',p_actor_id,'meetingId',p_meeting_id,'expectedVersion',p_expected_version)::text);
  select * into v_existing from public.meeting_command_receipts where actor_user_id=p_actor_id and operation='meetings.archive' and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'meetings_archive: idempotency key payload mismatch' using errcode='23000'; end if;
    if v_existing.response is null then raise exception 'meetings_archive: incomplete prior command' using errcode='55000'; end if;
    return v_existing.response||jsonb_build_object('deduplicated',true);
  end if;
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'meetings_archive: meeting not found' using errcode='P0002'; end if;
  if v_meeting.version<>p_expected_version then raise exception 'meetings_archive: version conflict' using errcode='MT409'; end if;
  if v_meeting.status<>'completed' then raise exception 'meetings_archive: only completed meetings may be archived' using errcode='55000'; end if;
  insert into public.meeting_command_receipts(actor_user_id,operation,idempotency_key,request_hash,meeting_id) values(p_actor_id,'meetings.archive',btrim(p_idempotency_key),v_hash,p_meeting_id);
  update public.meetings set status='archived',archived_at=v_now,archived_by=p_actor_id,version=version+1,updated_by=p_actor_id where id=p_meeting_id returning * into v_meeting;
  update public.message_threads set archived_at=coalesce(archived_at,v_now) where id=v_meeting.discussion_thread_id;
  v_event_id:=public.meetings_emit_command_side_effects(p_actor_id,p_meeting_id,'meetings.meeting.archived','Meeting archived.',jsonb_build_object('version',v_meeting.version),p_idempotency_key);
  v_result:=jsonb_build_object('meetingId',p_meeting_id,'status',v_meeting.status,'version',v_meeting.version,'changed',true,'eventId',v_event_id,'deduplicated',false);
  update public.meeting_command_receipts set response=v_result,completed_at=now() where actor_user_id=p_actor_id and operation='meetings.archive' and idempotency_key=btrim(p_idempotency_key);
  return v_result;
end;
$$;
revoke all on function public.meetings_archive_tx(text,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.meetings_archive_tx(text,text,uuid,bigint) to service_role;

create or replace function public.meetings_participants_invite_tx(
  p_actor_id text,p_idempotency_key text,p_meeting_id uuid,p_expected_version bigint,p_participants jsonb
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_hash text; v_existing public.meeting_command_receipts%rowtype; v_meeting public.meetings%rowtype;
  v_participant jsonb; v_attendee_id uuid; v_added_ids jsonb:='[]'::jsonb;
  v_result jsonb; v_event_id uuid; v_now timestamptz:=now();
begin
  if nullif(btrim(p_actor_id),'') is null or nullif(btrim(p_idempotency_key),'') is null or p_meeting_id is null
     or p_expected_version is null or p_participants is null or jsonb_typeof(p_participants)<>'array' or jsonb_array_length(p_participants)=0 then
    raise exception 'meetings_participants_invite: required argument missing' using errcode='22023';
  end if;
  if not exists(select 1 from public.app_users where id=p_actor_id and status='active') then raise exception 'meetings_participants_invite: active actor not found' using errcode='P0002'; end if;
  if exists(select 1 from jsonb_array_elements(p_participants) value group by value->>'userId' having count(*)>1) then raise exception 'meetings_participants_invite: duplicate participant' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_participants) value left join public.app_users u on u.id=value->>'userId' and u.status='active' where nullif(value->>'userId','') is null or u.id is null) then raise exception 'meetings_participants_invite: participant must be an active user' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_participants) value where jsonb_typeof(value)<>'object') then raise exception 'meetings_participants_invite: each participant must be an object' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_participants) value where coalesce(value->>'role','attendee') not in ('presenter','attendee','observer') or exists(select 1 from jsonb_object_keys(value) k where k<>all(array['userId','role','required']))) then raise exception 'meetings_participants_invite: invalid participant payload' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id||'|meetings.participants.invite|'||btrim(p_idempotency_key),0));
  v_hash:=md5(jsonb_build_object('actorId',p_actor_id,'meetingId',p_meeting_id,'expectedVersion',p_expected_version,'participants',p_participants)::text);
  select * into v_existing from public.meeting_command_receipts where actor_user_id=p_actor_id and operation='meetings.participants.invite' and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'meetings_participants_invite: idempotency key payload mismatch' using errcode='23000'; end if;
    if v_existing.response is null then raise exception 'meetings_participants_invite: incomplete prior command' using errcode='55000'; end if;
    return v_existing.response||jsonb_build_object('deduplicated',true);
  end if;
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'meetings_participants_invite: meeting not found' using errcode='P0002'; end if;
  if v_meeting.version<>p_expected_version then raise exception 'meetings_participants_invite: version conflict' using errcode='MT409'; end if;
  if v_meeting.status in ('cancelled','archived','completed') then raise exception 'meetings_participants_invite: invalid meeting state' using errcode='55000'; end if;
  if exists(select 1 from jsonb_array_elements(p_participants) value where value->>'userId'=v_meeting.organizer_user_id) then raise exception 'meetings_participants_invite: organizer cannot be invited' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_participants) value join public.meeting_participants mp on mp.meeting_id=p_meeting_id and mp.user_id=value->>'userId' and mp.removed_at is null) then raise exception 'meetings_participants_invite: participant already active' using errcode='23505'; end if;
  insert into public.meeting_command_receipts(actor_user_id,operation,idempotency_key,request_hash,meeting_id) values(p_actor_id,'meetings.participants.invite',btrim(p_idempotency_key),v_hash,p_meeting_id);

  for v_participant in select value from jsonb_array_elements(p_participants) loop
    insert into public.calendar_activity_attendees(calendar_entry_id,user_id,response_status,responded_at)
    values(v_meeting.calendar_entry_id,v_participant->>'userId','invited',null)
    on conflict(calendar_entry_id,user_id) do update set response_status='invited',responded_at=null
    returning id into v_attendee_id;
    insert into public.meeting_participants(meeting_id,calendar_attendee_id,user_id,role,required,added_by,added_at,removed_by,removed_at)
    values(p_meeting_id,v_attendee_id,v_participant->>'userId',coalesce(v_participant->>'role','attendee'),coalesce((v_participant->>'required')::boolean,true),p_actor_id,v_now,null,null)
    on conflict(meeting_id,user_id) do update set calendar_attendee_id=excluded.calendar_attendee_id,role=excluded.role,
      required=excluded.required,added_by=excluded.added_by,added_at=excluded.added_at,removed_by=null,removed_at=null;
    insert into public.message_participants(thread_id,user_id,role,joined_at,removed_at,archived_at)
    values(v_meeting.discussion_thread_id,v_participant->>'userId','participant',v_now,null,null)
    on conflict(thread_id,user_id) do update set role=case when message_participants.role='owner' then 'owner' else 'participant' end,
      joined_at=case when message_participants.removed_at is not null then v_now else message_participants.joined_at end,
      removed_at=null,archived_at=null;
    v_added_ids:=v_added_ids||jsonb_build_array(v_participant->>'userId');
  end loop;
  update public.meetings set version=version+1,updated_by=p_actor_id where id=p_meeting_id returning * into v_meeting;
  v_event_id:=public.meetings_emit_command_side_effects(p_actor_id,p_meeting_id,'meetings.participants.invited',
    'Participants were invited to the meeting.',jsonb_build_object('addedUserIds',v_added_ids,'version',v_meeting.version),p_idempotency_key);
  v_result:=jsonb_build_object('meetingId',p_meeting_id,'addedUserIds',v_added_ids,'version',v_meeting.version,'eventId',v_event_id,'deduplicated',false);
  update public.meeting_command_receipts set response=v_result,completed_at=now() where actor_user_id=p_actor_id and operation='meetings.participants.invite' and idempotency_key=btrim(p_idempotency_key);
  return v_result;
end;
$$;
revoke all on function public.meetings_participants_invite_tx(text,text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.meetings_participants_invite_tx(text,text,uuid,bigint,jsonb) to service_role;

create or replace function public.meetings_participant_remove_tx(
  p_actor_id text,p_idempotency_key text,p_meeting_id uuid,p_expected_version bigint,
  p_user_id text,p_reason text default null
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_hash text; v_existing public.meeting_command_receipts%rowtype; v_meeting public.meetings%rowtype;
  v_participant public.meeting_participants%rowtype; v_result jsonb; v_event_id uuid; v_now timestamptz:=now();
begin
  if nullif(btrim(p_actor_id),'') is null or nullif(btrim(p_idempotency_key),'') is null or p_meeting_id is null or p_expected_version is null or nullif(btrim(p_user_id),'') is null then raise exception 'meetings_participant_remove: required argument missing' using errcode='22023'; end if;
  if not exists(select 1 from public.app_users where id=p_actor_id and status='active') then raise exception 'meetings_participant_remove: active actor not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id||'|meetings.participant.remove|'||btrim(p_idempotency_key),0));
  v_hash:=md5(jsonb_build_object('actorId',p_actor_id,'meetingId',p_meeting_id,'expectedVersion',p_expected_version,'userId',p_user_id,'reason',p_reason)::text);
  select * into v_existing from public.meeting_command_receipts where actor_user_id=p_actor_id and operation='meetings.participant.remove' and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'meetings_participant_remove: idempotency key payload mismatch' using errcode='23000'; end if;
    if v_existing.response is null then raise exception 'meetings_participant_remove: incomplete prior command' using errcode='55000'; end if;
    return v_existing.response||jsonb_build_object('deduplicated',true);
  end if;
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'meetings_participant_remove: meeting not found' using errcode='P0002'; end if;
  if v_meeting.version<>p_expected_version then raise exception 'meetings_participant_remove: version conflict' using errcode='MT409'; end if;
  if v_meeting.status in ('cancelled','archived','completed') then raise exception 'meetings_participant_remove: invalid meeting state' using errcode='55000'; end if;
  select * into v_participant from public.meeting_participants where meeting_id=p_meeting_id and user_id=p_user_id for update;
  if not found or v_participant.removed_at is not null then raise exception 'meetings_participant_remove: active participant not found' using errcode='P0002'; end if;
  if v_participant.role='organizer' then raise exception 'meetings_participant_remove: organizer cannot be removed' using errcode='55000'; end if;
  insert into public.meeting_command_receipts(actor_user_id,operation,idempotency_key,request_hash,meeting_id) values(p_actor_id,'meetings.participant.remove',btrim(p_idempotency_key),v_hash,p_meeting_id);
  update public.meeting_participants set removed_at=v_now,removed_by=p_actor_id where id=v_participant.id;
  update public.calendar_activity_attendees set response_status='declined',responded_at=v_now where id=v_participant.calendar_attendee_id;
  update public.message_participants set removed_at=v_now where thread_id=v_meeting.discussion_thread_id and user_id=p_user_id;
  update public.meetings set version=version+1,updated_by=p_actor_id where id=p_meeting_id returning * into v_meeting;
  v_event_id:=public.meetings_emit_command_side_effects(p_actor_id,p_meeting_id,'meetings.participant.removed',
    'A participant was removed from the meeting.',jsonb_strip_nulls(jsonb_build_object('removedUserId',p_user_id,'reason',nullif(btrim(p_reason),''),'version',v_meeting.version)),p_idempotency_key);
  v_result:=jsonb_build_object('meetingId',p_meeting_id,'removedUserId',p_user_id,'version',v_meeting.version,'eventId',v_event_id,'deduplicated',false);
  update public.meeting_command_receipts set response=v_result,completed_at=now() where actor_user_id=p_actor_id and operation='meetings.participant.remove' and idempotency_key=btrim(p_idempotency_key);
  return v_result;
end;
$$;
revoke all on function public.meetings_participant_remove_tx(text,text,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.meetings_participant_remove_tx(text,text,uuid,bigint,text,text) to service_role;

create or replace function public.meetings_rsvp_tx(
  p_actor_id text,p_idempotency_key text,p_meeting_id uuid,p_expected_version bigint,p_response_status text
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_hash text; v_existing public.meeting_command_receipts%rowtype; v_meeting public.meetings%rowtype;
  v_participant public.meeting_participants%rowtype; v_result jsonb; v_event_id uuid; v_now timestamptz:=now();
begin
  if nullif(btrim(p_actor_id),'') is null or nullif(btrim(p_idempotency_key),'') is null or p_meeting_id is null or p_expected_version is null or p_response_status not in ('accepted','declined','tentative') then raise exception 'meetings_rsvp: invalid or missing argument' using errcode='22023'; end if;
  if not exists(select 1 from public.app_users where id=p_actor_id and status='active') then raise exception 'meetings_rsvp: active actor not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id||'|meetings.rsvp|'||btrim(p_idempotency_key),0));
  v_hash:=md5(jsonb_build_object('actorId',p_actor_id,'meetingId',p_meeting_id,'expectedVersion',p_expected_version,'responseStatus',p_response_status)::text);
  select * into v_existing from public.meeting_command_receipts where actor_user_id=p_actor_id and operation='meetings.rsvp' and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'meetings_rsvp: idempotency key payload mismatch' using errcode='23000'; end if;
    if v_existing.response is null then raise exception 'meetings_rsvp: incomplete prior command' using errcode='55000'; end if;
    return v_existing.response||jsonb_build_object('deduplicated',true);
  end if;
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'meetings_rsvp: meeting not found' using errcode='P0002'; end if;
  if v_meeting.version<>p_expected_version then raise exception 'meetings_rsvp: version conflict' using errcode='MT409'; end if;
  if v_meeting.status<>'scheduled' then raise exception 'meetings_rsvp: meeting is not accepting responses' using errcode='55000'; end if;
  select * into v_participant from public.meeting_participants where meeting_id=p_meeting_id and user_id=p_actor_id and removed_at is null for update;
  if not found then raise exception 'meetings_rsvp: active invitation not found' using errcode='P0002'; end if;
  insert into public.meeting_command_receipts(actor_user_id,operation,idempotency_key,request_hash,meeting_id) values(p_actor_id,'meetings.rsvp',btrim(p_idempotency_key),v_hash,p_meeting_id);
  update public.calendar_activity_attendees set response_status=p_response_status,responded_at=v_now where id=v_participant.calendar_attendee_id;
  update public.meetings set version=version+1,updated_by=p_actor_id where id=p_meeting_id returning * into v_meeting;
  v_event_id:=public.meetings_emit_command_side_effects(p_actor_id,p_meeting_id,'meetings.participant.rsvp_changed',
    'A participant responded '||p_response_status||'.',jsonb_build_object('userId',p_actor_id,'responseStatus',p_response_status,'respondedAt',v_now,'version',v_meeting.version),p_idempotency_key);
  v_result:=jsonb_build_object('meetingId',p_meeting_id,'responseStatus',p_response_status,'respondedAt',v_now,'version',v_meeting.version,'eventId',v_event_id,'deduplicated',false);
  update public.meeting_command_receipts set response=v_result,completed_at=now() where actor_user_id=p_actor_id and operation='meetings.rsvp' and idempotency_key=btrim(p_idempotency_key);
  return v_result;
end;
$$;
revoke all on function public.meetings_rsvp_tx(text,text,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.meetings_rsvp_tx(text,text,uuid,bigint,text) to service_role;

create or replace function public.meetings_session_start_tx(
  p_actor_id text,p_idempotency_key text,p_meeting_id uuid,p_occurrence_key text
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_hash text; v_existing public.meeting_command_receipts%rowtype; v_meeting public.meetings%rowtype;
  v_calendar public.calendar_entries%rowtype; v_session public.meeting_sessions%rowtype;
  v_result jsonb; v_event_id uuid; v_now timestamptz:=now();
begin
  if nullif(btrim(p_actor_id),'') is null or nullif(btrim(p_idempotency_key),'') is null or p_meeting_id is null or nullif(btrim(p_occurrence_key),'') is null then raise exception 'meetings_session_start: required argument missing' using errcode='22023'; end if;
  if not exists(select 1 from public.app_users where id=p_actor_id and status='active') then raise exception 'meetings_session_start: active actor not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id||'|meetings.session.start|'||btrim(p_idempotency_key),0));
  v_hash:=md5(jsonb_build_object('actorId',p_actor_id,'meetingId',p_meeting_id,'occurrenceKey',btrim(p_occurrence_key))::text);
  select * into v_existing from public.meeting_command_receipts where actor_user_id=p_actor_id and operation='meetings.session.start' and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'meetings_session_start: idempotency key payload mismatch' using errcode='23000'; end if;
    if v_existing.response is null then raise exception 'meetings_session_start: incomplete prior command' using errcode='55000'; end if;
    return v_existing.response||jsonb_build_object('deduplicated',true);
  end if;
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'meetings_session_start: meeting not found' using errcode='P0002'; end if;
  select * into v_calendar from public.calendar_entries where id=v_meeting.calendar_entry_id for share;
  if v_calendar.recurrence_rule is not null or btrim(p_occurrence_key)<>'master' then raise exception 'meetings_session_start: recurring occurrence mutation is not supported' using errcode='0A000'; end if;
  if v_meeting.status not in ('draft','scheduled') then raise exception 'meetings_session_start: invalid meeting state' using errcode='55000'; end if;
  select * into v_session from public.meeting_sessions where meeting_id=p_meeting_id and occurrence_key=btrim(p_occurrence_key) for update;
  if not found then raise exception 'meetings_session_start: session not found' using errcode='P0002'; end if;
  if v_session.status not in ('scheduled','ready') then raise exception 'meetings_session_start: session status conflict' using errcode='MT409'; end if;
  insert into public.meeting_command_receipts(actor_user_id,operation,idempotency_key,request_hash,meeting_id) values(p_actor_id,'meetings.session.start',btrim(p_idempotency_key),v_hash,p_meeting_id);
  update public.meeting_sessions set status='live',actual_started_at=v_now,actual_ended_at=null,started_by=p_actor_id,ended_by=null where id=v_session.id returning * into v_session;
  update public.meetings set status='in_progress',version=version+1,updated_by=p_actor_id where id=p_meeting_id returning * into v_meeting;
  v_event_id:=public.meetings_emit_command_side_effects(p_actor_id,p_meeting_id,'meetings.session.started',
    'Meeting session started.',jsonb_build_object('sessionId',v_session.id,'occurrenceKey',v_session.occurrence_key,'version',v_meeting.version),p_idempotency_key);
  v_result:=jsonb_build_object('id',v_session.id,'meetingId',p_meeting_id,'occurrenceKey',v_session.occurrence_key,
    'status',v_session.status,'scheduledStartsAt',v_session.scheduled_starts_at,'scheduledEndsAt',v_session.scheduled_ends_at,
    'startedAt',v_session.actual_started_at,'endedAt',v_session.actual_ended_at,'transcriptStatus',v_session.transcript_status,
    'failureReason',v_session.failure_detail,'version',v_meeting.version,'eventId',v_event_id,'deduplicated',false);
  update public.meeting_command_receipts set response=v_result,completed_at=now() where actor_user_id=p_actor_id and operation='meetings.session.start' and idempotency_key=btrim(p_idempotency_key);
  return v_result;
end;
$$;
revoke all on function public.meetings_session_start_tx(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.meetings_session_start_tx(text,text,uuid,text) to service_role;

create or replace function public.meetings_session_end_tx(
  p_actor_id text,p_idempotency_key text,p_meeting_id uuid,p_session_id uuid,p_expected_status text
) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  v_hash text; v_existing public.meeting_command_receipts%rowtype; v_meeting public.meetings%rowtype;
  v_session public.meeting_sessions%rowtype; v_result jsonb; v_event_id uuid;
  v_now timestamptz:=now(); v_terminal_status text; v_meeting_status text;
begin
  if nullif(btrim(p_actor_id),'') is null or nullif(btrim(p_idempotency_key),'') is null or p_meeting_id is null or p_session_id is null or p_expected_status not in ('ready','live') then raise exception 'meetings_session_end: invalid or missing argument' using errcode='22023'; end if;
  if not exists(select 1 from public.app_users where id=p_actor_id and status='active') then raise exception 'meetings_session_end: active actor not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id||'|meetings.session.end|'||btrim(p_idempotency_key),0));
  v_hash:=md5(jsonb_build_object('actorId',p_actor_id,'meetingId',p_meeting_id,'sessionId',p_session_id,'expectedStatus',p_expected_status)::text);
  select * into v_existing from public.meeting_command_receipts where actor_user_id=p_actor_id and operation='meetings.session.end' and idempotency_key=btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash<>v_hash then raise exception 'meetings_session_end: idempotency key payload mismatch' using errcode='23000'; end if;
    if v_existing.response is null then raise exception 'meetings_session_end: incomplete prior command' using errcode='55000'; end if;
    return v_existing.response||jsonb_build_object('deduplicated',true);
  end if;
  select * into v_meeting from public.meetings where id=p_meeting_id for update;
  if not found then raise exception 'meetings_session_end: meeting not found' using errcode='P0002'; end if;
  if v_meeting.status in ('cancelled','archived','completed') then raise exception 'meetings_session_end: invalid meeting state' using errcode='55000'; end if;
  select * into v_session from public.meeting_sessions where id=p_session_id and meeting_id=p_meeting_id for update;
  if not found then raise exception 'meetings_session_end: session not found' using errcode='P0002'; end if;
  if v_session.occurrence_key<>'master' or exists(select 1 from public.calendar_entries where id=v_meeting.calendar_entry_id and recurrence_rule is not null) then raise exception 'meetings_session_end: recurring occurrence mutation is not supported' using errcode='0A000'; end if;
  if v_session.status<>p_expected_status then raise exception 'meetings_session_end: session status conflict' using errcode='MT409'; end if;
  v_terminal_status:=case when v_meeting.recording_policy='required' or v_meeting.transcript_policy='automatic' then 'processing' else 'completed' end;
  v_meeting_status:=case when v_terminal_status='processing' then 'processing' else 'completed' end;
  insert into public.meeting_command_receipts(actor_user_id,operation,idempotency_key,request_hash,meeting_id) values(p_actor_id,'meetings.session.end',btrim(p_idempotency_key),v_hash,p_meeting_id);
  update public.meeting_sessions set status=v_terminal_status,actual_started_at=coalesce(actual_started_at,v_now),
    actual_ended_at=v_now,started_by=coalesce(started_by,p_actor_id),ended_by=p_actor_id,
    transcript_status=case when v_meeting.transcript_policy='automatic' then 'queued' else transcript_status end
  where id=p_session_id returning * into v_session;
  update public.meetings set status=v_meeting_status,version=version+1,updated_by=p_actor_id where id=p_meeting_id returning * into v_meeting;
  v_event_id:=public.meetings_emit_command_side_effects(p_actor_id,p_meeting_id,'meetings.session.ended',
    'Meeting session ended.',jsonb_build_object('sessionId',p_session_id,'sessionStatus',v_session.status,'meetingStatus',v_meeting.status,'version',v_meeting.version),p_idempotency_key);
  v_result:=jsonb_build_object('id',v_session.id,'meetingId',p_meeting_id,'occurrenceKey',v_session.occurrence_key,
    'status',v_session.status,'scheduledStartsAt',v_session.scheduled_starts_at,'scheduledEndsAt',v_session.scheduled_ends_at,
    'startedAt',v_session.actual_started_at,'endedAt',v_session.actual_ended_at,'transcriptStatus',v_session.transcript_status,
    'failureReason',v_session.failure_detail,'version',v_meeting.version,'eventId',v_event_id,'deduplicated',false);
  update public.meeting_command_receipts set response=v_result,completed_at=now() where actor_user_id=p_actor_id and operation='meetings.session.end' and idempotency_key=btrim(p_idempotency_key);
  return v_result;
end;
$$;
revoke all on function public.meetings_session_end_tx(text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.meetings_session_end_tx(text,text,uuid,uuid,text) to service_role;

commit;

notify pgrst, 'reload schema';
