-- Fix: finance_pay_policy_preflight checksum — use pg built-in sha256()
--
-- Root cause: the initial apply of migration 20260919000600 contained
--   encode(digest(manifest::text,'sha256'),'hex')
-- and the first corrective deploy changed it to
--   encode(digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex')
-- Both fail because PostgreSQL resolves the 'sha256' literal as type unknown
-- and there is no digest(bytea,unknown) overload on this Supabase instance.
--
-- Fix: replace with the PostgreSQL 11+ built-in sha256(bytea), which has no
-- overload ambiguity and does not depend on pgcrypto being in the search path:
--   encode(sha256(convert_to(manifest::text,'UTF8')),'hex')
--
-- Source migration 20260919000600 was corrected in-place on the branch.
-- This file re-deploys the function to the already-running live database.
--
-- Run once (Supabase Dashboard SQL Editor OR psql):
--   psql "postgresql://postgres:<PWD>@db.gaflqcwcrvnusnlghwej.supabase.co:5432/postgres" \
--        -f "supabase/_apply_preflight_digest_fix.sql"
-- Then: NOTIFY pgrst, 'reload schema';

create or replace function public.finance_pay_policy_preflight(p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare v public.finance_pay_policy_versions%rowtype; p public.finance_pay_policies%rowtype;
  blockers jsonb := '[]'; warnings jsonb := '[]'; manifest jsonb; checksum text; statutory_id uuid;
  component_count int; source_count int; costing_count int; earning_count int;
begin
  select * into v from public.finance_pay_policy_versions where id=p_version_id;
  if not found then raise exception 'pay_policy: version not found' using errcode='WF404'; end if;
  select * into p from public.finance_pay_policies where id=v.policy_id;
  select count(*),count(*) filter(where c.kind='earning') into component_count,earning_count
    from public.finance_pay_policy_components pc join public.finance_pay_components c on c.id=pc.component_id
    where pc.policy_version_id=v.id and c.is_active;
  select count(*) into source_count from public.finance_pay_policy_source_rules where policy_version_id=v.id and required;
  select count(*) into costing_count from public.finance_pay_policy_costing_rules where policy_version_id=v.id;
  select id into statutory_id from public.finance_statutory_versions
    where jurisdiction='TT' and currency='TTD' and status='active' and is_active
      and effective_from<=v.effective_from order by effective_from desc limit 1;
  if component_count=0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','components.required','message','Add at least one active pay component.')); end if;
  if earning_count=0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','earnings.required','message','Add at least one active earning component.')); end if;
  if statutory_id is null then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','statutory.missing','message','No active TT statutory version covers the effective date.')); end if;
  if not exists(select 1 from public.finance_pay_policy_source_rules where policy_version_id=v.id and source_type='statutory_profile' and required)
    then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','source.statutory_profile','message','A required statutory-profile source rule is missing.')); end if;
  if not exists(select 1 from public.finance_pay_policy_source_rules where policy_version_id=v.id and source_type='payment_destination' and required)
    then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','source.payment_destination','message','A required payment-destination source rule is missing.')); end if;
  if p.policy_type='hourly_shift' and not exists(select 1 from public.finance_pay_policy_source_rules where policy_version_id=v.id and source_type='approved_time' and required)
    then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','source.approved_time','message','Hourly policies require approved-time evidence.')); end if;
  if costing_count=0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','costing.cost_centre','message','Employee cost-centre resolution is required.')); end if;
  manifest:=jsonb_build_object('policy',jsonb_build_object('code',p.code,'type',p.policy_type),
    'version',jsonb_build_object('versionNo',v.version_no,'effectiveFrom',v.effective_from,'effectiveTo',v.effective_to,
      'timezone',v.timezone,'dayBoundary',v.day_boundary,'currency',v.currency),
    'components',(select coalesce(jsonb_agg(jsonb_build_object('componentId',component_id,'basis',calculation_basis,'rateSource',rate_source,
      'eligibilitySource',eligibility_source,'parameters',rule_parameters,'required',is_required) order by sort_order,component_id),'[]')
      from public.finance_pay_policy_components where policy_version_id=v.id),
    'sources',(select coalesce(jsonb_agg(jsonb_build_object('sourceType',source_type,'ownerRole',owner_role,'required',required,
      'reconciliationKey',reconciliation_key,'lateInputPolicy',late_input_policy,'severity',conflict_severity,'outcome',conflict_outcome) order by source_type),'[]')
      from public.finance_pay_policy_source_rules where policy_version_id=v.id),
    'costing',jsonb_build_object('dimension','cost_centre','resolutionSource','employee_assignment','missingOutcome','block_input_lock'),
    'statutoryVersionId',statutory_id);
  checksum:=encode(sha256(convert_to(manifest::text,'UTF8')),'hex');
  return jsonb_build_object('ready',jsonb_array_length(blockers)=0,'blockers',blockers,'warnings',warnings,
    'checksum',checksum,'statutoryVersionId',statutory_id,
    'counts',jsonb_build_object('components',component_count,'requiredSources',source_count,'costingRules',costing_count));
end $fn$;

revoke all on function public.finance_pay_policy_preflight(uuid) from public,anon,authenticated;
grant execute on function public.finance_pay_policy_preflight(uuid) to service_role;

notify pgrst, 'reload schema';
