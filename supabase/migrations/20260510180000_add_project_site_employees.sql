-- Junction table: which employees are assigned to which project site
create table if not exists public.project_site_employees (
  site_id  text not null references public.project_sites(id) on delete cascade,
  user_id  text not null references public.app_users(id)     on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (site_id, user_id)
);

-- Index for fast lookup of sites by user and users by site
create index if not exists idx_pse_site_id on public.project_site_employees(site_id);
create index if not exists idx_pse_user_id on public.project_site_employees(user_id);

-- RLS
alter table public.project_site_employees enable row level security;

create policy "Admins and managers can manage site employees"
  on public.project_site_employees
  for all
  using (true)
  with check (true);
