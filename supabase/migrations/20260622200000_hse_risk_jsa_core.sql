-- ── HSE Risk & JSA core tables ─────────────────────────────────────────────────
-- hse_hazards · hse_risk_assessments · hse_risk_assessment_hazards
-- hse_jsa · hse_jsa_steps · hse_controls · hse_ppe_requirements · hse_training_links
-- + workflow_templates for hazard, risk assessment, and JSA flows
-- ─────────────────────────────────────────────────────────────────────────────────

-- ── hse_hazards ───────────────────────────────────────────────────────────────

create table if not exists public.hse_hazards (
  id                   uuid primary key default gen_random_uuid(),
  ref                  text not null unique,
  title                text not null,
  description          text not null default '',
  category             text not null,
  site_id              text references public.sites(id),
  department_id        uuid references public.departments(id),
  location_text        text,
  owner_user_id        text references public.app_users(id),
  initial_likelihood   int  not null check (initial_likelihood between 1 and 5),
  initial_severity     int  not null check (initial_severity between 1 and 5),
  initial_score        int  generated always as (initial_likelihood * initial_severity) stored,
  residual_likelihood  int  check (residual_likelihood between 1 and 5),
  residual_severity    int  check (residual_severity between 1 and 5),
  residual_score       int  generated always as (residual_likelihood * residual_severity) stored,
  risk_level           text not null default 'medium'
                           check (risk_level in ('low','medium','high','critical')),
  status               text not null default 'registered'
                           check (status in ('draft','registered','assessment_required','controls_required','under_review','approved','monitoring','archived')),
  review_due_at        timestamptz,
  workflow_id          uuid,
  created_by           text references public.app_users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz
);

alter table public.hse_hazards enable row level security;
create policy "authenticated read hse_hazards"  on public.hse_hazards for select using (auth.role() = 'authenticated');
create policy "authenticated write hse_hazards" on public.hse_hazards for all    using (auth.role() = 'authenticated');

create index if not exists hse_hazards_status_idx    on public.hse_hazards(status);
create index if not exists hse_hazards_risk_idx      on public.hse_hazards(risk_level);
create index if not exists hse_hazards_site_idx      on public.hse_hazards(site_id);
create index if not exists hse_hazards_created_idx   on public.hse_hazards(created_at desc);

-- updated_at trigger
create or replace function public.set_hse_hazards_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger hse_hazards_updated_at before update on public.hse_hazards
  for each row execute function public.set_hse_hazards_updated_at();

-- ── hse_risk_assessments ──────────────────────────────────────────────────────

create table if not exists public.hse_risk_assessments (
  id                uuid primary key default gen_random_uuid(),
  ref               text not null unique,
  assessment_type   text not null default 'general'
                        check (assessment_type in ('general','task','area','equipment','chemical','permit_linked','change')),
  title             text not null,
  description       text not null default '',
  site_id           text references public.sites(id),
  department_id     uuid references public.departments(id),
  location_text     text,
  owner_user_id     text references public.app_users(id),
  status            text not null default 'draft'
                        check (status in ('draft','submitted','under_review','returned','approved','active','expired','archived')),
  initial_score     int,
  residual_score    int,
  risk_level        text not null default 'medium'
                        check (risk_level in ('low','medium','high','critical')),
  review_cycle      text not null default 'annual'
                        check (review_cycle in ('monthly','quarterly','biannual','annual','on_change')),
  review_due_at     timestamptz,
  workflow_id       uuid,
  created_by        text references public.app_users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,
  metadata          jsonb not null default '{}'::jsonb
);

alter table public.hse_risk_assessments enable row level security;
create policy "authenticated read hse_risk_assessments"  on public.hse_risk_assessments for select using (auth.role() = 'authenticated');
create policy "authenticated write hse_risk_assessments" on public.hse_risk_assessments for all    using (auth.role() = 'authenticated');

create index if not exists hse_ra_status_idx  on public.hse_risk_assessments(status);
create index if not exists hse_ra_site_idx    on public.hse_risk_assessments(site_id);
create index if not exists hse_ra_due_idx     on public.hse_risk_assessments(review_due_at);

