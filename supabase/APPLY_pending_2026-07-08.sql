-- ============================================================================
-- SIOMAC ERP — PENDING MIGRATIONS, COMPILED (generated 2026-07-08)
--
-- One-shot operator script: applies the 8 migrations whose objects were verified
-- ABSENT from the live DB (real-select probe, not head:true count). Apply ONCE in
-- the Supabase SQL editor, then it self-runs NOTIFY pgrst at the end.
--
-- Faithful concatenation of the individual migration files (unchanged bodies), in
-- filename/timestamp order = dependency order (roster_core before rosters, etc.).
-- All statements are idempotent (create table/index/trigger IF NOT EXISTS,
-- on conflict do nothing); every FK target was confirmed present. Wrapped in one
-- transaction — any failure rolls the whole batch back (all-or-nothing).
--
-- Source files (supabase/migrations/) — these remain the tracked source of truth:
--   1. 20260802000005_hr_compensation_inputs.sql
--   2. 20260802000006_hr_overtime_inputs.sql
--   3. 20260802000010_employee_statutory_profiles.sql
--   4. 20260803000000_hr_roster_core.sql
--   5. 20260803000001_hr_rosters.sql
--   6. 20260915000000_hr_contract_management.sql
--   7. 20260917000000_finance_general_ledger.sql
--   8. 20260917000040_finance_2b_foundation.sql
--
-- NOT applied here (verified already-applied or intentionally removed):
--   20260715000000 hr_org_structure_fields (columns live) · 20260620000000 draft
--   workflow/handoff (superseded by workflow_tasks/handoff_outbox) · hse_capa
--   (→ hse_capa_actions) · hse_permit_gas_tests (dropped by 20260630000000).
--   Finance AP/AR/enterprise (000010/000020/000030) + grants (000050): applied.
-- ============================================================================

begin;

-- ============================================================================
-- (1/8)  20260802000005_hr_compensation_inputs.sql
-- ============================================================================

-- ============================================================================
-- HR Compensation Inputs — hr_employee_pay_items
-- ============================================================================
-- Per §5 of the COMPENSATION_PAYROLL_PREP_IMPLEMENTATION_BRIEF.
-- HR-owned table for employee allowances / deductions.
-- References finance_pay_components (Finance-owned catalogue).
-- HR can only use ACTIVE Finance components — enforced in the service layer.
-- item_no generated via nextRef prefix 'PIT'.
-- Lifecycle: draft → pending_approval → active / rejected / retired
-- Retire-never-delete: items used in exported runs are immutable.
-- ============================================================================

create table if not exists public.hr_employee_pay_items (
  id uuid primary key default gen_random_uuid(),
  item_no text unique,
  employee_id text not null references public.app_users(id) on delete cascade,
  component_id uuid not null references public.finance_pay_components(id) on delete restrict,
  amount numeric(12,2),
  percent numeric(5,2),
  effective_from date not null,
  effective_to date,
  status text not null default 'draft' check (status in ('draft','pending_approval','active','rejected','retired')),
  workflow_id uuid references public.workflow_instances(id) on delete set null,
  is_active boolean not null default false,
  note text,
  created_by text references public.app_users(id) on delete set null,
  approved_by text references public.app_users(id) on delete set null,
  approved_at timestamptz,
  retired_by text references public.app_users(id) on delete set null,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_employee_pay_items_amount_or_percent_check
    check ((amount is not null and percent is null) or (amount is null and percent is not null)),
  constraint hr_employee_pay_items_effective_check
    check (effective_to is null or effective_to >= effective_from)
);

create index if not exists hr_employee_pay_items_employee_idx  on public.hr_employee_pay_items(employee_id, is_active);
create index if not exists hr_employee_pay_items_component_idx on public.hr_employee_pay_items(component_id);
create index if not exists hr_employee_pay_items_status_idx    on public.hr_employee_pay_items(status);

alter table public.hr_employee_pay_items enable row level security;
grant select, insert, update, delete on public.hr_employee_pay_items to service_role;

drop trigger if exists trg_hr_employee_pay_items_updated_at on public.hr_employee_pay_items;
create trigger trg_hr_employee_pay_items_updated_at
  before update on public.hr_employee_pay_items
  for each row execute function public.set_updated_at();

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- (2/8)  20260802000006_hr_overtime_inputs.sql
-- ============================================================================

-- ============================================================================
-- HR Overtime Inputs — hr_overtime_entries
-- ============================================================================
-- Per §6 of the COMPENSATION_PAYROLL_PREP_IMPLEMENTATION_BRIEF.
-- Employee submits own OT; manager/HR approve by scope.
-- Rejected OT never enters payroll; approved OT can.
-- Paid OT is immutable (once linked to an exported/locked payroll run).
-- overtime_no generated via nextRef prefix 'OVT'.
-- ============================================================================

