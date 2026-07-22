-- ============================================================================
-- Payroll Reports Center (F-12) — Slice 4 hardening (review remediation)
-- ============================================================================
-- IMPORTANT: migration 744 was already applied in Slice 1, so any change to a 744
-- function must live HERE (a forward CREATE OR REPLACE) to reach an already-migrated
-- environment — editing 744 in place would silently miss them. This migration OWNS
-- every Slice-4 function change (claim + complete_tx, below, plus the new RPCs).
--
-- DB-level fixes the app layer cannot enforce alone:
--
--  #1 (P0) Orphan-cleanup vs completion race. The orphan reconciler removed a
--     Storage object outside any fence, so complete_tx could commit an artifact
--     pointing at a just-deleted file. Fix: a reconcile CLAIM RPC that locks the
--     attempt row (FOR UPDATE SKIP LOCKED) and stamps last_cleanup_at BEFORE the
--     TS remove; complete_tx (redefined below) now also locks that attempt FOR
--     UPDATE and rejects a completion once last_cleanup_at is set. The shared row
--     lock serializes the two paths — no succeeded-artifact-with-missing-file.
--
--  #4 Crashed jobs reclaimed forever. claim (redefined below) now requires
--     attempts < max_attempts; this reaper transitions the expired-running jobs
--     that have exhausted their retry budget to 'failed' (one failed event+audit),
--     so a worker that is repeatedly killed before fail_tx no longer loops.
--
--  #16 Artifact append-only integrity was comment-only (service_role keeps blanket
--     UPDATE). This trigger enforces it: ONLY the purge columns may change, and
--     created_by may only be CLEARED (the ON DELETE SET NULL cascade), never
--     reassigned. Every evidence column — including retention_expires_at (retention
--     is frozen at complete_tx per §6) — is immutable.
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
     or NEW.retention_expires_at is distinct from OLD.retention_expires_at
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


