# Strict Mutation Backbone — transactional-outbox via Postgres RPC

> **CORRECTION — NO DUAL SYSTEM (CLAUDE.md).** An optional `txWrite` path *alongside*
> the legacy `writeRecord` in `runModuleMutation` is a band-aid (transitional dual
> system) and was reverted. The correct shape is **one** transactional commit path
> for **every** module mutation, with the legacy non-atomic path **deleted** — i.e.
> a single generic `module_mutation_commit(business, satellites, event, audit)` RPC
> that `runModuleMutation` ALWAYS calls, and every caller converted to a declarative
> `{ table, row, satellites }` spec in the same change. Because each family's RPC/spec
> must land together (and migrations are operator-applied), this is a **big-bang**
> migration — it cannot be rolled out family-by-family without re-introducing the dual
> system. Per-family `*_tx` functions (e.g. the already-applied `hse_create_incident_tx`)
> are therefore NOT the path; if we keep the generic approach, drop that function.
> Build-new → delete-legacy, all in one coherent, fully-E2E-verified change.


## Why
`runModuleMutation` writes the business row, then `app_events`, then `audit_logs`,
then `handoff_outbox`, then notifications — as **separate PostgREST calls**. supabase-js
cannot wrap them in one transaction, so any mid-chain failure leaves a partial state.
Throwing between calls (the first attempt) just trades a silent band-aid for a
partial-state band-aid (committed record + dup-on-retry, because `startMutationRun`
only short-circuits `completed` runs — a `failed` run re-runs `writeRecord`).

The only correct fix: commit **business row + satellites + app_events + audit_logs +
handoff_outbox in ONE Postgres transaction** (a function runs atomically — any RAISE
rolls back everything). Delivery (notifications, realtime signals, handoff *processing*)
stays async off the committed rows — a delivery hiccup must never roll back the business write.

## Pattern — per-family typed RPC (NOT generic dynamic SQL)
Dynamic `jsonb_populate_record` loses column DEFAULTS (id/created_at → NULL) and is
fragile. Use one **typed** function per high-value family with explicit column lists so
DB defaults apply:

```sql
-- migration: <ts>_hse_create_incident_tx.sql  (operator-applied; idempotent)
create or replace function public.hse_create_incident_tx(
  p_incident jsonb, p_people jsonb, p_event jsonb, p_audit jsonb, p_handoffs jsonb
) returns table(id uuid, ref text)
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text; r jsonb;
begin
  insert into public.hse_incidents (ref,title,description,incident_date,reported_by,
      site_id,department_id,location_text,incident_type,severity,status,immediate_action,
      regulatory_class,osh_classification,injury_type,body_part,lost_days,return_to_work,
      osh_notification_due,osh_written_due,recordable,lost_time,metadata)
  values (p_incident->>'ref', p_incident->>'title', ... )   -- explicit casts, defaults apply
  returning hse_incidents.id, hse_incidents.ref into v_id, v_ref;

  for r in select * from jsonb_array_elements(coalesce(p_people,'[]'::jsonb)) loop
    insert into public.hse_incident_people (incident_id,person_type,user_id,full_name,
        role_or_company,injury_description)
    values (v_id, r->>'person_type', r->>'user_id', r->>'full_name',
        r->>'role_or_company', r->>'injury_description');
  end loop;

  if p_event is not null then
    insert into public.app_events (event_type,source_module,source_entity_type,
        source_entity_id,actor_user_id,site_id,department_id,severity,payload,dedupe_key)
    values (p_event->>'event_type', ...);
  end if;
  if p_audit is not null then
    insert into public.audit_logs (action,table_name,record_id,user_id,changes)
    values (p_audit->>'action', ...);
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_handoffs,'[]'::jsonb)) loop
    insert into public.handoff_outbox (...) values (...);
  end loop;

  return query select v_id, v_ref;
end $$;
```

## JS side
1. Split `emitAppEvent` → `buildEventRow()` (pure → the app_events jsonb) +
   `deliverNotifications(eventId, recipients, notification)` (best-effort, AFTER commit).
