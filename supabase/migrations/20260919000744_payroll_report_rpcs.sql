-- ============================================================================
-- Payroll Reports Center (F-12, Phase A) — 5/6: transactional RPCs
-- ============================================================================
-- One commit path for every report-job / artifact mutation. All functions are
-- public SECURITY INVOKER (run as the service_role caller) and are execute-granted
-- to service_role ONLY. Every business-event RPC writes app_events + hr_audit_log
-- in the SAME transaction, so a failure rolls the whole thing back (no partial
-- state, no dup-on-retry). Claim/lease/fencing-token modelled on
-- workflow_outbox_claim (20260919000160); idempotency + PRxxx errcodes modelled on
-- the finance_payroll execution RPCs (20260919000421). PRxxx → HTTP is mapped by
-- netlify/functions/lib/finance/payroll/rpcError.ts.
--
-- Event naming follows the module convention `finance.payroll.report.<action>`
-- (source_module 'finance_payroll'); the contract's §8 shorthand omits the prefix.
-- Contract: §6 / §6A / §6B / §8.
-- ============================================================================

-- ── enqueue: idempotent file-export job (MUT-RPT-001) ───────────────────────
create or replace function public.finance_payroll_report_enqueue_tx(
  p_actor_id          text,
  p_report_key        text,
  p_params            jsonb,
  p_format            text,
  p_scope             jsonb,
  p_scope_id          text,
  p_requires_view_all boolean,
  p_requires_export   boolean,
  p_idempotency_key   text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_lock_key text;
  v_hash     text;
  v_existing public.payroll_report_jobs%rowtype;
  v_job      public.payroll_report_jobs%rowtype;
  v_event_id uuid;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_report_enqueue: actor is required' using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users where id = p_actor_id and status = 'active'
  ) then
    raise exception 'finance_payroll_report_enqueue: actor is not an active user'
      using errcode = 'PR403';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_report_enqueue: idempotency key is required'
      using errcode = 'PR400';
  end if;
  if p_report_key is null or btrim(p_report_key) = '' then
    raise exception 'finance_payroll_report_enqueue: report key is required' using errcode = 'PR400';
  end if;
  if p_format not in ('xlsx', 'csv', 'pdf', 'zip') then
    raise exception 'finance_payroll_report_enqueue: unsupported file format %', p_format
      using errcode = 'PR400';
  end if;

  -- Content hash: same idempotency key + different content → 409.
  v_hash := md5(jsonb_build_object(
    'reportKey', p_report_key,
    'params', p_params,
    'format', p_format
  )::text);
  v_lock_key := p_actor_id || '|payroll_report.enqueue|' || btrim(p_idempotency_key);
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  select * into v_existing
    from public.payroll_report_jobs
   where requested_by = p_actor_id
     and idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception 'finance_payroll_report_enqueue: idempotency key was already used for a different report'
        using errcode = 'PR409';
    end if;
    return to_jsonb(v_existing) || jsonb_build_object('duplicate', true);
  end if;

  insert into public.payroll_report_jobs (
    report_key, params, format, scope, scope_id, requested_by, request_hash,
    idempotency_key, requires_view_all, requires_export, state
  ) values (
    p_report_key, p_params, p_format, p_scope, p_scope_id, p_actor_id, v_hash,
    btrim(p_idempotency_key), coalesce(p_requires_view_all, false),
    coalesce(p_requires_export, false), 'queued'
  )
  returning * into v_job;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'finance.payroll.report.enqueued', 'finance_payroll', 'payroll_report_job',
    v_job.id::text, p_actor_id, 'info',
    jsonb_build_object(
      'reportKey', v_job.report_key, 'format', v_job.format, 'scopeId', v_job.scope_id,
      'requiresViewAll', v_job.requires_view_all, 'requiresExport', v_job.requires_export
    ),
    'finance.payroll.report.enqueued:' || v_job.id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key, record_id, actor_id, action, previous_state, new_state
  ) values (
    'finance_payroll', v_job.id::text, p_actor_id, 'payroll_report.enqueued', null,
    jsonb_build_object(
      'reportKey', v_job.report_key, 'format', v_job.format, 'scopeId', v_job.scope_id,
      'requiresViewAll', v_job.requires_view_all, 'requiresExport', v_job.requires_export
    )
  );

  return to_jsonb(v_job) || jsonb_build_object('duplicate', false, 'eventId', v_event_id);
end
$fn$;

-- ── claim: queued or lease-expired-running, SKIP LOCKED (FSM-RPT-002) ───────
-- NOTE: the attempts-cap hardening lives in migration 746 (a CREATE OR REPLACE),
-- NOT here — this file was already applied, so an already-migrated environment
-- would never see an edit made here. 746 owns every Slice-4 function change.
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
      where c.state = 'queued'
         or (c.state = 'running' and c.lease_expires_at < now())
      order by c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning j.*;
