-- ============================================================================
-- SIOMAC Ticket Center backend
--
-- Replaces the incomplete canonical ticket CRUD path with:
--   * configured request types and module queues
--   * participant-scoped reads and internal-note protection
--   * immutable activity sequencing, tags, and per-user read cursors
--   * idempotent, atomic create/comment/command mutations
--   * in-transaction app_events, audit_logs, ticket_events, and notifications
--   * idempotent overdue processing
--
-- app_users.id is TEXT. Browser clients receive ticket data only through the
-- authenticated Netlify API; every public RPC is service_role-only.
-- ============================================================================

create schema if not exists ticket_internal;
revoke all on schema ticket_internal from public, anon, authenticated;
grant usage on schema ticket_internal to service_role;

create table if not exists public.ticket_queues (
  code                text primary key,
  label               text not null,
  module              text not null,
  handler_permission  text not null,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create table if not exists public.ticket_request_types (
  code                       text primary key,
  queue_code                 text not null references public.ticket_queues(code),
  label                      text not null,
  description                text not null default '',
  category                   text not null,
  default_priority           text not null default 'medium'
                             check (default_priority in ('low','medium','high','critical')),
  response_target_minutes    integer not null check (response_target_minutes > 0),
  resolution_target_minutes  integer not null check (resolution_target_minutes > 0),
  system_tags                text[] not null default '{}',
  is_confidential            boolean not null default false,
  is_active                  boolean not null default true,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz
);

alter table public.ticket_queues enable row level security;
alter table public.ticket_request_types enable row level security;
revoke all on public.ticket_queues, public.ticket_request_types
  from anon, authenticated;
grant select, insert, update, delete on public.ticket_queues, public.ticket_request_types
  to service_role;

insert into public.ticket_queues (code, label, module, handler_permission)
values
  ('hr',         'People & HR',        'hr',       'hr.requests.manage'),
  ('payroll',    'Payroll Support',    'payroll',  'finance.payroll.view_all'),
  ('attendance', 'Attendance & Leave', 'hr',       'hr.attendance.exceptions.manage'),
  ('it',         'IT & System Help',   'platform', 'settings.system.manage'),
  ('facilities', 'Facilities & Admin', 'platform', 'tickets.manage'),
  ('hse',        'HSE Follow-up',      'hse',      'hse.incidents.manage'),
  ('general',    'General Support',    'platform', 'tickets.manage')
on conflict (code) do update
set label = excluded.label,
    module = excluded.module,
    handler_permission = excluded.handler_permission,
    is_active = true,
    updated_at = now();

insert into public.ticket_request_types (
  code, queue_code, label, description, category, default_priority,
  response_target_minutes, resolution_target_minutes, system_tags, is_confidential
)
values
  ('employment_letter', 'hr', 'Employment letter',
   'Request a standard employment or job letter.', 'employee_document', 'medium',
   480, 2880, array['HR','Job letter'], false),
  ('payslip_query', 'payroll', 'Payslip query',
   'Ask for help understanding or correcting a payslip.', 'payroll_query', 'medium',
   240, 1440, array['Payroll','Payslip'], true),
  ('attendance_correction', 'attendance', 'Attendance correction help',
   'Request help with a missed or incorrect attendance record.', 'attendance', 'medium',
   240, 1440, array['Attendance','Correction'], false),
  ('leave_assistance', 'attendance', 'Leave assistance',
   'Request help with an existing leave transaction.', 'leave', 'medium',
   480, 1440, array['Leave','Assistance'], false),
  ('employee_record_correction', 'hr', 'Employee record correction',
   'Request correction of personal or employment data.', 'employee_record', 'medium',
   480, 2880, array['HR','Employee record'], true),
  ('benefits_statutory_assistance', 'hr', 'Benefits or statutory assistance',
   'Ask for help with benefits or statutory employment documents.', 'benefits', 'medium',
   480, 2880, array['HR','Benefits'], true),
  ('facilities_issue', 'facilities', 'Facilities issue',
   'Report an office, building, or shared-services issue.', 'facilities', 'medium',
   240, 1440, array['Facilities'], false),
  ('technical_support', 'it', 'Technical support',
   'Request help with SIOMAC access or workplace technology.', 'technical_support', 'medium',
   120, 960, array['IT','Technical support'], false),
  ('general_hr', 'hr', 'General HR request',
   'Ask a people-services question that does not fit another request type.', 'general_hr', 'low',
   480, 2880, array['HR','General'], false),
  ('hse_confidential_concern', 'hse', 'Confidential HSE concern',
   'Raise a confidential safety concern for HSE follow-up.', 'hse_concern', 'high',
   120, 480, array['HSE','Confidential'], true),
  ('expense_receipt', 'general', 'Missing expense receipt',
   'Follow up a missing receipt that blocks expense reimbursement.', 'expense_receipt', 'medium',
   240, 1440, array['Finance','Receipt'], true),
  ('finance_admin', 'payroll', 'Finance administration follow-up',
   'Resolve employee payment data that blocks an approved finance process.', 'finance_admin', 'high',
   120, 480, array['Finance','Action required'], true),
  ('compliance', 'hr', 'Statutory profile correction',
   'Coordinate an employee statutory-profile correction with HR.', 'compliance', 'high',
   240, 1440, array['HR','Statutory','Correction'], true),
  ('finance_compliance', 'payroll', 'Finance compliance follow-up',
   'Follow up an overdue filing or missing authority receipt.', 'finance_compliance', 'high',
   120, 480, array['Finance','Compliance'], true),
  ('general_support', 'general', 'General support',
   'General support request used for migrated tickets and approved module integrations.', 'general', 'medium',
   480, 2880, array['Support'], false)
on conflict (code) do update
set queue_code = excluded.queue_code,
    label = excluded.label,
    description = excluded.description,
    category = excluded.category,
    default_priority = excluded.default_priority,
    response_target_minutes = excluded.response_target_minutes,
    resolution_target_minutes = excluded.resolution_target_minutes,
    system_tags = excluded.system_tags,
    is_confidential = excluded.is_confidential,
    is_active = true,
    updated_at = now();

-- ── Request-type routing flags + classification (idempotent) ────────────────────
-- is_employee_requestable: types ordinary staff may raise (self/team/on_behalf).
-- is_internal_requestable: internal/integration types (internal mode only) — must
-- NOT be exposed to ordinary staff (filtered in ticket_request_types_for_actor).
alter table public.ticket_request_types
  add column if not exists is_employee_requestable boolean not null default false,
  add column if not exists is_internal_requestable boolean not null default false;

update public.ticket_request_types
set is_employee_requestable = (code in (
      'employment_letter','payslip_query','attendance_correction','leave_assistance',
      'employee_record_correction','benefits_statutory_assistance','facilities_issue',
      'technical_support','general_hr','hse_confidential_concern')),
    is_internal_requestable = (code in (
      'expense_receipt','finance_admin','compliance','finance_compliance','general_support'));

alter table public.tickets
  add column if not exists request_type_code text references public.ticket_request_types(code),
  add column if not exists queue_code text references public.ticket_queues(code),
  add column if not exists response_due_at timestamptz,
  add column if not exists resolution_due_at timestamptz,
  add column if not exists response_target_minutes integer,
  add column if not exists resolution_target_minutes integer,
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists activity_sequence bigint not null default 0,
  add column if not exists version bigint not null default 1,
  add column if not exists overdue_notified_at timestamptz,
  add column if not exists is_confidential boolean not null default false,
  -- Creation provenance: who created the ticket, in what mode, and (on_behalf) why.
  add column if not exists created_by_user_id text references public.app_users(id),
  add column if not exists creation_mode text not null default 'self',
  add column if not exists creation_reason text;

update public.tickets
set request_type_code = coalesce(request_type_code, 'general_support'),
    queue_code = coalesce(queue_code, 'general'),
    response_target_minutes = coalesce(response_target_minutes, 480),
    resolution_target_minutes = coalesce(resolution_target_minutes, 2880),
    response_due_at = coalesce(response_due_at, created_at + interval '480 minutes'),
    resolution_due_at = coalesce(resolution_due_at, sla_due_at, created_at + interval '2880 minutes'),
    last_activity_at = coalesce(last_activity_at, updated_at, created_at),
    created_by_user_id = coalesce(created_by_user_id, requester_user_id)
where request_type_code is null
   or queue_code is null
   or response_target_minutes is null
   or resolution_target_minutes is null
   or response_due_at is null
   or resolution_due_at is null
   or created_by_user_id is null;

-- ── Ticket creation-mode constraints (guarded — a plain ADD CONSTRAINT is not
-- idempotent, so gate on pg_constraint so the source is safely rerunnable). ──────
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tickets_creation_mode_chk') then
    alter table public.tickets add constraint tickets_creation_mode_chk
      check (creation_mode in ('self','team','on_behalf','internal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tickets_on_behalf_reason_chk') then
    alter table public.tickets add constraint tickets_on_behalf_reason_chk
      check (creation_mode <> 'on_behalf' or (creation_reason is not null and btrim(creation_reason) <> ''));
  end if;
end $$;

-- ── Ticket-creation permission grants (idempotent) ──────────────────────────────
-- The four granular create keys. Enforcement reads these rows via
-- ticket_internal.user_has_permission (RPC) and requirePermission (routes). Roles
-- don't inherit — each grant is explicit. Superadmin is allow-all elsewhere; listed
-- here for completeness. Keep in sync with src/lib/permissions.ts + netlify BE
-- permissions.ts role sets.
-- create_self: EVERY application role. Driven off the roles table so it covers any
-- custom role too and can never violate the role_permissions -> roles(name) FK.
insert into public.role_permissions (role_name, permission)
select r.name, 'tickets.create_self'
from public.roles r
on conflict (role_name, permission) do nothing;

-- Mode-specific grants — only for roles that actually exist (the exists-guard skips
-- any missing role rather than tripping the FK). Keep in sync with the FE + BE
-- permissions.ts role sets (superadmin is allow-all; listed for completeness).
insert into public.role_permissions (role_name, permission)
select g.role_name, g.permission
from (values
  -- create_team: manager + admin/superadmin
  ('superadmin','tickets.create_team'), ('admin','tickets.create_team'), ('manager','tickets.create_team'),
  -- create_on_behalf: admin/superadmin only
  ('superadmin','tickets.create_on_behalf'), ('admin','tickets.create_on_behalf'),
  -- create_internal: admin/superadmin + module service-queue handler roles
  ('superadmin','tickets.create_internal'), ('admin','tickets.create_internal'),
  ('hr_staff','tickets.create_internal'), ('hr_manager','tickets.create_internal'),
  ('hse_staff','tickets.create_internal'),
  ('finance_staff','tickets.create_internal'), ('finance_manager','tickets.create_internal')
) as g(role_name, permission)
where exists (select 1 from public.roles r where r.name = g.role_name)
on conflict (role_name, permission) do nothing;

alter table public.tickets
  alter column request_type_code set not null,
  alter column queue_code set not null,
  alter column response_target_minutes set not null,
  alter column resolution_target_minutes set not null;

create index if not exists tickets_queue_status_activity_idx
  on public.tickets(queue_code, status, last_activity_at desc);
create index if not exists tickets_resolution_due_idx
  on public.tickets(resolution_due_at)
  where status in ('open','assigned','in_progress','waiting_requester','reopened');

create table if not exists public.ticket_participants (
  ticket_id             uuid not null references public.tickets(id) on delete cascade,
  user_id               text not null references public.app_users(id) on delete cascade,
  participant_role      text not null
                        check (participant_role in ('requester','assignee','watcher')),
  last_read_sequence    bigint not null default 0 check (last_read_sequence >= 0),
  notifications_muted   boolean not null default false,
  joined_at             timestamptz not null default now(),
  removed_at            timestamptz,
  primary key (ticket_id, user_id)
);

create index if not exists ticket_participants_user_active_idx
  on public.ticket_participants(user_id, ticket_id)
  where removed_at is null;
alter table public.ticket_participants enable row level security;
revoke all on public.ticket_participants from anon, authenticated;
grant select, insert, update, delete on public.ticket_participants to service_role;

insert into public.ticket_participants (ticket_id, user_id, participant_role)
select id, requester_user_id, 'requester'
from public.tickets
where requester_user_id is not null
on conflict (ticket_id, user_id) do update
set participant_role = 'requester', removed_at = null;

insert into public.ticket_participants (ticket_id, user_id, participant_role)
select id, assignee_user_id, 'assignee'
from public.tickets
where assignee_user_id is not null
on conflict (ticket_id, user_id) do update
set participant_role = case
      when public.ticket_participants.participant_role = 'requester' then 'requester'
      else 'assignee'
    end,
    removed_at = null;

-- Migrate legacy watchers into participants, then retire the table. Guarded with
-- to_regclass so the source migration stays RERUNNABLE: after a prior apply already
-- dropped ticket_watchers, this whole block is skipped (a bare INSERT ... FROM
-- ticket_watchers would otherwise raise 42P01 on re-run).
do $$
begin
  if to_regclass('public.ticket_watchers') is not null then
    insert into public.ticket_participants (ticket_id, user_id, participant_role)
    select ticket_id, user_id, 'watcher'
    from public.ticket_watchers
    on conflict (ticket_id, user_id) do nothing;

    drop table public.ticket_watchers;
  end if;
end $$;

create table if not exists public.ticket_tags (
  ticket_id     uuid not null references public.tickets(id) on delete cascade,
  tag_key       text not null,
  label         text not null,
  tag_kind      text not null default 'custom'
                check (tag_kind in ('system','custom')),
  created_by    text references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (ticket_id, tag_key)
);

create index if not exists ticket_tags_key_idx on public.ticket_tags(tag_key);
alter table public.ticket_tags enable row level security;
revoke all on public.ticket_tags from anon, authenticated;
grant select, insert, update, delete on public.ticket_tags to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  false,
  26214400,
  array[
    'image/jpeg','image/png','image/webp','application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv','text/plain'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.ticket_attachments (
  id             uuid primary key default gen_random_uuid(),
  ticket_id      uuid not null references public.tickets(id) on delete cascade,
  file_name      text not null,
  file_path      text not null unique,
  content_type   text not null,
  size_bytes     bigint not null check (size_bytes >= 0 and size_bytes <= 26214400),
  uploaded_by    text not null references public.app_users(id) on delete restrict,
  upload_status  text not null default 'pending'
                 check (upload_status in ('pending','uploaded','failed')),
  created_at     timestamptz not null default now(),
  uploaded_at    timestamptz
);
create index if not exists ticket_attachments_ticket_idx
  on public.ticket_attachments(ticket_id, created_at);
alter table public.ticket_attachments enable row level security;
revoke all on public.ticket_attachments from anon, authenticated;
grant select, insert, update, delete on public.ticket_attachments to service_role;

alter table public.ticket_comments
  add column if not exists sequence bigint,
  add column if not exists client_request_id text;

with numbered as (
  select id,
         row_number() over (partition by ticket_id order by created_at, id)::bigint as seq
  from public.ticket_comments
)
update public.ticket_comments c
set sequence = numbered.seq
from numbered
where c.id = numbered.id and c.sequence is null;

alter table public.ticket_comments alter column sequence set not null;
create unique index if not exists ticket_comments_ticket_sequence_uidx
  on public.ticket_comments(ticket_id, sequence);
create unique index if not exists ticket_comments_request_uidx
  on public.ticket_comments(ticket_id, author_user_id, client_request_id)
  where client_request_id is not null;

alter table public.ticket_events
  add column if not exists sequence bigint;

with numbered as (
  select id,
         row_number() over (partition by ticket_id order by created_at, id)::bigint as seq
  from public.ticket_events
)
update public.ticket_events e
set sequence = numbered.seq
from numbered
where e.id = numbered.id and e.sequence is null;

alter table public.ticket_events alter column sequence set not null;
create unique index if not exists ticket_events_ticket_sequence_uidx
  on public.ticket_events(ticket_id, sequence);

update public.tickets t
set activity_sequence = greatest(
      t.activity_sequence,
      coalesce((select max(c.sequence) from public.ticket_comments c where c.ticket_id = t.id), 0),
      coalesce((select max(e.sequence) from public.ticket_events e where e.ticket_id = t.id), 0)
    ),
    version = greatest(t.version, 1);

create table if not exists ticket_internal.command_receipts (
  actor_user_id     text not null,
  command_name      text not null,
  idempotency_key   text not null,
  ticket_id         uuid not null references public.tickets(id) on delete cascade,
  response          jsonb not null,
  created_at        timestamptz not null default now(),
  primary key (actor_user_id, command_name, idempotency_key)
);
revoke all on ticket_internal.command_receipts from public, anon, authenticated;
grant select, insert on ticket_internal.command_receipts to service_role;

create or replace function ticket_internal.user_has_permission(
  p_user_id text,
  p_permission text
)
returns boolean
language sql
stable
security invoker
set search_path = public, ticket_internal
as $$
  with actor as (
    select id, role
    from public.app_users
    where id = p_user_id and status = 'active'
  ),
  override_value as (
    select up.granted
    from public.user_permissions up
    where up.user_id = p_user_id
      and up.permission = p_permission
      and up.revoked_at is null
      and (up.valid_from is null or up.valid_from <= now())
      and (up.valid_until is null or up.valid_until > now())
    order by up.set_at desc
    limit 1
  )
  select case
    when not exists (select 1 from actor) then false
    when (select role from actor) = 'superadmin' then true
    when exists (select 1 from override_value)
      then (select granted from override_value)
    else exists (
      select 1
      from public.role_permissions rp
      join actor a on a.role = rp.role_name
      where rp.permission = p_permission
    )
  end;
$$;

create or replace function ticket_internal.handler_user_ids(
  p_queue_code text,
  p_exclude_user_id text default null
)
returns text[]
language sql
stable
security invoker
set search_path = public, ticket_internal
as $$
  select coalesce(array_agg(u.id order by u.id), '{}'::text[])
  from public.app_users u
  join public.ticket_queues q on q.code = p_queue_code and q.is_active
  where u.status = 'active'
    and u.id is distinct from p_exclude_user_id
    and ticket_internal.user_has_permission(u.id, q.handler_permission);
$$;

create or replace function ticket_internal.record_event(
  p_ticket public.tickets,
  p_actor_id text,
  p_event_type text,
  p_payload jsonb,
  p_sequence bigint
)
returns uuid
language plpgsql
security invoker
set search_path = public, ticket_internal
as $$
declare
  v_event_id uuid;
begin
  insert into public.ticket_events (
    ticket_id, event_type, actor_user_id, payload, sequence
  )
  values (
    p_ticket.id, p_event_type, p_actor_id, coalesce(p_payload, '{}'::jsonb), p_sequence
  );

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  )
  values (
    'ticket.' || p_event_type,
    coalesce(p_ticket.source_module, 'platform'),
    'ticket',
    p_ticket.ticket_number,
    p_actor_id,
    case p_ticket.priority
      when 'critical' then 'critical'
      when 'high' then 'high'
      else 'info'
    end,
    jsonb_build_object(
      'ticketId', p_ticket.id,
      'ticketNumber', p_ticket.ticket_number,
      'queueCode', p_ticket.queue_code,
      'requestTypeCode', p_ticket.request_type_code,
      'status', p_ticket.status,
      'sequence', p_sequence
    ) || coalesce(p_payload, '{}'::jsonb),
    'ticket.' || p_event_type || ':' || p_ticket.id::text || ':' || p_sequence::text
  )
  returning id into v_event_id;

  insert into public.audit_logs (
    action, table_name, record_id, user_id, changes, created_at
  )
  values (
    'ticket.' || p_event_type,
    'tickets',
    p_ticket.ticket_number,
    p_actor_id,
    jsonb_build_object(
      'ticketId', p_ticket.id,
      'queueCode', p_ticket.queue_code,
      'requestTypeCode', p_ticket.request_type_code,
      'status', p_ticket.status,
      'sequence', p_sequence
    ) || coalesce(p_payload, '{}'::jsonb),
    now()
  );

  return v_event_id;
end;
$$;

create or replace function ticket_internal.notify_users(
  p_ticket public.tickets,
  p_event_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_user_ids text[],
  p_action_required boolean default false,
  p_due_at timestamptz default null
)
returns void
language plpgsql
security invoker
set search_path = public, ticket_internal
as $$
declare
  v_user_id text;
  v_notification_id text;
  v_type text := 'ticket.' || p_event_type;
  v_module text := coalesce(p_ticket.source_module, 'platform');
begin
  foreach v_user_id in array coalesce(p_user_ids, '{}'::text[])
  loop
    if v_user_id is null then
      continue;
    end if;

    if exists (
      select 1
      from public.notification_mutes nm
      where nm.user_id = v_user_id
        and nm.scope in ('all', 'module:' || v_module, 'event:' || v_type)
        and (nm.muted_until is null or nm.muted_until > now())
    ) then
      continue;
    end if;

    if not coalesce(
      (
        select np.in_app
        from public.notification_preferences np
        where np.user_id = v_user_id and np.event_type = v_type
      ),
      (
        select np.in_app
        from public.notification_preferences np
        where np.user_id = v_user_id and np.event_type = '*'
      ),
      true
    ) then
      continue;
    end if;

    v_notification_id := null;
    insert into public.notifications (
      user_id, type, title, body, is_read, event_id, module, severity,
      source_type, source_id, action_route, metadata, dedupe_key,
      action_required, action_status, due_at, created_at
    )
    values (
      v_user_id,
      v_type,
      p_title,
      p_body,
      false,
      p_event_id,
      v_module,
      case p_ticket.priority
        when 'critical' then 'critical'
        when 'high' then 'warning'
        else 'info'
      end,
      'ticket',
      p_ticket.ticket_number,
      's-ticket-center',
      jsonb_build_object(
        'ticketId', p_ticket.id,
        'ticketNumber', p_ticket.ticket_number,
        'queueCode', p_ticket.queue_code,
        'requestTypeCode', p_ticket.request_type_code,
        'status', p_ticket.status,
        'priority', p_ticket.priority
      ),
      'ticket.' || p_event_type || ':' || p_ticket.id::text || ':' ||
        p_ticket.activity_sequence::text || ':' || v_user_id,
      p_action_required,
      case when p_action_required then 'pending' else 'none' end,
      p_due_at,
      now()
    )
    on conflict do nothing
    returning id into v_notification_id;

    if v_notification_id is not null then
      insert into public.notification_deliveries (
        notification_id, channel, status, attempted_at, created_at
      )
      values (v_notification_id, 'in_app', 'sent', now(), now());
    end if;
  end loop;
end;
$$;

revoke all on all functions in schema ticket_internal from public, anon, authenticated;
grant execute on all functions in schema ticket_internal to service_role;

-- The signature gained p_creation_mode/p_creation_reason. create-or-replace cannot
-- change arity, so drop the old 10-arg overload first (idempotent) — otherwise both
-- overloads would coexist and callers could bind the stale one.
drop function if exists public.ticket_create_tx(
  text,text,text,text,text,text,text,text,text,text
);
create or replace function public.ticket_create_tx(
  p_actor_id text,
  p_request_type_code text,
  p_subject text,
  p_description text,
  p_priority text,
  p_source_module text,
  p_source_entity_type text,
  p_source_entity_id text,
  p_requester_id text,
  p_creation_mode text,
  p_creation_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, ticket_internal
as $$
declare
  v_existing jsonb;
  v_type public.ticket_request_types%rowtype;
  v_ticket public.tickets%rowtype;
  v_ticket_number text;
  v_requester_id text := coalesce(p_requester_id, p_actor_id);
  v_mode text := lower(coalesce(nullif(trim(p_creation_mode), ''), 'self'));
  v_reason text := nullif(trim(p_creation_reason), '');
  v_priority text;
  v_handlers text[];
  v_recipients text[];
  v_event_id uuid;
  v_tag text;
  v_response jsonb;
begin
  if nullif(trim(p_idempotency_key), '') is null then
    raise exception using errcode = 'TK400', message = 'idempotencyKey is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_actor_id || ':ticket_create:' || p_idempotency_key, 0
  ));

  select response into v_existing
  from ticket_internal.command_receipts
  where actor_user_id = p_actor_id
    and command_name = 'ticket_create'
    and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing || jsonb_build_object('replayed', true);
  end if;

  if not exists (
    select 1 from public.app_users where id = p_actor_id and status = 'active'
  ) then
    raise exception using errcode = 'TK403', message = 'Actor is not active';
  end if;
  if not exists (
    select 1 from public.app_users where id = v_requester_id and status = 'active'
  ) then
    raise exception using errcode = 'TK422', message = 'Requester is not active';
  end if;

  select * into v_type
  from public.ticket_request_types
  where code = p_request_type_code and is_active;
  if not found then
    raise exception using errcode = 'TK422', message = 'Request type is unavailable';
  end if;

  -- ── Creation-mode enforcement (authoritative; API/UI checks are supplementary) ──
  if v_mode not in ('self','team','on_behalf','internal') then
    raise exception using errcode = 'TK422', message = 'Invalid creation mode';
  end if;

  -- The request type must be allowed for the mode: internal types are never
  -- offered to employee-facing modes, and employee types never to internal work.
  if v_mode = 'internal' then
    if not v_type.is_internal_requestable then
      raise exception using errcode = 'TK422', message = 'Request type is not available for internal work';
    end if;
  elsif not v_type.is_employee_requestable then
    raise exception using errcode = 'TK422', message = 'Request type is not available for employee requests';
  end if;

  if v_mode = 'self' then
    if v_requester_id <> p_actor_id then
      raise exception using errcode = 'TK422', message = 'Self-service tickets must be raised for yourself';
    end if;
    if not ticket_internal.user_has_permission(p_actor_id, 'tickets.create_self') then
      raise exception using errcode = 'TK403', message = 'Not permitted to raise tickets';
    end if;

  elsif v_mode = 'team' then
    if not ticket_internal.user_has_permission(p_actor_id, 'tickets.create_team') then
      raise exception using errcode = 'TK403', message = 'Not permitted to raise tickets for team members';
    end if;
    if not exists (
      select 1 from public.app_users
      where id = v_requester_id and supervisor_id = p_actor_id and status = 'active'
    ) then
      raise exception using errcode = 'TK403', message = 'Requester is not your active direct report';
    end if;

  elsif v_mode = 'on_behalf' then
    if v_requester_id = p_actor_id then
      raise exception using errcode = 'TK422', message = 'On-behalf tickets must name another employee';
    end if;
    if v_reason is null then
      raise exception using errcode = 'TK422', message = 'A reason is required for on-behalf tickets';
    end if;
    if not ticket_internal.user_has_permission(p_actor_id, 'tickets.create_on_behalf') then
      raise exception using errcode = 'TK403', message = 'Not permitted to raise tickets on behalf of employees';
    end if;
    if not ticket_internal.user_has_permission(
         p_actor_id,
         (select handler_permission from public.ticket_queues where code = v_type.queue_code)
       ) then
      raise exception using errcode = 'TK403', message = 'Not a handler for the target queue';
    end if;

  else  -- internal
    if v_requester_id <> p_actor_id then
      raise exception using errcode = 'TK422', message = 'Internal work is recorded under its creator';
    end if;
    if not ticket_internal.user_has_permission(p_actor_id, 'tickets.create_internal') then
      raise exception using errcode = 'TK403', message = 'Not permitted to raise internal work';
    end if;
  end if;

  if nullif(trim(p_subject), '') is null or length(trim(p_subject)) > 200 then
    raise exception using errcode = 'TK422', message = 'Subject must be between 1 and 200 characters';
  end if;
  if nullif(trim(p_description), '') is null or length(trim(p_description)) > 5000 then
    raise exception using errcode = 'TK422', message = 'Description must be between 1 and 5000 characters';
  end if;

  v_priority := coalesce(p_priority, v_type.default_priority);
  if v_priority not in ('low','medium','high','critical') then
    raise exception using errcode = 'TK422', message = 'Invalid priority';
  end if;

  v_ticket_number := 'TKT-' || extract(year from now())::integer || '-' ||
    lpad(public.increment_ref_counter(
      'TKT', extract(year from now())::integer
    )::text, 4, '0');

  insert into public.tickets (
    ticket_number, source_module, source_entity_type, source_entity_id,
    requester_user_id, created_by_user_id, creation_mode, creation_reason,
    category, priority, status, sla_due_at,
    response_due_at, resolution_due_at, response_target_minutes,
    resolution_target_minutes, request_type_code, queue_code,
    subject, description, is_confidential, last_activity_at,
    activity_sequence, version, metadata, created_at, updated_at
  )
  values (
    v_ticket_number,
    nullif(trim(p_source_module), ''),
    nullif(trim(p_source_entity_type), ''),
    nullif(trim(p_source_entity_id), ''),
    v_requester_id,
    p_actor_id,
    v_mode,
    v_reason,
    v_type.category,
    v_priority,
    'open',
    now() + make_interval(mins => v_type.resolution_target_minutes),
    now() + make_interval(mins => v_type.response_target_minutes),
    now() + make_interval(mins => v_type.resolution_target_minutes),
    v_type.response_target_minutes,
    v_type.resolution_target_minutes,
    v_type.code,
    v_type.queue_code,
    trim(p_subject),
    trim(p_description),
    v_type.is_confidential,
    now(),
    1,
    1,
    jsonb_build_object('requestTypeLabel', v_type.label),
    now(),
    now()
  )
  returning * into v_ticket;

  insert into public.ticket_participants (
    ticket_id, user_id, participant_role, last_read_sequence
  )
  values (v_ticket.id, v_requester_id, 'requester', 1);

  foreach v_tag in array v_type.system_tags
  loop
    insert into public.ticket_tags (
      ticket_id, tag_key, label, tag_kind, created_by
    )
    values (
      v_ticket.id,
      lower(regexp_replace(trim(v_tag), '[^a-zA-Z0-9]+', '-', 'g')),
      trim(v_tag),
      'system',
      p_actor_id
    )
    on conflict do nothing;
  end loop;

  v_event_id := ticket_internal.record_event(
    v_ticket, p_actor_id, 'created',
    jsonb_build_object(
      'requesterUserId', v_requester_id,
      'createdByUserId', p_actor_id,
      'creationMode', v_mode,
      'creationReason', v_reason
    ), 1
  );

  v_handlers := ticket_internal.handler_user_ids(v_type.queue_code, p_actor_id);
  perform ticket_internal.notify_users(
    v_ticket, v_event_id, 'created',
    'New ' || v_type.label || ' ticket',
    v_ticket.ticket_number || ' · ' || v_ticket.subject,
    v_handlers, true, v_ticket.resolution_due_at
  );

  if v_requester_id <> p_actor_id then
    perform ticket_internal.notify_users(
      v_ticket, v_event_id, 'created_for_you',
      'Ticket opened for you',
      v_ticket.ticket_number || ' · ' || v_ticket.subject,
      array[v_requester_id], false, null
    );
  end if;

  v_recipients := (
    select coalesce(array_agg(distinct x), '{}'::text[])
    from unnest(v_handlers || array[v_requester_id]) x
    where x is not null
  );

  v_response := jsonb_build_object(
    'ticketId', v_ticket.id,
    'ticketNumber', v_ticket.ticket_number,
    'status', v_ticket.status,
    'version', v_ticket.version,
    'recipientIds', v_recipients,
    'notificationRecipientIds', v_handlers,
    'replayed', false
  );

  insert into ticket_internal.command_receipts (
    actor_user_id, command_name, idempotency_key, ticket_id, response
  )
  values (p_actor_id, 'ticket_create', p_idempotency_key, v_ticket.id, v_response);

  return v_response;
end;
$$;

create or replace function public.ticket_comment_tx(
  p_actor_id text,
  p_ticket_id uuid,
  p_body text,
  p_is_internal boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, ticket_internal
as $$
declare
  v_existing jsonb;
  v_ticket public.tickets%rowtype;
  v_handler boolean;
  v_sequence bigint;
  v_comment_id uuid;
  v_event_type text;
  v_event_id uuid;
  v_recipients text[];
  v_notification_recipients text[];
  v_response jsonb;
begin
  if nullif(trim(p_idempotency_key), '') is null then
    raise exception using errcode = 'TK400', message = 'idempotencyKey is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_actor_id || ':ticket_comment:' || p_idempotency_key, 0
  ));

  select response into v_existing
  from ticket_internal.command_receipts
  where actor_user_id = p_actor_id
    and command_name = 'ticket_comment'
    and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing || jsonb_build_object('replayed', true);
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception using errcode = 'TK404', message = 'Ticket not found';
  end if;

  v_handler := ticket_internal.user_has_permission(
    p_actor_id,
    (select handler_permission from public.ticket_queues where code = v_ticket.queue_code)
  );

  if not v_handler and not exists (
    select 1 from public.ticket_participants
    where ticket_id = p_ticket_id and user_id = p_actor_id and removed_at is null
  ) then
    raise exception using errcode = 'TK403', message = 'Not a ticket participant';
  end if;
  if p_is_internal and not v_handler then
    raise exception using errcode = 'TK403', message = 'Internal notes are restricted to ticket handlers';
  end if;
  if v_ticket.status in ('closed','cancelled') then
    raise exception using errcode = 'TK409', message = 'Closed or cancelled tickets cannot receive comments';
  end if;
  if nullif(trim(p_body), '') is null or length(trim(p_body)) > 5000 then
    raise exception using errcode = 'TK422', message = 'Comment must be between 1 and 5000 characters';
  end if;

  v_sequence := v_ticket.activity_sequence + 1;
  insert into public.ticket_comments (
    ticket_id, author_user_id, body, is_internal, is_system,
    sequence, client_request_id
  )
  values (
    p_ticket_id, p_actor_id, trim(p_body), p_is_internal, false,
    v_sequence, p_idempotency_key
  )
  returning id into v_comment_id;

  if v_handler then
    insert into public.ticket_participants (
      ticket_id, user_id, participant_role, last_read_sequence
    )
    values (
      p_ticket_id, p_actor_id,
      case when v_ticket.assignee_user_id = p_actor_id then 'assignee' else 'watcher' end,
      v_sequence
    )
    on conflict (ticket_id, user_id) do update
    set removed_at = null,
        last_read_sequence = greatest(
          public.ticket_participants.last_read_sequence, excluded.last_read_sequence
        );
  end if;

  update public.ticket_participants
  set last_read_sequence = greatest(last_read_sequence, v_sequence)
  where ticket_id = p_ticket_id
    and user_id = p_actor_id
    and removed_at is null;

  update public.tickets
  set activity_sequence = v_sequence,
      version = version + 1,
      last_activity_at = now(),
      updated_at = now(),
      first_response_at = case
        when v_handler and not p_is_internal and first_response_at is null then now()
        else first_response_at
      end,
      status = case
        when not v_handler and status = 'waiting_requester' then 'in_progress'
        when not v_handler and status = 'resolved' then 'reopened'
        else status
      end,
      resolved_at = case
        when not v_handler and status = 'resolved' then null
        else resolved_at
      end,
      closed_at = case
        when not v_handler and status = 'resolved' then null
        else closed_at
      end,
      overdue_notified_at = case
        when not v_handler and status = 'resolved' then null
        else overdue_notified_at
      end
  where id = p_ticket_id
  returning * into v_ticket;

  if not v_handler and not p_is_internal then
    update public.notifications
    set action_status = 'completed',
        completed_at = now(),
        completed_by = p_actor_id
    where source_type = 'ticket'
      and source_id = v_ticket.ticket_number
      and type = 'ticket.waiting_requester'
      and action_status = 'pending';
  end if;

  v_event_type := case when p_is_internal then 'internal_note_added' else 'comment_added' end;
  v_event_id := ticket_internal.record_event(
    v_ticket, p_actor_id, v_event_type,
    jsonb_build_object('commentId', v_comment_id), v_sequence
  );

  select coalesce(array_agg(tp.user_id), '{}'::text[])
  into v_recipients
  from public.ticket_participants tp
  where tp.ticket_id = p_ticket_id
    and tp.removed_at is null
    and tp.user_id <> p_actor_id
    and (not p_is_internal or ticket_internal.user_has_permission(
      tp.user_id,
      (select handler_permission from public.ticket_queues where code = v_ticket.queue_code)
    ));

  v_notification_recipients := (
    select coalesce(array_agg(tp.user_id), '{}'::text[])
    from public.ticket_participants tp
    where tp.ticket_id = p_ticket_id
      and tp.removed_at is null
      and not tp.notifications_muted
      and tp.user_id <> p_actor_id
      and (not p_is_internal or ticket_internal.user_has_permission(
        tp.user_id,
        (select handler_permission from public.ticket_queues where code = v_ticket.queue_code)
      ))
  );

  perform ticket_internal.notify_users(
    v_ticket, v_event_id, v_event_type,
    case when p_is_internal then 'Internal ticket note' else 'New ticket reply' end,
    v_ticket.ticket_number || ' · ' || left(trim(p_body), 180),
    v_notification_recipients,
    not v_handler and not p_is_internal,
    case when not v_handler and not p_is_internal then v_ticket.resolution_due_at else null end
  );

  v_response := jsonb_build_object(
    'ticketId', v_ticket.id,
    'commentId', v_comment_id,
    'sequence', v_sequence,
    'status', v_ticket.status,
    'version', v_ticket.version,
    'recipientIds', v_recipients,
    'notificationRecipientIds', v_notification_recipients,
    'replayed', false
  );
  insert into ticket_internal.command_receipts (
    actor_user_id, command_name, idempotency_key, ticket_id, response
  )
  values (p_actor_id, 'ticket_comment', p_idempotency_key, v_ticket.id, v_response);
  return v_response;