2. `runModuleMutation` gains a `txCommit` option: instead of `writeRecord` + separate
   `emitAppEvent`, the family supplies the RPC name + the jsonb payloads; the adapter
   calls `sb.rpc(name, payloads)` (atomic), then runs `deliverNotifications` best-effort,
   then `afterCommit`. Idempotency: the RPC is `dedupe_key`-guarded on app_events; a
   re-run with the same key is a no-op insert (ON CONFLICT DO NOTHING).
3. Keep the legacy `writeRecord` path for families not yet migrated — migrate one at a time.

## Rollout order (each: migration → wire JS → run that suite green)
1. `hse_create_incident_tx`  (incidents.mjs)
2. `hr_provision_employee_tx` (hrEmployeeMaster.mjs) — app_users + assignment + statutory + status_history + audit
3. `hr_change_request_tx` / `hr_apply_change_tx` (hr.mjs)
4. `hse_create_investigation_tx`, `hse_create_capa_tx`
5. `hr_commit_import_row_tx` (per-row, replaces the JS saga)

## Migration coordination (critical)
Do NOT wire JS to an RPC before the operator has applied its migration + `NOTIFY pgrst,
'reload schema'` — otherwise `sb.rpc()` 404s and the family breaks. Sequence per family:
write migration → operator applies → wire JS → rebuild backend → run suite.

## Acceptance per family
- E2E suite green (record + app_events + audit_logs + handoffs all asserted).
- Negative test: force a satellite failure (e.g. invalid FK) → API returns failure AND
  the business row does NOT exist (true rollback) AND no dup on retry.

## Current safe state (until each family lands)
- HSE incident people-insert: atomic via compensating delete (interim, replaced by tx).
- HR import rows: per-row failure tracking (atomic per row).
- `writeHrAudit`: checks `{error}` + throws (removes the ignore-band-aid; full atomicity
  arrives with `hr_*_tx`).
- `moduleServiceAdapter` event/handoff strict throws: REVERTED (were non-atomic) — their
  strictness returns *inside* the RPCs where it's transactional.

## Confirmed live schemas (probed 2026-06-26)
- `handoff_outbox`: id, source_module, target_module, source_entity_type, source_entity_id,
  target_entity_type, target_entity_id, payload, status, attempts, error, created_by,
  created_at, processed_at. (`createHandoff` only QUEUES status='pending'; delivery is async.)
- `hse_incidents`: id, ref, title, description, incident_date, reported_at, reported_by,
  site_id, department_id, location_text, incident_type, severity, status, immediate_action,
  regulatory_class, recordable, lost_time, workflow_id, metadata, created_at, updated_at,
  osh_classification, injury_type, body_part, lost_days, return_to_work, osh_notification_due,
  osh_notified_at, osh_written_due, osh_written_at.
- `hse_incident_people`: id, incident_id, person_type, user_id, full_name, role_or_company,
  injury_description, created_at.

## STATUS
- ✅ Migration written: `supabase/migrations/20260712000000_hse_create_incident_tx.sql`
  (uses `jsonb_populate_record` → exact type coercion; caller supplies id + timestamps).
  **Operator must apply it + `NOTIFY pgrst` before the JS is wired.**
- ⏭️ NEXT (JS wiring, must be tested): add a `txCommit` path to `runModuleMutation` AND
  make it RESUME-SAFE — the RPC is NOT idempotent on the incident (a fresh `ref`/`id` each
  call), so:
    1. After the RPC commits, immediately `markMutationRunStage('record_written', entityId)`.
    2. On retry, if the run already has an `entityId`, SKIP the RPC and resume from the
       workflow/handoff/delivery stages (today `startMutationRun` only short-circuits
       `completed` — it must also resume `record_written`). Without this, a post-RPC
       workflow failure dup's the incident on retry.
- ⏭️ Split `emitAppEvent` → `deliverEventNotifications(eventId, input)` (recipients + notify
  + signal), called AFTER the RPC; the RPC owns the `app_events` row insert.
- ⏭️ incidents route: build `p_incident` (with id=randomUUID, reported_at/created_at/
  updated_at=now), `p_people`, `p_event`, `p_audit`; call `sb.rpc('hse_create_incident_tx', …)`;
  then deliver + workflow(s) + handoffs + backlink. Add the negative rollback E2E.
