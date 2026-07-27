-- ============================================================================
-- 20260926000008_hr_employee_import_create_tx.sql
--
-- Employee Import — transactional CREATE command (audit 2026-07-26, P0-3).
--
-- Import created employees via provisionEmployee(), which issued seven separate
-- writes with unchecked compensation: the auth_id update and the compensating deletes
-- were never error-checked, and a failure in the final audit write left the employee
-- and its satellites in place. The route caught the throw, marked the row `failed`,
-- and continued — so a row could be reported failed while a real employee, assignment
-- and statutory profile survived, and a retry could then collide with those orphans.
--
-- Replacing that call with a bare hr_employee_create_tx invocation would NOT close the
-- defect: the import row's `created` status was still a SECOND round-trip afterwards,
-- so a failure there reproduced "row failed, employee exists" one layer out.
--
-- This command therefore puts BOTH halves in ONE transaction:
--   • lock + validate the batch and the import row;
--   • delegate to the canonical hr_employee_create_tx (same transaction, same
--     validation, same mutation-run ledger — no duplicated create logic);
--   • mark the import row `created` with its target_employee_id;
--   • write the HR audit row;
--   • insert the import-scoped app_event.
-- Either every one of those commits, or none does. There is no compensation.
--
-- Idempotency key = batch id + import row id. The canonical command owns replay and
-- same-key/different-payload conflict detection; this wrapper additionally REPAIRS a
-- row whose employee was created but whose status write was lost, so a retry converges
-- on the truth instead of duplicating.
-- ============================================================================