end;
$$;

create or replace function public.ticket_command_tx(
  p_actor_id text,
  p_ticket_id uuid,
  p_action text,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, ticket_internal
as $$
declare
  v_existing jsonb;
  v_ticket public.tickets%rowtype;
  v_handler boolean;
  v_is_requester boolean;
  v_sequence bigint;
  v_event_id uuid;
  v_event_type text;
  v_target_user_id text;
  v_new_priority text;
  v_tag_key text;
  v_tag_label text;
  v_resolution_code text;
  v_recipients text[];
  v_notification_recipients text[];
  v_response jsonb;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if nullif(trim(p_idempotency_key), '') is null then
    raise exception using errcode = 'TK400', message = 'idempotencyKey is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_actor_id || ':ticket_command:' || p_idempotency_key, 0
  ));

  select response into v_existing
  from ticket_internal.command_receipts
  where actor_user_id = p_actor_id
    and command_name = 'ticket_command'
    and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing || jsonb_build_object('replayed', true);
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception using errcode = 'TK404', message = 'Ticket not found';
  end if;

  v_handler := ticket_internal.user_has_permission(
    p_actor_id,
    (select handler_permission from public.ticket_queues where code = v_ticket.queue_code)
  );
  v_is_requester := v_ticket.requester_user_id = p_actor_id;

  if p_action not in (
    'assign','start','wait_requester','resolve','close','reopen','cancel',
    'set_priority','add_tag','remove_tag','watch','unwatch'
  ) then
    raise exception using errcode = 'TK422', message = 'Unsupported ticket action';
  end if;
  if p_action not in ('reopen','cancel') and not v_handler then
    raise exception using errcode = 'TK403', message = 'Ticket handler permission required';
  end if;
  if p_action in ('reopen','cancel') and not (v_handler or v_is_requester) then
    raise exception using errcode = 'TK403', message = 'Not permitted for this ticket';
  end if;

  v_sequence := v_ticket.activity_sequence + 1;
  v_event_type := p_action;

  case p_action
    when 'assign' then
      v_target_user_id := nullif(v_payload->>'assigneeId', '');
      if v_target_user_id is null
         or not ticket_internal.user_has_permission(
           v_target_user_id,
           (select handler_permission from public.ticket_queues where code = v_ticket.queue_code)
         ) then
        raise exception using errcode = 'TK422', message = 'Assignee is not an active handler for this queue';
      end if;
      update public.tickets
      set assignee_user_id = v_target_user_id,
          status = case when status in ('open','reopened') then 'assigned' else status end,
          version = version + 1, activity_sequence = v_sequence,
          last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      insert into public.ticket_participants (
        ticket_id, user_id, participant_role, last_read_sequence
      )
      values (p_ticket_id, v_target_user_id, 'assignee', 0)
      on conflict (ticket_id, user_id) do update
      set participant_role = case
            when public.ticket_participants.participant_role = 'requester' then 'requester'
            else 'assignee'
          end,
          removed_at = null;
      v_event_type := 'assigned';

    when 'start' then
      if v_ticket.status not in ('open','assigned','reopened') then
        raise exception using errcode = 'TK409', message = 'Ticket cannot be started from its current status';
      end if;
      update public.tickets
      set status = 'in_progress', version = version + 1,
          activity_sequence = v_sequence, last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      v_event_type := 'started';

    when 'wait_requester' then
      if v_ticket.status not in ('assigned','in_progress','reopened') then
        raise exception using errcode = 'TK409', message = 'Ticket cannot wait for the requester from its current status';
      end if;
      update public.tickets
      set status = 'waiting_requester', version = version + 1,
          activity_sequence = v_sequence, last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      v_event_type := 'waiting_requester';

    when 'resolve' then
      if v_ticket.status not in ('open','assigned','in_progress','waiting_requester','reopened') then
        raise exception using errcode = 'TK409', message = 'Ticket cannot be resolved from its current status';
      end if;
      v_resolution_code := nullif(trim(v_payload->>'resolutionCode'), '');
      if v_resolution_code is null then
        raise exception using errcode = 'TK422', message = 'resolutionCode is required';
      end if;
      update public.tickets
      set status = 'resolved', resolution_code = v_resolution_code,
          resolved_at = now(), closed_at = null, version = version + 1,
          activity_sequence = v_sequence, last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      v_event_type := 'resolved';

    when 'close' then
      if v_ticket.status <> 'resolved' then
        raise exception using errcode = 'TK409', message = 'Only resolved tickets can be closed';
      end if;
      update public.tickets
      set status = 'closed', closed_at = now(), version = version + 1,
          activity_sequence = v_sequence, last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      v_event_type := 'closed';

    when 'reopen' then
      if v_ticket.status not in ('resolved','closed') then
        raise exception using errcode = 'TK409', message = 'Only resolved or closed tickets can be reopened';
      end if;
      update public.tickets
      set status = 'reopened', resolved_at = null, closed_at = null,
          resolution_code = null, overdue_notified_at = null,
          resolution_due_at = now() + make_interval(mins => resolution_target_minutes),
          sla_due_at = now() + make_interval(mins => resolution_target_minutes),
          version = version + 1, activity_sequence = v_sequence,
          last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      v_event_type := 'reopened';

    when 'cancel' then
      if v_ticket.status in ('closed','cancelled') then
        raise exception using errcode = 'TK409', message = 'Ticket is already final';
      end if;
      update public.tickets
      set status = 'cancelled', closed_at = now(), version = version + 1,
          activity_sequence = v_sequence, last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      v_event_type := 'cancelled';

    when 'set_priority' then
      v_new_priority := v_payload->>'priority';
      if v_new_priority not in ('low','medium','high','critical') then
        raise exception using errcode = 'TK422', message = 'Invalid priority';
      end if;
      update public.tickets
      set priority = v_new_priority, version = version + 1,
          activity_sequence = v_sequence, last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      v_event_type := 'priority_changed';

    when 'add_tag' then
      v_tag_label := nullif(trim(v_payload->>'label'), '');
      if v_tag_label is null or length(v_tag_label) > 40 then
        raise exception using errcode = 'TK422', message = 'Tag label must be between 1 and 40 characters';
      end if;
      v_tag_key := lower(regexp_replace(v_tag_label, '[^a-zA-Z0-9]+', '-', 'g'));
      insert into public.ticket_tags (ticket_id, tag_key, label, tag_kind, created_by)
      values (p_ticket_id, v_tag_key, v_tag_label, 'custom', p_actor_id)
      on conflict (ticket_id, tag_key) do update set label = excluded.label;
      update public.tickets
      set version = version + 1, activity_sequence = v_sequence,
          last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      v_payload := v_payload || jsonb_build_object('tagKey', v_tag_key);
      v_event_type := 'tag_added';

    when 'remove_tag' then
      v_tag_key := nullif(trim(v_payload->>'tagKey'), '');
      if v_tag_key is null then
        raise exception using errcode = 'TK422', message = 'tagKey is required';
      end if;
      delete from public.ticket_tags
      where ticket_id = p_ticket_id and tag_key = v_tag_key and tag_kind = 'custom';
      if not found then
        raise exception using errcode = 'TK404', message = 'Custom tag not found';
      end if;
      update public.tickets
      set version = version + 1, activity_sequence = v_sequence,
          last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      v_event_type := 'tag_removed';

    when 'watch' then
      insert into public.ticket_participants (
        ticket_id, user_id, participant_role, last_read_sequence
      )
      values (p_ticket_id, p_actor_id, 'watcher', v_ticket.activity_sequence)
      on conflict (ticket_id, user_id) do update set removed_at = null;
      update public.tickets
      set version = version + 1, activity_sequence = v_sequence,
          last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      v_event_type := 'watcher_added';

    when 'unwatch' then
      update public.ticket_participants
      set removed_at = now()
      where ticket_id = p_ticket_id
        and user_id = p_actor_id
        and participant_role = 'watcher'
        and removed_at is null;
      if not found then
        raise exception using errcode = 'TK404', message = 'Active watcher not found';
      end if;
      update public.tickets
      set version = version + 1, activity_sequence = v_sequence,
          last_activity_at = now(), updated_at = now()
      where id = p_ticket_id returning * into v_ticket;
      v_event_type := 'watcher_removed';
  end case;

  if v_event_type = 'assigned' then
    update public.notifications
    set action_status = 'completed',
        completed_at = now(),
        completed_by = p_actor_id
    where source_type = 'ticket'
      and source_id = v_ticket.ticket_number
      and type = 'ticket.created'
      and action_status = 'pending';
  elsif v_event_type in ('resolved','closed','cancelled') then
    update public.notifications
    set action_status = 'completed',
        completed_at = now(),
        completed_by = p_actor_id
    where source_type = 'ticket'
      and source_id = v_ticket.ticket_number
      and action_status in ('pending','escalated');
  end if;

  v_event_id := ticket_internal.record_event(
    v_ticket, p_actor_id, v_event_type, v_payload, v_sequence
  );

  select coalesce(array_agg(tp.user_id), '{}'::text[])
  into v_recipients
  from public.ticket_participants tp
  where tp.ticket_id = p_ticket_id
    and tp.removed_at is null
    and tp.user_id <> p_actor_id;

  select coalesce(array_agg(tp.user_id), '{}'::text[])
  into v_notification_recipients
  from public.ticket_participants tp
  where tp.ticket_id = p_ticket_id
    and tp.removed_at is null
    and not tp.notifications_muted
    and tp.user_id <> p_actor_id;

  if p_action = 'assign' and v_target_user_id <> p_actor_id then
    v_recipients := (
      select coalesce(array_agg(distinct x), '{}'::text[])
      from unnest(v_recipients || array[v_target_user_id]) x
    );
    v_notification_recipients := (
      select coalesce(array_agg(distinct x), '{}'::text[])
      from unnest(v_notification_recipients || array[v_target_user_id]) x
    );
  end if;

  perform ticket_internal.notify_users(
    v_ticket, v_event_id, v_event_type,
    case v_event_type
      when 'assigned' then 'Ticket assigned'
      when 'waiting_requester' then 'Ticket needs your response'
      when 'resolved' then 'Ticket resolved'
      when 'closed' then 'Ticket closed'
      when 'reopened' then 'Ticket reopened'
      when 'cancelled' then 'Ticket cancelled'
      when 'priority_changed' then 'Ticket priority changed'
      else 'Ticket updated'
    end,
    v_ticket.ticket_number || ' · ' || v_ticket.subject,
    v_notification_recipients,
    v_event_type in ('assigned','waiting_requester','reopened'),
    case
      when v_event_type in ('assigned','reopened') then v_ticket.resolution_due_at
      when v_event_type = 'waiting_requester' then v_ticket.resolution_due_at
      else null
    end
  );

  v_response := jsonb_build_object(
    'ticketId', v_ticket.id,
    'ticketNumber', v_ticket.ticket_number,
    'status', v_ticket.status,
    'priority', v_ticket.priority,
    'assigneeUserId', v_ticket.assignee_user_id,
    'sequence', v_sequence,
    'version', v_ticket.version,
    'recipientIds', v_recipients,
    'notificationRecipientIds', v_notification_recipients,
    'replayed', false
  );
  insert into ticket_internal.command_receipts (
    actor_user_id, command_name, idempotency_key, ticket_id, response
  )
  values (p_actor_id, 'ticket_command', p_idempotency_key, v_ticket.id, v_response);
  return v_response;
