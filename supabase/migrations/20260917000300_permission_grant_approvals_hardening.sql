-- ============================================================================
-- permission_grant_approvals — maker-checker hardening
--
-- Three related fixes on the critical-grant approval table:
--   1. approve_permission_grant_tx() — ONE atomic transaction that locks the
--      pending row, re-checks status/expiry/segregation-of-duties, applies the
--      grant to live RBAC, and marks the row approved. Replaces the previous
--      apply-then-update-in-JS path that could leave a grant APPLIED but the
--      approval row stuck 'pending' (the update ran as a separate PostgREST call
--      and its failure was swallowed). A row lock also serializes two concurrent
--      approvals so a grant can never be applied twice.
--   2. Partial unique indexes — DB-enforced dedupe of pending requests, closing
--      the read-then-insert race in requestCriticalGrant().
--   3. RLS tightening — drop the broad "any authenticated user can read" policy.
--      All reads go through the service-role backend (which bypasses RLS), so no
--      client needs SELECT on approval rows (requester identity + reasons).
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

begin;

-- ── 1. Atomic approve-and-apply ─────────────────────────────────────────────
-- Returns a jsonb result the backend branches on:
--   { status: 'not_found' | 'not_pending' | 'expired' | 'self_approval' }
--   { status: 'applied', request_type, target_role, target_user_id,
--             permission_key, effect, requested_by }
-- On 'applied' the grant and the status flip committed together; on any other
-- status nothing was written. Any raised exception rolls back the whole call.

create or replace function public.approve_permission_grant_tx(
  p_approval_id      text,
  p_checker_id       text,
  p_checker_username text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row permission_grant_approvals%rowtype;
  v_now timestamptz := now();
begin
  -- Lock the approval row: concurrent approvals of the same request serialize
  -- here, so the pending-guard below cannot be bypassed by a race.
  select * into v_row
    from permission_grant_approvals
   where id = p_approval_id
   for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('status', 'not_pending', 'current', v_row.status);
  end if;
  if v_row.expires_at < v_now then
    return jsonb_build_object('status', 'expired');
  end if;
  -- Segregation of duties: the maker cannot be the checker.
  if v_row.requested_by = p_checker_id then
    return jsonb_build_object('status', 'self_approval');
  end if;

  -- Apply the grant to live RBAC — the exact tables the direct grant routes write.
  if v_row.request_type = 'role_permission' then
    if v_row.effect = 'allow' then
      insert into role_permissions (role_name, permission)
        values (v_row.target_role, v_row.permission_key)
        on conflict (role_name, permission) do nothing;
    else
      delete from role_permissions
       where role_name = v_row.target_role
         and permission = v_row.permission_key;
    end if;
  else
    -- user_override — explicit per-user grant/deny row (granted = allow).
    insert into user_permissions (user_id, permission, granted, set_by, set_at)
      values (v_row.target_user_id, v_row.permission_key,
              (v_row.effect = 'allow'), p_checker_username, v_now)
      on conflict (user_id, permission) do update
        set granted = excluded.granted,
            set_by  = excluded.set_by,
            set_at  = excluded.set_at;
  end if;

  -- Mark the approval applied — atomic with the grant above.
  update permission_grant_approvals
     set status      = 'approved',
         decided_by  = p_checker_id,
         decided_at  = v_now,
         applied_at  = v_now
   where id = p_approval_id;

  return jsonb_build_object(
    'status',         'applied',
    'request_type',   v_row.request_type,
    'target_role',    v_row.target_role,
    'target_user_id', v_row.target_user_id,
    'permission_key', v_row.permission_key,
    'effect',         v_row.effect,
    'requested_by',   v_row.requested_by
  );
end;
$$;

-- Backend uses the service-role client; execute is service-role-only.
revoke all on function public.approve_permission_grant_tx(text, text, text) from public;
revoke all on function public.approve_permission_grant_tx(text, text, text) from anon;
revoke all on function public.approve_permission_grant_tx(text, text, text) from authenticated;
grant execute on function public.approve_permission_grant_tx(text, text, text) to service_role;

-- ── 2. DB-enforced dedupe of pending requests ───────────────────────────────
-- One open request per target + capability. Partial unique indexes make the
-- read-then-insert check in requestCriticalGrant() race-proof.
create unique index if not exists pga_uniq_pending_role
  on permission_grant_approvals (target_role, permission_key)
  where status = 'pending' and request_type = 'role_permission';

create unique index if not exists pga_uniq_pending_user
  on permission_grant_approvals (target_user_id, permission_key)
  where status = 'pending' and request_type = 'user_override';

-- ── 3. RLS tightening ────────────────────────────────────────────────────────
-- Approval rows carry the requester's identity + the free-text reason for a
-- critical grant. No client reads them directly — the console loads them via the
-- service-role backend (POST /api/admin/approvals/list), which bypasses RLS.
-- Drop the broad "any authenticated user may SELECT" policy; with RLS enabled
-- and no SELECT policy, client reads are denied by default.
drop policy if exists "pga_read" on permission_grant_approvals;

commit;

-- PostgREST caches the schema; reload so sb.rpc('approve_permission_grant_tx')
-- resolves instead of 404-ing on first call.
notify pgrst, 'reload schema';
