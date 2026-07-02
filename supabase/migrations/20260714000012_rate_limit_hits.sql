-- ============================================================================
-- Distributed rate limiting — replaces the in-process Map in
-- netlify/functions/lib/ratelimit.ts (which resets on every Lambda cold start
-- and doesn't share state across concurrently-running containers, so a
-- determined attacker spread across containers was never actually bounded by
-- it — "in-process" rate limiting is not real brute-force protection).
--
-- True sliding window (not a fixed-window counter): each hit is one row; a
-- check prunes this key's expired hits, counts what's left, and only inserts
-- a new hit if under the limit — same semantics as the old in-memory
-- implementation, now shared across every Lambda container via Postgres.
-- An advisory lock on the key serializes concurrent checks for the SAME key so
-- two racing requests can't both read count < max and both insert.
--
-- Self-cleaning: every check prunes its own key's old rows, plus a cheap ~1%-
-- probability global sweep so keys that are never re-checked don't linger
-- forever. No cron/scheduled function needed.
-- ============================================================================

create table if not exists public.rate_limit_hits (
  id     bigint generated always as identity primary key,
  rl_key text        not null,   -- e.g. 'login:1.2.3.4', 'auth_mut:USR-001'
  hit_at timestamptz not null default now()
);

create index if not exists rate_limit_hits_key_idx on public.rate_limit_hits(rl_key, hit_at);

alter table public.rate_limit_hits enable row level security;
-- Service-role only — this table has no legitimate direct client access.

create or replace function public.rate_limit_check(p_key text, p_window_ms integer, p_max integer)
returns table(allowed boolean, retry_after_secs integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - (p_window_ms || ' milliseconds')::interval;
  v_count  integer;
  v_oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext(p_key));

  delete from public.rate_limit_hits where rl_key = p_key and hit_at <= v_cutoff;

  select count(*), min(hit_at) into v_count, v_oldest
    from public.rate_limit_hits where rl_key = p_key;

  if v_count >= p_max then
    return query select false, greatest(1, ceil(extract(epoch from (v_oldest - v_cutoff)))::integer);
    return;
  end if;

  insert into public.rate_limit_hits (rl_key) values (p_key);

  if random() < 0.01 then
    delete from public.rate_limit_hits where hit_at < now() - interval '1 day';
  end if;

  return query select true, 0;
end;
$$;

revoke all on function public.rate_limit_check(text, integer, integer) from public;
revoke all on function public.rate_limit_check(text, integer, integer) from anon;
revoke all on function public.rate_limit_check(text, integer, integer) from authenticated;
grant execute on function public.rate_limit_check(text, integer, integer) to service_role;

-- refresh PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