end;
$$;

create or replace function public.ticket_mark_read_tx(
  p_actor_id text,
  p_ticket_id uuid,
  p_sequence bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public, ticket_internal
as $$
declare
  v_ticket public.tickets%rowtype;
  v_handler boolean;
  v_cursor bigint;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if not found then
    raise exception using errcode = 'TK404', message = 'Ticket not found';
  end if;
  v_handler := ticket_internal.user_has_permission(
    p_actor_id,
    (select handler_permission from public.ticket_queues where code = v_ticket.queue_code)
  );
  if not v_handler and not exists (
    select 1 from public.ticket_participants
    where ticket_id = p_ticket_id and user_id = p_actor_id and removed_at is null
  ) then
    raise exception using errcode = 'TK403', message = 'Not permitted for this ticket';
  end if;

  insert into public.ticket_participants (
    ticket_id, user_id, participant_role, last_read_sequence
  )
  values (
    p_ticket_id, p_actor_id,
    case
      when v_ticket.requester_user_id = p_actor_id then 'requester'
      when v_ticket.assignee_user_id = p_actor_id then 'assignee'
      else 'watcher'
    end,
    least(greatest(coalesce(p_sequence, v_ticket.activity_sequence), 0), v_ticket.activity_sequence)
  )
  on conflict (ticket_id, user_id) do update
  set last_read_sequence = greatest(
        public.ticket_participants.last_read_sequence,
        least(excluded.last_read_sequence, v_ticket.activity_sequence)
      ),
      removed_at = null
  returning last_read_sequence into v_cursor;

  return jsonb_build_object(
    'ticketId', p_ticket_id,
    'lastReadSequence', v_cursor,
    'unread', greatest(v_ticket.activity_sequence - v_cursor, 0)
  );
end;
$$;

create or replace function public.ticket_attachment_complete_tx(
  p_actor_id text,
  p_attachment_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, ticket_internal
as $$
declare
  v_existing jsonb;
  v_attachment public.ticket_attachments%rowtype;
  v_ticket public.tickets%rowtype;
  v_handler boolean;
  v_sequence bigint;
  v_response jsonb;
begin
  if nullif(trim(p_idempotency_key), '') is null then
    raise exception using errcode = 'TK400', message = 'idempotencyKey is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_actor_id || ':ticket_attachment:' || p_idempotency_key, 0
  ));

  select response into v_existing
  from ticket_internal.command_receipts
  where actor_user_id = p_actor_id
    and command_name = 'ticket_attachment'
    and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing || jsonb_build_object('replayed', true);
  end if;

  select * into v_attachment
  from public.ticket_attachments
  where id = p_attachment_id
  for update;
  if not found then
    raise exception using errcode = 'TK404', message = 'Attachment not found';
  end if;
  if v_attachment.uploaded_by <> p_actor_id then
    raise exception using errcode = 'TK403', message = 'Only the uploader can complete this attachment';
  end if;
  if v_attachment.upload_status <> 'pending' then
    raise exception using errcode = 'TK409', message = 'Attachment is not pending upload';
  end if;

  select * into v_ticket
  from public.tickets
  where id = v_attachment.ticket_id
  for update;
  if not found then
    raise exception using errcode = 'TK404', message = 'Ticket not found';
  end if;
  v_handler := ticket_internal.user_has_permission(
    p_actor_id,
    (select handler_permission from public.ticket_queues where code = v_ticket.queue_code)
  );
  if not v_handler and not exists (
    select 1 from public.ticket_participants
    where ticket_id = v_ticket.id and user_id = p_actor_id and removed_at is null
  ) then
    raise exception using errcode = 'TK403', message = 'Not permitted for this ticket';
  end if;
  if v_ticket.status in ('closed','cancelled') then
    raise exception using errcode = 'TK409', message = 'Attachments cannot be added to a final ticket';
  end if;

  v_sequence := v_ticket.activity_sequence + 1;
  update public.ticket_attachments
  set upload_status = 'uploaded', uploaded_at = now()
  where id = p_attachment_id;
  update public.tickets
  set activity_sequence = v_sequence,
      version = version + 1,
      last_activity_at = now(),
      updated_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  perform ticket_internal.record_event(
    v_ticket, p_actor_id, 'attachment_added',
    jsonb_build_object(
      'attachmentId', v_attachment.id,
      'fileName', v_attachment.file_name,
      'contentType', v_attachment.content_type,
      'sizeBytes', v_attachment.size_bytes
    ),
    v_sequence
  );

  v_response := jsonb_build_object(
    'ticketId', v_ticket.id,
    'attachmentId', v_attachment.id,
    'sequence', v_sequence,
    'version', v_ticket.version,
    'recipientIds', (
      select coalesce(array_agg(user_id), '{}'::text[])
      from public.ticket_participants
      where ticket_id = v_ticket.id and removed_at is null and user_id <> p_actor_id
    ),
    'notificationRecipientIds', '[]'::jsonb,
    'replayed', false
  );
  insert into ticket_internal.command_receipts (
    actor_user_id, command_name, idempotency_key, ticket_id, response
  )
  values (
    p_actor_id, 'ticket_attachment', p_idempotency_key, v_ticket.id, v_response
  );
  return v_response;
