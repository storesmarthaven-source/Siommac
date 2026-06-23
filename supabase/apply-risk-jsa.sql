-- ============================================================================
-- SIOMAC — Risk & JSA: schema + cross-links + demo seed (consolidated)
--
-- HOW TO USE:  Supabase Dashboard → SQL Editor → New query → paste this whole
--              file → Run.  Idempotent: safe to run more than once.
--
-- ASSUMES the ERP backbone already exists in this database:
--   public.reference_counters, public.workflow_templates,
--   public.departments, public.project_sites, public.app_users
-- (these come from the earlier backbone + HSE-core migrations).
--
-- Mirrors migrations:
--   20260622200000_hse_risk_jsa_core.sql
--   20260623100000_hse_risk_jsa_links.sql
--   20260623200000_hse_risk_jsa_seed.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CORE TABLES
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.hse_hazards (
  id                   uuid primary key default gen_random_uuid(),
  ref                  text not null unique,
  title                text not null,
  description          text not null default '',
  category             text not null,
  site_id              text references public.project_sites(id),
  department_id        text references public.departments(id),
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
create index if not exists hse_hazards_status_idx  on public.hse_hazards(status);
create index if not exists hse_hazards_risk_idx    on public.hse_hazards(risk_level);
create index if not exists hse_hazards_site_idx    on public.hse_hazards(site_id);
create index if not exists hse_hazards_created_idx on public.hse_hazards(created_at desc);

-- The earlier HSE-core migration (20260621100002) created a SKELETON
-- hse_risk_assessments with a different, superseded shape (hazard_description /
-- likelihood / review_date, no review_due_at). If that legacy table is present
-- (detected by the absence of review_due_at), drop it so the canonical definition
-- below can be created. Safe: the skeleton was never populated by the app.
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'hse_risk_assessments'
     ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'hse_risk_assessments'
          AND column_name = 'review_due_at'
     )
  THEN
    DROP TABLE public.hse_risk_assessments CASCADE;
    RAISE NOTICE 'Dropped legacy skeleton hse_risk_assessments (superseded by canonical shape).';
  END IF;
END $$;

