-- ============================================================================
-- Seed the global EMP reference counter (review #11 — atomic employee numbers)
-- ============================================================================
-- nextEmployeeNumber() previously scanned every EMP-#### and returned max+1 in JS —
-- non-atomic: two concurrent creates read the same max and mint the SAME number. It now
-- uses the transactional increment_ref_counter RPC with a GLOBAL sequence (year sentinel 0,
-- because an employee number carries no year, unlike ORC-2026-#### refs).
--
-- Seed that counter to (current max numeric EMP-#### + 1) so the first atomic allocation
-- CONTINUES the existing sequence instead of restarting at EMP-0001 and colliding. Uses
-- greatest() on conflict so re-running never moves the counter backwards.
-- Idempotent. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

insert into public.reference_counters (prefix, year, next_number)
select 'EMP', 0,
       coalesce(max((regexp_replace(employee_number, '^EMP-', ''))::int), 0) + 1
from public.app_users
where employee_number ~ '^EMP-\d+$'
on conflict (prefix, year)
  do update set next_number = greatest(public.reference_counters.next_number, excluded.next_number);

-- After applying:  NOTIFY pgrst, 'reload schema';
