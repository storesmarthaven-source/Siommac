-- Per-step hazards and controls for JSAs (spec §7): a job step can have many
-- hazards, and each hazard many controls — instead of the single free-text
-- hazard_description / controls_summary on hse_jsa_steps (kept for back-compat).

create table if not exists public.hse_jsa_step_hazards (
  id                  uuid primary key default gen_random_uuid(),
  step_id             uuid not null references public.hse_jsa_steps(id) on delete cascade,
  description         text not null,
  category            text,
  initial_likelihood  int check (initial_likelihood between 1 and 5),
  initial_severity    int check (initial_severity between 1 and 5),
  initial_score       int generated always as (initial_likelihood * initial_severity) stored,
  residual_likelihood int check (residual_likelihood between 1 and 5),
  residual_severity   int check (residual_severity between 1 and 5),
  residual_score      int generated always as (residual_likelihood * residual_severity) stored,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now()
);
alter table public.hse_jsa_step_hazards enable row level security;
create policy "authenticated rw hse_jsa_step_hazards" on public.hse_jsa_step_hazards for all using (auth.role() = 'authenticated');
create index if not exists hse_jsa_step_hazards_step_idx on public.hse_jsa_step_hazards(step_id);

create table if not exists public.hse_jsa_step_controls (
  id            uuid primary key default gen_random_uuid(),
  step_hazard_id uuid not null references public.hse_jsa_step_hazards(id) on delete cascade,
  description   text not null,
  control_type  text not null default 'administrative'
                    check (control_type in ('elimination','substitution','engineering','administrative','ppe','emergency_response')),
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
alter table public.hse_jsa_step_controls enable row level security;
create policy "authenticated rw hse_jsa_step_controls" on public.hse_jsa_step_controls for all using (auth.role() = 'authenticated');
create index if not exists hse_jsa_step_controls_hazard_idx on public.hse_jsa_step_controls(step_hazard_id);
