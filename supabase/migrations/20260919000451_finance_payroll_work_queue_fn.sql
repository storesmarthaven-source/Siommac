-- ============================================================================
-- Payroll Exceptions & Approvals (§15.3) — work-queue read model.
-- ONE ordered, cursorable stream unioning payroll control findings + open payroll
-- approval workflow-tasks. Strict keyset pagination (§15.2 — no unbounded select,
-- no in-TS merge). The route calls this function; it never joins the two sources
-- in TypeScript.
--
-- Ordering (all ASCending so keyset is a clean row-value comparison):
--   severity_rank ASC  (critical=0, high=1, medium=2, low=3)
--   neg_micros    ASC  (= -epoch_microseconds → newest first within a severity)
--   id            ASC  (deterministic tiebreak; findings uuid or 'task:'<uuid>)
-- Cursor is the opaque "severity_rank|neg_micros|id" of the last returned row.
--
-- Severity/kind mapping (DEC-EXC-008): blocker→kind blocker/sev critical;
-- warning→warning/medium; info→warning/low; approval task→approval/high.
-- ============================================================================
create or replace function public.finance_payroll_findings_work_queue(
  p_limit       integer default 25,
  p_cursor      text    default null,
  p_tab         text    default 'all',
  p_kinds       text[]  default null,
  p_severities  text[]  default null,
  p_states      text[]  default null,
  p_run_ids     uuid[]  default null,
  p_owner_id    text    default null,
  p_search      text    default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_limit    integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_search   text    := nullif(btrim(coalesce(p_search, '')), '');
  v_parts    text[];
  v_cur_sev  integer;
  v_cur_neg  bigint;
  v_cur_id   text;
  v_result   jsonb;
begin
  if p_tab is not null and p_tab not in ('all','approvals','blockers','warnings','resolved') then
    raise exception 'work_queue: unknown tab %', p_tab using errcode = 'PR422';
  end if;

  if p_cursor is not null and btrim(p_cursor) <> '' then
    v_parts := string_to_array(p_cursor, '|');
    if array_length(v_parts, 1) <> 3 then
      raise exception 'work_queue: malformed cursor' using errcode = 'PR422';
    end if;
    begin
      v_cur_sev := v_parts[1]::integer;
      v_cur_neg := v_parts[2]::bigint;
      v_cur_id  := v_parts[3];
    exception when others then
      raise exception 'work_queue: malformed cursor' using errcode = 'PR422';
    end;
  end if;

  with base as (
    -- payroll control findings
    select
      f.id::text                                                         as id,
      case f.severity when 'blocker' then 'blocker' else 'warning' end   as kind,
      case f.severity when 'blocker' then 'critical'
                      when 'warning' then 'medium' else 'low' end        as severity,
      f.state::text                                                      as state,
      f.version                                                          as version,
      f.run_id                                                           as run_id,
      f.title                                                            as title,
      f.detail                                                           as summary,
      f.assignee_id                                                      as owner_id,
      f.due_at                                                           as due_at,
      null::numeric                                                      as impact_amount,
      null::integer                                                      as impact_employees,
      null::text                                                         as workflow_task_id,
      f.created_at                                                       as created_at,
      lower(coalesce(f.title, '') || ' ' || coalesce(f.detail, ''))      as search_text,
      (case f.severity when 'blocker' then 0 when 'warning' then 2 else 3 end) as severity_rank
    from public.finance_payroll_control_findings f
    union all
    -- open payroll approval workflow-tasks (review-only; decisions stay in the workflow engine)
    select
      'task:' || t.id::text,
      'approval', 'high', 'pending_approval', 0,
      r0.id,
      coalesce(nullif(btrim(t.task_title), ''), 'Approval required'),
      'Payroll run pending an approval decision',
      t.assigned_to,
      t.due_at,
      r0.net_total,
      r0.employee_count,
      t.id::text,
      t.created_at,
      lower(coalesce(t.task_title, '') || ' approval'),
      1
    from public.workflow_tasks t
    join public.workflow_instances wi on wi.id = t.workflow_id
    join public.finance_payroll_runs r0 on r0.id::text = wi.source_record_id
    where t.step_type = 'approval'
      and t.status in ('open', 'in_progress')
      and wi.module_key = 'finance_payroll'
      and wi.source_record_id is not null
  ),
  scoped as (
    -- everything EXCEPT the tab filter (so tabCounts reflect the same scope)
    select
      b.*,
      r.run_no  as run_reference,
      r.pay_date as run_pay_date,
      ou.first_name, ou.last_name, ou.username,
      (-(extract(epoch from b.created_at) * 1000000)::bigint) as neg_micros
    from base b
    join public.finance_payroll_runs r on r.id = b.run_id
    left join public.app_users ou on ou.id = b.owner_id
    where (p_kinds      is null or b.kind     = any(p_kinds))
      and (p_severities is null or b.severity = any(p_severities))
      and (p_states     is null or b.state    = any(p_states))
      and (p_run_ids    is null or b.run_id   = any(p_run_ids))
      and (p_owner_id   is null or b.owner_id  = p_owner_id)
      and (v_search     is null
           or b.search_text  like '%' || lower(v_search) || '%'
           or lower(r.run_no) like '%' || lower(v_search) || '%')
  ),
  tabbed as (
    select * from scoped s
    where p_tab is null or p_tab = 'all'
       or (p_tab = 'approvals' and s.kind = 'approval')
       or (p_tab = 'blockers'  and s.kind = 'blocker')
       or (p_tab = 'warnings'  and s.kind = 'warning')
       or (p_tab = 'resolved'  and s.state in ('resolved', 'waived'))
  ),
  page as (
    select * from tabbed s
    where p_cursor is null or btrim(p_cursor) = ''
       or (s.severity_rank, s.neg_micros, s.id) > (v_cur_sev, v_cur_neg, v_cur_id)
    order by s.severity_rank, s.neg_micros, s.id
    limit v_limit + 1
  ),
  windowed as (
    select * from page order by severity_rank, neg_micros, id limit v_limit
  ),
  items as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'kind', kind,
        'severity', severity,
        'state', state,
        'version', version,
        'run', jsonb_build_object('id', run_id, 'reference', run_reference, 'payDate', run_pay_date),
        'title', title,
        'summary', summary,
        'owner', case when owner_id is null then null else jsonb_build_object(
          'type', 'user', 'id', owner_id,
          'displayName', coalesce(
            nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
            username, owner_id)
        ) end,
        'dueAt', due_at,
        'impact', jsonb_build_object(
          'currency', 'TTD',
          'amount', impact_amount,
          'employeeCount', impact_employees,
          'label', case when kind = 'approval' then 'Run net pay' else null end
        ),
        'allowedActions', case
          when kind = 'approval'              then jsonb_build_array('review')
          when state in ('resolved', 'waived') then jsonb_build_array('review', 'comment', 'reopen')
          when severity = 'critical'          then jsonb_build_array('review', 'assign', 'escalate', 'comment', 'resolve')
          else                                     jsonb_build_array('review', 'assign', 'escalate', 'comment', 'resolve', 'waive')
        end,
        'workflowTaskId', workflow_task_id
      )
      order by severity_rank, neg_micros, id
    ), '[]'::jsonb) as items
    from windowed
  ),
  next_cursor as (
    select case when (select count(*) from page) > v_limit
      then (
        select w.severity_rank || '|' || w.neg_micros || '|' || w.id
        from windowed w
        order by w.severity_rank desc, w.neg_micros desc, w.id desc
        limit 1
      )
      else null end as nc
  ),
  counts as (
    select jsonb_build_object(
      'all',       count(*),
      'approvals', count(*) filter (where kind = 'approval'),
      'blockers',  count(*) filter (where kind = 'blocker'),
      'warnings',  count(*) filter (where kind = 'warning'),
      'resolved',  count(*) filter (where state in ('resolved', 'waived'))
    ) as tab_counts
    from scoped
  )
  select jsonb_build_object(
    'items',      (select items from items),
    'nextCursor', (select nc from next_cursor),
    'total',      (select count(*) from tabbed),
    'tabCounts',  (select tab_counts from counts),
    'asOf',       now()
  )
  into v_result;

  return v_result;
end
$fn$;

revoke all on function public.finance_payroll_findings_work_queue(
  integer, text, text, text[], text[], text[], uuid[], text, text
) from public, anon, authenticated;
grant execute on function public.finance_payroll_findings_work_queue(
  integer, text, text, text[], text[], text[], uuid[], text, text
) to service_role;

-- PostgREST schema cache is refreshed by the operator after migration apply.