create or replace function public.hr_employee_import_create_tx(
  p_actor_id      text,
  p_batch_id      uuid,
  p_row_id        uuid,
  p_identity      jsonb,
  p_employment    jsonb,
  p_assignment    jsonb,
  p_access        jsonb,
  p_statutory     jsonb,
  p_record_status text,
  p_payload_hash  text,
  p_request_id    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- NOTE: deliberately NO `record`-typed variables. The Supabase dashboard SQL editor
  -- mis-parses `v_x record;` inside a function body as a newly created TABLE and
  -- appends `ALTER TABLE v_x ENABLE ROW LEVEL SECURITY;`, truncating the body and
  -- breaking the dollar-quoting. Scalars keep this file safe to paste.
  v_batch_no        text;
  v_batch_status    text;
  v_batch_mode      text;
  v_row_no          integer;
  v_row_status      text;
  v_row_target      text;
  v_key             text;
  v_result          jsonb;
  v_employee_id     text;
  v_replayed        boolean := false;
  v_is_replay       boolean := false;
  v_rows_touched    integer;
begin
  -- ── 1. Lock and validate the batch ────────────────────────────────────────
  select batch_no, status, import_mode
    into v_batch_no, v_batch_status, v_batch_mode
    from public.hr_employee_import_batches
   where id = p_batch_id
     for update;

  if not found then
    raise exception 'import batch % not found', p_batch_id using errcode = 'P0002';
  end if;

  -- ── 2. Lock the import row ────────────────────────────────────────────────
  select row_no, status, target_employee_id
    into v_row_no, v_row_status, v_row_target
    from public.hr_employee_import_rows
   where id = p_row_id and batch_id = p_batch_id
     for update;

  if not found then
    raise exception 'import row % does not belong to batch %', p_row_id, p_batch_id
      using errcode = 'P0002';
  end if;

  -- A row that already carries an employee is a REPLAY (or a repair of a lost status
  -- write). Those must keep working after the batch reaches `committed` — that is
  -- precisely when a repair is needed. Only a NEW create is gated on batch state.
  v_is_replay := v_row_status = 'created' and v_row_target is not null;

  if not v_is_replay then
    if v_batch_status not in ('validated', 'committing') then
      raise exception 'batch % is not committable (status: %)', v_batch_no, v_batch_status
        using errcode = '22023';
    end if;

    -- `update` mode may never create. Enforced here too, so the guarantee does not rest
    -- on the application layer alone.
    if v_batch_mode = 'update' then
      raise exception 'update mode cannot create records' using errcode = '22023';
    end if;
  end if;

  v_key := 'hr.import.row:' || p_batch_id::text || ':' || p_row_id::text;

  -- ── 3. Canonical employee create (same transaction) ───────────────────────
  -- Delegating rather than re-implementing keeps import and the single-employee
  -- wizard on identical validation, statutory handling and conflict semantics.
  -- hr_employee_create_tx returns the prior result on replay and raises 22023 when the
  -- same key arrives with a different payload.
  v_result := public.hr_employee_create_tx(
    p_actor_id        => p_actor_id,
    p_identity        => p_identity,
    p_employment      => p_employment,
    p_assignment      => coalesce(p_assignment, '{}'::jsonb),
    p_access          => coalesce(p_access, '{}'::jsonb),
    p_statutory       => coalesce(p_statutory, '{}'::jsonb),
    p_record_status   => coalesce(nullif(p_record_status, ''), 'active'),
    p_onboarding      => jsonb_build_object('prepareOnboarding', false, 'packageKey', null),
    p_idempotency_key => v_key,
    p_payload_hash    => p_payload_hash,
    p_request_id      => p_request_id
  );

  v_employee_id := v_result->>'employee_id';
  if v_employee_id is null then
    raise exception 'the employee create command returned no employee id' using errcode = 'XX000';
  end if;

  -- Replaying only if the row ALREADY pointed at this same employee before we ran.
  v_replayed := v_is_replay and v_row_target = v_employee_id;

  -- ── 4. Import row state — IN this transaction ─────────────────────────────
  -- This is the write that used to happen after the RPC. If it fails now, the employee
  -- create rolls back with it, so "row failed but employee exists" cannot occur.
  update public.hr_employee_import_rows
     set status = 'created',
         target_employee_id = v_employee_id,
         updated_at = now()
   where id = p_row_id and batch_id = p_batch_id;

  get diagnostics v_rows_touched = row_count;
  if v_rows_touched <> 1 then
    raise exception 'expected to mark exactly one import row created, touched %', v_rows_touched
      using errcode = 'XX000';
  end if;

  -- ── 5. Audit + event — exactly once, only on a genuine create ─────────────
  if not v_replayed then
    insert into public.hr_audit_log (
      employee_id, submodule_key, record_id, actor_id, action, new_state, reason
    ) values (
      v_employee_id, 'import', p_row_id::text, p_actor_id, 'hr.import.row_created',
      jsonb_build_object(
        'employeeId', v_employee_id,
        'employeeNo', v_result->>'employee_no',
        'batchNo', v_batch_no,
        'rowNo', v_row_no,
        'requestId', p_request_id,
        'outcome', 'created'
      ),
      format('Bulk import %s row %s', v_batch_no, v_row_no)
    );

    -- dedupe_key makes the event idempotent even if a caller retries outside the
    -- replay path; the canonical command emits its own hr.employee.created separately.
    insert into public.app_events (
      event_type, source_module, source_entity_type, source_entity_id,
      actor_user_id, site_id, department_id, severity, payload, dedupe_key
    ) values (
      'hr.import.row_created', 'hr', 'employee', v_employee_id,
      p_actor_id,
      nullif(p_assignment->>'siteId', ''), nullif(p_assignment->>'departmentId', ''),
      'info',
      jsonb_build_object(
        'batchId', p_batch_id, 'batchNo', v_batch_no,
        'rowId', p_row_id, 'rowNo', v_row_no,
        'employeeNo', v_result->>'employee_no',
        'requestId', p_request_id
      ),
      v_key || ':row-created'
    )
    -- app_events_dedupe_uidx is a PARTIAL unique index (where dedupe_key is not null),
    -- so the conflict target must repeat that predicate to match it.
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return v_result || jsonb_build_object(
    'row_id',   p_row_id,
    'row_no',   v_row_no,
    'batch_no', v_batch_no,
    'replayed', v_replayed
  );
end;
$$;

-- Service-role only. An authenticated caller must never reach the create path directly.
revoke all on function public.hr_employee_import_create_tx(
  text, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text
) from public, anon, authenticated;