-- ── claim + complete_tx: REDEFINED from migration 744 (forward-apply, see top) ─
-- ── claim: queued or lease-expired-running, SKIP LOCKED (FSM-RPT-002) ───────
-- Only claims jobs with attempts remaining (attempts < max_attempts) so a worker
-- that is repeatedly KILLED before it can call fail_tx cannot be reclaimed forever
-- (a job at the cap is instead reaped to 'failed' by finance_payroll_report_reap).
create or replace function public.finance_payroll_report_claim(
  p_worker_id     text,
  p_limit         integer default 5,
  p_lease_seconds integer default 300
) returns setof public.payroll_report_jobs
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  return query
  update public.payroll_report_jobs j
     set state            = 'running',
         claim_token      = gen_random_uuid(),
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
         attempts         = j.attempts + 1,
         started_at       = coalesce(j.started_at, now()),
         updated_at       = now()
   where j.id in (
     select c.id from public.payroll_report_jobs c
      where (c.state = 'queued'
             or (c.state = 'running' and c.lease_expires_at < now()))
        and c.attempts < c.max_attempts
      order by c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning j.*;
end
$fn$;

-- ── complete: token+ledger checked, artifact + succeeded, divergent→409 ─────
create or replace function public.finance_payroll_report_complete_tx(
  p_job_id         uuid,
  p_claim_token    uuid,
  p_storage_path   text,
  p_content_type   text,
  p_byte_size      bigint,
  p_sha256         text,
  p_scope          jsonb,
  p_scope_id       text,
  p_row_count      integer,
  p_retention_class text,
  p_retention_days integer
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_job      public.payroll_report_jobs%rowtype;
  v_artifact public.payroll_report_artifacts%rowtype;
  v_attempt  public.payroll_report_upload_attempts%rowtype;
  v_event_id uuid;
begin
  select * into v_job from public.payroll_report_jobs where id = p_job_id for update;
  if not found then
    raise exception 'finance_payroll_report_complete: job % was not found', p_job_id
      using errcode = 'PR404';
  end if;

  -- Idempotent replay of a succeeded job: identical artifact → original; any
  -- divergence (checksum/path/size) → 409.
  if v_job.state = 'succeeded' then
    select * into v_artifact from public.payroll_report_artifacts where job_id = p_job_id;
    if found
       and v_artifact.sha256 = p_sha256
       and v_artifact.storage_path = p_storage_path
       and v_artifact.byte_size = p_byte_size then
      return jsonb_build_object(
        'job', to_jsonb(v_job), 'artifact', to_jsonb(v_artifact), 'duplicate', true
      );
    end if;
    raise exception 'finance_payroll_report_complete: job already completed with a different artifact'
      using errcode = 'PR409';
  end if;

  if v_job.state <> 'running' or v_job.claim_token is distinct from p_claim_token then
    raise exception 'finance_payroll_report_complete: stale or invalid claim token'
      using errcode = 'PR409';
  end if;

  -- The winner path must be a registered ledger attempt for this exact token.
  -- Lock the attempt row FOR UPDATE so this serializes with the orphan reconciler's
  -- claim (finance_payroll_report_reconcile_claim, which also locks it): whichever
  -- grabs the lock first wins. If the reconciler already claimed the attempt for
  -- cleanup (last_cleanup_at set — the object is being/has been removed), REJECT the
  -- completion so a succeeded artifact can never point at a deleted object (P0 fence).
  select * into v_attempt from public.payroll_report_upload_attempts
    where job_id = p_job_id and claim_token = p_claim_token and storage_path = p_storage_path
    for update;
  if not found then
    raise exception 'finance_payroll_report_complete: upload attempt was not registered for this token/path'
      using errcode = 'PR409';
  end if;
  if v_attempt.last_cleanup_at is not null then
    raise exception 'finance_payroll_report_complete: this upload attempt was reclaimed by the orphan reconciler'
      using errcode = 'PR409';
  end if;

  insert into public.payroll_report_artifacts (
    job_id, storage_path, content_type, byte_size, sha256, scope, scope_id,
    row_count, retention_class, retention_expires_at, requires_view_all,
    requires_export, format, created_by
  ) values (
    p_job_id, p_storage_path, p_content_type, p_byte_size, p_sha256, p_scope, p_scope_id,
    greatest(coalesce(p_row_count, 0), 0), p_retention_class,
    now() + make_interval(days => greatest(coalesce(p_retention_days, 1), 1)),
    v_job.requires_view_all, v_job.requires_export, v_job.format, v_job.requested_by
  )
  returning * into v_artifact;

  update public.payroll_report_upload_attempts
     set committed_at = now()
   where job_id = p_job_id and claim_token = p_claim_token;

  update public.payroll_report_jobs
     set state = 'succeeded', artifact_id = v_artifact.id, completed_at = now(),
         error = null, updated_at = now()
   where id = p_job_id
  returning * into v_job;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'finance.payroll.report.completed', 'finance_payroll', 'payroll_report_artifact',
    v_artifact.id::text, v_job.requested_by, 'success',
    jsonb_build_object(
      'jobId', v_job.id, 'reportKey', v_job.report_key, 'format', v_artifact.format,
      'scopeId', v_artifact.scope_id, 'byteSize', v_artifact.byte_size,
      'sha256', v_artifact.sha256, 'rowCount', v_artifact.row_count
    ),
    'finance.payroll.report.completed:' || v_artifact.id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key, record_id, actor_id, action, previous_state, new_state
  ) values (
    'finance_payroll', v_job.id::text, v_job.requested_by, 'payroll_report.completed',
    jsonb_build_object('state', 'running'),
    jsonb_build_object(
      'state', 'succeeded', 'artifactId', v_artifact.id, 'sha256', v_artifact.sha256,
      'byteSize', v_artifact.byte_size, 'format', v_artifact.format
    )
  );

  return jsonb_build_object(
    'job', to_jsonb(v_job), 'artifact', to_jsonb(v_artifact),
    'eventId', v_event_id, 'duplicate', false
  );
end
$fn$;

-- Grants: CREATE OR REPLACE preserves privileges, but re-assert for a fresh apply.
revoke all on function public.finance_payroll_report_claim(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_report_claim(text, integer, integer)
  to service_role;
revoke all on function public.finance_payroll_report_complete_tx(
  uuid, uuid, text, text, bigint, text, jsonb, text, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.finance_payroll_report_complete_tx(
  uuid, uuid, text, text, bigint, text, jsonb, text, integer, text, integer
) to service_role;

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
