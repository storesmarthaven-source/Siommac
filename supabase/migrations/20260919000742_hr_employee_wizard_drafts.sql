-- Migration: 20260919000742_hr_employee_wizard_drafts.sql
--
-- Creates hr_employee_wizard_drafts: ephemeral per-actor wizard state.
-- One draft per actor (upsert by actor_id). Expires after 7 days.
-- Drafts are never authoritative — the create route is the only commit path.
-- PENDING OPERATOR ACTION — never self-apply.

create table if not exists public.hr_employee_wizard_drafts (
  id          uuid        primary key default gen_random_uuid(),
  actor_id    text        not null references public.app_users(id) on delete cascade,
  draft_data  jsonb       not null default '{}'::jsonb,
  step_index  integer     not null default 0,
  label       text,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  unique (actor_id)
);

create index if not exists hr_wizard_drafts_actor_idx on public.hr_employee_wizard_drafts (actor_id);
create index if not exists hr_wizard_drafts_expires_idx on public.hr_employee_wizard_drafts (expires_at);

-- updated_at trigger
create or replace function public.hr_wizard_draft_updated_at()
  returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_hr_wizard_draft_updated_at on public.hr_employee_wizard_drafts;
create trigger trg_hr_wizard_draft_updated_at
  before update on public.hr_employee_wizard_drafts
  for each row execute function public.hr_wizard_draft_updated_at();

alter table public.hr_employee_wizard_drafts enable row level security;

grant select, insert, update, delete
  on public.hr_employee_wizard_drafts to service_role;
