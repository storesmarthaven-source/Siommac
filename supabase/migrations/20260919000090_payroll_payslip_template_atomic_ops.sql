-- ============================================================================
-- Payroll Payslip Templates -- atomic set-default and archive RPCs (Phase 2 P2-d)
-- ============================================================================
-- setDefaultTemplate and archiveTemplate in payslipTemplates.ts previously
-- issued two separate PostgREST calls (clear-then-set / archive-then-promote).
-- A crash or error between the two left the template table in an inconsistent
-- state:
--   setDefault: zero defaults (all existing defaults cleared, new one not set)
--   archive:    archived but the next-default promote never ran (zero defaults)
--
-- These two Postgres functions execute BOTH operations in ONE transaction,
-- so any failure rolls back the entire operation and the prior state is
-- preserved exactly.
--
-- Pattern follows the precedent in migrations 20260919000060 and ...000070:
--   ASCII only, idempotent (create or replace), security definer,
--   revoke from public/anon/authenticated, grant to service_role only.
--
-- Operator steps after applying:
--   1. Apply this migration.
--   2. NOTIFY pgrst, 'reload schema';
--   3. npm run build:backend && restart the dev server.
--   No frontend change needed.
-- ============================================================================


-- ── payroll_set_default_template ─────────────────────────────────────────────

create or replace function public.payroll_set_default_template(
  p_id       uuid,
  p_actor_id text
)
returns public.payroll_payslip_templates
language plpgsql
security definer
set search_path = public
as $tmpl_default$
declare
  v_row public.payroll_payslip_templates;
begin
  -- Guard: target must exist and be active.
  -- Checking first (before clearing) so a bad id can never leave zero defaults.
  if not exists (
    select 1
    from public.payroll_payslip_templates
    where id = p_id
      and status = 'active'
  ) then
    raise exception
      'payroll_set_default_template: template not found or not active'
      using errcode = 'P0002';
  end if;

  -- Clear all active defaults except the new one, atomically in the same txn.
  update public.payroll_payslip_templates
  set    is_default = false,
         updated_by = p_actor_id
  where  status     = 'active'
    and  is_default = true
    and  id        <> p_id;

  -- Set the new default.
  update public.payroll_payslip_templates
  set    is_default = true,
         updated_by = p_actor_id
  where  id     = p_id
    and  status = 'active'
  returning * into v_row;

  if v_row is null then
    raise exception
      'payroll_set_default_template: failed to update target row'
      using errcode = 'P0001';
  end if;

  return v_row;
end;
$tmpl_default$;

revoke all on function public.payroll_set_default_template(uuid, text) from public;
revoke all on function public.payroll_set_default_template(uuid, text) from anon;
revoke all on function public.payroll_set_default_template(uuid, text) from authenticated;
grant  execute on function public.payroll_set_default_template(uuid, text) to service_role;


-- ── payroll_archive_template ──────────────────────────────────────────────────

create or replace function public.payroll_archive_template(
  p_id       uuid,
  p_actor_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $tmpl_archive$
declare
  v_was_default boolean;
  v_next_id     uuid;
begin
  -- Guard: target must exist and be active.
  select is_default
    into v_was_default
    from public.payroll_payslip_templates
   where id     = p_id
     and status = 'active';

  if not found then
    raise exception
      'payroll_archive_template: template not found or not active'
      using errcode = 'P0002';
  end if;

  -- Archive (also clears is_default to satisfy the partial unique index,
  -- avoiding a conflict if we promote another row to default in the same txn).
  update public.payroll_payslip_templates
  set    status     = 'archived',
         is_default = false,
         updated_by = p_actor_id
  where  id     = p_id
    and  status = 'active';

  -- If the archived template was the default, promote the most-recent
  -- remaining active template in the same transaction so there is never
  -- a window with zero defaults visible to concurrent reads.
  if v_was_default then
    select id
      into v_next_id
      from public.payroll_payslip_templates
     where status = 'active'
     order by created_at desc
     limit 1;

    if v_next_id is not null then
      update public.payroll_payslip_templates
      set    is_default = true,
             updated_by = p_actor_id
      where  id = v_next_id;
    end if;
  end if;
end;
$tmpl_archive$;

revoke all on function public.payroll_archive_template(uuid, text) from public;
revoke all on function public.payroll_archive_template(uuid, text) from anon;
revoke all on function public.payroll_archive_template(uuid, text) from authenticated;
grant  execute on function public.payroll_archive_template(uuid, text) to service_role;

-- After applying: NOTIFY pgrst, 'reload schema';
