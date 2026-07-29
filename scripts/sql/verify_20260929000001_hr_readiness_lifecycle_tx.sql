-- ============================================================================
-- Verification for supabase/migrations/20260929000001_hr_readiness_lifecycle_tx.sql
--   sha256 9443fe3280319dbaeedc8b1aa314863c1fdbf476d343cb2d3669c7c85a179fa0
--
-- Run this IN THE DATABASE (SQL editor or psql) AFTER applying the migration.
-- It proves the objects exist and — critically — that the trailing REVOKE was
-- not dropped. Pair it with scripts/verify-hr-readiness-lifecycle.mjs, which
-- crosses the PostgREST boundary the application actually uses.
--
-- Every check RAISES on failure, so a clean run means every assertion passed.
-- ============================================================================

do $verify$
declare
  v_count      int;
  v_acl        aclitem[];
  v_definition jsonb;
begin
  -- ── 1. Both functions exist ───────────────────────────────────────────────
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'hr_readiness_work_item_transition_tx';
  if v_count <> 1 then
    raise exception 'FAIL: hr_readiness_work_item_transition_tx missing (found %)', v_count;
  end if;
  raise notice 'PASS  hr_readiness_work_item_transition_tx exists';

  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'hr_readiness_recalculate';
  if v_count <> 1 then
    raise exception 'FAIL: hr_readiness_recalculate missing (found %)', v_count;
  end if;
  raise notice 'PASS  hr_readiness_recalculate exists';

  -- ── 2. SECURITY DEFINER, and NOT reachable by anon/authenticated ─────────
  -- This is the check that catches a truncated paste. If the REVOKE tail was
  -- dropped, PUBLIC retains the default EXECUTE and these functions become
  -- callable by any authenticated browser session.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'hr_readiness_work_item_transition_tx'
       and p.prosecdef
  ) then
    raise exception 'FAIL: hr_readiness_work_item_transition_tx is not SECURITY DEFINER';
  end if;
  raise notice 'PASS  transition function is SECURITY DEFINER';

  for v_acl in
    select p.proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('hr_readiness_work_item_transition_tx', 'hr_readiness_recalculate')
  loop
    if v_acl is null then
      raise exception 'FAIL: function ACL is NULL — the REVOKE tail was dropped, PUBLIC still holds EXECUTE';
    end if;
    if array_to_string(v_acl, ',') ~ '(^|,)=X/' then
      raise exception 'FAIL: PUBLIC holds EXECUTE — the REVOKE tail was dropped';
    end if;
    if array_to_string(v_acl, ',') ~ 'anon=X' or array_to_string(v_acl, ',') ~ 'authenticated=X' then
      raise exception 'FAIL: anon/authenticated hold EXECUTE — the REVOKE tail was dropped';
    end if;
    if array_to_string(v_acl, ',') !~ 'service_role=X' then
      raise exception 'FAIL: service_role does not hold EXECUTE — the backend cannot call this';
    end if;
  end loop;
  raise notice 'PASS  both functions are service_role-only (REVOKE tail intact)';

  -- ── 3. Both readiness workflow templates are published ───────────────────
  for v_definition in
    select v.definition
      from public.workflow_templates t
      join public.workflow_template_versions v on v.template_id = t.id
     where t.template_key in ('hr_readiness_review_role', 'hr_readiness_review_user')
       and v.version_status = 'published'
  loop
    if v_definition->'steps'->0->>'stepKey' <> 'readiness_resolution' then
      raise exception 'FAIL: published readiness definition has an unexpected first step %',
        v_definition->'steps'->0->>'stepKey';
    end if;
    -- _create_instance validates this vocabulary and raises WF422 on anything else.
    if v_definition->'steps'->0->>'stepType' <> 'verification' then
      raise exception 'FAIL: readiness step has stepType % (expected verification)',
        v_definition->'steps'->0->>'stepType';
    end if;
  end loop;

  select count(*) into v_count
    from public.workflow_templates t
    join public.workflow_template_versions v on v.template_id = t.id
   where t.template_key in ('hr_readiness_review_role', 'hr_readiness_review_user')
     and v.version_status = 'published';
  if v_count <> 2 then
    raise exception 'FAIL: expected 2 published readiness templates, found %', v_count;
  end if;
  raise notice 'PASS  both readiness workflow templates are published';

  -- The role variant must assign by ROLE and the user variant by USER; swapping
  -- them would make _create_instance raise WF422 at runtime, not here.
  if (select v.definition->'steps'->0->'assignment'->>'type'
        from public.workflow_templates t join public.workflow_template_versions v on v.template_id = t.id
       where t.template_key = 'hr_readiness_review_role' and v.version_status = 'published') <> 'role' then
    raise exception 'FAIL: hr_readiness_review_role does not use role assignment';
  end if;
  if (select v.definition->'steps'->0->'assignment'->>'type'
        from public.workflow_templates t join public.workflow_template_versions v on v.template_id = t.id
       where t.template_key = 'hr_readiness_review_user' and v.version_status = 'published') <> 'fixed_user' then
    raise exception 'FAIL: hr_readiness_review_user does not use fixed_user assignment';
  end if;
  raise notice 'PASS  assignment kinds are role / fixed_user respectively';

  -- ── 4. Recalculation returns the expected contract ───────────────────────
  -- Called with an id that cannot exist: an employee with no controls evaluated
  -- must come back 0-ready, never 100%.
  select public.hr_readiness_recalculate('__verify_no_such_employee__') into v_definition;
  if v_definition->>'readyControls' <> '0' then
    raise exception 'FAIL: unevaluated employee reports % ready controls', v_definition->>'readyControls';
  end if;
  if (v_definition->>'totalControls')::int < 1 then
    raise exception 'FAIL: no active blocking controls are seeded — readiness cannot be measured';
  end if;
  raise notice 'PASS  recalculation contract: % of % ready for an unevaluated employee',
    v_definition->>'readyControls', v_definition->>'totalControls';

  raise notice 'ALL CHECKS PASSED';
end
$verify$;
