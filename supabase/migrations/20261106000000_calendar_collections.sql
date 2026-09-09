-- ============================================================================
-- Calendar collections — real "My Calendars" containers
-- ============================================================================
-- A collection is the durable home for native calendar events and tasks. It is
-- deliberately separate from source modules (Meetings/HSE/etc.) and categories
-- (event/task/deadline). All writes use SECURITY DEFINER commands so the business
-- row, app_event, audit_log and idempotency receipt commit atomically.
-- ============================================================================

begin;

create schema if not exists cal_internal;
revoke usage on schema cal_internal from public;
grant usage on schema cal_internal to service_role;

create table if not exists public.calendar_collections (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  owner_user_id     text not null references public.app_users(id) on delete cascade,
  visibility        text not null default 'personal'
                    check (visibility in ('personal', 'team', 'org')),
  department_id     text references public.departments(id) on delete set null,
  color_key         text check (color_key is null or color_key in ('blue', 'indigo', 'purple', 'rose', 'coral', 'amber', 'lime', 'mint', 'teal', 'slate')),
  custom_color      text,
  is_default        boolean not null default false,
  status            text not null default 'active' check (status in ('active', 'archived')),
  created_by        text not null references public.app_users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint calendar_collections_name_check
    check (char_length(btrim(name)) between 1 and 80),
  constraint calendar_collections_description_check
    check (description is null or char_length(description) <= 400),
  constraint calendar_collections_custom_color_check
    check (custom_color is null or custom_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint calendar_collections_color_choice_check
    check (not (color_key is not null and custom_color is not null)),
  constraint calendar_collections_department_scope_check
    check ((visibility = 'team' and department_id is not null) or (visibility <> 'team' and department_id is null)),
  constraint calendar_collections_default_active_check
    check (not is_default or status = 'active')
);

create unique index if not exists calendar_collections_owner_name_uidx
  on public.calendar_collections (owner_user_id, lower(btrim(name)))
  where status = 'active';
create unique index if not exists calendar_collections_owner_default_uidx
  on public.calendar_collections (owner_user_id)
  where is_default and status = 'active';
create index if not exists calendar_collections_department_idx
  on public.calendar_collections (department_id, status);
create index if not exists calendar_collections_visibility_idx
  on public.calendar_collections (visibility, status);

drop trigger if exists trg_calendar_collections_updated_at on public.calendar_collections;
create trigger trg_calendar_collections_updated_at
  before update on public.calendar_collections
  for each row execute function public.set_calendar_updated_at();

alter table public.calendar_collections enable row level security;
revoke all on table public.calendar_collections from public, anon, authenticated;
grant select, insert, update, delete on table public.calendar_collections to service_role;

alter table public.calendar_entries
  add column if not exists calendar_collection_id uuid
    references public.calendar_collections(id) on delete restrict;
create index if not exists calendar_entries_collection_idx
  on public.calendar_entries (calendar_collection_id);

create table if not exists cal_internal.calendar_collection_request_receipts (
  request_key   text primary key,
  request_hash  text not null,
  operation     text not null,
  collection_id uuid references public.calendar_collections(id) on delete cascade,
  result        jsonb not null,
  created_at    timestamptz not null default now()
);
alter table cal_internal.calendar_collection_request_receipts enable row level security;
grant select, insert, update on cal_internal.calendar_collection_request_receipts to service_role;

-- Every existing user receives one honest default calendar, and existing native
-- entries are assigned to their owner's default instead of becoming orphans.
insert into public.calendar_collections (
  name, description, owner_user_id, visibility, color_key, is_default, created_by
)
select 'My Calendar', 'Your default SIOMAC calendar.', u.id, 'personal', 'blue', true, u.id
from public.app_users u
where not exists (
  select 1 from public.calendar_collections c
  where c.owner_user_id = u.id and c.status = 'active'
)
on conflict do nothing;

insert into public.app_events (
  event_type, source_module, source_entity_type, source_entity_id,
  actor_user_id, severity, payload, dedupe_key
)
select 'calendar.collection.provisioned', 'calendar', 'calendar_collection', c.id::text,
       c.owner_user_id, 'info', jsonb_build_object('name', c.name, 'isDefault', c.is_default),
       'calendar.collection.provisioned:' || c.owner_user_id
from public.calendar_collections c
where c.name = 'My Calendar' and c.is_default and c.status = 'active'
on conflict (dedupe_key) where dedupe_key is not null do nothing;

insert into public.audit_logs (action, table_name, record_id, user_id, changes)
select 'calendar.collection.provisioned', 'calendar_collection', c.id::text, c.owner_user_id,
       jsonb_build_object('name', c.name, 'isDefault', c.is_default)
from public.calendar_collections c
where c.name = 'My Calendar' and c.is_default and c.status = 'active'
  and not exists (
    select 1 from public.audit_logs a
    where a.action = 'calendar.collection.provisioned'
      and a.table_name = 'calendar_collection'
      and a.record_id = c.id::text
  );

update public.calendar_entries e
set calendar_collection_id = c.id
from public.calendar_collections c
where e.calendar_collection_id is null
  and c.owner_user_id = e.owner_user_id
  and c.is_default
  and c.status = 'active';

create or replace function public.calendar_collection_provision_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.calendar_collections (
    name, description, owner_user_id, visibility, color_key, is_default, created_by
  ) values (
    'My Calendar', 'Your default SIOMAC calendar.', new.id, 'personal', 'blue', true, new.id
  )
  returning id into v_id;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'calendar.collection.provisioned', 'calendar', 'calendar_collection', v_id::text,
    new.id, 'info', jsonb_build_object('name', 'My Calendar', 'isDefault', true),
    'calendar.collection.provisioned:' || new.id
  );

  insert into public.audit_logs (action, table_name, record_id, user_id, changes)
  values (
    'calendar.collection.provisioned', 'calendar_collection', v_id::text, new.id,
    jsonb_build_object('name', 'My Calendar', 'isDefault', true)
  );
  return new;