end;
$$;

-- Gained p_creation_mode (default 'self'); drop the old 1-arg overload so a 1-arg
-- call is not ambiguous with the new default-arg version. Idempotent.
drop function if exists public.ticket_request_types_for_actor(text);
create or replace function public.ticket_request_types_for_actor(
  p_actor_id text,
  p_creation_mode text default 'self'
)
returns jsonb
language sql
stable
security invoker
set search_path = public, ticket_internal
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', rt.code,
    'label', rt.label,
    'description', rt.description,
    'category', rt.category,
    'queueCode', rt.queue_code,
    'queueLabel', q.label,
    'module', q.module,
    'defaultPriority', rt.default_priority,
    'responseTargetMinutes', rt.response_target_minutes,
    'resolutionTargetMinutes', rt.resolution_target_minutes,
    'systemTags', rt.system_tags,
    'isConfidential', rt.is_confidential
  ) order by q.label, rt.label), '[]'::jsonb)
  from public.ticket_request_types rt
  join public.ticket_queues q on q.code = rt.queue_code
  where rt.is_active and q.is_active
    and exists (
      select 1 from public.app_users where id = p_actor_id and status = 'active'
    )
    -- Internal mode returns only internal types (and only if the actor may raise
    -- internal work); every other mode returns only employee-facing types. Internal
    -- types are therefore never exposed to ordinary staff.
    and case
      when lower(coalesce(nullif(trim(p_creation_mode), ''), 'self')) = 'internal'
        then rt.is_internal_requestable
             and ticket_internal.user_has_permission(p_actor_id, 'tickets.create_internal')
      else rt.is_employee_requestable
    end;
