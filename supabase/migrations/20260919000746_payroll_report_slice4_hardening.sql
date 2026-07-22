-- ============================================================================
-- Payroll Reports Center (F-12) — Slice 4 hardening (review remediation)
-- ============================================================================
-- Three DB-level fixes that the app layer cannot enforce alone:
--
--  #1 (P0) Orphan-cleanup vs completion race. The orphan reconciler removed a
--     Storage object outside any fence, so complete_tx could commit an artifact
--     pointing at a just-deleted file. Fix: a reconcile CLAIM RPC that locks the
--     attempt row (FOR UPDATE SKIP LOCKED) and stamps last_cleanup_at BEFORE the
--     TS remove; complete_tx (migration 744, updated) now also locks that attempt
--     FOR UPDATE and rejects a completion once last_cleanup_at is set. The shared
--     row lock serializes the two paths — no succeeded-artifact-with-missing-file.
--
--  #4 Crashed jobs reclaimed forever. claim (migration 744, updated) now requires
--     attempts < max_attempts; this reaper transitions the expired-running jobs
--     that have exhausted their retry budget to 'failed' (one failed event+audit),
--     so a worker that is repeatedly killed before fail_tx no longer loops.
--
--  #16 Artifact append-only integrity was comment-only (service_role keeps blanket
--     UPDATE). This trigger enforces it: only the purge columns + retention_expires_at
--     may change, and created_by may only be CLEARED (the ON DELETE SET NULL cascade),
--     never reassigned. Every evidence column (path/checksum/size/scope/format/…) is
--     immutable after complete_tx.
--
-- All functions are public SECURITY INVOKER, execute-granted to service_role only.
-- ============================================================================

