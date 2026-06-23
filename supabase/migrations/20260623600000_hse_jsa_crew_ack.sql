-- JSA crew acknowledgements — every required crew member must acknowledge the
-- JSA before it can be activated (spec §7, §10). Competency can be flagged per
-- member; competency gaps block activation unless an authorised user overrides.

create table if not exists public.hse_jsa_crew_acknowledgements (
  id                  uuid primary key default gen_random_uuid(),
  jsa_id              uuid not null references public.hse_jsa(id) on delete cascade,
  user_id             text references public.app_users(id),
  crew_name           text not null,
  role_title          text,
  required            boolean not null default true,
  competency_verified boolean not null default false,
  acknowledged        boolean not null default false,
  acknowledged_at     timestamptz,
  created_at          timestamptz not null default now()
);

alter table public.hse_jsa_crew_acknowledgements enable row level security;
create policy "authenticated rw hse_jsa_crew_ack" on public.hse_jsa_crew_acknowledgements
  for all using (auth.role() = 'authenticated');
create index if not exists hse_jsa_crew_ack_jsa_idx on public.hse_jsa_crew_acknowledgements(jsa_id);