$$;

-- ── Requester search (team / on-behalf pickers) ─────────────────────────────────
-- Team mode returns only the actor's active direct reports; on-behalf returns
-- active users only when the actor holds tickets.create_on_behalf. Server-side
-- ilike search + capped result count. No employee is listed for any other mode.
create or replace function public.ticket_requester_search(
  p_actor_id text,
  p_mode text,
  p_query text,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = public, ticket_internal
as $$
  with params as (
    select least(greatest(coalesce(p_limit, 20), 1), 50) as n,
           lower(coalesce(nullif(trim(p_mode), ''), 'team')) as mode,
           nullif(trim(p_query), '') as term
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  from (
    select u.id,
           coalesce(u.full_name, u.email, 'SIOMAC user') as "displayName",
           u.email
    from public.app_users u, params p
    where u.status = 'active'
      and u.id <> p_actor_id
      and (p.term is null
           or u.full_name ilike '%' || p.term || '%'
           or u.email ilike '%' || p.term || '%')
      and case
        when p.mode = 'team'
          then u.supervisor_id = p_actor_id
        when p.mode = 'on_behalf'
          then ticket_internal.user_has_permission(p_actor_id, 'tickets.create_on_behalf')
        else false
      end
    order by coalesce(u.full_name, u.email)
    limit (select n from params)
  ) r;
$$;

create or replace function public.ticket_list_for_actor(
  p_actor_id text,
  p_scope text,
  p_status text,
  p_queue_code text,
  p_priority text,
  p_request_type_code text,
  p_tag_key text,
  p_search text,
  p_limit integer,
  p_before timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public, ticket_internal
as $$
  with visible as (
    select t.*,
           coalesce(tp.last_read_sequence, 0) as last_read_sequence,
           greatest(t.activity_sequence - coalesce(tp.last_read_sequence, 0), 0) as unread_count,
           ticket_internal.user_has_permission(
             p_actor_id, q.handler_permission
           ) as can_handle
    from public.tickets t
    join public.ticket_queues q on q.code = t.queue_code
    left join public.ticket_participants tp
      on tp.ticket_id = t.id and tp.user_id = p_actor_id and tp.removed_at is null
    where (
      tp.user_id is not null
      or ticket_internal.user_has_permission(p_actor_id, q.handler_permission)
    )
      and (
        coalesce(p_scope, 'mine') not in ('mine','assigned')
        or (
          coalesce(p_scope, 'mine') = 'mine'
          and (t.requester_user_id = p_actor_id or tp.user_id is not null)
        )
        or (
          p_scope = 'assigned'
          and t.assignee_user_id = p_actor_id
        )
      )
      and (p_status is null or t.status = p_status)
      and (p_queue_code is null or t.queue_code = p_queue_code)
      and (p_priority is null or t.priority = p_priority)
      and (p_request_type_code is null or t.request_type_code = p_request_type_code)
      and (
        p_tag_key is null
        or exists (
          select 1 from public.ticket_tags filter_tag
          where filter_tag.ticket_id = t.id and filter_tag.tag_key = p_tag_key
        )
      )
      and (
        nullif(trim(p_search), '') is null
        or t.ticket_number ilike '%' || trim(p_search) || '%'
        or t.subject ilike '%' || trim(p_search) || '%'
        or t.description ilike '%' || trim(p_search) || '%'
      )
      and (p_before is null or t.last_activity_at < p_before)
    order by t.last_activity_at desc, t.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id,
      'ticketNumber', v.ticket_number,
      'requestTypeCode', v.request_type_code,
      'queueCode', v.queue_code,
      'category', v.category,
      'priority', v.priority,
      'status', v.status,
      'subject', v.subject,
      'requesterUserId', v.requester_user_id,
      'assigneeUserId', v.assignee_user_id,
      'responseDueAt', v.response_due_at,
      'resolutionDueAt', v.resolution_due_at,
      'lastActivityAt', v.last_activity_at,
      'activitySequence', v.activity_sequence,
      'lastReadSequence', v.last_read_sequence,
      'unreadCount', v.unread_count,
      'isConfidential', v.is_confidential,
      'canHandle', v.can_handle,
      'tags', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', tt.tag_key, 'label', tt.label, 'kind', tt.tag_kind
        ) order by tt.tag_kind, tt.label)
        from public.ticket_tags tt where tt.ticket_id = v.id
      ), '[]'::jsonb),
      'createdAt', v.created_at,
      'version', v.version
    ) order by v.last_activity_at desc, v.id desc), '[]'::jsonb),
    'nextCursor', case
      when count(*) = least(greatest(coalesce(p_limit, 50), 1), 100)
      then min(v.last_activity_at)
      else null
    end
  )
  from visible v;
