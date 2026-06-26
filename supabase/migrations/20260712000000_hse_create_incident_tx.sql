-- ============================================================================
-- Strict mutation backbone (Spec §2) — atomic incident create.
--
-- Commits the business record + its people satellites + the app_event + the
-- audit_log in ONE transaction. A plpgsql function is atomic: any failure RAISEs
-- and rolls back EVERYTHING — no orphan incident, no record-without-event, no
-- partial state. This replaces the app-layer sequence of separate PostgREST
-- calls (which cannot be transactional and left partial state on mid-chain
-- failure). See netlify/functions/lib/MUTATION_BACKBONE_PLAN.md.
--
-- Workflow start + handoff DELIVERY stay OUTSIDE this tx (separate aggregates,
-- async outbox) — a delivery hiccup must never roll back the business write.
--
-- Type-safety: jsonb_populate_record coerces each jsonb field to its real column
-- type (no hand-written casts to drift). The CALLER supplies id + timestamps so
-- columns aren't nulled out (jsonb_populate_record does not apply DB defaults).
--
-- Operator-applied. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

create or replace function public.hse_create_incident_tx(
  p_incident jsonb,
  p_people   jsonb default '[]'::jsonb,
  p_event    jsonb default null,
  p_audit    jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inc    public.hse_incidents;
  v_ev_id  uuid;
  v_person jsonb;
begin
  -- 1. Business record (typed coercion; caller provides id + timestamps).
  insert into public.hse_incidents
  select * from jsonb_populate_record(null::public.hse_incidents, p_incident)
  returning * into v_inc;

  -- 2. People satellites — incident_id is injected here, never trusted from input.
  if p_people is not null then
    for v_person in select value from jsonb_array_elements(p_people) loop
      insert into public.hse_incident_people
      select * from jsonb_populate_record(
        null::public.hse_incident_people,
        v_person || jsonb_build_object('incident_id', v_inc.id)
      );
    end loop;
  end if;

  -- 3. app_event — mandatory §2 side-effect, now in the same tx. dedupe_key
  --    guards concurrent retries (partial unique index); a deduped retry is a
  --    no-op and leaves v_ev_id null.
  if p_event is not null then
    insert into public.app_events
    select * from jsonb_populate_record(null::public.app_events, p_event)
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into v_ev_id;
  end if;

  -- 4. audit_log — mandatory §2 trail, same tx.
  if p_audit is not null then
    insert into public.audit_logs
    select * from jsonb_populate_record(null::public.audit_logs, p_audit);
  end if;

  return jsonb_build_object('id', v_inc.id, 'ref', v_inc.ref, 'eventId', v_ev_id);
end;
$$;

grant execute on function public.hse_create_incident_tx(jsonb, jsonb, jsonb, jsonb) to service_role;
