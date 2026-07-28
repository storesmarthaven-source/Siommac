-- ============================================================================
-- READ-ONLY verification for
--   supabase/migrations/20260928000002_hr_access_assignment_tx.sql
-- ============================================================================
-- ONE STATEMENT, ONE RESULT SET (the SQL editor shows only the last result).
-- Safe to run before or after applying. Every status must begin with "OK".
--
-- The check that matters most is `definer_not_public`. These are SECURITY
-- DEFINER functions: if the trailing REVOKE was dropped by a truncated paste,
-- anon or authenticated can execute them and write access grants, events and
-- audit rows directly, bypassing every route-level permission check.
-- That row MUST read OK.
--
-- Expected: 16 check rows + 1 summary row.
-- ============================================================================

with fns as (
  select p.oid,
         p.proname::text          as name,
         p.prosecdef              as is_definer,
         pg_get_function_identity_arguments(p.oid) as args,
         coalesce(array_to_string(p.proconfig, ','), '') as config,
         p.prosrc                 as body,
         p.proacl
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.proname in ('hr_access_assignment_grant_tx', 'hr_access_assignment_revoke_tx')
),
expected(name) as (
  values ('hr_access_assignment_grant_tx'), ('hr_access_assignment_revoke_tx')
),
checks as (

  -- 1. Both functions exist ------------------------------------------------
  select 1 as seq, 'function_exists'::text as check_name, e.name::text as object_name,
         (case when f.name is null then 'MISSING' else 'OK — (' || f.args || ')' end)::text as status
    from expected e left join fns f on f.name = e.name

  union all
  -- 2. Both are SECURITY DEFINER -------------------------------------------
  select 2, 'security_definer', e.name::text,
         (case when f.name is null then 'MISSING'
               when f.is_definer then 'OK — security definer'
               else 'NOT DEFINER' end)::text
    from expected e left join fns f on f.name = e.name

  union all
  -- 3. search_path is pinned ------------------------------------------------
  -- An unpinned search_path on a SECURITY DEFINER function is a privilege-
  -- escalation vector: a caller-controlled schema could shadow `public`.
  select 3, 'search_path_pinned', e.name::text,
         (case when f.name is null then 'MISSING'
               when f.config like '%search_path=public%' then 'OK — ' || f.config
               else 'NOT PINNED — ' || coalesce(nullif(f.config, ''), '(none)') end)::text
    from expected e left join fns f on f.name = e.name

  union all
  -- 4. THE CRITICAL ONE — not executable by anon/authenticated/public -------
  select 4, 'definer_not_public', e.name::text,
         (case
            when f.name is null then 'MISSING'
            when has_function_privilege('anon',          f.oid, 'EXECUTE')
              or has_function_privilege('authenticated', f.oid, 'EXECUTE')
            then 'EXPOSED — anon/authenticated can EXECUTE; the trailing REVOKE was lost'
            else 'OK — not executable by anon/authenticated'
          end)::text
    from expected e left join fns f on f.name = e.name

  union all
  -- 5. service_role can execute --------------------------------------------
  select 5, 'service_role_execute', e.name::text,
         (case when f.name is null then 'MISSING'
               when has_function_privilege('service_role', f.oid, 'EXECUTE') then 'OK — service_role may execute'
               else 'NO GRANT — the backend cannot call it' end)::text
    from expected e left join fns f on f.name = e.name

  union all
  -- 6. BODY performs every required write ----------------------------------
  -- Signature and ACL checks pass IDENTICALLY before and after a body change,
  -- so they cannot prove a re-apply landed. This asserts the side effects the
  -- command must perform — notably audit_logs, the CANONICAL platform audit
  -- record, which hr_audit_log does NOT substitute for.
  select 6, 'body_writes', e.name::text || ' → ' || w.target,
         (case when f.name is null then 'MISSING FUNCTION'
               when position(w.needle in f.body) > 0 then 'OK — writes ' || w.target
               else 'NOT WRITTEN — re-apply the migration' end)::text
    from expected e
    left join fns f on f.name = e.name
    cross join (values
      ('app_events',   'insert into public.app_events'),
      ('audit_logs',   'insert into public.audit_logs'),
      ('hr_audit_log', 'insert into public.hr_audit_log')
    ) as w(target, needle)
)
select seq, check_name, object_name, status from checks
union all
select 99, 'SUMMARY',
       (case when (select count(*) from checks where status not like 'OK%') = 0
             then 'ALL CHECKS PASSED' else 'FAILURES PRESENT' end)::text,
       ((select count(*) from checks where status not like 'OK%')::text
        || ' problem row(s) of ' || (select count(*) from checks)::text
        || ' — expected 16 check rows when fully applied')::text
 order by seq, check_name, object_name;
