-- External calendar connections and one-way provider imports.
-- Provider credentials are encrypted by the Netlify API before they reach Postgres.
-- Browser roles receive no table or RPC access; every operation is mediated by JWT APIs.

begin;

create schema if not exists cal_internal;
revoke all on schema cal_internal from public, anon, authenticated;

create table public.calendar_connections (
  id                    uuid primary key default gen_random_uuid(),
  owner_user_id         text not null references public.app_users(id) on delete cascade,
  provider              text not null check (provider in ('google', 'microsoft', 'apple', 'exchange')),
  provider_account_id   text not null,
  account_email         text,
  display_name          text not null,
  status                text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  sync_direction        text not null default 'import' check (sync_direction = 'import'),
  credentials_encrypted text,
  granted_scopes        text[] not null default '{}',
  provider_metadata     jsonb not null default '{}',
  last_synced_at        timestamptz,
  last_error_code       text,
  last_error_message    text,
  sync_claimed_at       timestamptz,
  sync_claim_token      uuid,
  created_by            text not null references public.app_users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_calendar_connection_account unique (owner_user_id, provider, provider_account_id),
  constraint chk_calendar_connection_account_id check (char_length(btrim(provider_account_id)) between 1 and 500),
  constraint chk_calendar_connection_display_name check (char_length(btrim(display_name)) between 1 and 160),
  constraint chk_calendar_connection_error_len check (
    (last_error_code is null or char_length(last_error_code) <= 80)
    and (last_error_message is null or char_length(last_error_message) <= 500)
  )
);

create index calendar_connections_owner_status_idx
  on public.calendar_connections (owner_user_id, status);
create index calendar_connections_active_sync_idx
  on public.calendar_connections (last_synced_at)
  where status = 'active';

create table public.calendar_external_calendars (
  id                     uuid primary key default gen_random_uuid(),
  connection_id          uuid not null references public.calendar_connections(id) on delete cascade,
  provider_calendar_id   text not null,
  name                   text not null,
  description            text,
  provider_color         text,
  time_zone              text,
  access_role            text,
  is_primary             boolean not null default false,
  enabled                boolean not null default false,
  calendar_collection_id uuid unique references public.calendar_collections(id) on delete set null,
  provider_etag          text,
  sync_cursor            jsonb not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint uq_calendar_external_calendar unique (connection_id, provider_calendar_id),
  constraint chk_calendar_external_calendar_id check (char_length(btrim(provider_calendar_id)) between 1 and 2000),
  constraint chk_calendar_external_calendar_name check (char_length(btrim(name)) between 1 and 240)
);

create index calendar_external_calendars_connection_idx
  on public.calendar_external_calendars (connection_id);
create index calendar_external_calendars_enabled_idx
  on public.calendar_external_calendars (connection_id, enabled)
  where enabled;

create table public.calendar_external_event_links (
  id                   uuid primary key default gen_random_uuid(),
  connection_id        uuid not null references public.calendar_connections(id) on delete cascade,
  external_calendar_id uuid not null references public.calendar_external_calendars(id) on delete cascade,
  provider_event_id    text not null,
  calendar_entry_id    uuid not null unique references public.calendar_entries(id) on delete cascade,
  provider_etag        text,
  provider_updated_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint uq_calendar_external_event unique (external_calendar_id, provider_event_id),
  constraint chk_calendar_external_event_id check (char_length(btrim(provider_event_id)) between 1 and 2000)
);

create index calendar_external_event_links_connection_idx
  on public.calendar_external_event_links (connection_id);
create index calendar_external_event_links_calendar_idx
  on public.calendar_external_event_links (external_calendar_id);

create table cal_internal.calendar_oauth_states (
  state_hash              text primary key,
  owner_user_id           text not null references public.app_users(id) on delete cascade,
  provider                text not null check (provider in ('google', 'microsoft')),
  code_verifier_encrypted text not null,
  redirect_uri            text not null,
  expires_at              timestamptz not null,
  created_at              timestamptz not null default now(),
  constraint chk_calendar_oauth_state_hash check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint chk_calendar_oauth_redirect check (redirect_uri ~ '^https?://')
);
create index calendar_oauth_states_expiry_idx on cal_internal.calendar_oauth_states (expires_at);

