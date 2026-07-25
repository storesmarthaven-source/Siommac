-- 20260925000000_finance_payroll_sod_policy.sql
--
-- Configurable payroll Segregation-of-Duties (SoD) policy.
--
-- WHY: the release chain hardcoded a 4-way SoD (funder/releaser had to differ from
-- preparer AND approver AND certifier). A finance team with fewer than four
-- payroll-authorised people could not release a run at all.
--
-- WHAT: a governed, versioned policy row carries an SoD level (2 | 3 | 4):
--     level 2 -> funder/releaser must differ from the preparer
--     level 3 -> ... and from the approver            (DEFAULT)
--     level 4 -> ... and from the certifier           (previous hardcoded behaviour)
--   The floor is 2: the preparer can NEVER fund or release their own run, and the
--   approver can never be the preparer (enforced on the approve path, unchanged).
--
-- PER-RUN SNAPSHOT: finance_payroll_runs.sod_level captures the ACTIVE level at
--   insert time via a column default. A run is judged for its whole life by the
--   level it was created under, so changing the policy never switches the rules on
--   an in-flight run. This deliberately avoids touching create_run_tx (which has
--   several historical versions) -- the default expression is evaluated per INSERT.
--
-- HOW THE TWO BIG RPCs ARE PATCHED: finance_payroll_release_run_tx (~1,170 lines)
--   and finance_payroll_confirm_funding_tx (~260 lines) are NOT reproduced here.
--   Section 4 reads each function's CURRENT definition out of the catalogue with
--   pg_get_functiondef(), rewrites ONLY the segregation-of-duties conditions, and
--   re-executes it. That means:
--     * the live definition is the input, so this can never go stale against a
--       later migration that changed those functions;
--     * every other line of the anti-fraud logic is preserved byte-for-byte;
--     * if an expected pattern is missing the DO block RAISES -- it can never
--       silently no-op and leave the SoD checks unpatched.
--
-- Idempotent: safe to run more than once (section 4 detects an already-patched
-- function and skips it).

-- ── 1. Policy table (versioned, append-only) ─────────────────────────────────
create table if not exists public.finance_payroll_sod_policy (
  id             uuid primary key default gen_random_uuid(),
  sod_level      int  not null check (sod_level in (2, 3, 4)),
  status         text not null default 'draft'
                   check (status in ('draft', 'pending_approval', 'active', 'superseded')),
  -- Roles permitted to PROPOSE/APPROVE an SoD change. Editing this list is
  -- superadmin-only (enforced in the service): a finance_manager must not be able
  -- to add themselves as the sole approver and defeat maker-checker.
  eligible_roles text[] not null default array['superadmin', 'finance_manager'],
  reason         text,
  proposed_by    text references public.app_users(id),
  approved_by    text references public.app_users(id),
  workflow_id    uuid,
  supersedes_id  uuid references public.finance_payroll_sod_policy(id),
  effective_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  -- Maker-checker: the approver must never be the proposer.
  constraint finance_payroll_sod_policy_maker_checker
    check (approved_by is null or proposed_by is null or approved_by <> proposed_by)
);

comment on table public.finance_payroll_sod_policy is
  'Versioned payroll segregation-of-duties policy. Exactly one row is active; changes are workflow-approved with creator != approver.';

-- Exactly ONE active policy at a time.
create unique index if not exists finance_payroll_sod_policy_one_active
  on public.finance_payroll_sod_policy (status) where status = 'active';

alter table public.finance_payroll_sod_policy enable row level security;

-- Seed the default active policy (level 3) exactly once.
insert into public.finance_payroll_sod_policy (sod_level, status, reason, effective_at)
select 3, 'active', 'Initial default policy (3-person segregation of duties).', now()
 where not exists (
   select 1 from public.finance_payroll_sod_policy where status = 'active'
 );

