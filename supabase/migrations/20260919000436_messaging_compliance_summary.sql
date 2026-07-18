-- ============================================================================
-- Messenger Compliance V1: operational summary read model
-- Migration: 20260919000436
--
-- Supplies the four operational summary cards in the approved compliance
-- mockup from one statement snapshot. The function exposes counts only and
-- never returns case reasons, conversation metadata, or message content.
-- ============================================================================

begin;

create index if not exists message_compliance_exports_ready_generated_idx
  on public.message_compliance_exports (generated_at desc)
  where status = 'ready';

create or replace function public.message_compliance_summary()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $fn$
  select jsonb_build_object(
    'activeCases',
      count(*) filter (
        where c.status = 'approved'
          and c.valid_until > statement_timestamp()
      )::integer,
    'pendingApprovalCases',
      count(*) filter (
        where c.status = 'pending_approval'
      )::integer,
    'expiringWithin24Hours',
      count(*) filter (
        where c.status = 'approved'
          and c.valid_until > statement_timestamp()
          and c.valid_until <= statement_timestamp() + interval '24 hours'
      )::integer,
    'exportsThisMonth',
      (
        select count(*)::integer
        from public.message_compliance_exports e
        where e.status = 'ready'
          and e.generated_at >= date_trunc('month', statement_timestamp())
          and e.generated_at < date_trunc('month', statement_timestamp()) + interval '1 month'
      ),
    'asOf',
      statement_timestamp()
  )
  from public.message_compliance_cases c
$fn$;

revoke all on function public.message_compliance_summary()
  from public, anon, authenticated;
grant execute on function public.message_compliance_summary()
  to service_role;

commit;

notify pgrst, 'reload schema';
