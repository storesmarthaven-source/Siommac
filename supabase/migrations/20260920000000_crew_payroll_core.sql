-- ═══════════════════════════════════════════════════════════════════════════
-- Crew Payroll — CP2 core schema (spec §14.3).
-- ═══════════════════════════════════════════════════════════════════════════
-- Crew/offshore/marine/rotation is a CONDITIONAL CAPABILITY of the normal payroll
-- run, enabled by the resolved pay-policy version's typed capability. This migration
-- adds ONLY the authoritative new domain (crew assignments + movements) and the
-- policy-type/rotation linkage. It is NOT a second payroll engine and adds NO
-- crew-run route/state. Contract: docs/module-contracts/CREW_PAYROLL_DELIVERY_CONTRACT.md
--
-- Decisions locked 2026-07-23:
--   • client dimension → finance_ar_customers FK (nullable only where policy permits;
--     never free-form text).
--   • site → NO column here; derived from ops_assets.site_id for display/recon only
--     (canonical ops_sites is a future Ops slice).
--   • do NOT fabricate movements from attendance — embark/disembark/transfer are real
--     hr_crew_movements records with an idempotent source business key.
--
-- Reuses canonical FK targets (all uuid PKs): finance_ar_customers, hr_contracts,
-- ops_assets, ops_work_orders, finance_pay_groups, finance_pay_group_policy_assignments,
-- hr_rotation_patterns. Employee FKs are text → app_users(id).

create extension if not exists btree_gist;

-- ── M1: expand the allowlisted policy types (§14.3). Keeps existing rows. ──────
alter table public.finance_pay_policies drop constraint if exists finance_pay_policies_policy_type_check;
alter table public.finance_pay_policies
  add constraint finance_pay_policies_policy_type_check
  check (policy_type in ('standard_salary','hourly_shift','project','offshore_rotation','marine_voyage','standby_callout'));

-- ── M2: policy-version rotation/work-pattern linkage + offshore-day boundary ───
alter table public.finance_pay_policy_versions
  add column if not exists rotation_pattern_id uuid references public.hr_rotation_patterns(id) on delete restrict;
comment on column public.finance_pay_policy_versions.rotation_pattern_id is
  'Optional published rotation pattern (7/7, 14/14, …) the policy version qualifies against. Null for standard policies.';
-- offshore-day is a real day-boundary capability (§14.4) for rotation/marine policies.
alter table public.finance_pay_policy_versions drop constraint if exists finance_pay_policy_versions_day_boundary_check;
alter table public.finance_pay_policy_versions
  add constraint finance_pay_policy_versions_day_boundary_check
  check (day_boundary in ('calendar_day','shift_start','offshore_day'));

-- ── M3: hr_crew_assignments (NEW) ─────────────────────────────────────────────
-- Effective crew assignment: employee ↔ pay group ↔ policy assignment, with canonical
-- client/contract/asset/work-order dimensions. Overlap of two ACTIVE assignments to the
-- SAME asset is a hard DB invariant (below); cross-asset double-booking is policy-
-- conditional and enforced in the write path (CP4) per the resolved policy capability.
create table if not exists public.hr_crew_assignments (
  id                       uuid primary key default gen_random_uuid(),
  assignment_no            text not null unique,
  employee_id              text not null references public.app_users(id) on delete restrict,
  pay_group_id             uuid not null references public.finance_pay_groups(id) on delete restrict,
  policy_assignment_id     uuid references public.finance_pay_group_policy_assignments(id) on delete set null,
  role                     text,
  -- canonical dimension FKs (decisions 2026-07-23); NO free-form client/site/asset text.
  client_id                uuid references public.finance_ar_customers(id) on delete restrict,
  contract_id              uuid references public.hr_contracts(id) on delete restrict,
  asset_id                 uuid references public.ops_assets(id) on delete restrict,
  work_order_id            uuid references public.ops_work_orders(id) on delete restrict,
  cost_center              text,                         -- code, mirrors app_users.cost_center
  contract_rate_reference  text,                         -- TTD contract/rate reference
  effective_from           date not null,
  effective_to             date,
  status                   text not null default 'draft'
                             check (status in ('draft','active','ended','cancelled')),
  approval_state           text not null default 'pending'
                             check (approval_state in ('pending','approved','rejected')),
  approved_by              text references public.app_users(id) on delete set null,
  approved_at              timestamptz,
  created_by               text not null references public.app_users(id) on delete restrict,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz,
  constraint hr_crew_assignments_period_ck check (effective_to is null or effective_to >= effective_from)
);
comment on table public.hr_crew_assignments is
  'Effective offshore/marine crew assignment (client/contract/asset/work-order). Site is derived from ops_assets.site_id, not stored here.';