$$;

create or replace function public.ticket_get_for_actor(
  p_actor_id text,
  p_ticket_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, ticket_internal
as $$
declare
  v_ticket public.tickets%rowtype;
  v_handler boolean;
  v_participant boolean;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if not found then
    raise exception using errcode = 'TK404', message = 'Ticket not found';
  end if;
  v_handler := ticket_internal.user_has_permission(
    p_actor_id,
    (select handler_permission from public.ticket_queues where code = v_ticket.queue_code)
  );
  select exists (
    select 1 from public.ticket_participants
    where ticket_id = p_ticket_id and user_id = p_actor_id and removed_at is null
  ) into v_participant;
  if not (v_handler or v_participant) then
    raise exception using errcode = 'TK403', message = 'Not permitted for this ticket';
  end if;

  return jsonb_build_object(
    'ticket', jsonb_build_object(
      'id', v_ticket.id,
      'ticketNumber', v_ticket.ticket_number,
      'requestTypeCode', v_ticket.request_type_code,
      'queueCode', v_ticket.queue_code,
      'category', v_ticket.category,
      'priority', v_ticket.priority,
      'status', v_ticket.status,
      'subject', v_ticket.subject,
      'description', v_ticket.description,
      'requesterUserId', v_ticket.requester_user_id,
      'assigneeUserId', v_ticket.assignee_user_id,
      'sourceModule', v_ticket.source_module,
      'sourceEntityType', v_ticket.source_entity_type,
      'sourceEntityId', v_ticket.source_entity_id,
      'responseDueAt', v_ticket.response_due_at,
      'resolutionDueAt', v_ticket.resolution_due_at,
      'firstResponseAt', v_ticket.first_response_at,
      'resolvedAt', v_ticket.resolved_at,
      'closedAt', v_ticket.closed_at,
      'resolutionCode', v_ticket.resolution_code,
      'lastActivityAt', v_ticket.last_activity_at,
      'activitySequence', v_ticket.activity_sequence,
      'isConfidential', v_ticket.is_confidential,
      'metadata', v_ticket.metadata,
      'createdAt', v_ticket.created_at,
      'updatedAt', v_ticket.updated_at,
      'version', v_ticket.version
    ),
    'canHandle', v_handler,
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'authorUserId', c.author_user_id,
        'body', c.body,
        'isInternal', c.is_internal,
        'isSystem', c.is_system,
        'sequence', c.sequence,
        'createdAt', c.created_at
      ) order by c.sequence)
      from public.ticket_comments c
      where c.ticket_id = p_ticket_id and (not c.is_internal or v_handler)
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', tt.tag_key, 'label', tt.label, 'kind', tt.tag_kind,
        'createdAt', tt.created_at
      ) order by tt.tag_kind, tt.label)
      from public.ticket_tags tt where tt.ticket_id = p_ticket_id
    ), '[]'::jsonb),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'fileName', a.file_name,
        'contentType', a.content_type,
        'sizeBytes', a.size_bytes,
        'uploadedBy', a.uploaded_by,
        'createdAt', a.created_at,
        'uploadedAt', a.uploaded_at
      ) order by a.created_at)
      from public.ticket_attachments a
      where a.ticket_id = p_ticket_id and a.upload_status = 'uploaded'
    ), '[]'::jsonb),
    'participants', case when v_handler then coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', tp.user_id,
        'role', tp.participant_role,
        'lastReadSequence', tp.last_read_sequence,
        'notificationsMuted', tp.notifications_muted,
        'joinedAt', tp.joined_at
      ) order by tp.joined_at)
      from public.ticket_participants tp
      where tp.ticket_id = p_ticket_id and tp.removed_at is null
    ), '[]'::jsonb) else '[]'::jsonb end,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'eventType', e.event_type,
        'actorUserId', e.actor_user_id,
        'payload', case when v_handler then e.payload else e.payload - 'internalNote' end,
        'sequence', e.sequence,
        'createdAt', e.created_at
      ) order by e.sequence)
      from public.ticket_events e where e.ticket_id = p_ticket_id
    ), '[]'::jsonb),
    'lastReadSequence', coalesce((
      select last_read_sequence from public.ticket_participants
      where ticket_id = p_ticket_id and user_id = p_actor_id and removed_at is null
    ), 0),
    'unreadCount', greatest(v_ticket.activity_sequence - coalesce((
      select last_read_sequence from public.ticket_participants
      where ticket_id = p_ticket_id and user_id = p_actor_id and removed_at is null
    ), 0), 0)
  );