-- ── reconcile_claim: fence the orphan reconciler (see #1) ───────────────────
-- Claims a bounded page of UNCOMMITTED upload attempts whose token is no longer
-- the job's current running token OR whose job lease expired, EXCLUDING any path a
-- committed artifact owns. Locks each row FOR UPDATE SKIP LOCKED (concurrent
-- reconcilers claim disjoint sets) and stamps last_cleanup_at + cleanup_attempts++
-- as the claim, so complete_tx (which locks the same row) rejects afterwards.
create or replace function public.finance_payroll_report_reconcile_claim(
  p_worker_id text,
  p_limit     integer default 50
) returns table (id uuid, storage_path text, created_at timestamptz, cleanup_attempts integer)
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  return query
  update public.payroll_report_upload_attempts a
     set cleanup_attempts = a.cleanup_attempts + 1,
         last_cleanup_at  = now()
   where a.id in (
     select c.id
       from public.payroll_report_upload_attempts c
       join public.payroll_report_jobs j on j.id = c.job_id
      where c.committed_at is null
        and (c.claim_token is distinct from j.claim_token
             or j.state <> 'running'
             or j.lease_expires_at is null
             or j.lease_expires_at < now())
        -- Never touch the object a committed artifact points at.
        and not exists (
          select 1 from public.payroll_report_artifacts ar
           where ar.storage_path = c.storage_path
        )
      order by c.created_at
      for update of c skip locked
      limit greatest(p_limit, 1)
   )
  returning a.id, a.storage_path, a.created_at, a.cleanup_attempts;
end
$fn$;

-- ── reap: fail expired-running jobs that exhausted their retries (see #4) ────
create or replace function public.finance_payroll_report_reap(
  p_worker_id text,
  p_limit     integer default 20
) returns integer
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_job   public.payroll_report_jobs%rowtype;
  v_count integer := 0;
begin
  for v_job in
    select * from public.payroll_report_jobs
     where state = 'running'
       and lease_expires_at < now()
       and attempts >= max_attempts
     order by created_at
     for update skip locked
     limit greatest(p_limit, 1)
  loop
    update public.payroll_report_jobs
       set state = 'failed', failed_at = now(),
           error = jsonb_build_object(
             'code', 'max_attempts_exceeded',
             'message', 'worker terminated before completion; retry budget exhausted',
             'retryable', false),
           claim_token = null, lease_expires_at = null, updated_at = now()
     where id = v_job.id;

    insert into public.app_events (
      event_type, source_module, source_entity_type, source_entity_id,
      actor_user_id, severity, payload, dedupe_key
    ) values (
      'finance.payroll.report.failed', 'finance_payroll', 'payroll_report_job',
      v_job.id::text, v_job.requested_by, 'warning',
      jsonb_build_object('reportKey', v_job.report_key, 'attempts', v_job.attempts,
        'maxAttempts', v_job.max_attempts, 'reason', 'reaped'),
      'finance.payroll.report.failed:' || v_job.id::text || ':' || v_job.attempts::text
    );
    insert into public.hr_audit_log (
      submodule_key, record_id, actor_id, action, previous_state, new_state, reason
    ) values (
      'finance_payroll', v_job.id::text, v_job.requested_by, 'payroll_report.failed',
      jsonb_build_object('state', 'running', 'attempts', v_job.attempts),
      jsonb_build_object('state', 'failed', 'attempts', v_job.attempts),
      'reaped: max attempts exceeded'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$fn$;

-- ── append-only integrity trigger for artifacts (see #16) ───────────────────
create or replace function public.payroll_report_artifacts_guard()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if NEW.id is distinct from OLD.id
     or NEW.job_id is distinct from OLD.job_id
     or NEW.storage_path is distinct from OLD.storage_path
     or NEW.content_type is distinct from OLD.content_type
     or NEW.byte_size is distinct from OLD.byte_size
     or NEW.sha256 is distinct from OLD.sha256
     or NEW.scope is distinct from OLD.scope
     or NEW.scope_id is distinct from OLD.scope_id
     or NEW.row_count is distinct from OLD.row_count
     or NEW.retention_class is distinct from OLD.retention_class
     or NEW.requires_view_all is distinct from OLD.requires_view_all
     or NEW.requires_export is distinct from OLD.requires_export
     or NEW.format is distinct from OLD.format
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'payroll_report_artifacts is append-only: immutable evidence columns cannot be updated'
      using errcode = 'PR409';
  end if;
  -- created_by may only be CLEARED (the app_users ON DELETE SET NULL cascade),
  -- never re-pointed to a different user.
  if NEW.created_by is distinct from OLD.created_by and NEW.created_by is not null then
    raise exception 'payroll_report_artifacts.created_by may only be cleared by cascade, not reassigned'
      using errcode = 'PR409';
  end if;
  return NEW;
end
$fn$;

drop trigger if exists payroll_report_artifacts_guard on public.payroll_report_artifacts;
create trigger payroll_report_artifacts_guard
  before update on public.payroll_report_artifacts
  for each row execute function public.payroll_report_artifacts_guard();

-- ── rpc_exists: read-only existence probe (post-apply verification, #6) ─────
-- Lets the verify script confirm the mutating claim-family RPCs are LIVE WITHOUT
-- executing them (executing claim/purge_claim/reap/reconcile_claim would lease or
-- fail real queue rows). STABLE, reads only the catalog, mutates nothing.
create or replace function public.finance_payroll_report_rpc_exists(p_qualified_name text)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public
as $fn$
  select to_regprocedure(p_qualified_name) is not null
$fn$;

-- ── Grants: revoke from all, execute → service_role only ────────────────────
revoke all on function public.finance_payroll_report_rpc_exists(text)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_report_rpc_exists(text)
  to service_role;

revoke all on function public.finance_payroll_report_reconcile_claim(text, integer)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_report_reconcile_claim(text, integer)
  to service_role;

revoke all on function public.finance_payroll_report_reap(text, integer)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_report_reap(text, integer)
  to service_role;

-- PostgREST schema cache is refreshed by the operator after migration apply.