alter table public.calendar_connections enable row level security;
alter table public.calendar_external_calendars enable row level security;
alter table public.calendar_external_event_links enable row level security;

revoke all on table public.calendar_connections from public, anon, authenticated;
revoke all on table public.calendar_external_calendars from public, anon, authenticated;
revoke all on table public.calendar_external_event_links from public, anon, authenticated;
revoke all on table cal_internal.calendar_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on table public.calendar_connections to service_role;
grant select, insert, update, delete on table public.calendar_external_calendars to service_role;
grant select, insert, update, delete on table public.calendar_external_event_links to service_role;
grant select, insert, update, delete on table cal_internal.calendar_oauth_states to service_role;

create trigger trg_calendar_connections_updated_at
  before update on public.calendar_connections
  for each row execute function public.set_calendar_updated_at();
create trigger trg_calendar_external_calendars_updated_at
  before update on public.calendar_external_calendars
  for each row execute function public.set_calendar_updated_at();
create trigger trg_calendar_external_event_links_updated_at
  before update on public.calendar_external_event_links
  for each row execute function public.set_calendar_updated_at();

create or replace function public.calendar_oauth_state_create(
  p_state_hash text,
  p_actor_id text,
  p_provider text,
  p_code_verifier_encrypted text,
  p_redirect_uri text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider not in ('google', 'microsoft')
    or p_expires_at <= now()
    or p_expires_at > now() + interval '15 minutes'
  then
    raise exception 'calendar_oauth_state: invalid state parameters' using errcode = '22023';
  end if;
  delete from cal_internal.calendar_oauth_states where expires_at <= now();
  insert into cal_internal.calendar_oauth_states (
    state_hash, owner_user_id, provider, code_verifier_encrypted, redirect_uri, expires_at
  ) values (
    p_state_hash, p_actor_id, p_provider, p_code_verifier_encrypted, p_redirect_uri, p_expires_at
  );
end;
$$;

create or replace function public.calendar_oauth_state_consume(
  p_state_hash text,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_state cal_internal.calendar_oauth_states%rowtype;
begin
  delete from cal_internal.calendar_oauth_states
  where state_hash = p_state_hash
    and owner_user_id = p_actor_id
    and expires_at > now()
  returning * into v_state;
  if not found then
    raise exception 'calendar_oauth_state: invalid, expired, or already consumed' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'provider', v_state.provider,
    'codeVerifierEncrypted', v_state.code_verifier_encrypted,
    'redirectUri', v_state.redirect_uri
  );
end;
$$;

create or replace function public.calendar_connection_activate_tx(
  p_actor_id text,
  p_provider text,
  p_provider_account_id text,
  p_account_email text,
  p_display_name text,
  p_credentials_encrypted text,
  p_granted_scopes text[],
  p_provider_metadata jsonb,
  p_calendars jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
  v_calendar jsonb;
  v_primary_count integer := 0;
  v_existing_source text;
begin
  if p_provider not in ('google', 'microsoft', 'apple', 'exchange') then
    raise exception 'calendar_connection_activate: invalid provider' using errcode = '22023';
  end if;
  if p_credentials_encrypted is null or btrim(p_credentials_encrypted) = '' then
    raise exception 'calendar_connection_activate: encrypted credentials are required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_calendars, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_calendars, '[]'::jsonb)) = 0 then
    raise exception 'calendar_connection_activate: provider returned no calendars' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'calendar_connection_activate: idempotency key is required' using errcode = '22023';
  end if;
  select source_entity_id into v_existing_source from public.app_events
  where dedupe_key = p_actor_id || '|calendar.connection.activated|' || p_idempotency_key
  limit 1;
  if found then
    return jsonb_build_object('connectionId', v_existing_source::uuid, 'idempotentReplay', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar-connection|' || p_actor_id || '|' || p_provider || '|' || p_provider_account_id, 0));

  select id into v_connection_id from public.calendar_connections
  where owner_user_id = p_actor_id and provider = p_provider and provider_account_id = p_provider_account_id
  for update;
  if found then
    update public.calendar_connections set
      account_email = nullif(btrim(coalesce(p_account_email, '')), ''),
      display_name = btrim(p_display_name), status = 'active', sync_direction = 'import',
      credentials_encrypted = p_credentials_encrypted,
      granted_scopes = coalesce(p_granted_scopes, '{}'),
      provider_metadata = coalesce(p_provider_metadata, '{}'),
      last_error_code = null, last_error_message = null
    where id = v_connection_id;
  else
    insert into public.calendar_connections (
      owner_user_id, provider, provider_account_id, account_email, display_name,
      credentials_encrypted, granted_scopes, provider_metadata, created_by
    ) values (
      p_actor_id, p_provider, btrim(p_provider_account_id), nullif(btrim(coalesce(p_account_email, '')), ''),
      btrim(p_display_name), p_credentials_encrypted, coalesce(p_granted_scopes, '{}'),
      coalesce(p_provider_metadata, '{}'), p_actor_id
    ) returning id into v_connection_id;
  end if;

  for v_calendar in select value from jsonb_array_elements(p_calendars)
  loop
    if coalesce(v_calendar->>'id', '') = '' or coalesce(v_calendar->>'name', '') = '' then
      raise exception 'calendar_connection_activate: malformed provider calendar' using errcode = '22023';
    end if;
    insert into public.calendar_external_calendars (
      connection_id, provider_calendar_id, name, description, provider_color,
      time_zone, access_role, is_primary, provider_etag
    ) values (
      v_connection_id, v_calendar->>'id', v_calendar->>'name', nullif(v_calendar->>'description', ''),
      nullif(v_calendar->>'color', ''), nullif(v_calendar->>'timeZone', ''),
      nullif(v_calendar->>'accessRole', ''), coalesce((v_calendar->>'isPrimary')::boolean, false),
      nullif(v_calendar->>'etag', '')
    )
    on conflict (connection_id, provider_calendar_id) do update set
      name = excluded.name, description = excluded.description,
      provider_color = excluded.provider_color, time_zone = excluded.time_zone,
      access_role = excluded.access_role, is_primary = excluded.is_primary,
      provider_etag = excluded.provider_etag;
    if coalesce((v_calendar->>'isPrimary')::boolean, false) then v_primary_count := v_primary_count + 1; end if;
  end loop;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'calendar.connection.activated', 'calendar', 'calendar_connection', v_connection_id::text,
    p_actor_id, 'info', jsonb_build_object('provider', p_provider, 'calendarCount', jsonb_array_length(p_calendars)),
    p_actor_id || '|calendar.connection.activated|' || p_idempotency_key
  ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  insert into public.audit_logs (action, table_name, record_id, user_id, changes)
  values (
    'calendar.connection.activated', 'calendar_connections', v_connection_id::text, p_actor_id,
    jsonb_build_object('provider', p_provider, 'accountEmail', p_account_email, 'calendarCount', jsonb_array_length(p_calendars))
  );
  return jsonb_build_object('connectionId', v_connection_id, 'calendarCount', jsonb_array_length(p_calendars), 'primaryCalendarCount', v_primary_count);
end;
$$;

create or replace function public.calendar_connection_sync_claim_tx(
  p_actor_id text,
  p_connection_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_connection public.calendar_connections%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('calendar-connection-sync-claim|' || p_connection_id::text, 0));
  select * into v_connection from public.calendar_connections
  where id = p_connection_id and owner_user_id = p_actor_id and status in ('active', 'error')
  for update;
  if not found then raise exception 'calendar_connection_sync_claim: connection not found' using errcode = 'P0002'; end if;
  if v_connection.sync_claimed_at is not null and v_connection.sync_claimed_at > now() - interval '15 minutes' then
    raise exception 'calendar_connection_sync_claim: sync already running' using errcode = '55P03';
  end if;
  update public.calendar_connections set sync_claimed_at = now(), sync_claim_token = p_claim_token
  where id = p_connection_id;
  return jsonb_build_object('connectionId', p_connection_id, 'claimed', true);
end;
$$;

create or replace function public.calendar_external_calendar_toggle_tx(
  p_actor_id text,
  p_external_calendar_id uuid,
  p_enabled boolean,
  p_color_key text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remote public.calendar_external_calendars%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_collection_id uuid;
  v_existing_payload jsonb;
begin
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'calendar_external_calendar_toggle: idempotency key is required' using errcode = '22023';
  end if;
  select payload into v_existing_payload from public.app_events
  where dedupe_key = p_actor_id || '|calendar.external_calendar.toggle|' || p_idempotency_key
  limit 1;
  if found then
    return coalesce(v_existing_payload, '{}'::jsonb) || jsonb_build_object('externalCalendarId', p_external_calendar_id, 'idempotentReplay', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar-external-calendar|' || p_external_calendar_id::text, 0));
  select ec.* into v_remote from public.calendar_external_calendars ec
  join public.calendar_connections cc on cc.id = ec.connection_id
  where ec.id = p_external_calendar_id and cc.owner_user_id = p_actor_id and cc.status in ('active', 'error')
  for update of ec;
  if not found then raise exception 'calendar_external_calendar_toggle: calendar not found' using errcode = 'P0002'; end if;
  select * into v_connection from public.calendar_connections where id = v_remote.connection_id;
  v_collection_id := v_remote.calendar_collection_id;

  if p_enabled then
    if v_collection_id is null then
      insert into public.calendar_collections (
        name, description, owner_user_id, visibility, color_key, is_default, created_by
      ) values (
        left(initcap(v_connection.provider) || ' · ' || v_remote.name, 70) || ' · ' || left(md5(v_connection.provider_account_id), 6),
        coalesce(v_remote.description, initcap(v_connection.provider) || ' calendar · imported read-only'),
        p_actor_id, 'personal', coalesce(p_color_key, 'blue'), false, p_actor_id
      ) returning id into v_collection_id;
    else
      update public.calendar_collections set status = 'active', color_key = coalesce(p_color_key, color_key)
      where id = v_collection_id and owner_user_id = p_actor_id;
    end if;
  elsif v_collection_id is not null then
    update public.calendar_collections set status = 'archived', is_default = false
    where id = v_collection_id and owner_user_id = p_actor_id;
  end if;

  update public.calendar_external_calendars
  set enabled = p_enabled, calendar_collection_id = v_collection_id
  where id = p_external_calendar_id;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key
  ) values (
    'calendar.external_calendar.' || case when p_enabled then 'enabled' else 'disabled' end,
    'calendar', 'calendar_external_calendar', p_external_calendar_id::text, p_actor_id, 'info',
    jsonb_build_object('provider', v_connection.provider, 'name', v_remote.name, 'collectionId', v_collection_id, 'enabled', p_enabled),
    p_actor_id || '|calendar.external_calendar.toggle|' || p_idempotency_key
  ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  insert into public.audit_logs (action, table_name, record_id, user_id, changes)
  values (
    'calendar.external_calendar.' || case when p_enabled then 'enabled' else 'disabled' end,
    'calendar_external_calendars', p_external_calendar_id::text, p_actor_id,
    jsonb_build_object('provider', v_connection.provider, 'name', v_remote.name, 'collectionId', v_collection_id)
  );
  return jsonb_build_object('externalCalendarId', p_external_calendar_id, 'collectionId', v_collection_id, 'enabled', p_enabled);
end;
$$;

create or replace function public.calendar_external_events_upsert_tx(
  p_actor_id text,
  p_external_calendar_id uuid,
  p_events jsonb,
  p_deleted_event_ids text[],
  p_sync_cursor jsonb,
  p_sync_run_id text,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remote public.calendar_external_calendars%rowtype;
  v_connection public.calendar_connections%rowtype;
  v_event jsonb;
  v_entry_id uuid;
  v_link public.calendar_external_event_links%rowtype;
  v_upserted integer := 0;
  v_deleted integer := 0;
begin
  if jsonb_typeof(coalesce(p_events, '[]'::jsonb)) <> 'array' then
    raise exception 'calendar_external_events_upsert: events must be an array' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar-external-sync|' || p_external_calendar_id::text, 0));
  select ec.* into v_remote from public.calendar_external_calendars ec
  join public.calendar_connections cc on cc.id = ec.connection_id
  where ec.id = p_external_calendar_id and ec.enabled and ec.calendar_collection_id is not null
    and cc.owner_user_id = p_actor_id and cc.status in ('active', 'error') and cc.sync_claim_token = p_claim_token
  for update of ec;
  if not found then raise exception 'calendar_external_events_upsert: enabled calendar not found' using errcode = 'P0002'; end if;
  select * into v_connection from public.calendar_connections where id = v_remote.connection_id for update;

  for v_event in select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
  loop
    if coalesce(v_event->>'providerEventId', '') = '' or coalesce(v_event->>'title', '') = '' then
      raise exception 'calendar_external_events_upsert: malformed event' using errcode = '22023';
    end if;
    select * into v_link from public.calendar_external_event_links
    where external_calendar_id = p_external_calendar_id and provider_event_id = v_event->>'providerEventId'
    for update;
    if found then
      v_entry_id := v_link.calendar_entry_id;
      update public.calendar_entries set
        title = left(v_event->>'title', 200), notes = nullif(v_event->>'notes', ''),
        location_label = nullif(left(v_event->>'location', 240), ''),
        all_day = (v_event->>'allDay')::boolean,
        starts_on = case when (v_event->>'allDay')::boolean then (v_event->>'startsOn')::date else null end,
        ends_on = case when (v_event->>'allDay')::boolean then nullif(v_event->>'endsOn', '')::date else null end,
        starts_at = case when not (v_event->>'allDay')::boolean then (v_event->>'startsAt')::timestamptz else null end,
        ends_at = case when not (v_event->>'allDay')::boolean then nullif(v_event->>'endsAt', '')::timestamptz else null end,
        source_ref = v_event->>'providerEventId'
      where id = v_entry_id;
      update public.calendar_external_event_links set
        provider_etag = nullif(v_event->>'etag', ''),
        provider_updated_at = nullif(v_event->>'updatedAt', '')::timestamptz
      where id = v_link.id;
    else
      insert into public.calendar_entries (
        type, title, notes, location_label, all_day, starts_on, ends_on, starts_at, ends_at,
        owner_user_id, visibility, status, priority, source_module, source_ref,
        created_by, calendar_collection_id
      ) values (
        'activity', left(v_event->>'title', 200), nullif(v_event->>'notes', ''), nullif(left(v_event->>'location', 240), ''),
        (v_event->>'allDay')::boolean,
        case when (v_event->>'allDay')::boolean then (v_event->>'startsOn')::date else null end,
        case when (v_event->>'allDay')::boolean then nullif(v_event->>'endsOn', '')::date else null end,
        case when not (v_event->>'allDay')::boolean then (v_event->>'startsAt')::timestamptz else null end,
        case when not (v_event->>'allDay')::boolean then nullif(v_event->>'endsAt', '')::timestamptz else null end,
        p_actor_id, 'personal', null, null, 'external_calendar', v_event->>'providerEventId',
        p_actor_id, v_remote.calendar_collection_id
      ) returning id into v_entry_id;
      insert into public.calendar_external_event_links (
        connection_id, external_calendar_id, provider_event_id, calendar_entry_id, provider_etag, provider_updated_at
      ) values (
        v_remote.connection_id, p_external_calendar_id, v_event->>'providerEventId', v_entry_id,
        nullif(v_event->>'etag', ''), nullif(v_event->>'updatedAt', '')::timestamptz
      );
    end if;
    v_upserted := v_upserted + 1;
  end loop;

  if coalesce(array_length(p_deleted_event_ids, 1), 0) > 0 then
    with deleted_entries as (
      delete from public.calendar_entries ce
      using public.calendar_external_event_links link
      where ce.id = link.calendar_entry_id
        and link.external_calendar_id = p_external_calendar_id
        and link.provider_event_id = any(p_deleted_event_ids)
      returning ce.id
    ) select count(*) into v_deleted from deleted_entries;
  end if;

  update public.calendar_external_calendars set sync_cursor = coalesce(p_sync_cursor, '{}')
  where id = p_external_calendar_id;
  update public.calendar_connections set
    status = 'active', last_synced_at = now(), last_error_code = null, last_error_message = null
  where id = v_remote.connection_id;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key
  ) values (
    'calendar.connection.synced', 'calendar', 'calendar_connection', v_remote.connection_id::text,
    p_actor_id, 'info', jsonb_build_object('provider', v_connection.provider, 'calendar', v_remote.name, 'upserted', v_upserted, 'deleted', v_deleted),
    p_actor_id || '|calendar.connection.sync|' || p_sync_run_id || '|' || p_external_calendar_id::text
  ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  insert into public.audit_logs (action, table_name, record_id, user_id, changes)
  values (
    'calendar.connection.synced', 'calendar_connections', v_remote.connection_id::text, p_actor_id,
    jsonb_build_object('provider', v_connection.provider, 'calendar', v_remote.name, 'upserted', v_upserted, 'deleted', v_deleted)
  );
  return jsonb_build_object('upserted', v_upserted, 'deleted', v_deleted);
end;
$$;

create or replace function public.calendar_connection_sync_finish_tx(
  p_actor_id text,
  p_connection_id uuid,
  p_claim_token uuid,
  p_credentials_encrypted text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.calendar_connections set
    credentials_encrypted = p_credentials_encrypted,
    sync_claimed_at = null,
    sync_claim_token = null
  where id = p_connection_id and owner_user_id = p_actor_id and sync_claim_token = p_claim_token;
  if not found then raise exception 'calendar_connection_sync_finish: active claim not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('connectionId', p_connection_id, 'released', true);
end;
$$;

create or replace function public.calendar_connection_sync_failed_tx(
  p_actor_id text,
  p_connection_id uuid,
  p_error_code text,
  p_error_message text,
  p_sync_run_id text,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_connection public.calendar_connections%rowtype;
begin
  select * into v_connection from public.calendar_connections
  where id = p_connection_id and owner_user_id = p_actor_id and status <> 'disconnected'
    and sync_claim_token = p_claim_token
  for update;
  if not found then raise exception 'calendar_connection_sync_failed: connection not found' using errcode = 'P0002'; end if;
  update public.calendar_connections set
    status = 'error', last_error_code = left(p_error_code, 80), last_error_message = left(p_error_message, 500),
    sync_claimed_at = null, sync_claim_token = null
  where id = p_connection_id;
  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key
  ) values (
    'calendar.connection.sync_failed', 'calendar', 'calendar_connection', p_connection_id::text,
    p_actor_id, 'warning', jsonb_build_object('provider', v_connection.provider, 'errorCode', left(p_error_code, 80)),
    p_actor_id || '|calendar.connection.sync_failed|' || p_sync_run_id
  ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  insert into public.audit_logs (action, table_name, record_id, user_id, changes)
  values ('calendar.connection.sync_failed', 'calendar_connections', p_connection_id::text, p_actor_id,
    jsonb_build_object('provider', v_connection.provider, 'errorCode', left(p_error_code, 80)));
  return jsonb_build_object('connectionId', p_connection_id, 'status', 'error');
end;
$$;

create or replace function public.calendar_connection_disconnect_tx(
  p_actor_id text,
  p_connection_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_connection public.calendar_connections%rowtype; v_removed integer := 0; v_existing_payload jsonb;
begin
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'calendar_connection_disconnect: idempotency key is required' using errcode = '22023';
  end if;
  select payload into v_existing_payload from public.app_events
  where dedupe_key = p_actor_id || '|calendar.connection.disconnected|' || p_idempotency_key
  limit 1;
  if found then
    return coalesce(v_existing_payload, '{}'::jsonb) || jsonb_build_object('connectionId', p_connection_id, 'idempotentReplay', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('calendar-connection|' || p_connection_id::text, 0));
  select * into v_connection from public.calendar_connections
  where id = p_connection_id and owner_user_id = p_actor_id and status <> 'disconnected'
  for update;
  if not found then raise exception 'calendar_connection_disconnect: connection not found' using errcode = 'P0002'; end if;
  with removed as (
    delete from public.calendar_entries ce
    using public.calendar_external_event_links link
    where ce.id = link.calendar_entry_id and link.connection_id = p_connection_id
    returning ce.id
  ) select count(*) into v_removed from removed;
  update public.calendar_collections cc set status = 'archived', is_default = false
  where cc.id in (
    select ec.calendar_collection_id from public.calendar_external_calendars ec
    where ec.connection_id = p_connection_id and ec.calendar_collection_id is not null
  );
  update public.calendar_external_calendars set enabled = false, sync_cursor = '{}' where connection_id = p_connection_id;
  update public.calendar_connections set status = 'disconnected', credentials_encrypted = null,
    granted_scopes = '{}', last_error_code = null, last_error_message = null,
    sync_claimed_at = null, sync_claim_token = null
  where id = p_connection_id;
  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key
  ) values (
    'calendar.connection.disconnected', 'calendar', 'calendar_connection', p_connection_id::text,
    p_actor_id, 'warning', jsonb_build_object('provider', v_connection.provider, 'removedEventCount', v_removed),
    p_actor_id || '|calendar.connection.disconnected|' || p_idempotency_key
  ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  insert into public.audit_logs (action, table_name, record_id, user_id, changes)
  values ('calendar.connection.disconnected', 'calendar_connections', p_connection_id::text, p_actor_id,
    jsonb_build_object('provider', v_connection.provider, 'removedEventCount', v_removed));
  return jsonb_build_object('connectionId', p_connection_id, 'removedEventCount', v_removed);
end;
$$;

revoke all on function public.calendar_oauth_state_create(text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.calendar_oauth_state_consume(text, text) from public, anon, authenticated;
revoke all on function public.calendar_connection_activate_tx(text, text, text, text, text, text, text[], jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.calendar_connection_sync_claim_tx(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.calendar_external_calendar_toggle_tx(text, uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.calendar_external_events_upsert_tx(text, uuid, jsonb, text[], jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.calendar_connection_sync_finish_tx(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.calendar_connection_sync_failed_tx(text, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.calendar_connection_disconnect_tx(text, uuid, text) from public, anon, authenticated;
grant execute on function public.calendar_oauth_state_create(text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.calendar_oauth_state_consume(text, text) to service_role;
grant execute on function public.calendar_connection_activate_tx(text, text, text, text, text, text, text[], jsonb, jsonb, text) to service_role;
grant execute on function public.calendar_connection_sync_claim_tx(text, uuid, uuid) to service_role;
grant execute on function public.calendar_external_calendar_toggle_tx(text, uuid, boolean, text, text) to service_role;
grant execute on function public.calendar_external_events_upsert_tx(text, uuid, jsonb, text[], jsonb, text, uuid) to service_role;
grant execute on function public.calendar_connection_sync_finish_tx(text, uuid, uuid, text) to service_role;
grant execute on function public.calendar_connection_sync_failed_tx(text, uuid, text, text, text, uuid) to service_role;
grant execute on function public.calendar_connection_disconnect_tx(text, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
