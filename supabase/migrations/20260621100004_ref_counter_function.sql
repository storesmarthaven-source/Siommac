-- ============================================================================
-- Atomic reference counter function
-- Called by refGenerator.ts to increment and return sequential ref numbers
-- without race conditions under concurrent inserts.
-- ============================================================================

create or replace function public.increment_ref_counter(p_prefix text, p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  insert into public.reference_counters (prefix, year, next_number)
  values (p_prefix, p_year, 2)
  on conflict (prefix, year) do update
    set next_number = reference_counters.next_number + 1
  returning next_number - 1 into v_next;

  return v_next;
end;
$$;

-- Grant execute to service role only (backend uses service role client).
revoke all on function public.increment_ref_counter(text, integer) from public;
revoke all on function public.increment_ref_counter(text, integer) from anon;
revoke all on function public.increment_ref_counter(text, integer) from authenticated;
grant execute on function public.increment_ref_counter(text, integer) to service_role;