end;
$$;

create or replace function public.ticket_summary_for_actor(
  p_actor_id text
)
returns jsonb
language sql
stable
security invoker
set search_path = public, ticket_internal
as $$
  -- Every ticket the actor may see (participant OR queue handler), across ALL
  -- statuses. `open` counts only active statuses; `unread` counts unread activity
  -- on any non-archived ticket, so a newly RESOLVED ticket's unread does not vanish
  -- (the old CTE filtered to active statuses BEFORE both counts).
  with visible as (
    select t.status,
           t.activity_sequence,
           coalesce(tp.last_read_sequence, 0) as last_read_sequence
    from public.tickets t
    join public.ticket_queues q on q.code = t.queue_code
    left join public.ticket_participants tp
      on tp.ticket_id = t.id and tp.user_id = p_actor_id and tp.removed_at is null
    where (
      tp.user_id is not null
      or ticket_internal.user_has_permission(p_actor_id, q.handler_permission)
    )
  )
  select jsonb_build_object(
    'open', count(*) filter (
      where status in ('open','assigned','in_progress','waiting_requester','reopened')
    ),
    'unread', count(*) filter (
      where activity_sequence > last_read_sequence
        and status not in ('closed','cancelled')
    )
  )
  from visible;
$$;

create or replace function public.ticket_overdue_sweep_tx(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = public, ticket_internal
as $$
declare
  v_ticket public.tickets%rowtype;
  v_sequence bigint;
  v_event_id uuid;
  v_handlers text[];
  v_all_recipients text[] := '{}'::text[];
  v_processed integer := 0;
begin
  for v_ticket in
    select *
    from public.tickets
    where status in ('open','assigned','in_progress','waiting_requester','reopened')
      and resolution_due_at < now()
      and overdue_notified_at is null
    order by resolution_due_at, id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  loop
    v_sequence := v_ticket.activity_sequence + 1;
    update public.tickets
    set overdue_notified_at = now(),
        activity_sequence = v_sequence,
        version = version + 1,
        last_activity_at = now(),
        updated_at = now()
    where id = v_ticket.id
    returning * into v_ticket;

    v_event_id := ticket_internal.record_event(
      v_ticket, null, 'overdue',
      jsonb_build_object('resolutionDueAt', v_ticket.resolution_due_at),
      v_sequence
    );
    v_handlers := ticket_internal.handler_user_ids(v_ticket.queue_code, null);
    perform ticket_internal.notify_users(
      v_ticket, v_event_id, 'overdue',
      'Ticket overdue',
      v_ticket.ticket_number || ' · ' || v_ticket.subject,
      v_handlers, true, v_ticket.resolution_due_at
    );
    v_all_recipients := v_all_recipients || v_handlers;
    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'recipientIds', (
      select coalesce(array_agg(distinct x), '{}'::text[])
      from unnest(v_all_recipients) x
    )
  );