-- ── 2. Active-level accessor (used as the run column default) ────────────────
create or replace function public.finance_payroll_active_sod_level()
returns int
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select p.sod_level
       from public.finance_payroll_sod_policy p
      where p.status = 'active'
      limit 1),
    3  -- fail-safe default if no active row exists
  );
$fn$;

comment on function public.finance_payroll_active_sod_level() is
  'The currently active payroll SoD level (2|3|4); defaults to 3. Used as the finance_payroll_runs.sod_level insert default.';

-- ── 3. Per-run snapshot column ───────────────────────────────────────────────
alter table public.finance_payroll_runs
  add column if not exists sod_level int not null
    default public.finance_payroll_active_sod_level();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'finance_payroll_runs_sod_level_check'
  ) then
    alter table public.finance_payroll_runs
      add constraint finance_payroll_runs_sod_level_check check (sod_level in (2, 3, 4));
  end if;
end $$;

comment on column public.finance_payroll_runs.sod_level is
  'SoD level snapshotted from the active policy when the run was created. The run is governed by THIS value for its whole life.';

-- ── 4. Parameterise the SoD checks inside the two release-chain RPCs ─────────
-- Reads each live definition, rewrites only the SoD conditions, re-executes it.
-- Raises if an expected pattern is absent, so it can never silently no-op.
do $$
declare
  v_src   text;
  v_new   text;
  v_fn    text;
  v_kind  text;
  r       record;
begin
  for r in
    select 'public.finance_payroll_release_run_tx(uuid,text,text)'::regprocedure as fn,
           'release' as kind
    union all
    select 'public.finance_payroll_confirm_funding_tx(uuid,text,text,numeric,text,text,text)'::regprocedure,
           'funding'
  loop
    v_fn   := r.fn::text;
    v_kind := r.kind;
    v_src  := pg_get_functiondef(r.fn);

    -- Already patched (re-run of this migration) -> nothing to do.
    if position('v_run.sod_level' in v_src) > 0 then
      raise notice 'SoD: % already parameterised, skipping', v_fn;
      continue;
    end if;

    -- (a) preparer OR approver -> preparer always, approver only at level >= 3.
    if position('if p_actor_id = v_run.created_by or p_actor_id = v_run.approved_by then' in v_src) = 0 then
      raise exception 'SoD patch: preparer/approver check not found in % -- aborting so the SoD rules are never left unpatched', v_fn;
    end if;
    v_new := replace(
      v_src,
      'if p_actor_id = v_run.created_by or p_actor_id = v_run.approved_by then',
      'if p_actor_id = v_run.created_by then'
      || E'\n    raise exception ''finance_payroll_' || v_kind
      || ': the preparer cannot fund or release their own run'' using errcode = ''PR403'';'
      || E'\n  end if;'
      || E'\n  if v_run.sod_level >= 3 and p_actor_id = v_run.approved_by then'
    );

    -- (b) certifier separation applies only at level 4.
    if position('if p_actor_id = v_cert.certified_by then' in v_new) = 0 then
      raise exception 'SoD patch: certifier check not found in % -- aborting so the SoD rules are never left unpatched', v_fn;
    end if;
    v_new := replace(
      v_new,
      'if p_actor_id = v_cert.certified_by then',
      'if v_run.sod_level >= 4 and p_actor_id = v_cert.certified_by then'
    );

    if v_new = v_src then
      raise exception 'SoD patch: no change produced for % -- aborting', v_fn;
    end if;

    execute v_new;
    raise notice 'SoD: % parameterised by v_run.sod_level', v_fn;
  end loop;
end $$;

-- ── 5. Governed policy-change RPCs ───────────────────────────────────────────
-- supabase-js issues SEPARATE PostgREST calls, so "supersede the active row" +
-- "activate the new row" CANNOT be made atomic from the app layer. Both flows
-- below therefore commit in ONE transaction inside the database.

