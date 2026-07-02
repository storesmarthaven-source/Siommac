-- ============================================================================
-- HR Organization Structure (Phase A) — structured fields on existing tables
-- ============================================================================
-- `departments` stays the canonical org-unit tree; `finance_cost_centers` stays
-- the shared cost-centre registry; `hr_positions` stays the positions table.
-- This migration only ADDS the structured columns the Organization Structure
-- module needs — no new hr_org_units / hr_cost_centers fork. Additive + idempotent.
-- Run manually, then: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── departments: structured code + cost-centre link + display ordering ─────────
alter table public.departments add column if not exists code           text;
alter table public.departments add column if not exists cost_center_id uuid
  references public.finance_cost_centers(id) on delete set null;
alter table public.departments add column if not exists sort_order     integer not null default 0;

create unique index if not exists departments_code_key
  on public.departments(lower(code)) where code is not null;
create index if not exists departments_cost_center_idx
  on public.departments(cost_center_id) where cost_center_id is not null;

-- ── hr_positions: grade / headcount budget / position-level reports-to ─────────
alter table public.hr_positions add column if not exists grade                  text;
alter table public.hr_positions add column if not exists headcount_budget       integer;
alter table public.hr_positions add column if not exists reports_to_position_id uuid
  references public.hr_positions(id) on delete set null;

-- ── finance_cost_centers: promote the skeleton to a manageable registry ────────
-- Additive only — Finance owns this table long-term; HR Org Structure manages the
-- registry until the Finance module lands (both reference the SAME table).
alter table public.finance_cost_centers add column if not exists code       text;
alter table public.finance_cost_centers add column if not exists is_active  boolean not null default true;
alter table public.finance_cost_centers add column if not exists manager_id text
  references public.app_users(id) on delete set null;
alter table public.finance_cost_centers add column if not exists created_by text
  references public.app_users(id) on delete set null;
alter table public.finance_cost_centers add column if not exists updated_at timestamptz;

create unique index if not exists finance_cost_centers_code_key
  on public.finance_cost_centers(lower(code)) where code is not null;
create index if not exists finance_cost_centers_active_idx
  on public.finance_cost_centers(is_active);

-- After applying, run:  NOTIFY pgrst, 'reload schema';
