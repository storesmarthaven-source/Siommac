-- 20260919000430_finance_payroll_control_center_fn.sql
-- Payroll Command Center read model — ONE read-only, snapshot-consistent aggregation function.
-- Authority: docs/module-contracts/PAYROLL_COMMAND_CENTER_IMPLEMENTATION.md (approved) +
--            docs/module-contracts/PAYROLL_COMMAND_CENTER_CONTRACT_TO_CODE_MAP.md.
--
-- Requirements honored (per user restart directives + Codex review remediation):
--   * complete-dataset aggregation — NO row cap on KPIs/health/tab counts (only response DETAILS bounded);
--   * SECURITY INVOKER (runs with the caller's privileges — caller is service_role);
--   * fixed safe search_path; fully schema-qualified objects; NO dynamic SQL;
--   * typed cursor tuple parameters (no opaque blob parsed in SQL);
--   * REVOKE from PUBLIC/anon/authenticated; EXECUTE granted only to service_role.
--
-- Review fixes: openBlockerCount = blocker FINDINGS + separate blockerRunCount; criticalCount uses the
-- latest calculation ATTEMPT (run status is never 'calculation_failed'); the Ready tab requires cert +
-- funding confirmation + posted GL + bank-ready (not just approved+0-blockers); register jsonb_agg is
-- explicitly ordered; assignedToYou/primaryIntervention exclude inactive runs; deadlines keep overdue
-- dates even before window.from. The TS service composes the authoritative 7 readiness gates from ONE
-- finance_payroll_release_preflight() call for the selected next run.
--
-- 2026-07-18 fix: `latest_attempt_failed` used `att.status = 'failed'`, which is NULL (not false) for a
-- run with NO calculation attempt. That NULL poisoned the `criticalCount`/`atRiskCount`/`tab_attention`
-- boolean filters (`not (NULL or …)` → NULL → the row is silently NOT counted), so blocker runs never
-- landed in atRiskCount and the portfolio-health band read "on track" while the rail showed risk. Now
-- `att.status is not distinct from 'failed'` yields a proper boolean (false when there is no attempt).

-- Access-path indexes (validated with EXPLAIN ANALYZE). Per-run evidence (findings, funding, cert,
-- release, tasks, latest attempt, missing-bank) is gathered via LATERAL index lookups keyed by
-- run_id/workflow_id, so the plan is stable and linear under the generic (parameterized) plan used by
-- this language-sql function — no materialized-CTE nested loop (the prior O(n^2) failure mode). Do NOT
-- add force_custom_plan: the lateral structure makes the cached generic plan optimal, and per-call
-- replanning saturates CPU under concurrency.
--
-- Narrow/wide split (temp-spill control): the multiply-scanned `facts` CTE carries ONLY ids, effective
-- totals, status dates and evidence/tab booleans — NOT wide detail columns. The bounded register and
-- next-run paths re-fetch wide detail (pay_group name, run_type, updated_at, employer NIS, snapshot id)
-- from base tables AFTER keyset filtering + LIMIT, for their few rows only. Aggregate parity is exact.
--
-- Performance SLA (measured @ work_mem 2184kB, 2-vCPU shared dev). Realistic scale (dozens–hundreds of
-- runs per window): <100ms, ZERO temp blocks. The 10k-runs-in-ONE-window torture case (100–300x
-- realistic) is a DOCUMENTED CEILING — still correct + 0 timeouts under concurrency 5/10/20, but the
-- shared evidence set (~16–18 fact columns x 10k rows ~= 2.5–7MB) exceeds work_mem and spills, so direct
-- p95 ~500–800ms with minor temp I/O. Per SLA decision this is NOT fixed by raising work_mem; if
-- interactive 10k-per-window latency is ever required, move to an incremental command-center rollup.
--
-- These indexes back the lateral lookups; the certification composite is distinctly named to avoid
-- colliding with migration 420's finance_payroll_certifications_run_idx (run_id, certified_at desc).
create index if not exists finance_payroll_runs_pay_date_idx
  on public.finance_payroll_runs(pay_date);
create index if not exists finance_payroll_runs_period_window_idx
  on public.finance_payroll_runs(period_start, period_end)
  where pay_date is null;
create index if not exists finance_payroll_control_findings_run_idx
  on public.finance_payroll_control_findings(run_id, calculation_version_id);
create index if not exists finance_payroll_certifications_run_version_idx
  on public.finance_payroll_certifications(run_id, calculation_version_id);
create index if not exists finance_payroll_release_certificates_run_idx
  on public.finance_payroll_release_certificates(run_id);
create index if not exists finance_payroll_calc_attempts_run_idx
  on public.finance_payroll_calculation_attempts(run_id, attempt_no desc);
create index if not exists workflow_tasks_workflow_idx
  on public.workflow_tasks(workflow_id);

create or replace function public.finance_payroll_control_center(
  p_from             date,
  p_to               date,
  p_pay_group_ids    uuid[],
  p_actor_id         text,
  p_actor_role       text,
  p_tab              text,
  p_search           text,
  p_limit            integer,
  p_cursor_pay_date  date,
  p_cursor_period_end date,
  p_cursor_run_no    text,
  p_cursor_id        uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
with win as (
    -- Windowed base columns needed by the fact laterals + the bounded (workflow/finding) queries.
    -- Detail-only columns (pay_group name, snapshot id, gl journal id, updated_at, nis) are NOT carried
    -- here; the bounded register/nextRun paths re-fetch them from base tables for their few rows.
    select
      r.id, r.run_no, r.run_type, r.status,
      r.period_start, r.period_end, r.pay_date, r.cut_off_date,
      r.workflow_id, r.current_calculation_version_id,
      coalesce(cv.employee_count, r.employee_count) as eff_emp,
      coalesce(cv.gross_total,    r.gross_total)    as eff_gross,
      coalesce(cv.net_total,      r.net_total)      as eff_net,
      (r.gl_journal_id is not null) as gl_posted,
      (p_search is null
        or r.run_no ilike '%' || p_search || '%'
        or coalesce(r.pay_group, '') ilike '%' || p_search || '%') as match_search
    from public.finance_payroll_runs r
    left join public.finance_payroll_calculation_versions cv
      on cv.id = r.current_calculation_version_id
    where (
        (r.pay_date is not null and r.pay_date between p_from and p_to)
        or (r.pay_date is null and r.period_start <= p_to and r.period_end >= p_from)
      )
      and (
        p_pay_group_ids is null or cardinality(p_pay_group_ids) = 0
        or r.pay_group_id = any (p_pay_group_ids)
      )
  ),
  facts as (
    -- NARROW per-run facts: the single multiply-scanned set. Only ids, effective totals, status dates,
    -- and the evidence + tab booleans — no wide detail columns — so it fits work_mem (no temp spill).
    select
      w.id, w.run_no, w.run_type, w.status,
      w.period_start, w.period_end, w.pay_date, w.cut_off_date,
      w.workflow_id, w.current_calculation_version_id,
      w.eff_emp, w.eff_gross, w.eff_net,
      coalesce(fnd.blockers, 0) as blockers,
      coalesce(fnd.warnings, 0) as warnings,
      fund.confirmed_amount     as funded,
      (fund.run_id is not null)  as funding_confirmed,
      (cert.hit is not null)     as certified,
      (rel.hit is not null)      as release_evidence,
      coalesce(tsk.open_tasks, 0) as open_tasks,
      coalesce(tsk.any_overdue, false) as task_overdue,
      (att.status is not distinct from 'failed') as latest_attempt_failed,
      coalesce(bank.missing, 0)  as missing_bank,
      w.gl_posted,
      w.match_search,
      (w.status not in ('released', 'exported', 'cancelled')) as is_active,
      (w.current_calculation_version_id is not null and coalesce(w.pay_date, w.cut_off_date) is not null
        and coalesce(w.pay_date, w.cut_off_date) between current_date and (current_date + 3)) as due_soon,
      (w.eff_net > 0 and w.status not in ('released', 'exported', 'cancelled')
        and w.current_calculation_version_id is not null) as fundable,
      (w.status <> 'cancelled') as tab_all,
      (w.status <> 'cancelled' and (coalesce(fnd.blockers, 0) > 0 or (att.status is not distinct from 'failed')
        or w.status = 'returned' or coalesce(tsk.any_overdue, false))) as tab_attention,
      (w.status = 'pending_approval' or coalesce(tsk.open_tasks, 0) > 0) as tab_approval,
      (w.status in ('approved', 'locked') and coalesce(fnd.blockers, 0) = 0 and w.current_calculation_version_id is not null
        and (cert.hit is not null) and (fund.run_id is not null) and w.gl_posted and coalesce(bank.missing, 0) = 0) as tab_ready,
      (w.status in ('released', 'exported') or (rel.hit is not null)) as tab_released
    from win w
    left join lateral (
      select count(*) filter (where f.severity = 'blocker') as blockers,
             count(*) filter (where f.severity = 'warning') as warnings
      from public.finance_payroll_control_findings f
      where f.run_id = w.id and f.calculation_version_id = w.current_calculation_version_id
        and f.state in ('open', 'in_progress')
    ) fnd on true
    left join lateral (
      select fc.confirmed_amount, fc.run_id
      from public.finance_payroll_funding_confirmations fc
      where fc.run_id = w.id and fc.calculation_version_id = w.current_calculation_version_id
      order by fc.confirmation_no desc
      limit 1
    ) fund on true
    left join lateral (
      select 1 as hit from public.finance_payroll_certifications c
      where c.run_id = w.id and c.calculation_version_id = w.current_calculation_version_id
      limit 1
    ) cert on true
    left join lateral (
      select 1 as hit from public.finance_payroll_release_certificates rc
      where rc.run_id = w.id
      limit 1
    ) rel on true
    left join lateral (
      select count(*) as open_tasks,
             bool_or(t.due_at is not null and (t.due_at)::date < current_date) as any_overdue
      from public.workflow_tasks t
      where t.workflow_id = w.workflow_id and t.status in ('open', 'pending', 'in_progress')
    ) tsk on true
    left join lateral (
      select a.status from public.finance_payroll_calculation_attempts a
      where a.run_id = w.id order by a.attempt_no desc limit 1
    ) att on true
    left join lateral (
      select count(*) as missing
      from public.finance_payroll_calculation_version_lines l
      left join public.finance_employee_bank_accounts b on b.employee_id = l.employee_id and b.is_active
      where l.run_id = w.id and l.calculation_version_id = w.current_calculation_version_id
        and l.net > 0 and b.employee_id is null
    ) bank on true
  ),
  agg as (
    select
      count(*) filter (where is_active) as active_runs,
      coalesce(sum(eff_emp)   filter (where is_active), 0) as employees_due,
      coalesce(sum(eff_gross) filter (where is_active), 0) as gross,
      coalesce(sum(eff_net)   filter (where is_active), 0) as net,
      coalesce(sum(eff_net)   filter (where fundable), 0) as funding_required,
      coalesce(sum(coalesce(funded, 0)) filter (where fundable), 0) as funding_confirmed,
      coalesce(sum(blockers) filter (where is_active), 0) as open_blocker_count,
      count(*) filter (where is_active and blockers > 0) as blocker_run_count,
      count(*) filter (where is_active and (latest_attempt_failed or (blockers > 0 and due_soon))) as critical_count,
      count(*) filter (where is_active and blockers > 0 and not (latest_attempt_failed or (blockers > 0 and due_soon))) as at_risk_count,
      coalesce(bool_or(fundable and due_soon and coalesce(funded, 0) < eff_net), false) as near_due_unfunded,
      count(*) filter (where tab_all       and match_search) as tab_all_c,
      count(*) filter (where tab_attention and match_search) as tab_attention_c,
      count(*) filter (where tab_approval  and match_search) as tab_approval_c,
      count(*) filter (where tab_ready     and match_search) as tab_ready_c,
      count(*) filter (where tab_released  and match_search) as tab_released_c
    from facts
  )
  select jsonb_build_object(

    'kpis', (
      select jsonb_build_object(
        'activeRuns',       a.active_runs,
        'employeesDue',     a.employees_due,
        'gross',            a.gross,
        'net',              a.net,
        'fundingRequired',  a.funding_required,
        'fundingConfirmed', a.funding_confirmed,
        'nextPayDate', (
          select jsonb_build_object('date', to_char(f2.pay_date, 'YYYY-MM-DD'), 'runId', f2.id, 'runNo', f2.run_no)
          from facts f2
          where f2.is_active and f2.pay_date is not null and f2.pay_date >= current_date
          order by f2.pay_date asc, f2.period_start asc, f2.id asc
          limit 1
        )
      )
      from agg a
    ),

    'health', (
      select jsonb_build_object(
        'openBlockerCount',   a.open_blocker_count,
        'blockerRunCount',    a.blocker_run_count,
        'criticalCount',      a.critical_count,
        'atRiskCount',        a.at_risk_count,
        'nearDueUnfunded',    a.near_due_unfunded,
        'overdueActionCount', (
          select count(*)
          from public.workflow_tasks t
          join win w on w.workflow_id = t.workflow_id
          where t.status in ('open', 'pending', 'in_progress')
            and t.due_at is not null and (t.due_at)::date < current_date
            and (t.assigned_to = p_actor_id or (p_actor_role is not null and t.assigned_role = p_actor_role))
        )
      )
      from agg a
    ),

    'primaryIntervention', (
      select to_jsonb(x) - 'prio' - 'sort_due'
      from (
        select * from (
          select 1 as prio, 'approval'::text as kind,
                 coalesce(t.step_name, 'Overdue Payroll Approval') as title,
                 w.run_no || ' approval is overdue' as detail,
                 w.id as "runId", t.id::text as "targetId",
                 to_char(t.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "dueAt",
                 t.due_at as sort_due
          from public.workflow_tasks t
          join win w on w.workflow_id = t.workflow_id
          where t.status in ('open', 'pending', 'in_progress')
            and w.status not in ('released', 'exported', 'cancelled')
            and t.due_at is not null and (t.due_at)::date < current_date
            and (t.assigned_to = p_actor_id or (p_actor_role is not null and t.assigned_role = p_actor_role))
          union all
          select 2, 'finding', f.title, w.run_no || ' · ' || f.domain, w.id, f.id::text,
                 case when f.due_at is null then null else to_char(f.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
                 f.due_at
          from public.finance_payroll_control_findings f
          join win w on w.id = f.run_id and w.current_calculation_version_id = f.calculation_version_id
          where f.severity = 'blocker' and f.state in ('open', 'in_progress')
            and w.status not in ('released', 'exported', 'cancelled')
          union all
          select 3, 'funding', 'Confirm Payroll Funding', w.run_no || ' funding is unconfirmed', w.id, w.id::text,
                 case when coalesce(w.pay_date, w.cut_off_date) is null then null
                      else to_char(coalesce(w.pay_date, w.cut_off_date), 'YYYY-MM-DD') end,
                 coalesce(w.pay_date, w.cut_off_date)::timestamptz
          from facts w
          where w.fundable and w.due_soon and coalesce(w.funded, 0) < w.eff_net
        ) cand
        order by cand.prio asc, (cand.sort_due is not null) desc, cand.sort_due asc, cand."runId" asc, cand."targetId" asc
        limit 1
      ) x
    ),

    'tabCounts', (
      select jsonb_build_object(
        'all',       a.tab_all_c,
        'attention', a.tab_attention_c,
        'approval',  a.tab_approval_c,
        'ready',     a.tab_ready_c,
        'released',  a.tab_released_c
      )
      from agg a
    ),

    'register', (
      with reg_all as (
        select f.id, f.run_no, f.run_type, f.status, f.period_start, f.period_end, f.pay_date,
               f.eff_emp, f.eff_gross, f.eff_net, f.blockers, f.warnings
        from facts f
        where f.match_search
          and (case p_tab
                 when 'attention' then f.tab_attention
                 when 'approval'  then f.tab_approval
                 when 'ready'     then f.tab_ready
                 when 'released'  then f.tab_released
                 else f.tab_all
               end)
      ),
      reg_page as (
        select f.* from reg_all f
        where (
          p_cursor_id is null
          or (coalesce(f.pay_date, '-infinity'::date), f.period_end, f.run_no, f.id)
             < (coalesce(p_cursor_pay_date, '-infinity'::date), p_cursor_period_end, p_cursor_run_no, p_cursor_id)
        )
        order by coalesce(f.pay_date, '-infinity'::date) desc, f.period_end desc, f.run_no desc, f.id desc
        limit p_limit + 1
      ),
      reg_items as (
        select * from reg_page
        order by coalesce(pay_date, '-infinity'::date) desc, period_end desc, run_no desc, id desc
        limit p_limit
      )
      select jsonb_build_object(
        'total', (select count(*) from reg_all),
        'items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', i.id, 'runNo', i.run_no, 'runType', i.run_type,
              'payGroupId', r.pay_group_id, 'payGroupName', r.pay_group,
              'periodStart', to_char(i.period_start, 'YYYY-MM-DD'),
              'periodEnd', to_char(i.period_end, 'YYYY-MM-DD'),
              'payDate', to_char(i.pay_date, 'YYYY-MM-DD'),
              'employeeCount', i.eff_emp, 'gross', i.eff_gross, 'net', i.eff_net,
              'status', i.status, 'blockerCount', i.blockers, 'warningCount', i.warnings,
              'updatedAt', to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            )
            order by coalesce(i.pay_date, '-infinity'::date) desc, i.period_end desc, i.run_no desc, i.id desc
          )
          from reg_items i
          join public.finance_payroll_runs r on r.id = i.id
        ), '[]'::jsonb),
        'nextCursor', (
          case when (select count(*) from reg_page) > p_limit then (
            select jsonb_build_object(
              'payDate', to_char(i.pay_date, 'YYYY-MM-DD'),
              'periodEnd', to_char(i.period_end, 'YYYY-MM-DD'),
              'runNo', i.run_no, 'id', i.id)
            from reg_items i
            order by coalesce(i.pay_date, '-infinity'::date) asc, i.period_end asc, i.run_no asc, i.id asc
            limit 1
          ) else null end
        )
      )
    ),

    'assignedToYou', (
      select jsonb_build_object(
        'taskId', t.id, 'workflowId', t.workflow_id, 'runId', w.id, 'runNo', w.run_no,
        'title', coalesce(t.step_name, 'Review Payroll Approval'),
        'dueAt', case when t.due_at is null then null else to_char(t.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
        'assigneeId', u.id, 'assigneeName', u.full_name,
        'assigneePhoto', coalesce(u.profile_image_thumb_url, u.profile_image_url)
      )
      from public.workflow_tasks t
      join win w on w.workflow_id = t.workflow_id
      left join public.app_users u on u.id = p_actor_id
      where t.status in ('open', 'pending', 'in_progress')
        and w.status not in ('released', 'exported', 'cancelled')
        and (t.assigned_to = p_actor_id or (p_actor_role is not null and t.assigned_role = p_actor_role))
      order by (t.due_at is not null) desc, t.due_at asc nulls last, t.created_at asc, t.id asc
      limit 1
    ),

    'deadlines', coalesce((
      select jsonb_agg(d order by (d.due_date < current_date) desc, d.due_date asc, d.run_id asc, d.id asc)
      from (
        select * from (
          select 'cutoff-' || w.id::text as id, 'cutoff'::text as kind, w.id as run_id, w.run_no,
                 'Input Cutoff'::text as title, w.cut_off_date as due_date
          from facts w
          where w.is_active and w.cut_off_date is not null and (w.cut_off_date >= p_from or w.cut_off_date < current_date)
          union all
          select 'paydate-' || w.id::text, 'pay_date', w.id, w.run_no, 'Pay Date', w.pay_date
          from facts w
          where w.is_active and w.pay_date is not null and (w.pay_date >= p_from or w.pay_date < current_date)
          union all
          select 'task-' || t.id::text, 'approval', w.id, w.run_no, coalesce(t.step_name, 'Approval Due'), (t.due_at)::date
          from public.workflow_tasks t join facts w on w.workflow_id = t.workflow_id
          where w.is_active and t.status in ('open','pending','in_progress')
            and t.due_at is not null and ((t.due_at)::date >= p_from or (t.due_at)::date < current_date)
          union all
          select 'finding-' || f.id::text,
                 case when f.domain = 'release' then 'release' else 'funding' end,
                 w.id, w.run_no, f.title, (f.due_at)::date
          from public.finance_payroll_control_findings f
          join facts w on w.id = f.run_id and w.current_calculation_version_id = f.calculation_version_id
          where w.is_active and f.state in ('open','in_progress') and f.domain in ('funding','release')
            and f.due_at is not null and ((f.due_at)::date >= p_from or (f.due_at)::date < current_date)
        ) u
        order by (u.due_date < current_date) desc, u.due_date asc, u.run_id asc, u.id asc
        limit 5
      ) d
    ), '[]'::jsonb),

    'activity', coalesce((
      select jsonb_agg(a order by a.occurred_at desc, a.event_id desc)
      from (
        select ae.id as event_id, ae.event_type,
          to_char(ae.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as occurred_at,
          r.id as run_id, r.run_no,
          au.id as actor_id, au.full_name as actor_name,
          coalesce(au.profile_image_thumb_url, au.profile_image_url) as actor_photo
        from public.app_events ae
        left join public.finance_payroll_runs r on r.id::text = ae.source_entity_id::text
        left join public.app_users au on au.id = ae.actor_user_id
        where ae.source_module = 'finance_payroll'
          and ae.event_type in (
            'finance.payroll.run.certified', 'finance.payroll.run.calculated',
            'finance.payroll.run.funding_confirmed', 'finance.payroll.run.released',
            'finance.payroll.run.submitted', 'finance.payroll.run.approved',
            'finance.payroll.run.rejected', 'finance.payroll.run.reopened',
            'finance.payroll.run.locked'
          )
        order by ae.created_at desc, ae.id desc
        limit 3
      ) a
    ), '[]'::jsonb),

    'nextRun', (
      select jsonb_build_object(
        'id', n.id, 'runNo', n.run_no, 'runType', n.run_type,
        'payGroupId', r.pay_group_id, 'payGroupName', r.pay_group,
        'periodStart', to_char(n.period_start, 'YYYY-MM-DD'),
        'periodEnd', to_char(n.period_end, 'YYYY-MM-DD'),
        'payDate', to_char(n.pay_date, 'YYYY-MM-DD'),
        'employeeCount', n.eff_emp, 'gross', n.eff_gross, 'net', n.eff_net,
        'employerNis', coalesce(cv.nis_employer_total, r.nis_employer_total), 'status', n.status,
        'blockerCount', n.blockers, 'warningCount', n.warnings,
        'certified', n.certified, 'fundingConfirmed', n.funding_confirmed, 'funded', coalesce(n.funded, 0),
        'currentCalcVersionId', n.current_calculation_version_id,
        'inputSnapshotId', r.current_input_snapshot_id,
        'updatedAt', to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      )
      from facts n
      join public.finance_payroll_runs r on r.id = n.id
      left join public.finance_payroll_calculation_versions cv on cv.id = n.current_calculation_version_id
      where n.run_type = 'scheduled' and n.status not in ('released', 'exported', 'cancelled')
        and n.pay_date is not null and n.pay_date >= p_from
      order by n.pay_date asc, n.period_start asc, n.id asc
      limit 1
    )
  )
$$;

comment on function public.finance_payroll_control_center(date, date, uuid[], text, text, text, text, integer, date, date, text, uuid)
  is 'Payroll Command Center read model: one snapshot-consistent aggregation over the complete filtered run set (KPIs, health inputs, tab counts, keyset register page, assigned task, deadlines, safe activity, next-run identity+evidence). Read-only; the TS service adds capabilities, one release preflight and authoritative readiness composition.';

revoke all on function public.finance_payroll_control_center(date, date, uuid[], text, text, text, text, integer, date, date, text, uuid) from public;
revoke all on function public.finance_payroll_control_center(date, date, uuid[], text, text, text, text, integer, date, date, text, uuid) from anon;
revoke all on function public.finance_payroll_control_center(date, date, uuid[], text, text, text, text, integer, date, date, text, uuid) from authenticated;
grant execute on function public.finance_payroll_control_center(date, date, uuid[], text, text, text, text, integer, date, date, text, uuid) to service_role;
