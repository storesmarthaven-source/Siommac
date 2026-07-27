-- Per-user, typed UI preferences. All access is through authenticated Netlify
-- routes using the service-role client; the browser never reads this table.
create table public.ui_user_preferences (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null references public.app_users(id) on delete cascade,
  preference_key   text not null check (char_length(preference_key) between 1 and 120),
  preference_value jsonb not null,
  version           integer not null default 1 check (version > 0),
  updated_by        text references public.app_users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, preference_key)
);

create index ui_user_preferences_user_idx
  on public.ui_user_preferences(user_id);

create trigger trg_ui_user_preferences_updated_at
  before update on public.ui_user_preferences
  for each row execute function public.set_updated_at();

alter table public.ui_user_preferences enable row level security;

create policy "service manages ui_user_preferences"
  on public.ui_user_preferences
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.ui_user_preferences from anon, authenticated;
grant select, insert, update, delete on table public.ui_user_preferences to service_role;
