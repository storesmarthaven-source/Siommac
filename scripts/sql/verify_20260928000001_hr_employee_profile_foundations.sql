-- ============================================================================
-- READ-ONLY verification for
--   supabase/migrations/20260928000001_hr_employee_profile_foundations.sql
--   migration sha256 c1e6fceb500d126688bfc8d0576cb0a022e9196597c1bda1cbfaafa835fb95d0
-- ============================================================================
-- ONE STATEMENT, ONE RESULT SET.
--
-- The Supabase SQL editor displays only the LAST statement's result, so an
-- earlier multi-block revision of this file silently hid checks 1-10 and showed
-- only check 11. Every check is therefore a branch of a single UNION ALL.
--
-- SAFE TO RUN AT ANY TIME, before or after applying the migration. No branch
-- reads a new table directly, so nothing can fail with 42P01 and abort. Every
-- catalogue value is cast to text, so nothing can fail with 42725 on an
-- ambiguous `||` against "char"/name/domain types.
--
-- HOW TO READ IT: sort is by `seq`. Every row's `status` must begin with "OK".
-- The final SUMMARY row counts any that do not.
--
-- Expected when fully applied: 48 check rows + 1 summary row.
--   checks 5b and 10 are NEGATIVE and contribute 0 rows when healthy.
--
-- Row-level checks (the 3 seeded controls, real selects through the Data API)
-- live in the service-role probe, which handles absence gracefully:
--     node scripts/verify-hr-profile-foundations.mjs
--
-- The migration executes `notify pgrst, 'reload schema';` itself.
-- ============================================================================

