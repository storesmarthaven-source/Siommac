-- ============================================================================
-- permission_grant_approvals -- atomic reject/cancel (audit remediation P1-8)
--
-- approve_permission_grant_tx (20260917000300) made APPROVE atomic, but reject
-- and cancel still did read-pending-then-update as two separate PostgREST calls:
-- a concurrent approve could APPLY the grant between the read and the update,
-- after which reject/cancel silently overwrote the approval's status while the
-- grant stayed live. These functions mirror the approve tx: lock the row,
-- re-check status under the lock, then flip -- or report why not.
--   reject_permission_grant_tx -- maker <> checker enforced inside the tx.
--   cancel_permission_grant_tx -- only the REQUESTER may cancel their own request.
-- ASCII only + named dollar-quote tags. Idempotent / re-runnable.
-- ============================================================================

create or replace function public.reject_permission_grant_tx(
  p_approval_id text,
  p_checker_id  text,
  p_reason      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $reject_pga$
declare
  v_row permission_grant_approvals%rowtype;
  v_now timestamptz := now();
begin
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
  if v_row.requested_by = p_checker_id then
    return jsonb_build_object('status', 'self_approval');
  end if;

  update permission_grant_approvals
     set status          = 'rejected',
         decided_by      = p_checker_id,
         decided_at      = v_now,
         decision_reason = nullif(p_reason, '')
   where id = p_approval_id;

  return jsonb_build_object(
    'status',         'rejected',
    'permission_key', v_row.permission_key,
    'requested_by',   v_row.requested_by
  );
end;
$reject_pga$;

create or replace function public.cancel_permission_grant_tx(
  p_approval_id text,
  p_actor_id    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $cancel_pga$
declare
  v_row permission_grant_approvals%rowtype;
begin
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
  -- Only the requester withdraws their own request.
  if v_row.requested_by <> p_actor_id then
    return jsonb_build_object('status', 'not_requester');
  end if;

  update permission_grant_approvals
     set status     = 'cancelled',
         decided_by = p_actor_id,
         decided_at = now()
   where id = p_approval_id;

  return jsonb_build_object(
    'status',         'cancelled',
    'permission_key', v_row.permission_key
  );
end;
$cancel_pga$;

revoke all on function public.reject_permission_grant_tx(text, text, text) from public, anon, authenticated;
revoke all on function public.cancel_permission_grant_tx(text, text) from public, anon, authenticated;
grant execute on function public.reject_permission_grant_tx(text, text, text) to service_role;
grant execute on function public.cancel_permission_grant_tx(text, text) to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