end;
$$;

revoke all on function public.ticket_create_tx(
  text,text,text,text,text,text,text,text,text,text,text,text
) from public, anon, authenticated;
revoke all on function public.ticket_comment_tx(
  text,uuid,text,boolean,text
) from public, anon, authenticated;
revoke all on function public.ticket_command_tx(
  text,uuid,text,jsonb,text
) from public, anon, authenticated;
revoke all on function public.ticket_mark_read_tx(
  text,uuid,bigint
) from public, anon, authenticated;
revoke all on function public.ticket_attachment_complete_tx(
  text,uuid,text
) from public, anon, authenticated;
revoke all on function public.ticket_request_types_for_actor(text,text)
  from public, anon, authenticated;
revoke all on function public.ticket_requester_search(text,text,text,integer)
  from public, anon, authenticated;
revoke all on function public.ticket_list_for_actor(
  text,text,text,text,text,text,text,text,integer,timestamptz
) from public, anon, authenticated;
revoke all on function public.ticket_get_for_actor(text,uuid)
  from public, anon, authenticated;
revoke all on function public.ticket_summary_for_actor(text)
  from public, anon, authenticated;
revoke all on function public.ticket_overdue_sweep_tx(integer)
  from public, anon, authenticated;

grant execute on function public.ticket_create_tx(
  text,text,text,text,text,text,text,text,text,text,text,text
) to service_role;
grant execute on function public.ticket_comment_tx(
  text,uuid,text,boolean,text
) to service_role;
grant execute on function public.ticket_command_tx(
  text,uuid,text,jsonb,text
) to service_role;
grant execute on function public.ticket_mark_read_tx(
  text,uuid,bigint
) to service_role;
grant execute on function public.ticket_attachment_complete_tx(
  text,uuid,text
) to service_role;
grant execute on function public.ticket_request_types_for_actor(text,text)
  to service_role;
grant execute on function public.ticket_requester_search(text,text,text,integer)
  to service_role;
grant execute on function public.ticket_list_for_actor(
  text,text,text,text,text,text,text,text,integer,timestamptz
) to service_role;
grant execute on function public.ticket_get_for_actor(text,uuid)
  to service_role;
grant execute on function public.ticket_summary_for_actor(text)
  to service_role;
grant execute on function public.ticket_overdue_sweep_tx(integer)
  to service_role;

notify pgrst, 'reload schema';
