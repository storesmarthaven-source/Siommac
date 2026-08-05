-- Migration: 20260930000003_hr_onboarding_work_queue_rpc.sql
--
-- The unified Onboarding Work Queue read model: ONE locked-down RPC that UNION ALLs the
-- four existing stores into a normalised executable-work projection.
--
--   hr_onboarding_tasks         -> source_type 'task'
--   hr_onboarding_handoffs      -> source_type 'handoff'
--   hr_onboarding_blockers      -> source_type 'blocker'
--   hr_onboarding_task_evidence -> source_type 'evidence'   (pending review = actionable)
--
-- No new work table is created. Each store stays authoritative; this is a read projection.
--
-- WHY AN RPC AND NOT JAVASCRIPT
-- Assembling the union in Node would mean fetching every store, merging, then slicing —
-- which makes `total`, search and every filter approximate the moment the result exceeds
-- the fetch window. That is the exact defect being fixed in the case-list endpoint. Here
-- filtering, ordering, LIMIT/OFFSET and the exact count all execute in Postgres, so the
-- reported total is a real count and page N is correct.
--
-- AUTHORIZATION — THIS FUNCTION DOES NOT AUTHORIZE
-- Scope stays in the TypeScript resolver (netlify/functions/lib/hr/onboardingScope.ts),
-- which remains the single authorization authority. The resolver's decision arrives as
-- p_case_ids:
--     NULL       -> authorized and unconstrained ('all')
--     '{}'       -> authorized but no visible cases -> zero rows (never "everything")
--     '{...}'    -> exactly these cases
-- The distinction between NULL and '{}' is load-bearing. Duplicating scope logic in SQL
-- would create a second authorization path that could drift from the resolver.
--
-- SECURITY INVOKER, not DEFINER: the backend calls this with the service-role key, which
-- already bypasses RLS. A DEFINER function would add privilege escalation for no benefit.
-- EXECUTE is revoked from PUBLIC/anon/authenticated at the bottom of this file, because a
-- newly created Postgres function is executable by PUBLIC by default — a PostgREST-exposed
-- function would otherwise be callable straight from the browser with an anon key.
--
-- PENDING OPERATOR ACTION — never self-apply.

drop function if exists public.hr_onboarding_work_queue(
  uuid[], text[], text[], text, text[], text[], text[], boolean, text, text, text, int, int, timestamptz);