create or replace function public.set_hse_ra_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger hse_ra_updated_at before update on public.hse_risk_assessments
  for each row execute function public.set_hse_ra_updated_at();

-- ── hse_risk_assessment_hazards ───────────────────────────────────────────────

create table if not exists public.hse_risk_assessment_hazards (
  id                   uuid primary key default gen_random_uuid(),
  assessment_id        uuid not null references public.hse_risk_assessments(id) on delete cascade,
  hazard_id            uuid references public.hse_hazards(id),
  hazard_description   text,
  category             text,
  initial_likelihood   int not null check (initial_likelihood between 1 and 5),
  initial_severity     int not null check (initial_severity between 1 and 5),
  initial_score        int generated always as (initial_likelihood * initial_severity) stored,
  residual_likelihood  int check (residual_likelihood between 1 and 5),
  residual_severity    int check (residual_severity between 1 and 5),
  residual_score       int generated always as (residual_likelihood * residual_severity) stored,
  notes                text,
  created_at           timestamptz not null default now()
);

alter table public.hse_risk_assessment_hazards enable row level security;
create policy "authenticated rw hse_ra_hazards" on public.hse_risk_assessment_hazards for all using (auth.role() = 'authenticated');

create index if not exists hse_rah_assessment_idx on public.hse_risk_assessment_hazards(assessment_id);

-- ── hse_jsa ───────────────────────────────────────────────────────────────────

create table if not exists public.hse_jsa (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique,
  title            text not null,
  description      text not null default '',
  site_id          text references public.sites(id),
  department_id    uuid references public.departments(id),
  location_text    text,
  owner_user_id    text references public.app_users(id),
  status           text not null default 'draft'
                       check (status in ('draft','submitted','hse_review','returned','approved','active','expired','archived')),
  risk_level       text not null default 'medium'
                       check (risk_level in ('low','medium','high','critical')),
  linked_permit_id uuid,
  review_due_at    timestamptz,
  workflow_id      uuid,
  created_by       text references public.app_users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  metadata         jsonb not null default '{}'::jsonb
);

alter table public.hse_jsa enable row level security;
create policy "authenticated read hse_jsa"  on public.hse_jsa for select using (auth.role() = 'authenticated');
create policy "authenticated write hse_jsa" on public.hse_jsa for all    using (auth.role() = 'authenticated');

create index if not exists hse_jsa_status_idx on public.hse_jsa(status);
create index if not exists hse_jsa_site_idx   on public.hse_jsa(site_id);
create index if not exists hse_jsa_due_idx    on public.hse_jsa(review_due_at);

create or replace function public.set_hse_jsa_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger hse_jsa_updated_at before update on public.hse_jsa
  for each row execute function public.set_hse_jsa_updated_at();

-- ── hse_jsa_steps ─────────────────────────────────────────────────────────────

create table if not exists public.hse_jsa_steps (
  id                   uuid primary key default gen_random_uuid(),
  jsa_id               uuid not null references public.hse_jsa(id) on delete cascade,
  step_number          int  not null,
  task_step            text not null,
  hazard_description   text,
  initial_likelihood   int  check (initial_likelihood between 1 and 5),
  initial_severity     int  check (initial_severity between 1 and 5),
  initial_score        int  generated always as (initial_likelihood * initial_severity) stored,
  residual_likelihood  int  check (residual_likelihood between 1 and 5),
  residual_severity    int  check (residual_severity between 1 and 5),
  residual_score       int  generated always as (residual_likelihood * residual_severity) stored,
  controls_summary     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz
);

alter table public.hse_jsa_steps enable row level security;
create policy "authenticated rw hse_jsa_steps" on public.hse_jsa_steps for all using (auth.role() = 'authenticated');
create index if not exists hse_jsa_steps_jsa_idx on public.hse_jsa_steps(jsa_id, step_number);

-- ── hse_controls ──────────────────────────────────────────────────────────────

