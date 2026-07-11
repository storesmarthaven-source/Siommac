-- ============================================================================
-- Finance Payroll — one active pay group per employee per date (P2-5)
-- ============================================================================
-- The assignments PK (employee_id, pay_group_id, effective_from) only prevented
-- duplicate start dates WITHIN a group — one employee could hold overlapping
-- assignments in TWO groups for the same period and be paid in multiple runs.
-- A gist exclusion constraint makes overlap impossible at the DB layer, and a
-- CHECK enforces a sane date range. assignEmployee() closes the previous open
-- assignment before inserting (business intent: moving groups ends the old one).
-- ============================================================================

create extension if not exists btree_gist;

-- Sane ranges only.
alter table public.finance_employee_pay_group_assignments
  add constraint fepga_range_sane
  check (effective_to is null or effective_to >= effective_from);

-- One active assignment per employee per date — across ALL groups.
-- Open-ended assignments (effective_to null) extend to infinity.
alter table public.finance_employee_pay_group_assignments
  add constraint fepga_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  );

-- After applying, run: NOTIFY pgrst, 'reload schema';
-- NOTE: if existing data already overlaps, the ALTER fails — resolve the
-- overlapping rows first (close the older assignment's effective_to).
