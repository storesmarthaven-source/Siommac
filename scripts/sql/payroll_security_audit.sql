-- ═══════════════════════════════════════════════════════════════════════════
-- PAYROLL SECURITY / DATABASE RUNTIME AUDIT (certification §5) — read-only.
-- Run as postgres/service in the SQL editor; each statement returns one result
-- set. Paste the outputs into docs/module-contracts/PAYROLL_SECURITY_AUDIT.md.
-- Scope pattern: payroll-owned objects (finance_pay%/finance_payroll%/
-- finance_statutory%/hr_crew%/payroll%) + the payslip/report buckets.
-- ═══════════════════════════════════════════════════════════════════════════

-- 5.1 ── RLS enabled on every exposed payroll table (expect rls_enabled = true for ALL)
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and (c.relname like 'finance_pay%' or c.relname like 'finance_payroll%'
     or c.relname like 'finance_statutory%' or c.relname like 'hr_crew%'
     or c.relname like 'payroll%')
 order by rls_enabled, table_name;

-- 5.3 ── anon / authenticated table privileges (expect ZERO rows)
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
   and (table_name like 'finance_pay%' or table_name like 'finance_payroll%'
     or table_name like 'finance_statutory%' or table_name like 'hr_crew%'
     or table_name like 'payroll%')
 order by table_name, grantee;

-- 5.4 ── service_role table privileges (review: only what the server needs)
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'service_role'
   and (table_name like 'finance_pay%' or table_name like 'finance_payroll%'
     or table_name like 'finance_statutory%' or table_name like 'hr_crew%'
     or table_name like 'payroll%')
 group by table_name order by table_name;

-- 5.5/5.6 ── payroll functions: SECURITY DEFINER flag, search_path, and role EXECUTE.
-- Expect: prosecdef = false (INVOKER) unless documented; search_path pinned ('public');
-- has_public_execute / has_anon_execute / has_auth_execute ALL false; service_role true.
select p.proname,
       p.oid::regprocedure as signature,
       p.prosecdef as security_definer,
       coalesce((select string_agg(cfg, ',') from unnest(p.proconfig) cfg where cfg like 'search_path=%'), '(NOT SET)') as search_path,
       has_function_privilege('anon', p.oid, 'execute')           as anon_execute,
       has_function_privilege('authenticated', p.oid, 'execute')  as auth_execute,
       has_function_privilege('service_role', p.oid, 'execute')   as service_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proname like 'finance_payroll%' or p.proname like 'finance_record%'
     or p.proname like 'payroll%' or p.proname like 'finance_pay_policy%'
     or p.proname like 'work_calendar%')
 order by p.prosecdef desc, p.proname;

-- 5.7 ── storage buckets + object policies for payslips / statutory forms / reports.
-- Expect: private buckets; policies never grant cross-employee read.
select id, name, public from storage.buckets
 where id in ('payslips', 'statutory-forms', 'payroll-reports', 'bank-files') or name like '%payslip%' or name like '%payroll%';
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr
  from pg_policy where polrelid = 'storage.objects'::regclass
 order by polname;

-- 5.9 ── index inventory for the key mutation/list tables (review coverage of FKs,
-- state filters, idempotency keys, effective-date resolution, keyset pagination).
select tablename, indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and tablename in ('finance_payroll_runs','finance_payroll_run_inputs',
     'finance_payroll_run_lines','finance_payroll_calculation_versions',
     'finance_payroll_calculation_attempts','finance_payroll_input_snapshots',
     'finance_payroll_control_findings','finance_pay_policies',
     'finance_pay_policy_versions','finance_pay_group_policy_assignments',
     'hr_crew_assignments','hr_crew_movements','payroll_report_artifacts')
 order by tablename, indexname;

-- 5.10 ── EXPLAIN (ANALYZE, BUFFERS) templates for the heavy read paths.
-- Substitute a real pay-period / cursor before running; run ONE at a time.
-- (a) run register keyset page
--   explain (analyze, buffers)
--   select * from finance_payroll_runs
--    where status not in ('cancelled')
--    order by pay_date desc, id desc limit 25;
-- (b) findings work-queue union page
--   explain (analyze, buffers)
--   select * from finance_payroll_control_findings
--    where state in ('open','in_progress') order by severity, due_at nulls last, created_at limit 25;
-- (c) source-readiness timesheet overlap probe (P1-9 canonical semantics)
--   explain (analyze, buffers)
--   select id from hr_timesheets
--    where status = 'approved' and period_start <= '2026-07-31' and period_end >= '2026-07-01';
-- (d) report history keyset
--   explain (analyze, buffers)
--   select * from payroll_report_artifacts order by created_at desc, id desc limit 25;
-- (e) calculation support: run lines by version (1,100-employee run)
--   explain (analyze, buffers)
--   select employee_id, gross, net from finance_payroll_run_lines
--    where calculation_version_id = '<version-uuid>' order by id limit 1200;