create or replace function public.hr_onboarding_work_queue(
  p_case_ids         uuid[]      default null,   -- NULL = unconstrained, '{}' = none
  p_source_types     text[]      default null,   -- work type: task|handoff|blocker|evidence
  p_lifecycles       text[]      default null,   -- normalised: open|in_progress|blocked|done|cancelled
  p_due_state        text        default 'all',  -- all|overdue|due_today|due_this_week|unscheduled
  p_department_ids   text[]      default null,   -- subject's org unit (app_users.department_id)
  p_queues           text[]      default null,   -- owning queue: module/role that performs the work
  p_accountable_ids  text[]      default null,   -- accountable person
  p_unassigned       boolean     default false,  -- accountable person is NULL
  p_search           text        default null,
  p_sort             text        default 'due_at',
  p_sort_dir         text        default 'asc',
  p_page             int         default 1,
  p_page_size        int         default 25,
  p_now              timestamptz default now()
)
returns table (
  source_type        text,
  source_id          uuid,
  case_id            uuid,
  case_no            text,
  employee_id        text,
  employee_name      text,
  department_id      text,
  site_id            text,
  title              text,
  detail             text,
  owning_queue       text,
  accountable_id     text,
  source_status      text,
  normalized_status  text,
  due_at             timestamptz,
  severity           text,
  is_blocking        boolean,
  related_task_id    uuid,
  related_handoff_id uuid,
  created_at         timestamptz,
  total_count        bigint
)
language sql
stable
parallel safe
security invoker
set search_path = public, pg_temp
as $$
with params as (
  select
    greatest(1, coalesce(p_page, 1))                       as page,
    least(200, greatest(1, coalesce(p_page_size, 25)))     as page_size,
    lower(coalesce(p_due_state, 'all'))                    as due_state,
    lower(coalesce(p_sort, 'due_at'))                      as sort_key,
    case when lower(coalesce(p_sort_dir, 'asc')) = 'desc' then 'desc' else 'asc' end as sort_dir,
    nullif(btrim(coalesce(p_search, '')), '')              as search,
    coalesce(p_now, now())                                 as ref_now
),
-- ── the union: one row per executable item ────────────────────────────────────────
-- Lifecycle normalisation is defined HERE and only here. The three stores use three
-- different status vocabularies (7 / 8 / 6 values) with overlapping meanings, so one
-- Status filter control is only possible against a single normalised mapping.
base as (
  select
    'task'::text                                  as source_type,
    t.id                                          as source_id,
    t.case_id,
    t.task_title                                  as title,
    t.task_key                                    as detail,
    coalesce(t.module_key, t.owner_role)          as owning_queue,
    t.assigned_to                                 as accountable_id,
    t.status                                      as source_status,
    case t.status
      when 'pending'     then 'open'
      when 'open'        then 'open'
      when 'in_progress' then 'in_progress'
      when 'blocked'     then 'blocked'
      when 'completed'   then 'done'
      else 'cancelled'                            -- skipped | cancelled
    end                                           as normalized_status,
    t.due_at,
    t.priority                                    as severity,
    t.is_blocking,
    t.id                                          as related_task_id,
    null::uuid                                    as related_handoff_id,
    t.created_at
  from public.hr_onboarding_tasks t

  union all

  select
    'handoff',
    h.id,
    h.case_id,
    coalesce(h.handoff_type, h.handoff_key, h.target_module),
    h.target_module,
    h.target_module,                              -- the receiving team IS the owning queue
    h.owner_id,
    h.status,
    case h.status
      when 'pending'   then 'open'
      when 'sent'      then 'open'
      when 'accepted'  then 'in_progress'
      when 'blocked'   then 'blocked'
      when 'failed'    then 'blocked'
      when 'delivered' then 'done'
      when 'completed' then 'done'
      else 'cancelled'
    end,
    h.due_at,
    null::text,
    (h.status in ('blocked', 'failed')),
    null::uuid,
    h.id,
    h.created_at
  from public.hr_onboarding_handoffs h

  union all

  select
    'blocker',
    b.id,
    b.case_id,
    b.blocker_title,
    b.blocker_key,
    b.blocking_module,
    b.owner_id,
    b.status,
    case b.status
      when 'active'           then 'open'
      when 'acknowledged'     then 'in_progress'
      when 'waiting_on_owner' then 'in_progress'
      when 'escalated'        then 'blocked'
      else 'done'                                 -- resolved | waived
    end,
    b.due_at,
    b.severity,
    true,                                         -- a blocker is blocking by definition
    b.task_id,
    b.handoff_id,
    b.created_at
  from public.hr_onboarding_blockers b

  union all

  -- Evidence is an ARTIFACT, but a submission awaiting review is executable work for the
  -- reviewer, so it appears as its own row linked back to the authoritative task.
  -- 'returned' is normalised to 'blocked': it cannot progress until the worker resubmits.
  select
    'evidence',
    ev.id,
    ev.case_id,
    coalesce(ev.file_name, 'Legacy evidence'),
    t2.task_title,
    coalesce(t2.module_key, t2.owner_role),
    t2.assigned_to,
    ev.review_status,
    case ev.review_status
      when 'pending_review' then 'open'
      when 'approved'       then 'done'
      else 'blocked'                              -- returned
    end,
    t2.due_at,                                    -- evidence inherits its task's due date
    null::text,
    false,
    ev.task_id,
    null::uuid,
    ev.submitted_at
  from public.hr_onboarding_task_evidence ev
  join public.hr_onboarding_tasks t2 on t2.id = ev.task_id
),
-- ── enrich with case + subject, then filter ──────────────────────────────────────
enriched as (
  select
    b.*,
    c.case_no,
    c.employee_id,
    u.full_name    as employee_name,
    u.department_id,
    u.site_id
  from base b
  join public.hr_onboarding_cases c on c.id = b.case_id
  left join public.app_users u on u.id = c.employee_id
),
filtered as (
  select e.*
  from enriched e, params p
  where
    -- Scope, straight from the TypeScript resolver. NULL = unconstrained; '{}' = none.
    (p_case_ids is null or e.case_id = any (p_case_ids))
    and (p_source_types    is null or e.source_type       = any (p_source_types))
    and (p_lifecycles      is null or e.normalized_status = any (p_lifecycles))
    and (p_department_ids  is null or e.department_id     = any (p_department_ids))
    and (p_queues          is null or e.owning_queue      = any (p_queues))
    and (
      -- Accountable person, and/or explicitly unassigned work. Requesting both means
      -- "these people OR nobody", which is how a queue owner reviews their own patch
      -- plus the work no one has picked up.
      (p_accountable_ids is null and not coalesce(p_unassigned, false))
      or (p_accountable_ids is not null and e.accountable_id = any (p_accountable_ids))
      or (coalesce(p_unassigned, false) and e.accountable_id is null)
    )
    and case p.due_state
      when 'overdue'       then e.due_at is not null and e.due_at < p.ref_now
      when 'due_today'     then e.due_at is not null
                                and e.due_at >= date_trunc('day', p.ref_now)
                                and e.due_at <  date_trunc('day', p.ref_now) + interval '1 day'
      when 'due_this_week' then e.due_at is not null
                                and e.due_at >= date_trunc('day', p.ref_now)
                                and e.due_at <  date_trunc('day', p.ref_now) + interval '7 days'
      when 'unscheduled'   then e.due_at is null
      else true
    end
    and (
      p.search is null
      or e.title         ilike '%' || p.search || '%'
      or e.case_no       ilike '%' || p.search || '%'
      or e.employee_name ilike '%' || p.search || '%'
      or e.detail        ilike '%' || p.search || '%'
    )
),
counted as (
  select f.*, count(*) over () as total_count from filtered f
)
select
  c.source_type, c.source_id, c.case_id, c.case_no, c.employee_id, c.employee_name,
  c.department_id, c.site_id, c.title, c.detail, c.owning_queue, c.accountable_id,
  c.source_status, c.normalized_status, c.due_at, c.severity, c.is_blocking,
  c.related_task_id, c.related_handoff_id, c.created_at, c.total_count
