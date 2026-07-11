-- ============================================================================
-- Finance Payroll -- one active pay group per employee per date (P2-5)
-- ============================================================================
-- The assignments PK (employee_id, pay_group_id, effective_from) only prevented
-- duplicate start dates WITHIN a group -- one employee could hold overlapping
-- assignments in TWO groups for the same period and be paid in multiple runs.
-- A gist exclusion constraint makes overlap impossible at the DB layer, and a
-- CHECK enforces a sane date range. assignEmployee() closes the previous open
-- assignment before inserting (business intent: moving groups ends the old one).
-- Idempotent / re-runnable (drop-if-exists before add).
-- ============================================================================

create extension if not exists btree_gist;

-- Preflight: if live data already overlaps, the exclusion ADD below throws an
-- opaque "conflicting key value violates exclusion constraint". Detect it first
-- and RAISE a message that NAMES the offending employees + ranges, so the
-- operator knows exactly what to fix. (scripts/preflight-paygroup-overlaps.mjs
-- --fix can close them automatically before applying this migration.)
do $preflight$
declare
  v_conflicts text;
begin
  select string_agg(
           format('emp %s [%s..%s] vs [%s..%s]',
                  a.employee_id, a.effective_from, coalesce(a.effective_to::text, 'open'),
                  b.effective_from, coalesce(b.effective_to::text, 'open')),
           '; ')
    into v_conflicts
    from public.finance_employee_pay_group_assignments a
    join public.finance_employee_pay_group_assignments b
      on a.employee_id = b.employee_id
     and a.ctid < b.ctid
     and daterange(a.effective_from, coalesce(a.effective_to, 'infinity'::date), '[]')
      && daterange(b.effective_from, coalesce(b.effective_to, 'infinity'::date), '[]');
  if v_conflicts is not null then
    raise exception 'Pay-group overlap constraint blocked: resolve these overlapping assignments first -> %', v_conflicts;
  end if;
end;
$preflight$;

-- Sane ranges only.
alter table public.finance_employee_pay_group_assignments
  drop constraint if exists fepga_range_sane;
alter table public.finance_employee_pay_group_assignments
  add constraint fepga_range_sane
  check (effective_to is null or effective_to >= effective_from);

-- One active assignment per employee per date -- across ALL groups.
-- Open-ended assignments (effective_to null) extend to infinity.
alter table public.finance_employee_pay_group_assignments
  drop constraint if exists fepga_no_overlap;
alter table public.finance_employee_pay_group_assignments
  add constraint fepga_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  );

-- After applying, run: NOTIFY pgrst, 'reload schema';
-- NOTE: if existing data already overlaps, the ADD fails -- resolve the
-- overlapping rows first (close the older assignment's effective_to).
