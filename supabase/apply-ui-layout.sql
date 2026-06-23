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
  updated_by  text references public.app_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
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
