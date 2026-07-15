-- ============================================================================
-- HR org: serialize position hierarchy changes + one active CR per position (review #7)
-- ============================================================================
-- The reports-to cycle check read the positions graph SEPARATELY from the eventual update,
-- so two concurrent approvals (e.g. A→B and B→A on different positions) could each pass the
-- check before either write landed, committing a cycle. And multiple ACTIVE change requests
-- for the same position could be overlaid in nondeterministic order. This migration closes
-- both: (1) a partial unique index enforcing ONE active change request per position, and
-- (2) a transactional RPC that takes an advisory lock so the cycle check + write are atomic
-- and hierarchy applies run one at a time.
-- Idempotent. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. One active change request per position ────────────────────────────────
-- Preflight: pre-existing duplicate active position CRs would make the index create fail.
do $$
declare v_dupes text;
begin
  select string_agg(entity_id::text, ', ') into v_dupes from (
    select entity_id
    from public.hr_org_change_requests
    where entity_type = 'position'
      and status in ('draft','pending_approval','approved','scheduled')
    group by entity_id having count(*) > 1
  ) d;
  if v_dupes is not null then
    raise exception 'Cannot enforce one-active-CR-per-position: multiple active change requests exist for position(s): %. Cancel the extras first, then re-run.', v_dupes;
  end if;
end $$;

create unique index if not exists hr_org_change_requests_one_active_per_position_uidx
  on public.hr_org_change_requests (entity_id)
  where entity_type = 'position'
    and status in ('draft','pending_approval','approved','scheduled');

-- ── 2. Serialized, cycle-safe reports-to apply ───────────────────────────────
create or replace function public.hr_position_apply_reports_to_tx(p_position_id uuid, p_reports_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor uuid;
  v_guard  int := 0;
begin
  -- Serialize ALL position hierarchy applies. Without this a TS-side cycle check followed by
  -- a separate UPDATE cannot serialize across PostgREST calls: two concurrent approvals each
  -- read the graph before the other's write lands, both pass, and a cycle is committed. A
  -- transaction-scoped advisory lock forces them to run one at a time so the later one sees
  -- the earlier write.
  perform pg_advisory_xact_lock(hashtext('hr_position_hierarchy'));

  if p_reports_to is not null then
    if p_reports_to = p_position_id then
      raise exception 'A position cannot report to itself.' using errcode = 'HR409';
    end if;
    -- Walk the committed reports-to chain up from the proposed parent (under the lock);
    -- reaching the position being updated means this change would close a cycle.
    v_cursor := p_reports_to;
    while v_cursor is not null loop
      v_guard := v_guard + 1;
      if v_guard > 100000 then
        raise exception 'reports-to chain exceeded the depth guard.' using errcode = 'HR409';
      end if;
      if v_cursor = p_position_id then
        raise exception 'This reports-to change would create a position hierarchy cycle.' using errcode = 'HR409';
      end if;
      select reports_to_position_id into v_cursor from public.hr_positions where id = v_cursor;
    end loop;
  end if;

  update public.hr_positions
     set reports_to_position_id = p_reports_to, updated_at = now()
   where id = p_position_id;
  if not found then
    raise exception 'Position % not found.', p_position_id using errcode = 'HR404';
  end if;
end $$;

revoke all on function public.hr_position_apply_reports_to_tx(uuid, uuid) from public;
revoke all on function public.hr_position_apply_reports_to_tx(uuid, uuid) from anon;
revoke all on function public.hr_position_apply_reports_to_tx(uuid, uuid) from authenticated;
grant execute on function public.hr_position_apply_reports_to_tx(uuid, uuid) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
