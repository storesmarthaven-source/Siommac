-- ============================================================================
-- calendar_entries.department_id (additive)
--
-- The HR employee-master branch originally added this column + index by EDITING
-- the historical migration 20260917000310_calendar_module.sql. That file is
-- immutable — it is (or may be) already applied — so editing it would be a
-- no-op on any deployed database. This carries the same change as a new,
-- uniquely-numbered, idempotent additive migration instead.
--
-- Operator note: this column already exists in the live dev DB (verified via
-- db:audit), so this migration is a safe no-op there; it exists so a fresh
-- rebuild reproduces the schema.
-- ============================================================================

alter table public.calendar_entries
  add column if not exists department_id text references public.departments(id) on delete set null;

create index if not exists calendar_entries_department_idx
  on public.calendar_entries (department_id);
