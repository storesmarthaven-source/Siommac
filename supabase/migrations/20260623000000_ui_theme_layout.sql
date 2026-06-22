-- ── UI personalisation: design-system theme + module page card layout ──────────
--   app_theme  — the app-wide design-system token overrides (one global row)
--   ui_layout  — per-page card ordering: one org-wide default (user_id NULL) plus
--                optional per-user overrides (user_id set)
-- Platform-level tables (no module prefix). app_users.id is TEXT.
-- ─────────────────────────────────────────────────────────────────────────────────

-- Shared updated_at trigger fn (idempotent — also defined by earlier migrations).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── app_theme ─────────────────────────────────────────────────────────────────
-- Single global row (scope = 'global'). `tokens` is a JSON map of CSS custom
-- property → override value (e.g. {"--siomac-navy":"#1b2d54"}). Empty = defaults.
create table if not exists public.app_theme (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null default 'global' unique,
  tokens      jsonb not null default '{}'::jsonb,
  updated_by  text references public.app_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

alter table public.app_theme enable row level security;
-- Theme is non-sensitive UI config — readable by anyone (the login screen themes
-- itself too). Writes go through the service-role backend only.
create policy "anyone read app_theme"        on public.app_theme for select using (true);
create policy "service write app_theme"       on public.app_theme for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create trigger trg_app_theme_updated_at
  before update on public.app_theme
  for each row execute function public.set_updated_at();

-- Seed the single global row so /theme/get always has a row to read/upsert.
insert into public.app_theme (scope, tokens) values ('global', '{}'::jsonb)
  on conflict (scope) do nothing;

-- ── ui_layout ─────────────────────────────────────────────────────────────────
-- Card ordering per module page. `page_key` identifies the page (e.g.
-- 'hse.risk'). `user_id` NULL = the org-wide default; a set user_id = that user's
-- personal override. `card_order` is an ordered JSON array of card keys.
create table if not exists public.ui_layout (
  id          uuid primary key default gen_random_uuid(),
  page_key    text not null,
  user_id     text references public.app_users(id),
  card_order  jsonb not null default '[]'::jsonb,
  updated_by  text references public.app_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

-- One org default per page (user_id NULL) and one override per (page,user).
create unique index if not exists ui_layout_default_uniq
  on public.ui_layout(page_key) where user_id is null;
create unique index if not exists ui_layout_user_uniq
  on public.ui_layout(page_key, user_id) where user_id is not null;
create index if not exists ui_layout_user_idx on public.ui_layout(user_id);

alter table public.ui_layout enable row level security;
create policy "authenticated read ui_layout" on public.ui_layout for select using (auth.role() = 'authenticated');
create policy "service write ui_layout"      on public.ui_layout for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create trigger trg_ui_layout_updated_at
  before update on public.ui_layout
  for each row execute function public.set_updated_at();