comment on column public.hr_crew_assignments.client_id is
  'Canonical client → finance_ar_customers. Nullable only where the policy/work type permits; never free-form text.';

create index if not exists hr_crew_assignments_emp_idx    on public.hr_crew_assignments(employee_id, effective_from desc);
create index if not exists hr_crew_assignments_pg_idx      on public.hr_crew_assignments(pay_group_id);
create index if not exists hr_crew_assignments_asset_idx   on public.hr_crew_assignments(asset_id);
create index if not exists hr_crew_assignments_active_idx  on public.hr_crew_assignments(status) where status = 'active';

-- Hard invariant: an employee cannot hold two ACTIVE assignments to the SAME asset over
-- overlapping effective periods. (Cross-asset simultaneity is policy-conditional → CP4.)
alter table public.hr_crew_assignments
  add constraint hr_crew_assignments_no_same_asset_overlap
  exclude using gist (
    employee_id with =,
    asset_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  ) where (status = 'active' and asset_id is not null);

create trigger hr_crew_assignments_updated_at before update on public.hr_crew_assignments
  for each row execute function public.set_updated_at();

-- ── M4: hr_crew_movements (NEW) ───────────────────────────────────────────────
-- Immutable, correctable crew movement records. Idempotent import via a unique source
-- business key. A correction NEVER overwrites an approved historical event — it records
-- a corrects_movement_id relationship so an already-snapshotted run stays explainable.
create table if not exists public.hr_crew_movements (
  id                     uuid primary key default gen_random_uuid(),
  movement_no            text not null unique,
  employee_id            text not null references public.app_users(id) on delete restrict,
  movement_type          text not null
                           check (movement_type in ('embark','disembark','transfer','mobilize','demobilize')),
  occurred_at            timestamptz not null,
  operational_timezone   text not null default 'America/Port_of_Spain',
  asset_id               uuid references public.ops_assets(id) on delete restrict,
  source_system          text not null default 'manual',
  source_reference       text not null,                 -- business key from the source system
  approval_state         text not null default 'pending'
                           check (approval_state in ('pending','approved','rejected')),
  approved_by            text references public.app_users(id) on delete set null,
  approved_at            timestamptz,
  corrects_movement_id   uuid references public.hr_crew_movements(id) on delete set null,
  correction_reason      text,
  created_by             text not null references public.app_users(id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz,
  -- idempotent import: one row per (source system, business key).
  constraint hr_crew_movements_source_key_uq unique (source_system, source_reference),
  -- a correction must state its reason and point at a different original event.
  constraint hr_crew_movements_correction_ck
    check (corrects_movement_id is null or (correction_reason is not null and corrects_movement_id <> id))
);
comment on table public.hr_crew_movements is
  'Embark/disembark/transfer/mobilize/demobilize crew movements. Idempotent import (source_system, source_reference). Corrections link via corrects_movement_id; approved originals are never overwritten.';

create index if not exists hr_crew_movements_emp_time_idx   on public.hr_crew_movements(employee_id, occurred_at desc);
create index if not exists hr_crew_movements_asset_time_idx on public.hr_crew_movements(asset_id, occurred_at desc);
create index if not exists hr_crew_movements_corrects_idx   on public.hr_crew_movements(corrects_movement_id) where corrects_movement_id is not null;

create trigger hr_crew_movements_updated_at before update on public.hr_crew_movements
  for each row execute function public.set_updated_at();

-- ── RLS + grants (browser ERP access stays behind authenticated Netlify APIs) ──
alter table public.hr_crew_assignments enable row level security;
alter table public.hr_crew_movements   enable row level security;
grant select, insert, update, delete on public.hr_crew_assignments to service_role;
grant select, insert, update, delete on public.hr_crew_movements   to service_role;

-- NOTE (CP6): the run policy/input snapshot + per-line crew evidence extension is
-- decided when the run read/preflight contracts are extended, not here — see the
-- delivery contract §2.3 M5.