from counted c, params p
-- Sorting is STABLE: every ordering ends with (source_type, source_id). Without a unique
-- tiebreaker a UNION can repeat or skip rows between pages, because equal sort keys have
-- no defined order across the four sources. Undated work sorts last in BOTH directions —
-- an absent due date is not "earliest".
order by
  case when p.sort_key = 'due_at'        and p.sort_dir = 'asc'  then c.due_at end asc  nulls last,
  case when p.sort_key = 'due_at'        and p.sort_dir = 'desc' then c.due_at end desc nulls last,
  case when p.sort_key = 'title'         and p.sort_dir = 'asc'  then lower(c.title) end asc,
  case when p.sort_key = 'title'         and p.sort_dir = 'desc' then lower(c.title) end desc,
  case when p.sort_key = 'employee_name' and p.sort_dir = 'asc'  then lower(c.employee_name) end asc  nulls last,
  case when p.sort_key = 'employee_name' and p.sort_dir = 'desc' then lower(c.employee_name) end desc nulls last,
  case when p.sort_key = 'case_no'       and p.sort_dir = 'asc'  then c.case_no end asc,
  case when p.sort_key = 'case_no'       and p.sort_dir = 'desc' then c.case_no end desc,
  case when p.sort_key = 'source_type'   and p.sort_dir = 'asc'  then c.source_type end asc,
  case when p.sort_key = 'source_type'   and p.sort_dir = 'desc' then c.source_type end desc,
  case when p.sort_key = 'status'        and p.sort_dir = 'asc'  then c.normalized_status end asc,
  case when p.sort_key = 'status'        and p.sort_dir = 'desc' then c.normalized_status end desc,
  case when p.sort_key = 'created_at'    and p.sort_dir = 'asc'  then c.created_at end asc,
  case when p.sort_key = 'created_at'    and p.sort_dir = 'desc' then c.created_at end desc,
  c.source_type, c.source_id