end
$fn$;

-- ── heartbeat: renew lease iff token matches + running (FSM-RPT-006) ────────
create or replace function public.finance_payroll_report_heartbeat(
  p_job_id        uuid,
  p_claim_token   uuid,
  p_lease_seconds integer default 300
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_job public.payroll_report_jobs%rowtype;
begin
  update public.payroll_report_jobs
     set lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
         updated_at       = now()
   where id = p_job_id
     and claim_token = p_claim_token
     and state = 'running'
  returning * into v_job;
  if not found then
    raise exception 'finance_payroll_report_heartbeat: job not running under this claim token'
      using errcode = 'PR409';
  end if;
  return to_jsonb(v_job);
end
$fn$;

-- ── register upload attempt: ledger row BEFORE upload (MUT-RPT-007) ─────────
create or replace function public.finance_payroll_report_register_upload_tx(
  p_job_id       uuid,
  p_claim_token  uuid,
  p_storage_path text,
  p_sha256       text,
  p_byte_size    bigint
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_job     public.payroll_report_jobs%rowtype;
  v_attempt public.payroll_report_upload_attempts%rowtype;
begin
  select * into v_job from public.payroll_report_jobs where id = p_job_id for update;
  if not found then
    raise exception 'finance_payroll_report_register_upload: job % was not found', p_job_id
      using errcode = 'PR404';
  end if;
  if v_job.state <> 'running' or v_job.claim_token is distinct from p_claim_token then
    raise exception 'finance_payroll_report_register_upload: stale or invalid claim token'
      using errcode = 'PR409';
  end if;
  if p_storage_path is null or btrim(p_storage_path) = ''
     or p_sha256 is null or btrim(p_sha256) = '' then
    raise exception 'finance_payroll_report_register_upload: storage path and checksum are required'
      using errcode = 'PR400';
  end if;

  -- First registration of a (job, token) attempt wins; re-registration is a no-op
  -- so the recorded path is immutable for the attempt (idempotent).
  insert into public.payroll_report_upload_attempts (
    job_id, claim_token, storage_path, sha256, byte_size
  ) values (
    p_job_id, p_claim_token, p_storage_path, p_sha256, p_byte_size
  )
  on conflict (job_id, claim_token) do nothing;

  select * into v_attempt
    from public.payroll_report_upload_attempts
   where job_id = p_job_id and claim_token = p_claim_token;

  return to_jsonb(v_attempt);
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
  -- NOTE: the P0 orphan-reconciler fence (FOR UPDATE lock + last_cleanup_at reject)
  -- is added by migration 746 (CREATE OR REPLACE), not here — see the claim note.
  if not exists (
    select 1 from public.payroll_report_upload_attempts
     where job_id = p_job_id and claim_token = p_claim_token
       and storage_path = p_storage_path
  ) then
    raise exception 'finance_payroll_report_complete: upload attempt was not registered for this token/path'
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

-- ── fail: nextAttempts boundary; requeue<max else failed (MUT-RPT-003) ──────
create or replace function public.finance_payroll_report_fail_tx(
  p_job_id       uuid,
  p_claim_token  uuid,
  p_error_code   text,
  p_error_message text,
  p_retryable    boolean default true
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_job       public.payroll_report_jobs%rowtype;
  v_error     jsonb;
  v_failed    boolean;
  v_event_id  uuid;
  v_action    text;
  v_new_state text;
begin
  select * into v_job from public.payroll_report_jobs where id = p_job_id for update;
  if not found then
    raise exception 'finance_payroll_report_fail: job % was not found', p_job_id
      using errcode = 'PR404';
  end if;
  if v_job.state = 'failed' then
    return to_jsonb(v_job) || jsonb_build_object('duplicate', true);
  end if;
  if v_job.state <> 'running' or v_job.claim_token is distinct from p_claim_token then
    raise exception 'finance_payroll_report_fail: stale or invalid claim token'
      using errcode = 'PR409';
  end if;
  if p_error_code is null or btrim(p_error_code) = ''
     or p_error_message is null or btrim(p_error_message) = '' then
    raise exception 'finance_payroll_report_fail: error code and sanitized message are required'
      using errcode = 'PR400';
  end if;

  -- attempts was already incremented at claim time.
  v_failed := (v_job.attempts >= v_job.max_attempts) or (coalesce(p_retryable, true) = false);
  v_error := jsonb_build_object(
    'code', left(btrim(p_error_code), 100),
    'message', left(btrim(p_error_message), 500),
    'retryable', coalesce(p_retryable, true)
  );

  if v_failed then
    v_new_state := 'failed';
    update public.payroll_report_jobs
       set state = 'failed', failed_at = now(), error = v_error,
           claim_token = null, lease_expires_at = null, updated_at = now()
     where id = p_job_id
    returning * into v_job;
  else
    v_new_state := 'queued';
    update public.payroll_report_jobs
       set state = 'queued', error = v_error,
           claim_token = null, lease_expires_at = null, updated_at = now()
     where id = p_job_id
    returning * into v_job;
  end if;

  v_action := case when v_failed then 'failed' else 'requeued' end;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'finance.payroll.report.' || v_action, 'finance_payroll', 'payroll_report_job',
    v_job.id::text, v_job.requested_by, 'warning',
    jsonb_build_object(
      'reportKey', v_job.report_key, 'attempts', v_job.attempts,
      'maxAttempts', v_job.max_attempts, 'error', v_error
    ),
    'finance.payroll.report.' || v_action || ':' || v_job.id::text || ':' || v_job.attempts::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key, record_id, actor_id, action, previous_state, new_state, reason
  ) values (
    'finance_payroll', v_job.id::text, v_job.requested_by, 'payroll_report.' || v_action,
    jsonb_build_object('state', 'running', 'attempts', v_job.attempts),
    jsonb_build_object('state', v_new_state, 'attempts', v_job.attempts),
    left(btrim(p_error_message), 500)
  );

  return to_jsonb(v_job) || jsonb_build_object('duplicate', false, 'eventId', v_event_id);
end
$fn$;

-- ── preview audit (MUT-RPT-004): audit only, NO business event ───────────────
create or replace function public.finance_payroll_report_log_run(
  p_actor_id   text,
  p_report_key text,
  p_params     jsonb,
  p_scope_id   text,
  p_format     text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_report_log_run: actor is required' using errcode = 'PR400';
  end if;
  insert into public.hr_audit_log (
    submodule_key, record_id, actor_id, action, previous_state, new_state
  ) values (
    'finance_payroll', p_scope_id, p_actor_id, 'payroll_report.previewed', null,
    jsonb_build_object('reportKey', p_report_key, 'format', p_format, 'params', p_params)
  );
  return jsonb_build_object('logged', true);
end
$fn$;

-- ── download audit (MUT-RPT-005): audit only, NO business event ──────────────
create or replace function public.finance_payroll_report_log_download(
  p_actor_id    text,
  p_artifact_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_report_log_download: actor is required' using errcode = 'PR400';
  end if;
  insert into public.hr_audit_log (
    submodule_key, record_id, actor_id, action, previous_state, new_state
  ) values (
    'finance_payroll', p_artifact_id::text, p_actor_id, 'payroll_report.downloaded', null,
    jsonb_build_object('artifactId', p_artifact_id)
  );
  return jsonb_build_object('logged', true);
end
$fn$;

-- ── purge_claim: retention-expired, active or stranded-purging (FSM-PRG-01) ─
create or replace function public.finance_payroll_report_purge_claim(
  p_worker_id     text,
  p_limit         integer default 20,
  p_lease_seconds integer default 300
) returns setof public.payroll_report_artifacts
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  return query
  update public.payroll_report_artifacts a
     set purge_state            = 'purging',
         purge_token            = gen_random_uuid(),
         purge_lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
         purge_attempts         = a.purge_attempts + 1
   where a.id in (
     select c.id from public.payroll_report_artifacts c
      where now() >= c.retention_expires_at
        and (c.purge_state = 'active'
          or (c.purge_state = 'purging' and c.purge_lease_expires_at < now()))
      order by c.retention_expires_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning a.*;
end
$fn$;

-- ── purge_fail: token-checked; expire lease so row is re-claimable (FSM-PRG-02) ─
create or replace function public.finance_payroll_report_purge_fail(
  p_artifact_id uuid,
  p_purge_token uuid,
  p_error       jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_artifact public.payroll_report_artifacts%rowtype;
begin
  select * into v_artifact from public.payroll_report_artifacts
    where id = p_artifact_id for update;
  if not found then
    raise exception 'finance_payroll_report_purge_fail: artifact % was not found', p_artifact_id
      using errcode = 'PR404';
  end if;
  -- Token checked BEFORE any state write; a stale/different token always rejects.
  if v_artifact.purge_token is distinct from p_purge_token then
    raise exception 'finance_payroll_report_purge_fail: stale or invalid purge token'
      using errcode = 'PR409';
  end if;

  update public.payroll_report_artifacts
     set purge_error = jsonb_build_object(
           'code', left(coalesce(p_error->>'code', 'purge_error'), 100),
           'message', left(coalesce(p_error->>'message', 'storage remove failed'), 500)
         ),
         purge_lease_expires_at = now()  -- expire so the recovery pass re-claims it
   where id = p_artifact_id
  returning * into v_artifact;

  return to_jsonb(v_artifact);
end
$fn$;

-- ── purge_finalize: token-first, idempotent, exactly-one event (MUT-RPT-006) ─
create or replace function public.finance_payroll_report_purge_finalize(
  p_artifact_id uuid,
  p_purge_token uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_artifact public.payroll_report_artifacts%rowtype;
  v_event_id uuid;
begin
  select * into v_artifact from public.payroll_report_artifacts
    where id = p_artifact_id for update;
  if not found then
    raise exception 'finance_payroll_report_purge_finalize: artifact % was not found', p_artifact_id
      using errcode = 'PR404';
  end if;

  -- Token is checked FIRST, including when the row is already purged, so a
  -- stale/different token always rejects; the winning token is preserved so a
  -- same-token replay is distinguishable from a stale call.
  if v_artifact.purge_token is distinct from p_purge_token then
    raise exception 'finance_payroll_report_purge_finalize: stale or invalid purge token'
      using errcode = 'PR409';
  end if;

  if v_artifact.purge_state = 'purged' then
    -- Same-token replay after success: return the original, no second event.
    return to_jsonb(v_artifact) || jsonb_build_object('duplicate', true);
  end if;
  if v_artifact.purge_state <> 'purging' then
    raise exception 'finance_payroll_report_purge_finalize: artifact must be claimed before finalize'
      using errcode = 'PR409';
  end if;

  update public.payroll_report_artifacts
     set purge_state = 'purged', purged_at = now()
   where id = p_artifact_id
  returning * into v_artifact;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  ) values (
    'finance.payroll.report.purged', 'finance_payroll', 'payroll_report_artifact',
    v_artifact.id::text, v_artifact.created_by, 'info',
    jsonb_build_object(
      'jobId', v_artifact.job_id, 'scopeId', v_artifact.scope_id,
      'format', v_artifact.format, 'retentionClass', v_artifact.retention_class
    ),
    'finance.payroll.report.purged:' || v_artifact.id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key, record_id, actor_id, action, previous_state, new_state
  ) values (
    'finance_payroll', v_artifact.id::text, v_artifact.created_by, 'payroll_report.purged',
    jsonb_build_object('purgeState', 'purging'),
    jsonb_build_object('purgeState', 'purged', 'purgedAt', v_artifact.purged_at)
  );

  return to_jsonb(v_artifact) || jsonb_build_object('duplicate', false, 'eventId', v_event_id);
end
$fn$;

-- ── Grants: revoke from all, execute → service_role only ────────────────────
revoke all on function public.finance_payroll_report_enqueue_tx(
  text, text, jsonb, text, jsonb, text, boolean, boolean, text
) from public, anon, authenticated;
grant execute on function public.finance_payroll_report_enqueue_tx(
  text, text, jsonb, text, jsonb, text, boolean, boolean, text
) to service_role;

revoke all on function public.finance_payroll_report_claim(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_report_claim(text, integer, integer)
  to service_role;

revoke all on function public.finance_payroll_report_heartbeat(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_report_heartbeat(uuid, uuid, integer)
  to service_role;

revoke all on function public.finance_payroll_report_register_upload_tx(
  uuid, uuid, text, text, bigint
) from public, anon, authenticated;
grant execute on function public.finance_payroll_report_register_upload_tx(
  uuid, uuid, text, text, bigint
) to service_role;

revoke all on function public.finance_payroll_report_complete_tx(
  uuid, uuid, text, text, bigint, text, jsonb, text, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.finance_payroll_report_complete_tx(
  uuid, uuid, text, text, bigint, text, jsonb, text, integer, text, integer
) to service_role;

revoke all on function public.finance_payroll_report_fail_tx(
  uuid, uuid, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.finance_payroll_report_fail_tx(
  uuid, uuid, text, text, boolean
) to service_role;

revoke all on function public.finance_payroll_report_log_run(text, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_report_log_run(text, text, jsonb, text, text)
  to service_role;

revoke all on function public.finance_payroll_report_log_download(text, uuid)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_report_log_download(text, uuid)
  to service_role;

revoke all on function public.finance_payroll_report_purge_claim(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_report_purge_claim(text, integer, integer)
  to service_role;

revoke all on function public.finance_payroll_report_purge_fail(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_report_purge_fail(uuid, uuid, jsonb)
  to service_role;

revoke all on function public.finance_payroll_report_purge_finalize(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_report_purge_finalize(uuid, uuid)
  to service_role;

-- PostgREST schema cache is refreshed by the operator after migration apply.
