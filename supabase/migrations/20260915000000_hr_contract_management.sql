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