limit  (select page_size from params)
offset (select (page - 1) * page_size from params);
$$;

comment on function public.hr_onboarding_work_queue is
  'Unified Onboarding Work Queue read model. UNION ALL over onboarding tasks, handoffs, '
  'blockers and evidence submissions with normalised lifecycle, server-side filtering, '
  'stable sorting, exact pagination and an exact total_count. Does NOT authorize: the '
  'caller passes p_case_ids resolved by the TypeScript onboarding scope resolver, where '
  'NULL means authorized-unconstrained and an empty array means no visible cases.';

-- ════════════════════════════════════════════════════════════════════════════════
-- Lock down execution.
-- A new function is EXECUTE-able by PUBLIC by default, and PostgREST exposes functions in
-- the public schema, so without these revokes this queue would be callable directly from a
-- browser holding only the anon key — bypassing requirePermission and the scope resolver.
-- ════════════════════════════════════════════════════════════════════════════════

revoke all on function public.hr_onboarding_work_queue(
  uuid[], text[], text[], text, text[], text[], text[], boolean, text, text, text, int, int, timestamptz)
  from public;

revoke all on function public.hr_onboarding_work_queue(
  uuid[], text[], text[], text, text[], text[], text[], boolean, text, text, text, int, int, timestamptz)
  from anon;

revoke all on function public.hr_onboarding_work_queue(
  uuid[], text[], text[], text, text[], text[], text[], boolean, text, text, text, int, int, timestamptz)
  from authenticated;

grant execute on function public.hr_onboarding_work_queue(
  uuid[], text[], text[], text, text[], text[], text[], boolean, text, text, text, int, int, timestamptz)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run after applying. Expected results stated per query.
-- ════════════════════════════════════════════════════════════════════════════════

-- V1 — the function exists exactly once. Expect 1 row.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'hr_onboarding_work_queue';

-- V2 — anon and authenticated CANNOT execute it. Expect both false.
select
  has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role',  p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'hr_onboarding_work_queue';

-- V3 — an empty scope array returns NOTHING (never "everything"). Expect 0 rows.
select count(*) as rows_for_empty_scope
from public.hr_onboarding_work_queue(p_case_ids => '{}'::uuid[]);

-- V4 — NULL scope is unconstrained and total_count is consistent across the page.
-- Expect one distinct total_count, equal to the true unfiltered item count.
select count(distinct total_count) as distinct_totals, max(total_count) as reported_total
from public.hr_onboarding_work_queue(p_case_ids => null, p_page_size => 200);

-- V5 — pagination is stable: no row appears on two consecutive pages. Expect 0.
with p1 as (select source_type, source_id from public.hr_onboarding_work_queue(p_page => 1, p_page_size => 25)),
     p2 as (select source_type, source_id from public.hr_onboarding_work_queue(p_page => 2, p_page_size => 25))
select count(*) as overlapping_rows
from p1 join p2 using (source_type, source_id);

-- V6 — every source contributes and every lifecycle value is one of the five normalised
-- states. Expect no row with an unexpected normalized_status.
select source_type, normalized_status, count(*)
from public.hr_onboarding_work_queue(p_case_ids => null, p_page_size => 200)
group by 1, 2 order by 1, 2;