create table if not exists public.hr_overtime_entries (
  id uuid primary key default gen_random_uuid(),
  overtime_no text unique,
  employee_id text not null references public.app_users(id) on delete cascade,
  work_date date not null,
  hours numeric(8,2) not null check (hours > 0),
  multiplier numeric(5,2) not null default 1.5 check (multiplier > 0),
  reason text,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','paid','cancelled')),
  workflow_id uuid references public.workflow_instances(id) on delete set null,
  payroll_run_id uuid,
  payroll_run_line_id uuid,
  approved_by text references public.app_users(id) on delete set null,
  approved_at timestamptz,
  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_overtime_entries_employee_idx    on public.hr_overtime_entries(employee_id, work_date);
create index if not exists hr_overtime_entries_status_idx      on public.hr_overtime_entries(status);
create index if not exists hr_overtime_entries_payroll_run_idx on public.hr_overtime_entries(payroll_run_id);

alter table public.hr_overtime_entries enable row level security;
grant select, insert, update, delete on public.hr_overtime_entries to service_role;

drop trigger if exists trg_hr_overtime_entries_updated_at on public.hr_overtime_entries;
create trigger trg_hr_overtime_entries_updated_at
  before update on public.hr_overtime_entries
  for each row execute function public.set_updated_at();

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- (3/8)  20260802000010_employee_statutory_profiles.sql
-- ============================================================================

-- ============================================================================
-- HR/Finance — Employee Statutory Profiles (NIS Continuity) — Phase 2.5
-- ============================================================================
-- Table: hr_employee_statutory_profiles
-- HR captures NIS continuity data when an employee joins from another company.
-- Finance verifies the profile (NIS status set to 'verified').
-- HR can NEVER set nis_status='verified'; only finance.payroll.nis.verify can.
--
-- unique(employee_id, jurisdiction) — one profile per employee per jurisdiction.
-- ============================================================================

create table if not exists public.hr_employee_statutory_profiles (
  id                              uuid primary key default gen_random_uuid(),
  employee_id                     text not null references public.app_users(id) on delete cascade,
  jurisdiction                    text not null default 'TT' check (jurisdiction in ('TT')),
  currency                        text not null default 'TTD' check (currency in ('TTD')),
  nis_number                      text,
  nis_status                      text not null default 'pending_verification'
                                    check (nis_status in ('pending_verification','verified','not_available','not_applicable','exempt')),
  nis_applicable                  boolean not null default true,
  previous_employer_name          text,
  previous_employer_end_date      date,
  opening_ytd_insurable_earnings  numeric(12,2) not null default 0,
  opening_ytd_nis_employee        numeric(12,2) not null default 0,
  opening_ytd_nis_employer        numeric(12,2) not null default 0,
  opening_balance_as_of           date,
  -- verification fields (only Finance may populate these)
  verified_by                     text references public.app_users(id) on delete set null,
  verified_at                     timestamptz,
  verification_note               text,
  -- workflow link (set when HR submits for Finance verification)
  workflow_id                     uuid references public.workflow_instances(id) on delete set null,
  -- audit fields
  created_by                      text references public.app_users(id) on delete set null,
  updated_by                      text references public.app_users(id) on delete set null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique(employee_id, jurisdiction)
);

create index if not exists hr_employee_statutory_profiles_employee_idx
  on public.hr_employee_statutory_profiles(employee_id);
create index if not exists hr_employee_statutory_profiles_nis_status_idx
  on public.hr_employee_statutory_profiles(nis_status);
create index if not exists hr_employee_statutory_profiles_jurisdiction_idx
  on public.hr_employee_statutory_profiles(jurisdiction, nis_status);

alter table public.hr_employee_statutory_profiles enable row level security;
grant select, insert, update, delete on public.hr_employee_statutory_profiles to service_role;

drop trigger if exists trg_hr_employee_statutory_profiles_updated_at
  on public.hr_employee_statutory_profiles;
create trigger trg_hr_employee_statutory_profiles_updated_at
  before update on public.hr_employee_statutory_profiles
  for each row execute function public.set_updated_at();

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- (4/8)  20260803000000_hr_roster_core.sql
-- ============================================================================

-- ============================================================================
-- HR Shift / Roster Scheduling — Core tables (greenfield)
-- Shift templates, rotation patterns, coverage requirements
-- ============================================================================
-- These are the building blocks for rosters. A roster (20260803000001) owns
-- many shift_assignments; assignments reference templates; coverage_requirements
-- declare required headcount that gap-detection compares against.
--
-- app_users.id is TEXT — all user FKs are text.
-- RLS enabled on every table + service_role grants.
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── Shift templates ───────────────────────────────────────────────────────────
create table if not exists public.hr_shift_templates (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  starts_at        time not null,
  ends_at          time not null,
  crosses_midnight boolean not null default false,
  break_minutes    int not null default 0,
  paid_hours       numeric(5,2) not null,
  colour           text,
  site_id          text references public.project_sites(id) on delete set null,
  is_active        boolean not null default true,
  created_by       text references public.app_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists hr_shift_templates_site_idx    on public.hr_shift_templates(site_id);
create index if not exists hr_shift_templates_active_idx  on public.hr_shift_templates(is_active);

alter table public.hr_shift_templates enable row level security;
grant select, insert, update, delete on public.hr_shift_templates to service_role;

drop trigger if exists trg_hr_shift_templates_updated_at on public.hr_shift_templates;
create trigger trg_hr_shift_templates_updated_at
  before update on public.hr_shift_templates
  for each row execute function public.set_updated_at();

-- ── Rotation patterns ─────────────────────────────────────────────────────────
-- pattern jsonb: array of { dayIndex: number, shiftTemplateCode: string | 'off' }
create table if not exists public.hr_rotation_patterns (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  cycle_days  int not null check (cycle_days > 0),
  pattern     jsonb not null default '[]',
  is_active   boolean not null default true,
  created_by  text references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists hr_rotation_patterns_active_idx on public.hr_rotation_patterns(is_active);

alter table public.hr_rotation_patterns enable row level security;
grant select, insert, update, delete on public.hr_rotation_patterns to service_role;

drop trigger if exists trg_hr_rotation_patterns_updated_at on public.hr_rotation_patterns;
create trigger trg_hr_rotation_patterns_updated_at
  before update on public.hr_rotation_patterns
  for each row execute function public.set_updated_at();

-- ── Coverage requirements ─────────────────────────────────────────────────────
-- Declares required headcount per site/dept/position/shift.
-- Gap detection compares assignments against this.
create table if not exists public.hr_coverage_requirements (
  id                  uuid primary key default gen_random_uuid(),
  site_id             text references public.project_sites(id) on delete cascade,
  department_id       text references public.departments(id) on delete set null,
  position_id         uuid references public.hr_positions(id) on delete set null,
  shift_template_id   uuid not null references public.hr_shift_templates(id) on delete cascade,
  required_headcount  int not null check (required_headcount > 0),
  day_of_week         int check (day_of_week between 0 and 6),  -- null = every day
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists hr_coverage_requirements_site_idx  on public.hr_coverage_requirements(site_id);
create index if not exists hr_coverage_requirements_shift_idx on public.hr_coverage_requirements(shift_template_id);
create index if not exists hr_coverage_requirements_active_idx on public.hr_coverage_requirements(is_active);

alter table public.hr_coverage_requirements enable row level security;
grant select, insert, update, delete on public.hr_coverage_requirements to service_role;

drop trigger if exists trg_hr_coverage_requirements_updated_at on public.hr_coverage_requirements;
create trigger trg_hr_coverage_requirements_updated_at
  before update on public.hr_coverage_requirements
  for each row execute function public.set_updated_at();

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- (5/8)  20260803000001_hr_rosters.sql
-- ============================================================================

-- ============================================================================
-- HR Shift / Roster Scheduling — Roster + Shift Assignments
-- ============================================================================
-- hr_rosters: one per site/dept + period (week/fortnight/month).
-- hr_shift_assignments: employee × date row within a roster.
--
-- Lifecycle: draft → (pending_approval →) published → archived
-- Publish freezes the roster; edits require reopen → re-notify.
-- Unique partial index prevents two non-archived rosters for the same
-- site/dept/period_start overlap (validated in-app with a clear message).
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── Rosters ───────────────────────────────────────────────────────────────────
create table if not exists public.hr_rosters (
  id                   uuid primary key default gen_random_uuid(),
  roster_no            text not null unique,
  title                text not null,
  site_id              text not null references public.project_sites(id) on delete restrict,
  department_id        text references public.departments(id) on delete set null,
  period_start         date not null,
  period_end           date not null,
  status               text not null default 'draft'
    check (status in ('draft','pending_approval','returned','published','archived')),
  rotation_pattern_id  uuid references public.hr_rotation_patterns(id) on delete set null,
  workflow_id          uuid references public.workflow_instances(id) on delete set null,
  assignment_count     int not null default 0,
  open_shift_count     int not null default 0,
  created_by           text references public.app_users(id) on delete set null,
  published_by         text references public.app_users(id) on delete set null,
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint hr_rosters_period_check check (period_end >= period_start)
);

-- Partial unique: only one active roster (not archived) per site+dept+period_start.
-- Two rosters can share a period_start if one is archived.
create unique index if not exists hr_rosters_active_unique_idx
  on public.hr_rosters(site_id, coalesce(department_id, ''), period_start)
  where status <> 'archived';

create index if not exists hr_rosters_site_idx    on public.hr_rosters(site_id);
create index if not exists hr_rosters_dept_idx    on public.hr_rosters(department_id);
create index if not exists hr_rosters_status_idx  on public.hr_rosters(status);
create index if not exists hr_rosters_period_idx  on public.hr_rosters(period_start, period_end);

alter table public.hr_rosters enable row level security;
grant select, insert, update, delete on public.hr_rosters to service_role;

drop trigger if exists trg_hr_rosters_updated_at on public.hr_rosters;
create trigger trg_hr_rosters_updated_at
  before update on public.hr_rosters
  for each row execute function public.set_updated_at();

-- ── Shift assignments ─────────────────────────────────────────────────────────
-- One row per employee per date per roster. kind = shift|off|leave|open.
create table if not exists public.hr_shift_assignments (
  id                uuid primary key default gen_random_uuid(),
  roster_id         uuid not null references public.hr_rosters(id) on delete cascade,
  employee_id       text not null references public.app_users(id) on delete cascade,
  work_date         date not null,
  shift_template_id uuid references public.hr_shift_templates(id) on delete set null,
  kind              text not null default 'shift'
    check (kind in ('shift','off','leave','open')),
  hours             numeric(5,2),
  note              text,
  source            text not null default 'manual'
    check (source in ('manual','rotation','leave_sync')),
  created_by        text references public.app_users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (roster_id, employee_id, work_date)
);

create index if not exists hr_shift_assignments_roster_idx    on public.hr_shift_assignments(roster_id);
create index if not exists hr_shift_assignments_employee_idx  on public.hr_shift_assignments(employee_id);
create index if not exists hr_shift_assignments_date_idx      on public.hr_shift_assignments(work_date);
create index if not exists hr_shift_assignments_template_idx  on public.hr_shift_assignments(shift_template_id);

alter table public.hr_shift_assignments enable row level security;
grant select, insert, update, delete on public.hr_shift_assignments to service_role;

drop trigger if exists trg_hr_shift_assignments_updated_at on public.hr_shift_assignments;
create trigger trg_hr_shift_assignments_updated_at
  before update on public.hr_shift_assignments
  for each row execute function public.set_updated_at();

-- After applying, run: NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- (6/8)  20260915000000_hr_contract_management.sql
-- ============================================================================

-- ============================================================================
-- HR Contract Management — employment contracts owned by HR (templates → issue →
-- sign → active → renew/expire/terminate). Distinct from HSE Contractors (which
-- covers contractor-company safety compliance). Linked optionally to onboarding.
--
-- Conventions: uuid PKs; created_at/updated_at + public.set_updated_at() trigger;
-- app_users.id is TEXT → all user FKs are text references. RLS enabled; service_role
-- granted (the app reads/writes via the service-role client behind JWT auth).
-- Operator-applied; after applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Contract templates — reusable, versioned contract blueprints ──────────
create table if not exists public.hr_contract_templates (
  id                     uuid        primary key default gen_random_uuid(),
  template_key           text        not null unique,
  name                   text        not null,
  description            text,
  contract_type          text        not null default 'permanent'
                           check (contract_type in ('permanent','fixed_term','probation','contractor','temporary','internship')),
  worker_types           text[]      not null default '{}',
  body_template          text        not null default '',
  clauses                jsonb       not null default '[]'::jsonb,
  default_duration_months int,
  probation_months       int,
  status                 text        not null default 'active'
                           check (status in ('draft','active','retired')),
  version_no             int         not null default 1,
  created_by             text        references public.app_users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz
);

-- ── 2. Contracts — the issued instances ─────────────────────────────────────
create table if not exists public.hr_contracts (
  id                     uuid        primary key default gen_random_uuid(),
  contract_no            text        not null unique,
  employee_id            text        not null references public.app_users(id) on delete cascade,
  template_id            uuid        references public.hr_contract_templates(id) on delete set null,
  title                  text        not null,
  contract_type          text        not null default 'permanent'
                           check (contract_type in ('permanent','fixed_term','probation','contractor','temporary','internship')),
  start_date             date,
  end_date               date,
  probation_end_date     date,
  compensation_amount    numeric(14,2),
  compensation_currency  text        default 'TTD',
  compensation_period    text        default 'annual'
                           check (compensation_period in ('annual','monthly','fortnightly','weekly','daily','hourly')),
  body                   text        not null default '',
  status                 text        not null default 'draft'
                           check (status in ('draft','pending_signature','active','expired','terminated','superseded','cancelled')),
  issued_at              timestamptz,
  issued_by              text        references public.app_users(id) on delete set null,
  activated_at           timestamptz,
  terminated_at          timestamptz,
  termination_reason     text,
  terminated_by          text        references public.app_users(id) on delete set null,
  -- renewal / amendment chain: a renewed or amended contract points at the one it supersedes
  parent_contract_id     uuid        references public.hr_contracts(id) on delete set null,
  -- optional link to the onboarding case that produced this contract
  onboarding_case_id     uuid        references public.hr_onboarding_cases(id) on delete set null,
  metadata               jsonb       not null default '{}'::jsonb,
  created_by             text        references public.app_users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz
);

-- ── 3. Signatories — per-contract signature tracking (employer/employee/witness) ─
create table if not exists public.hr_contract_signatories (
  id                     uuid        primary key default gen_random_uuid(),
  contract_id            uuid        not null references public.hr_contracts(id) on delete cascade,
  party                  text        not null default 'employee'
                           check (party in ('employer','employee','witness','guarantor')),
  signatory_id           text        references public.app_users(id) on delete set null,
  signatory_name         text        not null,
  signatory_email        text,
  status                 text        not null default 'pending'
                           check (status in ('pending','signed','declined')),
  signature_method       text        check (signature_method in ('e_signature','wet_signature','uploaded')),
  signed_at              timestamptz,
  decline_reason         text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz
);

-- ── indexes ──────────────────────────────────────────────────────────────────
create index if not exists hr_contracts_employee_idx    on public.hr_contracts(employee_id, status);
create index if not exists hr_contracts_status_idx       on public.hr_contracts(status, end_date);
create index if not exists hr_contracts_template_idx     on public.hr_contracts(template_id);
create index if not exists hr_contracts_parent_idx       on public.hr_contracts(parent_contract_id);
create index if not exists hr_contract_sig_contract_idx  on public.hr_contract_signatories(contract_id, status);
create index if not exists hr_contract_templates_status_idx on public.hr_contract_templates(status);

-- ── RLS + service-role grants (app talks through the service-role client) ─────
alter table public.hr_contract_templates    enable row level security;
alter table public.hr_contracts             enable row level security;
alter table public.hr_contract_signatories  enable row level security;
grant select, insert, update, delete on table public.hr_contract_templates   to service_role;
grant select, insert, update, delete on table public.hr_contracts            to service_role;
grant select, insert, update, delete on table public.hr_contract_signatories to service_role;

-- ── updated_at triggers ───────────────────────────────────────────────────────
drop trigger if exists trg_hr_contract_templates_updated_at on public.hr_contract_templates;
create trigger trg_hr_contract_templates_updated_at before update on public.hr_contract_templates
  for each row execute function public.set_updated_at();
drop trigger if exists trg_hr_contracts_updated_at on public.hr_contracts;
create trigger trg_hr_contracts_updated_at before update on public.hr_contracts
  for each row execute function public.set_updated_at();
drop trigger if exists trg_hr_contract_sig_updated_at on public.hr_contract_signatories;
create trigger trg_hr_contract_sig_updated_at before update on public.hr_contract_signatories
  for each row execute function public.set_updated_at();

-- ── seed: a few standard templates so the page renders populated ───────────────
insert into public.hr_contract_templates (template_key, name, description, contract_type, worker_types, default_duration_months, probation_months, body_template, clauses)
values
  ('permanent_employee', 'Permanent Employment Contract',
   'Standard open-ended employment contract for permanent staff.', 'permanent', array['employee'], null, 3,
   'This Employment Agreement is made between {{company_name}} ("the Employer") and {{employee_name}} ("the Employee") for the position of {{job_title}}, commencing {{start_date}}.',
   '[{"title":"Probation","body":"The first three (3) months constitute a probationary period."},{"title":"Confidentiality","body":"The Employee shall keep all proprietary information confidential."},{"title":"Termination","body":"Either party may terminate on one (1) month written notice."}]'::jsonb),
  ('fixed_term_employee', 'Fixed-Term Employment Contract',
   'Time-bound contract for a defined project or period.', 'fixed_term', array['employee'], 12, 1,
   'This Fixed-Term Agreement between {{company_name}} and {{employee_name}} for {{job_title}} runs from {{start_date}} to {{end_date}}.',
   '[{"title":"Term","body":"This contract expires automatically on the end date unless renewed in writing."}]'::jsonb),
  ('contractor_services', 'Independent Contractor Agreement',
   'Services agreement for external/agency contractors.', 'contractor', array['contractor'], 6, null,
   'This Services Agreement between {{company_name}} and {{contractor_name}} covers the provision of services from {{start_date}} to {{end_date}}.',
   '[{"title":"Independent Status","body":"The Contractor is not an employee and is responsible for their own statutory obligations."},{"title":"Insurance","body":"The Contractor shall maintain valid liability insurance for the term."}]'::jsonb)
on conflict (template_key) do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- (7/8)  20260917000000_finance_general_ledger.sql
-- ============================================================================

-- ============================================================================
-- Finance General Ledger — Chart of Accounts, Journals, Journal Lines
-- ============================================================================
-- Defines the GL foundation that AP/AR/Fixed-Assets reference.
-- Contract: finance_gl_accounts(code text unique) exposed via POST /api/finance/gl/accounts/list.
-- Other modules MUST store gl_account_code TEXT (no FK) and source their picker
-- from that endpoint. Do NOT hard-FK this table.
--
-- Lifecycle: draft → posted (immutable) → reversed (creates a reversing journal).
-- Rule: a posted journal must balance — sum(debit) == sum(credit), ≥2 lines,
--       each line debit XOR credit (not both non-zero).
-- Human ref: JE-<YYYY>-<NNNN> generated via increment_ref_counter RPC.
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Chart of Accounts ─────────────────────────────────────────────────────

create table if not exists public.finance_gl_accounts (
  id              uuid        primary key default gen_random_uuid(),
  code            text        not null unique,          -- e.g. '1000', '1000.01'
  name            text        not null,
  type            text        not null
                  check (type in ('asset','liability','equity','revenue','expense')),
  subtype         text,                                 -- e.g. 'current_asset', 'fixed_asset'
  parent_code     text,                                 -- soft ref to code (no FK — tree is advisory)
  normal_balance  text        not null default 'debit'
                  check (normal_balance in ('debit','credit')),
  is_active       boolean     not null default true,
  description     text,
  metadata        jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

-- index for type/active lookups (pickers)
create index if not exists fga_type_active_idx
  on public.finance_gl_accounts(type, is_active);

-- index for parent hierarchy traversal
create index if not exists fga_parent_code_idx
  on public.finance_gl_accounts(parent_code)
  where parent_code is not null;

-- updated_at trigger
create or replace function public.set_finance_gl_accounts_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_fga_updated_at on public.finance_gl_accounts;
create trigger trg_fga_updated_at
  before update on public.finance_gl_accounts
  for each row execute function public.set_finance_gl_accounts_updated_at();

-- RLS
alter table public.finance_gl_accounts enable row level security;

create policy "service_role_bypass_finance_gl_accounts"
  on public.finance_gl_accounts
  using (auth.role() = 'service_role');

-- ── 2. Journal headers ────────────────────────────────────────────────────────

create table if not exists public.finance_gl_journals (
  id              uuid        primary key default gen_random_uuid(),
  journal_no      text        not null unique,          -- JE-2026-0001
  entry_date      date        not null,
  memo            text,
  status          text        not null default 'draft'
                  check (status in ('draft','posted','reversed')),
  source_module   text        not null default 'manual',  -- 'manual','finance_ap','finance_ar',…
  source_ref      text,                                   -- e.g. AP invoice number
  posted_at       timestamptz,
  posted_by       text        references public.app_users(id) on delete set null,
  reversed_at     timestamptz,
  reversal_of     uuid        references public.finance_gl_journals(id) on delete set null,
  created_by      text        references public.app_users(id) on delete set null,
  metadata        jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

-- index for status + date ordering
create index if not exists fgj_status_date_idx
  on public.finance_gl_journals(status, entry_date desc);

create index if not exists fgj_source_module_idx
  on public.finance_gl_journals(source_module);

-- updated_at trigger
create or replace function public.set_finance_gl_journals_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_fgj_updated_at on public.finance_gl_journals;
create trigger trg_fgj_updated_at
  before update on public.finance_gl_journals
  for each row execute function public.set_finance_gl_journals_updated_at();

-- RLS
alter table public.finance_gl_journals enable row level security;

create policy "service_role_bypass_finance_gl_journals"
  on public.finance_gl_journals
  using (auth.role() = 'service_role');

-- ── 3. Journal Lines ──────────────────────────────────────────────────────────

create table if not exists public.finance_gl_journal_lines (
  id              uuid        primary key default gen_random_uuid(),
  journal_id      uuid        not null references public.finance_gl_journals(id) on delete cascade,
  line_no         integer     not null,
  account_code    text        not null,                -- soft ref to finance_gl_accounts(code)
  debit           numeric(15,2) not null default 0,
  credit          numeric(15,2) not null default 0,
  description     text,
  cost_center_id  uuid,                               -- soft ref to finance_cost_centers(id)
  created_at      timestamptz not null default now(),
  -- Constraint: at least one of debit/credit must be non-zero but not both.
  constraint gl_line_debit_xor_credit check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  ),
  -- Each line number is unique within a journal.
  constraint gl_line_unique_line_no unique (journal_id, line_no)
);

-- index for journal → lines (used in balance check + trial balance)
create index if not exists fgjl_journal_idx
  on public.finance_gl_journal_lines(journal_id);

-- index for account-based trial balance aggregation
create index if not exists fgjl_account_code_idx
  on public.finance_gl_journal_lines(account_code);

-- RLS
alter table public.finance_gl_journal_lines enable row level security;

create policy "service_role_bypass_finance_gl_journal_lines"
  on public.finance_gl_journal_lines
  using (auth.role() = 'service_role');

-- ── 4. Service-role grants ────────────────────────────────────────────────────

grant select, insert, update, delete
  on public.finance_gl_accounts to service_role;

grant select, insert, update, delete
  on public.finance_gl_journals to service_role;

grant select, insert, update, delete
  on public.finance_gl_journal_lines to service_role;

-- ── 5. Realistic Chart of Accounts seed ──────────────────────────────────────
-- ASSET accounts (normal balance: debit)
insert into public.finance_gl_accounts (code, name, type, subtype, parent_code, normal_balance, description) values
  ('1000', 'Cash and Cash Equivalents',  'asset', 'current_asset',  null,   'debit', 'Petty cash, current accounts, and bank deposits'),
  ('1010', 'Petty Cash',                 'asset', 'current_asset',  '1000', 'debit', 'On-hand petty cash float'),
  ('1020', 'Bank — Main Operating',      'asset', 'current_asset',  '1000', 'debit', 'Primary operating bank account'),
  ('1030', 'Bank — Payroll',             'asset', 'current_asset',  '1000', 'debit', 'Dedicated payroll funding account'),
  ('1100', 'Accounts Receivable',        'asset', 'current_asset',  null,   'debit', 'Amounts owed by customers and clients'),
  ('1110', 'Trade Receivables',          'asset', 'current_asset',  '1100', 'debit', 'Standard trade debtor balances'),
  ('1120', 'Allowance for Doubtful Accounts', 'asset', 'current_asset', '1100', 'credit', 'Contra-asset: estimated uncollectable trade debts'),
  ('1200', 'Prepaid Expenses',           'asset', 'current_asset',  null,   'debit', 'Expenses paid in advance (insurance, rent, subscriptions)'),
  ('1300', 'Inventory',                  'asset', 'current_asset',  null,   'debit', 'Goods and materials held for sale or use'),
  ('1400', 'Other Current Assets',       'asset', 'current_asset',  null,   'debit', 'Miscellaneous short-term assets'),
  ('1500', 'Property, Plant & Equipment','asset', 'fixed_asset',    null,   'debit', 'Tangible fixed assets at cost'),
  ('1510', 'Land',                       'asset', 'fixed_asset',    '1500', 'debit', 'Land held at cost (not depreciated)'),
  ('1520', 'Buildings',                  'asset', 'fixed_asset',    '1500', 'debit', 'Office and operational buildings at cost'),
  ('1530', 'Plant & Machinery',          'asset', 'fixed_asset',    '1500', 'debit', 'Manufacturing and production equipment'),
  ('1540', 'Vehicles',                   'asset', 'fixed_asset',    '1500', 'debit', 'Company vehicles and fleet'),
  ('1550', 'Computer Equipment',         'asset', 'fixed_asset',    '1500', 'debit', 'Servers, laptops, and IT hardware'),
  ('1590', 'Accumulated Depreciation',   'asset', 'fixed_asset',    '1500', 'credit','Contra-asset: accumulated depreciation on PP&E'),
  ('1600', 'Intangible Assets',          'asset', 'intangible',     null,   'debit', 'Goodwill, licences, and other intangible assets'),
  ('1700', 'Long-term Investments',      'asset', 'investment',     null,   'debit', 'Non-current investments and equity stakes')
on conflict (code) do nothing;

-- LIABILITY accounts (normal balance: credit)
insert into public.finance_gl_accounts (code, name, type, subtype, parent_code, normal_balance, description) values
  ('2000', 'Accounts Payable',           'liability', 'current_liability', null,   'credit', 'Amounts owed to suppliers and vendors'),
  ('2010', 'Trade Payables',             'liability', 'current_liability', '2000', 'credit', 'Standard trade creditor balances'),
  ('2100', 'Accrued Liabilities',        'liability', 'current_liability', null,   'credit', 'Expenses incurred but not yet invoiced'),
  ('2110', 'Accrued Salaries & Wages',   'liability', 'current_liability', '2100', 'credit', 'Payroll accruals at period end'),
  ('2200', 'Short-term Borrowings',      'liability', 'current_liability', null,   'credit', 'Bank overdrafts and current portion of loans'),
  ('2300', 'Tax Liabilities',            'liability', 'current_liability', null,   'credit', 'NIS, PAYE, and VAT payable'),
  ('2310', 'PAYE Payable',               'liability', 'current_liability', '2300', 'credit', 'Income tax withheld from employees'),
  ('2320', 'NIS Payable',                'liability', 'current_liability', '2300', 'credit', 'National Insurance contributions payable'),
  ('2330', 'VAT Payable',                'liability', 'current_liability', '2300', 'credit', 'Value-Added Tax collected from customers'),
  ('2400', 'Deferred Revenue',           'liability', 'current_liability', null,   'credit', 'Advance payments and unearned income'),
  ('2500', 'Other Current Liabilities',  'liability', 'current_liability', null,   'credit', 'Miscellaneous short-term obligations'),
  ('2600', 'Long-term Loans',            'liability', 'non_current_liability', null, 'credit', 'Non-current bank loans and bonds'),
  ('2700', 'Deferred Tax Liabilities',   'liability', 'non_current_liability', null, 'credit', 'Timing differences in tax recognition'),
  ('2800', 'Other Long-term Liabilities','liability', 'non_current_liability', null, 'credit', 'Pension obligations and other non-current liabilities')
on conflict (code) do nothing;

-- EQUITY accounts (normal balance: credit)
insert into public.finance_gl_accounts (code, name, type, subtype, parent_code, normal_balance, description) values
  ('3000', 'Shareholders Equity',        'equity', 'capital',    null,   'credit', 'Total owners equity'),
  ('3100', 'Share Capital',              'equity', 'capital',    '3000', 'credit', 'Issued and paid-up share capital'),
  ('3200', 'Retained Earnings',          'equity', 'retained',   '3000', 'credit', 'Cumulative retained profits'),
  ('3300', 'Current Year Profit/Loss',   'equity', 'retained',   '3000', 'credit', 'Profit or loss for the current period'),
  ('3400', 'Revaluation Reserve',        'equity', 'reserve',    '3000', 'credit', 'Unrealised gains on asset revaluation'),
  ('3500', 'General Reserve',            'equity', 'reserve',    '3000', 'credit', 'General-purpose reserve retained from profits')
on conflict (code) do nothing;

-- REVENUE accounts (normal balance: credit)
insert into public.finance_gl_accounts (code, name, type, subtype, parent_code, normal_balance, description) values
  ('4000', 'Revenue',                    'revenue', 'operating',  null,   'credit', 'Total operating revenue'),
  ('4100', 'Product Sales',              'revenue', 'operating',  '4000', 'credit', 'Revenue from product sales'),
  ('4200', 'Service Revenue',            'revenue', 'operating',  '4000', 'credit', 'Revenue from services rendered'),
  ('4300', 'Project Revenue',            'revenue', 'operating',  '4000', 'credit', 'Revenue from contracted projects'),
  ('4400', 'Rental Income',              'revenue', 'other',      '4000', 'credit', 'Income from asset rentals'),
  ('4500', 'Interest Income',            'revenue', 'other',      '4000', 'credit', 'Interest earned on deposits and investments'),
  ('4600', 'Other Income',               'revenue', 'other',      '4000', 'credit', 'Miscellaneous non-operating income')
on conflict (code) do nothing;

-- EXPENSE accounts (normal balance: debit)
insert into public.finance_gl_accounts (code, name, type, subtype, parent_code, normal_balance, description) values
  ('5000', 'Operating Expenses',         'expense', 'operating',  null,   'debit', 'Total direct operating costs'),
  ('5100', 'Cost of Goods Sold',         'expense', 'cost_of_sales', '5000', 'debit', 'Direct costs attributable to goods sold'),
  ('5110', 'Raw Materials',              'expense', 'cost_of_sales', '5100', 'debit', 'Materials consumed in production'),
  ('5120', 'Direct Labour',              'expense', 'cost_of_sales', '5100', 'debit', 'Wages of production and field staff'),
  ('5200', 'Salaries & Wages',           'expense', 'payroll',    '5000', 'debit', 'All staff remuneration (non-production)'),
  ('5210', 'Statutory Contributions',    'expense', 'payroll',    '5200', 'debit', 'Employer NIS and other statutory costs'),
  ('5220', 'Staff Benefits',             'expense', 'payroll',    '5200', 'debit', 'Health insurance, pension, and other benefits'),
  ('5300', 'Rent & Occupancy',           'expense', 'overhead',   '5000', 'debit', 'Office rent, utilities, and facilities'),
  ('5400', 'Travel & Entertainment',     'expense', 'overhead',   '5000', 'debit', 'Business travel, meals, and accommodation'),
  ('5500', 'Professional Services',      'expense', 'overhead',   '5000', 'debit', 'Legal, audit, consulting, and advisory fees'),
  ('5600', 'Depreciation & Amortisation','expense', 'non_cash',   '5000', 'debit', 'Periodic depreciation of PP&E and amortisation of intangibles'),
  ('5700', 'Insurance',                  'expense', 'overhead',   '5000', 'debit', 'General, liability, and asset insurance premiums'),
  ('5800', 'Marketing & Advertising',    'expense', 'overhead',   '5000', 'debit', 'Sales and marketing expenditure'),
  ('5900', 'IT & Technology',            'expense', 'overhead',   '5000', 'debit', 'Software licences, SaaS subscriptions, and IT support'),
  ('5950', 'Bank Charges & Interest',    'expense', 'finance',    '5000', 'debit', 'Bank fees, interest on overdrafts and loans'),
  ('5990', 'Other Expenses',             'expense', 'overhead',   '5000', 'debit', 'Miscellaneous operating costs not elsewhere classified')
on conflict (code) do nothing;

-- After applying: NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- (8/8)  20260917000040_finance_2b_foundation.sql
-- ============================================================================

-- ============================================================================
-- Finance Wave 2B Foundation — shared attachment tables + reimbursement handoffs
-- ============================================================================
-- Creates:
--   storage bucket  finance-receipts          (private; used by all Finance attachments)
--   table           finance_expense_attachments     (multi-doc support per claim)
--   table           finance_remittance_attachments  (filing slips, payment confirmations)
--   table           finance_reimbursement_handoffs  (idempotency bridge per expense claim)
--
-- The existing finance_expense_claims.receipt_path column is left in place (single-
-- receipt fast-path); finance_expense_attachments is the multi-doc store that sits
-- alongside it.
--
-- Operator-applied. After applying, run: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Finance-receipts storage bucket (private) ─────────────────────────────
-- Used for expense receipts, remittance confirmation slips, and general Finance
-- file attachments. Created idempotently so re-running this migration is safe.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'finance-receipts',
  'finance-receipts',
  false,
  10485760,   -- 10 MB hard limit
  array[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain'
  ]
)
on conflict (id) do nothing;

-- ── 2. finance_expense_attachments ───────────────────────────────────────────
-- Multi-attachment store for expense claims. Each row is one file.
-- Supports receipts, supporting documents, approval confirmation PDFs, etc.

create table if not exists public.finance_expense_attachments (
  id             uuid         primary key default gen_random_uuid(),
  claim_id       uuid         not null
                 references public.finance_expense_claims(id) on delete cascade,
  file_name      text         not null check (char_length(file_name) <= 255),
  file_size      integer      check (file_size > 0),    -- bytes; null = unknown
  content_type   text,
  storage_path   text         not null,                 -- relative path in finance-receipts bucket
  uploaded_by    text         references public.app_users(id) on delete set null,
  created_at     timestamptz  not null default now()
);

create index if not exists fea_claim_idx
  on public.finance_expense_attachments(claim_id);

alter table public.finance_expense_attachments enable row level security;

-- service_role bypass (all access flows through the Netlify service-role client)
create policy "service_role_bypass_finance_expense_attachments"
  on public.finance_expense_attachments
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_expense_attachments to service_role;

-- ── 3. finance_remittance_attachments ────────────────────────────────────────
-- Filing confirmation slips, BIR/NIBTT payment receipts, supporting schedules.

create table if not exists public.finance_remittance_attachments (
  id               uuid         primary key default gen_random_uuid(),
  remittance_id    uuid         not null
                   references public.finance_remittances(id) on delete cascade,
  file_name        text         not null check (char_length(file_name) <= 255),
  file_size        integer      check (file_size > 0),
  content_type     text,
  storage_path     text         not null,
  uploaded_by      text         references public.app_users(id) on delete set null,
  created_at       timestamptz  not null default now()
);

create index if not exists fra_remittance_idx
  on public.finance_remittance_attachments(remittance_id);

alter table public.finance_remittance_attachments enable row level security;

create policy "service_role_bypass_finance_remittance_attachments"
  on public.finance_remittance_attachments
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_remittance_attachments to service_role;

-- ── 4. finance_reimbursement_handoffs ────────────────────────────────────────
-- Bridge table: tracks the cross-module handoff (Expenses → Payroll or Finance-AP)
-- that triggers reimbursement processing for an approved expense claim.
--
-- The UNIQUE constraint on expense_claim_id makes createReimbursementHandoff()
-- idempotent — a duplicate call catches the conflict and returns the existing row
-- rather than creating a second handoff for the same claim.

create table if not exists public.finance_reimbursement_handoffs (
  id                uuid         primary key default gen_random_uuid(),
  expense_claim_id  uuid         not null
                    references public.finance_expense_claims(id) on delete cascade,
  -- TEXT (not uuid) — handoff_outbox.id is 'hox-<ulid>'
  handoff_id        text         not null,
  -- Optional back-reference to the payroll run that initiated the reimbursement
  payroll_run_id    uuid,
  -- Mirrors handoff_outbox status for quick querying without a join
  status            text         not null default 'pending'
                    check (status in ('pending', 'processing', 'completed', 'failed', 'manual_review')),
  error_message     text,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz,
  -- Idempotency: at most one active handoff record per claim
  unique (expense_claim_id)
);

create index if not exists frh_status_idx
  on public.finance_reimbursement_handoffs(status)
  where status in ('pending', 'failed');

-- updated_at trigger
create or replace function public.set_finance_reimbursement_handoffs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_frh_updated_at on public.finance_reimbursement_handoffs;
create trigger trg_frh_updated_at
  before update on public.finance_reimbursement_handoffs
  for each row execute function public.set_finance_reimbursement_handoffs_updated_at();

alter table public.finance_reimbursement_handoffs enable row level security;

create policy "service_role_bypass_finance_reimbursement_handoffs"
  on public.finance_reimbursement_handoffs
  using (auth.role() = 'service_role');

grant select, insert, update, delete
  on public.finance_reimbursement_handoffs to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';

commit;

-- Reload PostgREST schema cache so the new tables are queryable immediately.
notify pgrst, 'reload schema';