-- Approve a pending proposal: supersede the current active policy and activate
-- the proposal, enforcing maker != checker and the status guard server-side.
create or replace function public.finance_payroll_sod_policy_approve_tx(
  p_policy_id uuid,
  p_actor_id  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row        public.finance_payroll_sod_policy%rowtype;
  v_active     public.finance_payroll_sod_policy%rowtype;
  v_had_active boolean := false;
begin
  select * into v_row
    from public.finance_payroll_sod_policy
   where id = p_policy_id
     for update;
  if not found then
    raise exception 'finance_payroll_sod_policy: proposal % was not found', p_policy_id
      using errcode = 'PR404';
  end if;
  if v_row.status <> 'pending_approval' then
    raise exception 'finance_payroll_sod_policy: proposal is % (only pending_approval can be approved)',
      v_row.status using errcode = 'PR422';
  end if;
  -- Maker-checker: the proposer can never approve their own change.
  if v_row.proposed_by is not null and v_row.proposed_by = p_actor_id then
    raise exception 'finance_payroll_sod_policy: the proposer cannot approve their own change'
      using errcode = 'PR403';
  end if;

  select * into v_active
    from public.finance_payroll_sod_policy
   where status = 'active'
     for update;
  v_had_active := found;
  if v_had_active then
    update public.finance_payroll_sod_policy
       set status = 'superseded', updated_at = now()
     where id = v_active.id;
  end if;

  update public.finance_payroll_sod_policy
     set status        = 'active',
         approved_by   = p_actor_id,
         effective_at  = now(),
         updated_at    = now(),
         supersedes_id = case when v_had_active then v_active.id else supersedes_id end
   where id = v_row.id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$fn$;

-- Replace the eligible-role list (superadmin-only; the route enforces the
-- permission). Versioned like any other change: supersede + insert a new active
-- row carrying the SAME level, so the history stays append-only.
create or replace function public.finance_payroll_sod_policy_set_roles_tx(
  p_roles    text[],
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_active public.finance_payroll_sod_policy%rowtype;
  v_new    public.finance_payroll_sod_policy%rowtype;
  v_roles  text[] := p_roles;
begin
  if v_roles is null or array_length(v_roles, 1) is null then
    raise exception 'finance_payroll_sod_policy: at least one eligible role is required'
      using errcode = 'PR422';
  end if;
  -- superadmin is ALWAYS retained: the control can never be locked out of itself.
  if not ('superadmin' = any(v_roles)) then
    v_roles := array_append(v_roles, 'superadmin');
  end if;

  select * into v_active
    from public.finance_payroll_sod_policy
   where status = 'active'
     for update;
  if not found then
    raise exception 'finance_payroll_sod_policy: no active policy to amend'
      using errcode = 'PR409';
  end if;

  update public.finance_payroll_sod_policy
     set status = 'superseded', updated_at = now()
   where id = v_active.id;

  insert into public.finance_payroll_sod_policy
    (sod_level, status, eligible_roles, reason, proposed_by, supersedes_id, effective_at)
  values
    (v_active.sod_level, 'active', v_roles,
     'Eligible-role list updated by superadmin.', p_actor_id, v_active.id, now())
  returning * into v_new;

  return to_jsonb(v_new);
end;
$fn$;

-- ── 6. Role grants ───────────────────────────────────────────────────────────
-- requirePermission resolves a role's capabilities from THIS table (not from the
-- static catalogue in code), so the new keys must be granted here or every call
-- 403s. superadmin is allow-all in memory and needs no row.
-- manage_roles is deliberately granted to NOBODY: it stays superadmin-only, so a
-- finance_manager can never make itself the sole approver and defeat maker-checker.
insert into public.role_permissions (role_name, permission)
select r.role_name, p.permission
  from (values ('finance_manager'), ('admin')) as r(role_name)
 cross join (values
   ('finance.payroll.sod_policy.view'),
   ('finance.payroll.sod_policy.propose'),
   ('finance.payroll.sod_policy.approve')
 ) as p(permission)
 where not exists (
   select 1 from public.role_permissions rp
    where rp.role_name = r.role_name and rp.permission = p.permission
 );