with checks as (

  -- 1. TABLES — 6 rows -----------------------------------------------------
  select 1 as seq, 'tables'::text as check_name, e.name::text as object_name,
         (case when t.table_name is null then 'MISSING' else 'OK' end)::text as status
    from (values
      ('hr_employee_access_assignments'), ('hr_employee_access_scopes'),
      ('hr_readiness_controls'), ('hr_readiness_control_instances'),
      ('hr_readiness_work_items'), ('hr_readiness_work_item_transitions')
    ) as e(name)
    left join information_schema.tables t
      on t.table_schema = 'public' and t.table_name = e.name

  union all
  -- 2. NEW COLUMNS on the effective-dated assignment model — 3 rows ---------
  select 2, 'assignment_columns', e.name::text,
         (case when c.column_name is null then 'MISSING'
               else 'OK — ' || c.data_type::text
                    || coalesce('(' || c.numeric_precision::text || ',' || c.numeric_scale::text || ')', '')
          end)::text
    from (values ('weekly_hours'), ('fte'), ('updated_at')) as e(name)
    left join information_schema.columns c
      on c.table_schema = 'public' and c.table_name = 'hr_employee_assignments'
     and c.column_name = e.name

  union all
  -- 3. CHECK CONSTRAINTS EXIST — 2 rows ------------------------------------
  select 3, 'range_constraints', e.name::text,
         (case when k.conname is null then 'MISSING'
               else 'OK — ' || pg_get_constraintdef(k.oid)::text end)::text
    from (values ('hr_assignments_weekly_hours_range'), ('hr_assignments_fte_range')) as e(name)
    left join pg_constraint k on k.conname = e.name

  union all
  -- 4. INDEXES — 12 rows ---------------------------------------------------
  select 4, 'indexes', e.name::text,
         (case when i.indexname is null then 'MISSING'
               else 'OK — ' || i.tablename::text end)::text
    from (values
      ('hr_access_assign_employee_idx'), ('hr_access_assign_profile_idx'),
      ('hr_access_assign_active_unique'), ('hr_access_scope_assignment_idx'),
      ('hr_access_scope_unique'), ('hr_readiness_controls_active_idx'),
      ('hr_readiness_instances_employee_idx'), ('hr_readiness_work_employee_idx'),
      ('hr_readiness_work_due_idx'), ('hr_readiness_work_owner_idx'),
      ('hr_readiness_work_correlation_idx'), ('hr_readiness_transitions_item_idx')
    ) as e(name)
    left join pg_indexes i on i.schemaname = 'public' and i.indexname = e.name

  union all
  -- 5. UPDATED_AT TRIGGERS — 5 rows ----------------------------------------
  -- Triggers are collected FIRST, then joined to the expected list: joining
  -- pg_trigger directly would let a table that has other triggers but no
  -- set_updated_at trigger vanish instead of reporting MISSING.
  select 5, 'updated_at_triggers', e.name::text,
         coalesce(x.status, 'MISSING')::text
    from (values
      ('hr_employee_assignments'), ('hr_employee_access_assignments'),
      ('hr_readiness_controls'), ('hr_readiness_control_instances'),
      ('hr_readiness_work_items')
    ) as e(name)
    left join (
      select c.relname::text as relname,
             (case when t.tgenabled::text <> 'O'
                   then 'DISABLED — tgenabled=' || t.tgenabled::text
                   else 'OK — ' || t.tgname::text || ' -> ' || p.proname::text end)::text as status
        from pg_trigger t
        join pg_class c     on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join pg_proc p      on p.oid = t.tgfoid
       where not t.tgisinternal and p.proname = 'set_updated_at'
    ) x on x.relname = e.name

  union all
  -- 5b. NEGATIVE — append-only tables must have NO updated_at trigger ------
  select 6, 'append_only_clean', c.relname::text,
         ('UNEXPECTED TRIGGER — ' || t.tgname::text)::text
    from pg_trigger t
    join pg_class c     on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p      on p.oid = t.tgfoid
   where not t.tgisinternal and n.nspname = 'public'
     and p.proname = 'set_updated_at'
     and c.relname in ('hr_employee_access_scopes', 'hr_readiness_work_item_transitions')

  union all
  -- 6. ROW LEVEL SECURITY — 6 rows -----------------------------------------
  select 7, 'rls', e.name::text,
         (case when c.relname is null then 'MISSING TABLE'
               when c.relrowsecurity then 'OK'
               else 'RLS DISABLED' end)::text
    from (values
      ('hr_employee_access_assignments'), ('hr_employee_access_scopes'),
      ('hr_readiness_controls'), ('hr_readiness_control_instances'),
      ('hr_readiness_work_items'), ('hr_readiness_work_item_transitions')
    ) as e(name)
    left join (
      select c.relname::text as relname, c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    ) c on c.relname = e.name

  union all
  -- 7. SERVICE-ROLE GRANTS — 6 rows ----------------------------------------
  select 8, 'grants', e.name::text,
         coalesce('OK — ' || g.privileges, 'MISSING')::text
    from (values
      ('hr_employee_access_assignments'), ('hr_employee_access_scopes'),
      ('hr_readiness_controls'), ('hr_readiness_control_instances'),
      ('hr_readiness_work_items'), ('hr_readiness_work_item_transitions')
    ) as e(name)
    left join (
      select table_name::text as table_name,
             string_agg(privilege_type::text, ',' order by privilege_type::text) as privileges
        from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'service_role'
       group by table_name
    ) g on g.table_name = e.name

  union all
  -- 8. SEEDED CONTROLS — catalogue-safe existence check — 1 row ------------
  -- Deliberately does NOT select from hr_readiness_controls: that fails at
  -- PARSE time when the table is absent and would abort the whole statement.
  select 9, 'seed_controls', 'hr_readiness_controls'::text,
         (case when to_regclass('public.hr_readiness_controls') is null
               then 'MISSING TABLE — run the migration first'
               else 'OK — table present; confirm the 3 seeded keys with scripts/verify-hr-profile-foundations.mjs'
          end)::text

  union all
  -- 9. PERMISSION GRANTS — 5 rows ------------------------------------------
  select 10, 'role_permissions', e.permission::text,
         (case when coalesce(g.roles, '') = e.expected
               then 'OK — ' || e.expected
               else 'MISMATCH — expected [' || e.expected || '] got [' || coalesce(g.roles, 'none') || ']'
          end)::text
    from (values
      ('hr.employees.access_assignments.manage', 'admin,hr_manager'),
      ('hr.employees.access_assignments.view',   'admin,hr_manager,hr_staff'),
      ('hr.employees.readiness.follow_up',       'admin,hr_manager,hr_staff'),
      ('hr.employees.readiness.review',          'admin,hr_manager'),
      ('hr.employees.readiness.view',            'admin,hr_manager,hr_staff')
    ) as e(permission, expected)
    left join (
      select permission::text as permission,
             string_agg(role_name::text, ',' order by role_name::text) as roles
        from public.role_permissions
       group by permission
    ) g on g.permission = e.permission

  union all
  -- 10. NEGATIVE — no unexpected function was created ----------------------
  -- The migration defines NO functions. Anything here means the SQL editor
  -- rewrote the DO $$ block.
  select 11, 'unexpected_functions', p.proname::text,
         ('UNEXPECTED — security_definer=' || p.prosecdef::text)::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (
       p.proname like 'hr_readiness%'
       or p.proname like 'hr_employee_access%'
     )

  union all
  -- 11. CONSTRAINTS ARE VALIDATED, not merely present — 2 rows -------------
  select 12, 'constraint_enforced', e.name::text,
         (case when k.conname is null then 'MISSING'
               when k.convalidated then 'OK — validated'
               else 'NOT VALIDATED' end)::text
    from (values ('hr_assignments_fte_range'), ('hr_assignments_weekly_hours_range')) as e(name)
    left join pg_constraint k on k.conname = e.name
)
select seq, check_name, object_name, status from checks
union all
select 99, 'SUMMARY',
       (case when (select count(*) from checks where status not like 'OK%') = 0
             then 'ALL CHECKS PASSED' else 'FAILURES PRESENT' end)::text,
       ((select count(*) from checks where status not like 'OK%')::text
        || ' problem row(s) of ' || (select count(*) from checks)::text
        || ' — expected 48 check rows when fully applied')::text
 order by seq, check_name, object_name;