create table if not exists public.hse_controls (
  id             uuid primary key default gen_random_uuid(),
  source_type    text not null check (source_type in ('hazard','assessment','jsa','capa')),
  source_id      text not null,
  hazard_id      uuid references public.hse_hazards(id),
  description    text not null,
  control_type   text not null default 'administrative'
                     check (control_type in ('elimination','substitution','engineering','administrative','ppe','emergency_response')),
  owner_user_id  text references public.app_users(id),
  status         text not null default 'planned'
                     check (status in ('planned','implemented','verified','ineffective','superseded')),
  effectiveness  text check (effectiveness in ('effective','partially_effective','ineffective')),
  due_at         timestamptz,
  verified_by    text references public.app_users(id),
  verified_at    timestamptz,
  created_by     text references public.app_users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  metadata       jsonb not null default '{}'::jsonb
);

alter table public.hse_controls enable row level security;
create policy "authenticated rw hse_controls" on public.hse_controls for all using (auth.role() = 'authenticated');
create index if not exists hse_controls_source_idx on public.hse_controls(source_type, source_id);
create index if not exists hse_controls_status_idx on public.hse_controls(status);

create or replace function public.set_hse_controls_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger hse_controls_updated_at before update on public.hse_controls
  for each row execute function public.set_hse_controls_updated_at();

-- ── hse_ppe_requirements ──────────────────────────────────────────────────────

create table if not exists public.hse_ppe_requirements (
  id          uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('jsa','assessment','hazard')),
  source_id   text not null,
  ppe_item    text not null,
  required    boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);

alter table public.hse_ppe_requirements enable row level security;
create policy "authenticated rw hse_ppe_req" on public.hse_ppe_requirements for all using (auth.role() = 'authenticated');
create index if not exists hse_ppe_source_idx on public.hse_ppe_requirements(source_type, source_id);

-- ── hse_training_links ────────────────────────────────────────────────────────

create table if not exists public.hse_training_links (
  id                        uuid primary key default gen_random_uuid(),
  source_type               text not null check (source_type in ('jsa','assessment','hazard')),
  source_id                 text not null,
  training_requirement_id   uuid,
  requirement_description   text not null,
  certification_required    boolean not null default false,
  competency_verification   boolean not null default false,
  notes                     text,
  created_at                timestamptz not null default now()
);

alter table public.hse_training_links enable row level security;
create policy "authenticated rw hse_training_links" on public.hse_training_links for all using (auth.role() = 'authenticated');
create index if not exists hse_training_source_idx on public.hse_training_links(source_type, source_id);

-- ── ref_prefix entries (no-op if function/table handles it differently) ────────
-- The nextRef() function reads reference_counters. Seed the prefixes.
insert into public.reference_counters (prefix, last_value)
values
  ('HAZ', 0),
  ('RA',  0),
  ('JSA', 0)
on conflict (prefix) do nothing;

-- ── workflow_templates ────────────────────────────────────────────────────────

insert into public.workflow_templates (module, key, name, description, is_active, definition)
values
  (
    'hse', 'hse_hazard_review',
    'Hazard Review & Approval',
    'Review and approval workflow for HSE hazards requiring controls or higher management sign-off.',
    true,
    '{"steps":[{"key":"review","label":"HSE Review","role":"hse_officer","action":"review"},{"key":"approve","label":"Management Approval","role":"manager","action":"approve_reject"}]}'::jsonb
  ),
  (
    'hse', 'hse_risk_assessment_review',
    'Risk Assessment Review & Approval',
    'Formal review and approval workflow for HSE risk assessments.',
    true,
    '{"steps":[{"key":"hse_review","label":"HSE Review","role":"hse_officer","action":"review"},{"key":"approve","label":"Management Approval","role":"manager","action":"approve_reject"}]}'::jsonb
  ),
  (
    'hse', 'hse_jsa_review',
    'JSA Review & Approval',
    'Review and approval workflow for Job Safety Analyses.',
    true,
    '{"steps":[{"key":"hse_review","label":"HSE Review","role":"hse_officer","action":"review"},{"key":"approve","label":"Approval","role":"manager","action":"approve_reject"}]}'::jsonb
  )
on conflict (key) do nothing;