end;
$$;

drop trigger if exists trg_app_users_calendar_default on public.app_users;
create trigger trg_app_users_calendar_default
  after insert on public.app_users
  for each row execute function public.calendar_collection_provision_default();
revoke all on function public.calendar_collection_provision_default() from public, anon, authenticated;

create or replace function public.calendar_collection_create_tx(
  p_actor_id        text,
  p_name            text,
  p_description     text,
  p_visibility      text,
  p_department_id   text,
  p_color_key       text,
  p_custom_color    text,
  p_make_default    boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_key  text;
  v_request_hash text;
  v_receipt      cal_internal.calendar_collection_request_receipts%rowtype;
  v_id           uuid;
  v_make_default boolean;
  v_result       jsonb;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'calendar_collection_create: actor is required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'calendar_collection_create: idempotency key is required' using errcode = '22023';
  end if;
  v_request_key := p_actor_id || '|calendar.collection.create|' || btrim(p_idempotency_key);
  v_request_hash := md5(jsonb_build_object(
    'name', btrim(p_name), 'description', nullif(btrim(coalesce(p_description, '')), ''),
    'visibility', p_visibility, 'departmentId', p_department_id,
    'colorKey', p_color_key, 'customColor', lower(p_custom_color),
    'makeDefault', coalesce(p_make_default, false)
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('calendar-collections-owner|' || p_actor_id, 0));

  select * into v_receipt
  from cal_internal.calendar_collection_request_receipts
  where request_key = v_request_key;
  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception 'calendar_collection_create: idempotency key reused with different inputs' using errcode = '22023';
    end if;
    return v_receipt.result;
  end if;

  v_make_default := coalesce(p_make_default, false) or not exists (
    select 1 from public.calendar_collections
    where owner_user_id = p_actor_id and status = 'active' and is_default
  );
  if v_make_default then
    update public.calendar_collections
    set is_default = false
    where owner_user_id = p_actor_id and status = 'active' and is_default;
  end if;

  insert into public.calendar_collections (
    name, description, owner_user_id, visibility, department_id,
    color_key, custom_color, is_default, created_by
  ) values (
    btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_actor_id,
    p_visibility, p_department_id, p_color_key, lower(p_custom_color), v_make_default, p_actor_id
  ) returning id into v_id;

  v_result := jsonb_build_object('collectionId', v_id, 'isDefault', v_make_default);
  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, department_id, payload, dedupe_key
  ) values (
    'calendar.collection.created', 'calendar', 'calendar_collection', v_id::text,
    p_actor_id, 'info', p_department_id,
    jsonb_build_object('name', btrim(p_name), 'visibility', p_visibility, 'isDefault', v_make_default),
    v_request_key || ':event'
  );
  insert into public.audit_logs (action, table_name, record_id, user_id, changes)
  values (
    'calendar.collection.created', 'calendar_collection', v_id::text, p_actor_id,
    jsonb_build_object('name', btrim(p_name), 'visibility', p_visibility, 'departmentId', p_department_id, 'isDefault', v_make_default)
  );
  insert into cal_internal.calendar_collection_request_receipts (
    request_key, request_hash, operation, collection_id, result
  ) values (v_request_key, v_request_hash, 'create', v_id, v_result);
  return v_result;
end;
$$;

create or replace function public.calendar_collection_update_tx(
  p_actor_id        text,
  p_collection_id   uuid,
  p_name            text,
  p_description     text,
  p_visibility      text,
  p_department_id   text,
  p_color_key       text,
  p_custom_color    text,
  p_make_default    boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_key  text;
  v_request_hash text;
  v_receipt      cal_internal.calendar_collection_request_receipts%rowtype;
  v_before       public.calendar_collections%rowtype;
  v_result       jsonb;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'calendar_collection_update: idempotency key is required' using errcode = '22023';
  end if;
  v_request_key := p_actor_id || '|calendar.collection.update|' || btrim(p_idempotency_key);
  v_request_hash := md5(jsonb_build_object(
    'collectionId', p_collection_id, 'name', btrim(p_name),
    'description', nullif(btrim(coalesce(p_description, '')), ''),
    'visibility', p_visibility, 'departmentId', p_department_id,
    'colorKey', p_color_key, 'customColor', lower(p_custom_color),
    'makeDefault', coalesce(p_make_default, false)
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('calendar-collections-owner|' || p_actor_id, 0));
  select * into v_receipt from cal_internal.calendar_collection_request_receipts where request_key = v_request_key;
  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception 'calendar_collection_update: idempotency key reused with different inputs' using errcode = '22023';
    end if;
    return v_receipt.result;
  end if;

  select * into v_before from public.calendar_collections
  where id = p_collection_id and owner_user_id = p_actor_id and status = 'active'
  for update;
  if not found then
    raise exception 'calendar_collection_update: active owned calendar not found' using errcode = 'P0002';
  end if;
  if coalesce(p_make_default, false) then
    update public.calendar_collections set is_default = false
    where owner_user_id = p_actor_id and status = 'active' and id <> p_collection_id and is_default;
  end if;

  update public.calendar_collections set
    name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''),
    visibility = p_visibility, department_id = p_department_id,
    color_key = p_color_key, custom_color = lower(p_custom_color),
    is_default = case when coalesce(p_make_default, false) then true else is_default end
  where id = p_collection_id;

  v_result := jsonb_build_object('collectionId', p_collection_id, 'isDefault', coalesce(p_make_default, false) or v_before.is_default);
  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, department_id, payload, dedupe_key
  ) values (
    'calendar.collection.updated', 'calendar', 'calendar_collection', p_collection_id::text,
    p_actor_id, 'info', p_department_id,
    jsonb_build_object('name', btrim(p_name), 'visibility', p_visibility, 'isDefault', coalesce(p_make_default, false) or v_before.is_default),
    v_request_key || ':event'
  );
  insert into public.audit_logs (action, table_name, record_id, user_id, changes)
  values (
    'calendar.collection.updated', 'calendar_collection', p_collection_id::text, p_actor_id,
    jsonb_build_object(
      'before', jsonb_build_object('name', v_before.name, 'visibility', v_before.visibility, 'departmentId', v_before.department_id, 'colorKey', v_before.color_key, 'customColor', v_before.custom_color, 'isDefault', v_before.is_default),
      'after', jsonb_build_object('name', btrim(p_name), 'visibility', p_visibility, 'departmentId', p_department_id, 'colorKey', p_color_key, 'customColor', lower(p_custom_color), 'isDefault', coalesce(p_make_default, false) or v_before.is_default)
    )
  );
  insert into cal_internal.calendar_collection_request_receipts (request_key, request_hash, operation, collection_id, result)
  values (v_request_key, v_request_hash, 'update', p_collection_id, v_result);
  return v_result;
end;
$$;

create or replace function public.calendar_collection_archive_tx(
  p_actor_id        text,
  p_collection_id   uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_key  text;
  v_request_hash text;
  v_receipt      cal_internal.calendar_collection_request_receipts%rowtype;
  v_before       public.calendar_collections%rowtype;
  v_next_default uuid;
  v_result       jsonb;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'calendar_collection_archive: idempotency key is required' using errcode = '22023';
  end if;
  v_request_key := p_actor_id || '|calendar.collection.archive|' || btrim(p_idempotency_key);
  v_request_hash := md5(jsonb_build_object('collectionId', p_collection_id)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('calendar-collections-owner|' || p_actor_id, 0));
  select * into v_receipt from cal_internal.calendar_collection_request_receipts where request_key = v_request_key;
  if found then
    if v_receipt.request_hash <> v_request_hash then
      raise exception 'calendar_collection_archive: idempotency key reused with different inputs' using errcode = '22023';
    end if;
    return v_receipt.result;
  end if;

  select * into v_before from public.calendar_collections
  where id = p_collection_id and owner_user_id = p_actor_id and status = 'active'
  for update;
  if not found then
    raise exception 'calendar_collection_archive: active owned calendar not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.calendar_collections
    where owner_user_id = p_actor_id and status = 'active' and id <> p_collection_id
  ) then
    raise exception 'calendar_collection_archive: at least one active calendar is required' using errcode = '22023';
  end if;

  if v_before.is_default then
    select id into v_next_default from public.calendar_collections
    where owner_user_id = p_actor_id and status = 'active' and id <> p_collection_id
    order by created_at, id limit 1 for update;
  end if;
  update public.calendar_collections set status = 'archived', is_default = false where id = p_collection_id;
  if v_next_default is not null then
    update public.calendar_collections set is_default = true where id = v_next_default;
  end if;

  v_result := jsonb_build_object('collectionId', p_collection_id, 'status', 'archived', 'defaultCollectionId', v_next_default);
  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'calendar.collection.archived', 'calendar', 'calendar_collection', p_collection_id::text,
    p_actor_id, 'info', jsonb_build_object('name', v_before.name, 'defaultCollectionId', v_next_default),
    v_request_key || ':event'
  );
  insert into public.audit_logs (action, table_name, record_id, user_id, changes)
  values (
    'calendar.collection.archived', 'calendar_collection', p_collection_id::text, p_actor_id,
    jsonb_build_object('name', v_before.name, 'previousDefault', v_before.is_default, 'defaultCollectionId', v_next_default)
  );
  insert into cal_internal.calendar_collection_request_receipts (request_key, request_hash, operation, collection_id, result)
  values (v_request_key, v_request_hash, 'archive', p_collection_id, v_result);
  return v_result;
end;
$$;

revoke all on function public.calendar_collection_create_tx(text, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.calendar_collection_update_tx(text, uuid, text, text, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.calendar_collection_archive_tx(text, uuid, text) from public, anon, authenticated;
grant execute on function public.calendar_collection_create_tx(text, text, text, text, text, text, text, boolean, text) to service_role;
grant execute on function public.calendar_collection_update_tx(text, uuid, text, text, text, text, text, text, boolean, text) to service_role;
grant execute on function public.calendar_collection_archive_tx(text, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