create table if not exists public.hse_risk_assessments (
  id                uuid primary key default gen_random_uuid(),
  ref               text not null unique,
  assessment_type   text not null default 'general'
                        check (assessment_type in ('general','task','area','equipment','chemical','permit_linked','change')),
  title             text not null,
  description       text not null default '',
  site_id           text references public.project_sites(id),
  department_id     text references public.departments(id),
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
create index if not exists hse_ra_status_idx on public.hse_risk_assessments(status);
create index if not exists hse_ra_site_idx   on public.hse_risk_assessments(site_id);
create index if not exists hse_ra_due_idx    on public.hse_risk_assessments(review_due_at);

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
create index if not exists hse_rah_assessment_idx on public.hse_risk_assessment_hazards(assessment_id);

create table if not exists public.hse_jsa (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique,
  title            text not null,
  description      text not null default '',
  site_id          text references public.project_sites(id),
  department_id    text references public.departments(id),
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
create index if not exists hse_jsa_status_idx on public.hse_jsa(status);
create index if not exists hse_jsa_site_idx   on public.hse_jsa(site_id);
create index if not exists hse_jsa_due_idx    on public.hse_jsa(review_due_at);

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
create index if not exists hse_jsa_steps_jsa_idx on public.hse_jsa_steps(jsa_id, step_number);

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
create index if not exists hse_controls_source_idx on public.hse_controls(source_type, source_id);
create index if not exists hse_controls_status_idx on public.hse_controls(status);

create table if not exists public.hse_ppe_requirements (
  id          uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('jsa','assessment','hazard')),
  source_id   text not null,
  ppe_item    text not null,
  required    boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists hse_ppe_source_idx on public.hse_ppe_requirements(source_type, source_id);

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
create index if not exists hse_training_source_idx on public.hse_training_links(source_type, source_id);

-- ── Cross-link table ─────────────────────────────────────────────────────────
create table if not exists public.hse_risk_jsa_links (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null,
  source_id    text not null,
  target_type  text not null,
  target_id    text not null,
  link_type    text not null,
  created_by   text references public.app_users(id),
  created_at   timestamptz not null default now(),
  metadata     jsonb not null default '{}'::jsonb
);
create index if not exists hse_rjl_source_idx on public.hse_risk_jsa_links(source_type, source_id);
create index if not exists hse_rjl_target_idx on public.hse_risk_jsa_links(target_type, target_id);
create unique index if not exists hse_rjl_uniq
  on public.hse_risk_jsa_links(source_type, source_id, target_type, target_id, link_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS + POLICIES (idempotent: drop-then-create)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.hse_hazards                  enable row level security;
alter table public.hse_risk_assessments         enable row level security;
alter table public.hse_risk_assessment_hazards  enable row level security;
alter table public.hse_jsa                       enable row level security;
alter table public.hse_jsa_steps                 enable row level security;
alter table public.hse_controls                  enable row level security;
alter table public.hse_ppe_requirements          enable row level security;
alter table public.hse_training_links            enable row level security;
alter table public.hse_risk_jsa_links            enable row level security;

drop policy if exists "authenticated read hse_hazards"  on public.hse_hazards;
drop policy if exists "authenticated write hse_hazards" on public.hse_hazards;
create policy "authenticated read hse_hazards"  on public.hse_hazards for select using (auth.role() = 'authenticated');
create policy "authenticated write hse_hazards" on public.hse_hazards for all    using (auth.role() = 'authenticated');

drop policy if exists "authenticated read hse_risk_assessments"  on public.hse_risk_assessments;
drop policy if exists "authenticated write hse_risk_assessments" on public.hse_risk_assessments;
create policy "authenticated read hse_risk_assessments"  on public.hse_risk_assessments for select using (auth.role() = 'authenticated');
create policy "authenticated write hse_risk_assessments" on public.hse_risk_assessments for all    using (auth.role() = 'authenticated');

drop policy if exists "authenticated rw hse_ra_hazards" on public.hse_risk_assessment_hazards;
create policy "authenticated rw hse_ra_hazards" on public.hse_risk_assessment_hazards for all using (auth.role() = 'authenticated');

drop policy if exists "authenticated read hse_jsa"  on public.hse_jsa;
drop policy if exists "authenticated write hse_jsa" on public.hse_jsa;
create policy "authenticated read hse_jsa"  on public.hse_jsa for select using (auth.role() = 'authenticated');
create policy "authenticated write hse_jsa" on public.hse_jsa for all    using (auth.role() = 'authenticated');

drop policy if exists "authenticated rw hse_jsa_steps" on public.hse_jsa_steps;
create policy "authenticated rw hse_jsa_steps" on public.hse_jsa_steps for all using (auth.role() = 'authenticated');

drop policy if exists "authenticated rw hse_controls" on public.hse_controls;
create policy "authenticated rw hse_controls" on public.hse_controls for all using (auth.role() = 'authenticated');

drop policy if exists "authenticated rw hse_ppe_req" on public.hse_ppe_requirements;
create policy "authenticated rw hse_ppe_req" on public.hse_ppe_requirements for all using (auth.role() = 'authenticated');

drop policy if exists "authenticated rw hse_training_links" on public.hse_training_links;
create policy "authenticated rw hse_training_links" on public.hse_training_links for all using (auth.role() = 'authenticated');

drop policy if exists "authenticated read hse_risk_jsa_links" on public.hse_risk_jsa_links;
drop policy if exists "service write hse_risk_jsa_links"      on public.hse_risk_jsa_links;
create policy "authenticated read hse_risk_jsa_links" on public.hse_risk_jsa_links for select using (auth.role() = 'authenticated');
create policy "service write hse_risk_jsa_links"      on public.hse_risk_jsa_links for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. updated_at TRIGGERS (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_hse_hazards_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists hse_hazards_updated_at on public.hse_hazards;
create trigger hse_hazards_updated_at before update on public.hse_hazards
  for each row execute function public.set_hse_hazards_updated_at();

create or replace function public.set_hse_ra_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists hse_ra_updated_at on public.hse_risk_assessments;
create trigger hse_ra_updated_at before update on public.hse_risk_assessments
  for each row execute function public.set_hse_ra_updated_at();

create or replace function public.set_hse_jsa_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists hse_jsa_updated_at on public.hse_jsa;
create trigger hse_jsa_updated_at before update on public.hse_jsa
  for each row execute function public.set_hse_jsa_updated_at();

create or replace function public.set_hse_controls_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists hse_controls_updated_at on public.hse_controls;
create trigger hse_controls_updated_at before update on public.hse_controls
  for each row execute function public.set_hse_controls_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REFERENCE COUNTERS + WORKFLOW TEMPLATES (idempotent upserts)
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.reference_counters (prefix, year, next_number)
values
  ('HAZ', 2026, 1),
  ('RA',  2026, 1),
  ('JSA', 2026, 1)
on conflict (prefix, year) do nothing;

insert into public.workflow_templates (module, key, name, description, is_active, definition)
values
  ('hse', 'hse_hazard_review', 'Hazard Review & Approval',
   'Review and approval workflow for HSE hazards requiring controls or higher management sign-off.', true,
   '{"steps":[{"key":"review","label":"HSE Review","role":"hse_officer","action":"review"},{"key":"approve","label":"Management Approval","role":"manager","action":"approve_reject"}]}'::jsonb),
  ('hse', 'hse_risk_assessment_review', 'Risk Assessment Review & Approval',
   'Formal review and approval workflow for HSE risk assessments.', true,
   '{"steps":[{"key":"hse_review","label":"HSE Review","role":"hse_officer","action":"review"},{"key":"approve","label":"Management Approval","role":"manager","action":"approve_reject"}]}'::jsonb),
  ('hse', 'hse_jsa_review', 'JSA Review & Approval',
   'Review and approval workflow for Job Safety Analyses.', true,
   '{"steps":[{"key":"hse_review","label":"HSE Review","role":"hse_officer","action":"review"},{"key":"approve","label":"Approval","role":"manager","action":"approve_reject"}]}'::jsonb)
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. DEMO SEED  (guarded — only loads once; site carried in location_text,
--    controls/PPE/training source_id = parent UUID to match the app's queries)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  h1 uuid := '33333333-0003-0003-0003-000000000001';
  h2 uuid := '33333333-0003-0003-0003-000000000002';
  h3 uuid := '33333333-0003-0003-0003-000000000003';
  h4 uuid := '33333333-0003-0003-0003-000000000004';
  h5 uuid := '33333333-0003-0003-0003-000000000005';
  h6 uuid := '33333333-0003-0003-0003-000000000006';
  h7 uuid := '33333333-0003-0003-0003-000000000007';
  h8 uuid := '33333333-0003-0003-0003-000000000008';
  r1 uuid := '44444444-0004-0004-0004-000000000001';
  r2 uuid := '44444444-0004-0004-0004-000000000002';
  r3 uuid := '44444444-0004-0004-0004-000000000003';
  r4 uuid := '44444444-0004-0004-0004-000000000004';
  r5 uuid := '44444444-0004-0004-0004-000000000005';
  j1 uuid := '55555555-0005-0005-0005-000000000001';
  j2 uuid := '55555555-0005-0005-0005-000000000002';
  j3 uuid := '55555555-0005-0005-0005-000000000003';
  j4 uuid := '55555555-0005-0005-0005-000000000004';
  j5 uuid := '55555555-0005-0005-0005-000000000005';
BEGIN
  IF EXISTS (SELECT 1 FROM public.hse_hazards WHERE ref = 'HAZ-2026-0001') THEN
    RAISE NOTICE 'Risk/JSA demo seed already present — skipping inserts.';
  ELSE

  INSERT INTO public.hse_hazards (
    id, ref, title, description, category, location_text,
    initial_likelihood, initial_severity, residual_likelihood, residual_severity,
    risk_level, status, review_due_at, created_at
  ) VALUES
  (h1, 'HAZ-2026-0001', 'Chlorine gas release at water treatment skid',
   'Potential chlorine gas release during cylinder changeover at the potable water treatment skid. Affects operators and nearby maintenance crews. Detection and forced ventilation in place.',
   'Chemical', 'Point Lisas Plant — Water treatment skid', 4, 4, 2, 3, 'high', 'monitoring', '2026-09-15 00:00:00+00', '2026-01-14 09:00:00+00'),
  (h2, 'HAZ-2026-0002', 'Unguarded nip point on aggregate conveyor CV-04',
   'Exposed in-running nip point at the tail drum of conveyor CV-04. Risk of entanglement / amputation during belt tracking and cleaning. Interim lockout in place; fixed guard outstanding.',
   'Mechanical', 'La Brea Yard — Conveyor CV-04 tail drum', 4, 5, 3, 4, 'critical', 'controls_required', '2026-07-01 00:00:00+00', '2026-02-03 10:30:00+00'),
  (h3, 'HAZ-2026-0003', 'Exposed 480V busbar in MCC room B',
   'Missing dead-front cover on the 480V motor control centre exposes live busbar. Arc-flash and electrocution risk to electricians during routine inspection.',
   'Electrical', 'Point Lisas Plant — MCC room B', 3, 4, NULL, NULL, 'high', 'under_review', '2026-08-10 00:00:00+00', '2026-02-22 14:15:00+00'),
  (h4, 'HAZ-2026-0004', 'Flammable solvent storage adjacent to hot-work area',
   'Drummed flammable solvents stored within 6m of a designated hot-work area at the fabrication shop. Fire / explosion risk during welding and grinding operations.',
   'Fire', 'Galeota Marine Base — Fabrication shop', 4, 5, NULL, NULL, 'critical', 'assessment_required', '2026-06-20 00:00:00+00', '2026-03-11 08:45:00+00'),
  (h5, 'HAZ-2026-0005', 'Manual handling of 200L lube drums',
   'Operators manually upending and rolling 200L lubricant drums without mechanical aid. Musculoskeletal injury risk. Drum dolly and training introduced.',
   'Ergonomic', 'Piarco Logistics — Lube store', 3, 2, 1, 2, 'medium', 'approved', '2026-11-30 00:00:00+00', '2026-03-28 11:00:00+00'),
  (h6, 'HAZ-2026-0006', 'Hydrocarbon ingress to east storm drain',
   'Minor hydrocarbon sheen periodically observed entering the east storm drain from the transfer apron. Environmental / EMA reporting risk.',
   'Environmental', 'Point Lisas Plant — East transfer apron', 3, 4, NULL, NULL, 'high', 'registered', '2026-07-18 00:00:00+00', '2026-04-15 13:20:00+00'),
  (h7, 'HAZ-2026-0007', 'H2S exposure during well intervention',
   'Potential hydrogen sulphide exposure during slickline well intervention on sour wells. Life-threatening at high concentration. Personal monitors and SCBA staged.',
   'Process', 'Galeota Marine Base — Wellhead platform A', 4, 5, 2, 5, 'critical', 'monitoring', '2026-09-05 00:00:00+00', '2026-05-06 07:30:00+00'),
  (h8, 'HAZ-2026-0008', 'Fall from scaffold during tank inspection',
   'Work-at-height fall risk during external tank shell inspection from mobile scaffold. Guardrails and harness anchor points specified.',
   'Safety', 'La Brea Yard — Tank T-201', 2, 3, NULL, NULL, 'medium', 'registered', '2026-10-22 00:00:00+00', '2026-05-29 15:40:00+00');

  INSERT INTO public.hse_risk_assessments (
    id, ref, assessment_type, title, description, location_text, status,
    initial_score, residual_score, risk_level, review_cycle, review_due_at, created_at
  ) VALUES
  (r1, 'RA-2026-0001', 'chemical', 'Chlorine handling & cylinder changeover',
   'Formal assessment of chlorine cylinder storage, changeover and emergency response at the water treatment skid.',
   'Point Lisas Plant — Water treatment skid', 'active', 16, 6, 'high', 'annual', '2026-09-15 00:00:00+00', '2026-01-20 09:30:00+00'),
  (r2, 'RA-2026-0002', 'task', 'Conveyor CV-04 maintenance & belt tracking',
   'Task-based assessment for guarding, isolation and belt-tracking work on conveyor CV-04.',
   'La Brea Yard — Conveyor CV-04', 'under_review', 20, 12, 'critical', 'biannual', '2026-08-01 00:00:00+00', '2026-02-10 10:00:00+00'),
  (r3, 'RA-2026-0003', 'area', 'Tank farm bunding & overfill protection',
   'Area assessment of secondary containment, overfill protection and access for the main tank farm.',
   'Point Lisas Plant — Tank farm', 'submitted', 15, NULL, 'high', 'annual', '2026-09-01 00:00:00+00', '2026-03-18 14:00:00+00'),
  (r4, 'RA-2026-0004', 'equipment', 'Mobile crane lifting operations',
   'Equipment assessment for mobile crane set-up, ground bearing and lift planning on the marine base.',
   'Galeota Marine Base — Laydown yard', 'active', 12, 4, 'high', 'annual', '2026-05-25 00:00:00+00', '2026-04-02 08:15:00+00'),
  (r5, 'RA-2026-0005', 'permit_linked', 'Confined space entry — ballast tank V-112',
   'Permit-linked assessment for entry, atmospheric monitoring and rescue provision for ballast tank V-112.',
   'Galeota Marine Base — Ballast tank V-112', 'draft', 20, NULL, 'critical', 'on_change', NULL, '2026-05-19 11:45:00+00');

  INSERT INTO public.hse_risk_assessment_hazards (
    assessment_id, hazard_id, hazard_description, category,
    initial_likelihood, initial_severity, residual_likelihood, residual_severity, notes
  ) VALUES
  (r1, h1, 'Chlorine gas release during cylinder changeover', 'Chemical', 4, 4, 2, 3, 'Residual after detection + forced ventilation + SCBA.'),
  (r2, h2, 'Entanglement at CV-04 nip point',                'Mechanical', 4, 5, 3, 4, 'Residual pending fixed guard install.'),
  (r4, NULL, 'Crane overturn from poor ground bearing',     'Mechanical', 3, 4, 1, 4, 'Residual after ground assessment + outrigger mats.');

  INSERT INTO public.hse_jsa (
    id, ref, title, description, location_text, status, risk_level, review_due_at, created_at
  ) VALUES
  (j1, 'JSA-2026-0001', 'Replace aggregate conveyor belt CV-04',
   'Step-by-step job safety analysis for de-tensioning, removing and replacing the CV-04 conveyor belt.',
   'La Brea Yard — Conveyor CV-04', 'active', 'high', '2026-08-15 00:00:00+00', '2026-02-12 09:00:00+00'),
  (j2, 'JSA-2026-0002', 'Confined space tank cleaning — ballast tank V-112',
   'JSA for entry, sludge removal and cleaning of ballast tank V-112 under confined-space permit.',
   'Galeota Marine Base — Ballast tank V-112', 'hse_review', 'critical', '2026-07-20 00:00:00+00', '2026-03-22 10:30:00+00'),
  (j3, 'JSA-2026-0003', 'Hot work — welding repair on pipe rack',
   'JSA for hot-work welding repairs on the elevated pipe rack including fire watch and gas testing.',
   'Point Lisas Plant — Pipe rack 3', 'active', 'high', '2026-05-30 00:00:00+00', '2026-04-08 13:00:00+00'),
  (j4, 'JSA-2026-0004', 'Working at height — roof-edge AC maintenance',
   'JSA for maintenance of roof-mounted AC plant within 2m of an unguarded roof edge.',
   'Port of Spain Office — Roof level', 'submitted', 'medium', '2026-09-10 00:00:00+00', '2026-04-26 08:30:00+00'),
  (j5, 'JSA-2026-0005', 'Chemical drum transfer & decanting',
   'JSA for transferring and decanting solvents from 200L drums to day tanks.',
   'Galeota Marine Base — Fabrication shop', 'draft', 'medium', NULL, '2026-05-24 15:00:00+00');

  INSERT INTO public.hse_jsa_steps (
    jsa_id, step_number, task_step, hazard_description,
    initial_likelihood, initial_severity, residual_likelihood, residual_severity, controls_summary
  ) VALUES
  (j1, 1, 'Isolate and lock out conveyor drive',       'Unexpected start-up / entanglement', 4, 5, 1, 5, 'LOTO applied; verified zero-energy; key control.'),
  (j1, 2, 'De-tension and remove old belt',            'Stored energy release; manual handling', 3, 4, 2, 3, 'Controlled de-tensioning; mechanical aids; gloves.'),
  (j1, 3, 'Fit and track new belt',                    'Nip point / pinch injury', 4, 4, 2, 3, 'Guards reinstated for tracking; jog mode only.'),
  (j1, 4, 'Function test and return to service',       'Premature energisation', 3, 4, 1, 4, 'Permit sign-off; area clear confirmation.'),
  (j2, 1, 'Atmospheric gas test of tank',              'Oxygen deficiency / toxic atmosphere', 4, 5, 1, 5, 'Continuous monitoring; ventilation; entry permit.'),
  (j2, 2, 'Establish entry, attendant and rescue',     'Entrapment / no rescue', 4, 5, 1, 5, 'Trained attendant; rescue plan; tripod/winch staged.'),
  (j2, 3, 'Remove sludge and clean shell',             'Slips; chemical contact', 3, 4, 2, 3, 'Non-slip footing; chemical PPE; lighting.'),
  (j2, 4, 'Continuous atmospheric monitoring',         'Atmosphere change during work', 4, 5, 2, 4, 'Personal monitors; stop-work on alarm.'),
  (j2, 5, 'Exit, account for personnel, close permit', 'Miscount of entrants', 3, 4, 1, 4, 'Entry log reconciliation; permit close-out.'),
  (j3, 1, 'Gas test and issue hot-work permit',        'Flammable atmosphere', 3, 5, 1, 5, 'Gas test pre-task and periodic; permit issued.'),
  (j3, 2, 'Set up fire watch and extinguishers',       'Fire spread / no suppression', 3, 4, 1, 4, 'Dedicated fire watch; extinguishers staged.'),
  (j3, 3, 'Perform welding repair',                    'Burns; UV; fume', 3, 4, 2, 3, 'Welding PPE; screens; local exhaust ventilation.'),
  (j3, 4, 'Post-work fire watch and inspection',       'Smouldering ignition', 3, 4, 1, 4, '30-min post-work fire watch; area inspection.'),
  (j4, 1, 'Erect edge protection / anchor harness',    'Fall from height', 4, 5, 1, 5, 'Guardrail or harness to certified anchor; permit.'),
  (j4, 2, 'Perform AC plant maintenance',              'Slip; electrical', 3, 3, 1, 3, 'Electrical isolation; non-slip footwear.'),
  (j4, 3, 'Remove access and reinstate area',          'Trip hazards left behind', 2, 3, 1, 2, 'Housekeeping; tool tally; barricade removal.');

  INSERT INTO public.hse_controls (
    source_type, source_id, hazard_id, description, control_type, status, effectiveness, due_at
  ) VALUES
  ('hazard', h1::text, h1, 'Fixed chlorine detection with audible/visual alarm', 'engineering',   'implemented', 'effective',           NULL),
  ('hazard', h1::text, h1, 'Forced ventilation interlock on cylinder room',       'engineering',   'implemented', 'effective',           NULL),
  ('hazard', h1::text, h1, 'SCBA staged at room entry; quarterly drill',          'ppe',           'verified',    'effective',           NULL),
  ('hazard', h2::text, h2, 'Install fixed mesh guard at CV-04 tail drum',         'engineering',   'planned',     NULL,                  '2026-07-01 00:00:00+00'),
  ('hazard', h2::text, h2, 'Interim LOTO before any belt-tracking work',          'administrative','implemented', 'partially_effective', NULL),
  ('hazard', h3::text, h3, 'Replace dead-front cover on MCC; arc-flash labelling','engineering',   'planned',     NULL,                  '2026-07-15 00:00:00+00'),
  ('hazard', h5::text, h5, 'Provide drum dolly and powered upender',              'engineering',   'implemented', 'effective',           NULL),
  ('hazard', h5::text, h5, 'Manual handling training for store crew',             'administrative','verified',    'effective',           NULL),
  ('hazard', h7::text, h7, 'Personal H2S monitors with stop-work alarm set',      'administrative','implemented', 'effective',           NULL),
  ('hazard', h7::text, h7, 'SCBA and escape sets staged at wellhead',             'ppe',           'verified',    'effective',           NULL),
  ('assessment', r4::text, NULL, 'Ground bearing assessment before crane set-up', 'administrative','implemented', 'effective',           NULL),
  ('assessment', r4::text, NULL, 'Outrigger mats and exclusion zone',             'engineering',   'implemented', 'effective',           NULL),
  ('jsa', j2::text, NULL, 'Continuous atmospheric monitoring during entry',       'administrative','implemented', 'effective',           NULL),
  ('jsa', j3::text, NULL, 'Dedicated fire watch with 30-min post-work hold',      'administrative','implemented', 'effective',           NULL);

  INSERT INTO public.hse_ppe_requirements (source_type, source_id, ppe_item, required, notes) VALUES
  ('jsa', j2::text, 'Full-face respirator / SCBA', true, 'Confined space atmospheric protection.'),
  ('jsa', j2::text, 'Chemical-resistant coveralls', true, 'Sludge / chemical contact.'),
  ('jsa', j2::text, 'Confined space harness', true, 'For tripod/winch rescue.'),
  ('jsa', j3::text, 'Welding helmet (shade 10+)', true, 'UV / arc protection.'),
  ('jsa', j3::text, 'Flame-resistant coveralls', true, 'Hot-work protection.'),
  ('jsa', j1::text, 'Cut-resistant gloves (Level D)', true, 'Belt handling.'),
  ('hazard', h7::text, 'H2S personal monitor', true, 'Worn at all times on platform.');

  INSERT INTO public.hse_training_links (
    source_type, source_id, requirement_description, certification_required, competency_verification, notes
  ) VALUES
  ('jsa', j2::text, 'Confined Space Entry & Rescue',  true,  true,  'Refresher within 24 months.'),
  ('jsa', j2::text, 'Atmospheric Gas Testing',        true,  true,  'Authorised gas tester only.'),
  ('jsa', j3::text, 'Hot Work / Fire Watch',          true,  false, 'Permit issuer and fire watch.'),
  ('jsa', j1::text, 'LOTO — Authorised Person',       true,  true,  'Machine-specific isolation.'),
  ('hazard', h7::text, 'H2S Awareness & Escape',      true,  true,  'Sour-service certification.');

  RAISE NOTICE 'Risk/JSA demo seed inserted.';
  END IF;
END $$;

-- Advance the 2026 counters past the seeded refs so new records continue cleanly.
INSERT INTO public.reference_counters (prefix, year, next_number)
VALUES ('HAZ', 2026, 9), ('RA', 2026, 6), ('JSA', 2026, 6)
ON CONFLICT (prefix, year) DO UPDATE
  SET next_number = GREATEST(reference_counters.next_number, EXCLUDED.next_number);

-- Quick check (optional): row counts after running.
-- select 'hazards' k, count(*) from public.hse_hazards
-- union all select 'assessments', count(*) from public.hse_risk_assessments
-- union all select 'jsa', count(*) from public.hse_jsa
-- union all select 'controls', count(*) from public.hse_controls;
