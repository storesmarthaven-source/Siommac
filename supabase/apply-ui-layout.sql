-- ============================================================================
-- SIOMAC — UI personalisation tables: app_theme + ui_layout (consolidated)
--
-- HOW TO USE:  Supabase Dashboard → SQL Editor → paste → Run. Idempotent.
-- Without these tables, card "Arrange" order and "Set default" are NOT saved to
-- the database (they only persist in the browser's localStorage).
--
-- Mirrors migration 20260623000000_ui_theme_layout.sql.
-- Assumes public.app_users exists (id is TEXT).
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- ── app_theme ─────────────────────────────────────────────────────────────────
create table if not exists public.app_theme (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null default 'global' unique,
  tokens      jsonb not null default '{}'::jsonb,
  configuration jsonb not null default '{"schemaVersion":1,"theme":{"tokens":{}},"recipes":{"button":{"overrides":{}}}}'::jsonb,
  version     integer not null default 0 check (version >= 0),
  updated_by  text references public.app_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
alter table public.app_theme add column if not exists configuration jsonb
  not null default '{"schemaVersion":1,"theme":{"tokens":{}},"recipes":{"button":{"overrides":{}}}}'::jsonb;
alter table public.app_theme add column if not exists version integer not null default 0;
update public.app_theme
set configuration = jsonb_build_object('schemaVersion',1,'theme',jsonb_build_object('tokens',tokens),'recipes',jsonb_build_object('button',jsonb_build_object('overrides','{}'::jsonb)))
where version = 0 and configuration = '{"schemaVersion":1,"theme":{"tokens":{}},"recipes":{"button":{"overrides":{}}}}'::jsonb and tokens <> '{}'::jsonb;
alter table public.app_theme enable row level security;
drop policy if exists "anyone read app_theme"  on public.app_theme;
drop policy if exists "service write app_theme" on public.app_theme;
create policy "anyone read app_theme"  on public.app_theme for select using (true);
create policy "service write app_theme" on public.app_theme for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop trigger if exists trg_app_theme_updated_at on public.app_theme;
create trigger trg_app_theme_updated_at before update on public.app_theme
  for each row execute function public.set_updated_at();
insert into public.app_theme (scope, tokens) values ('global', '{}'::jsonb)
  on conflict (scope) do nothing;

create table if not exists public.app_theme_drafts (
  id uuid primary key default gen_random_uuid(), scope text not null default 'global',
  base_version integer not null check (base_version >= 0), revision integer not null default 1 check (revision > 0),
  status text not null default 'draft' check (status in ('draft','published','superseded')),
  configuration jsonb not null, validation jsonb not null,
  created_by text not null references public.app_users(id), updated_by text not null references public.app_users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists app_theme_one_open_draft_uidx on public.app_theme_drafts(scope) where status = 'draft';
alter table public.app_theme_drafts enable row level security;
create policy "service manages app_theme_drafts" on public.app_theme_drafts for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create trigger trg_app_theme_drafts_updated_at before update on public.app_theme_drafts for each row execute function public.set_updated_at();

create table if not exists public.app_theme_versions (
  id uuid primary key default gen_random_uuid(), scope text not null default 'global', version integer not null check (version > 0),
  configuration jsonb not null, summary text, published_by text not null references public.app_users(id),
  published_at timestamptz not null default now(), created_at timestamptz not null default now(), unique(scope, version)
);
create index if not exists app_theme_versions_scope_idx on public.app_theme_versions(scope, version desc);
alter table public.app_theme_versions enable row level security;
create policy "service manages app_theme_versions" on public.app_theme_versions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create or replace function public.publish_app_theme(p_actor text,p_draft_id uuid,p_expected_revision integer,p_summary text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_theme public.app_theme%rowtype; v_draft public.app_theme_drafts%rowtype; v_version integer; v_tokens jsonb; v_now timestamptz:=now();
begin
  select * into v_theme from public.app_theme where scope='global' for update;
  if not found then raise exception 'Global theme root is missing'; end if;
  select * into v_draft from public.app_theme_drafts where id=p_draft_id and scope='global' and status='draft' for update;
  if not found or v_draft.revision<>p_expected_revision then raise exception 'Draft is stale or no longer publishable'; end if;
  if v_draft.base_version<>v_theme.version then raise exception 'Published configuration changed after this draft was created'; end if;
  v_version:=v_theme.version+1; v_tokens:=coalesce(v_draft.configuration#>'{theme,tokens}','{}'::jsonb)||coalesce(v_draft.configuration#>'{recipes,button,overrides}','{}'::jsonb);
  insert into public.app_theme_versions(scope,version,configuration,summary,published_by,published_at) values('global',v_version,v_draft.configuration,p_summary,p_actor,v_now);
  update public.app_theme set tokens=v_tokens,configuration=v_draft.configuration,version=v_version,updated_by=p_actor,updated_at=v_now where id=v_theme.id;
  update public.app_theme_drafts set status='published',updated_by=p_actor,updated_at=v_now where id=v_draft.id;
  insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,actor_user_id,payload,dedupe_key) values('platform.theme.published','platform','app_theme','global',p_actor,jsonb_build_object('version',v_version,'summary',p_summary),'platform.theme.published:global:'||v_version);
  insert into public.audit_logs(action,table_name,record_id,user_id,changes) values('platform.theme.published','app_theme','global',p_actor,jsonb_build_object('version',v_version,'summary',p_summary));
  return jsonb_build_object('version',v_version,'configuration',v_draft.configuration,'publishedAt',v_now,'publishedBy',p_actor,'summary',p_summary);
end $$;

create or replace function public.rollback_app_theme(p_actor text,p_target_version integer,p_summary text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_theme public.app_theme%rowtype; v_configuration jsonb; v_version integer; v_tokens jsonb; v_now timestamptz:=now(); v_summary text:=p_summary||' (restored v'||p_target_version||')';
begin
  select * into v_theme from public.app_theme where scope='global' for update;
  if not found then raise exception 'Global theme root is missing'; end if;
  select configuration into v_configuration from public.app_theme_versions where scope='global' and version=p_target_version;
  if v_configuration is null then raise exception 'Published version not found'; end if;
  v_version:=v_theme.version+1; v_tokens:=coalesce(v_configuration#>'{theme,tokens}','{}'::jsonb)||coalesce(v_configuration#>'{recipes,button,overrides}','{}'::jsonb);
  insert into public.app_theme_versions(scope,version,configuration,summary,published_by,published_at) values('global',v_version,v_configuration,v_summary,p_actor,v_now);
  update public.app_theme set tokens=v_tokens,configuration=v_configuration,version=v_version,updated_by=p_actor,updated_at=v_now where id=v_theme.id;
  update public.app_theme_drafts set status='superseded',updated_by=p_actor,updated_at=v_now where scope='global' and status='draft';
  insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,actor_user_id,payload,dedupe_key) values('platform.theme.rolled_back','platform','app_theme','global',p_actor,jsonb_build_object('version',v_version,'summary',v_summary),'platform.theme.rolled_back:global:'||v_version);
  insert into public.audit_logs(action,table_name,record_id,user_id,changes) values('platform.theme.rolled_back','app_theme','global',p_actor,jsonb_build_object('version',v_version,'summary',v_summary));
  return jsonb_build_object('version',v_version,'configuration',v_configuration,'publishedAt',v_now,'publishedBy',p_actor,'summary',v_summary);
end $$;
revoke all on function public.publish_app_theme(text,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.rollback_app_theme(text,integer,text) from public,anon,authenticated;
grant execute on function public.publish_app_theme(text,uuid,integer,text) to service_role;
grant execute on function public.rollback_app_theme(text,integer,text) to service_role;

-- ── ui_layout ─────────────────────────────────────────────────────────────────
create table if not exists public.ui_layout (
  id          uuid primary key default gen_random_uuid(),
  page_key    text not null,
  user_id     text references public.app_users(id),
  card_order  jsonb not null default '[]'::jsonb,
  updated_by  text references public.app_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
create unique index if not exists ui_layout_default_uniq
  on public.ui_layout(page_key) where user_id is null;
create unique index if not exists ui_layout_user_uniq
  on public.ui_layout(page_key, user_id) where user_id is not null;
create index if not exists ui_layout_user_idx on public.ui_layout(user_id);

alter table public.ui_layout enable row level security;
drop policy if exists "authenticated read ui_layout" on public.ui_layout;
drop policy if exists "service write ui_layout"      on public.ui_layout;
create policy "authenticated read ui_layout" on public.ui_layout for select using (auth.role() = 'authenticated');
create policy "service write ui_layout"      on public.ui_layout for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
drop trigger if exists trg_ui_layout_updated_at on public.ui_layout;
create trigger trg_ui_layout_updated_at before update on public.ui_layout
  for each row execute function public.set_updated_at();

-- Quick check (optional):
-- select page_key, user_id, card_order from public.ui_layout order by page_key;
