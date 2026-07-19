-- Finance Payroll Setup: governed T&T pay policies (Phase A).
-- Scope is deliberately local employees paid in TTD; crew/run-policy integration is Phase B.
-- Operator-applied. After applying: NOTIFY pgrst, 'reload schema';

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table public.finance_pay_policies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
  name text not null check (char_length(name) between 3 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  legal_entity_code text not null default 'SIOMAC-TT' check (legal_entity_code = 'SIOMAC-TT'),
  worker_relationship text not null default 'employee' check (worker_relationship = 'employee'),
  policy_type text not null check (policy_type in ('standard_salary','hourly_shift')),
  workforce_type text not null check (workforce_type in ('salaried','hourly')),
  status text not null default 'draft' check (status in ('draft','active','retired')),
  owner_id text references public.app_users(id) on delete set null,
  created_by text not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.finance_pay_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.finance_pay_policies(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','active','superseded','rejected','retired')),
  effective_from date not null,
  effective_to date,
  change_summary text not null default '' check (char_length(change_summary) <= 500),
  timezone text not null default 'America/Port_of_Spain' check (timezone = 'America/Port_of_Spain'),
  day_boundary text not null check (day_boundary in ('calendar_day','shift_start')),
  statutory_binding text not null default 'approved_by_pay_date' check (statutory_binding = 'approved_by_pay_date'),
  currency text not null default 'TTD' check (currency = 'TTD'),
  payment_destination text not null default 'primary_bank_account' check (payment_destination = 'primary_bank_account'),
  missing_bank_outcome text not null default 'block_release' check (missing_bank_outcome = 'block_release'),
  workflow_id uuid references public.workflow_instances(id) on delete set null,
  canonical_checksum text,
  lock_version integer not null default 1,
  prepared_by text not null references public.app_users(id),
  submitted_by text references public.app_users(id),
  submitted_at timestamptz,
  approved_by text references public.app_users(id),
  approved_at timestamptz,
  activated_by text references public.app_users(id),
  activated_at timestamptz,
  retired_by text references public.app_users(id),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id, version_no),
  check (effective_to is null or effective_to >= effective_from)
);

create table public.finance_pay_policy_components (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid not null references public.finance_pay_policy_versions(id) on delete cascade,
  component_id uuid not null references public.finance_pay_components(id) on delete restrict,
  calculation_basis text not null check (calculation_basis in ('salary_period','approved_hours')),
  rate_source text not null check (rate_source in ('employee_contract','employee_assignment')),
  eligibility_source text not null
    check (eligibility_source in ('effective_employment','approved_compensation','approved_time')),
  rule_parameters jsonb not null default '{}'::jsonb,
  is_required boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_version_id, component_id),
  check (
    (calculation_basis = 'salary_period' and eligibility_source in ('effective_employment','approved_compensation')
      and rule_parameters ? 'proration' and rule_parameters->>'proration' in ('calendar_days','working_days'))
    or
    (calculation_basis = 'approved_hours' and eligibility_source = 'approved_time' and rule_parameters = '{}'::jsonb)
  )
);

create table public.finance_pay_policy_source_rules (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid not null references public.finance_pay_policy_versions(id) on delete cascade,
  source_type text not null
    check (source_type in ('approved_compensation','approved_time','approved_leave','statutory_profile','payment_destination')),
  owner_role text not null check (owner_role in ('hr_manager','finance_staff','finance_manager','manager')),
  required boolean not null default true,
  reconciliation_key text not null
    check (reconciliation_key in ('employee_effective_date','employee_period','employee_work_date')),
  cutoff_policy text not null default 'pay_group_cutoff' check (cutoff_policy = 'pay_group_cutoff'),
  late_input_policy text not null check (late_input_policy in ('exclude_and_review','correction_candidate')),
  conflict_severity text not null check (conflict_severity in ('warning','blocker')),
  conflict_outcome text not null
    check (conflict_outcome in ('exclude_unapproved_input','create_review_finding','block_employee_calculation','block_input_lock','create_correction_candidate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_version_id, source_type)
);

create table public.finance_pay_policy_costing_rules (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid not null references public.finance_pay_policy_versions(id) on delete cascade,
  dimension text not null check (dimension = 'cost_centre'),
  resolution_source text not null check (resolution_source = 'employee_assignment'),
  required boolean not null default true check (required),
  missing_outcome text not null default 'block_input_lock' check (missing_outcome = 'block_input_lock'),
  created_at timestamptz not null default now(),
  unique (policy_version_id, dimension)
);

create table public.finance_pay_group_policy_assignments (
  id uuid primary key default gen_random_uuid(),
  pay_group_id uuid not null references public.finance_pay_groups(id) on delete restrict,
  policy_id uuid not null references public.finance_pay_policies(id) on delete restrict,
  policy_version_id uuid not null references public.finance_pay_policy_versions(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  status text not null default 'active' check (status in ('active','ended')),
  assigned_by text not null references public.app_users(id),
  ended_by text references public.app_users(id),
  end_reason text check (end_reason is null or char_length(end_reason) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

alter table public.finance_pay_group_policy_assignments
  add constraint finance_pay_group_policy_assignments_no_overlap
  exclude using gist (
    pay_group_id with =,
    daterange(effective_from, coalesce(effective_to + 1, 'infinity'::date), '[)') with &&
  ) where (status = 'active');

create table public.finance_pay_policy_command_receipts (
  request_key text primary key,
  input_hash text not null,
  command text not null,
  policy_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index finance_pay_policies_list_idx on public.finance_pay_policies(status, updated_at desc, id desc);
create index finance_pay_policy_versions_policy_idx on public.finance_pay_policy_versions(policy_id, version_no desc);
create index finance_pay_policy_versions_workflow_idx on public.finance_pay_policy_versions(workflow_id);
create index finance_pay_policy_components_version_idx on public.finance_pay_policy_components(policy_version_id);
create index finance_pay_policy_sources_version_idx on public.finance_pay_policy_source_rules(policy_version_id);
create index finance_pay_policy_assignments_policy_idx on public.finance_pay_group_policy_assignments(policy_id, effective_from desc);
create index finance_pay_policy_assignments_group_idx on public.finance_pay_group_policy_assignments(pay_group_id, effective_from desc);

alter table public.finance_pay_policies enable row level security;
alter table public.finance_pay_policy_versions enable row level security;
alter table public.finance_pay_policy_components enable row level security;
alter table public.finance_pay_policy_source_rules enable row level security;
alter table public.finance_pay_policy_costing_rules enable row level security;
alter table public.finance_pay_group_policy_assignments enable row level security;
alter table public.finance_pay_policy_command_receipts enable row level security;
grant select, insert, update, delete on public.finance_pay_policies to service_role;
grant select, insert, update, delete on public.finance_pay_policy_versions to service_role;
grant select, insert, update, delete on public.finance_pay_policy_components to service_role;
grant select, insert, update, delete on public.finance_pay_policy_source_rules to service_role;
grant select, insert, update, delete on public.finance_pay_policy_costing_rules to service_role;
grant select, insert, update, delete on public.finance_pay_group_policy_assignments to service_role;
grant select, insert, update, delete on public.finance_pay_policy_command_receipts to service_role;

create trigger finance_pay_policies_updated_at before update on public.finance_pay_policies
  for each row execute function public.set_updated_at();
create trigger finance_pay_policy_versions_updated_at before update on public.finance_pay_policy_versions
  for each row execute function public.set_updated_at();
create trigger finance_pay_policy_components_updated_at before update on public.finance_pay_policy_components
  for each row execute function public.set_updated_at();
create trigger finance_pay_policy_sources_updated_at before update on public.finance_pay_policy_source_rules
  for each row execute function public.set_updated_at();
create trigger finance_pay_policy_assignments_updated_at before update on public.finance_pay_group_policy_assignments
  for each row execute function public.set_updated_at();

-- Permission catalogue grants. Static catalogues are updated in TS in the same slice.
insert into public.role_permissions (role_name, permission) values
  ('finance_staff','finance.payroll.policies.view'),
  ('finance_staff','finance.payroll.policies.draft'),
  ('finance_staff','finance.payroll.policies.submit'),
  ('finance_manager','finance.payroll.policies.view'),
  ('finance_manager','finance.payroll.policies.draft'),
  ('finance_manager','finance.payroll.policies.submit'),
  ('finance_manager','finance.payroll.policies.statutory_approve'),
  ('finance_manager','finance.payroll.policies.activate'),
  ('finance_manager','finance.payroll.policies.assign'),
  ('hr_manager','finance.payroll.policies.view'),
  ('hr_manager','finance.payroll.policies.source_approve'),
  ('admin','finance.payroll.policies.view'),
  ('admin','finance.payroll.policies.draft'),
  ('admin','finance.payroll.policies.submit'),
  ('admin','finance.payroll.policies.source_approve'),
  ('admin','finance.payroll.policies.statutory_approve'),
  ('admin','finance.payroll.policies.activate'),
  ('admin','finance.payroll.policies.assign'),
  ('superadmin','finance.payroll.policies.view'),
  ('superadmin','finance.payroll.policies.draft'),
  ('superadmin','finance.payroll.policies.submit'),
  ('superadmin','finance.payroll.policies.source_approve'),
  ('superadmin','finance.payroll.policies.statutory_approve'),
  ('superadmin','finance.payroll.policies.activate'),
  ('superadmin','finance.payroll.policies.assign')
on conflict do nothing;

-- Two workflow-native reviews. Activation is the third, independent Finance approval.
do $seed$
declare v_template uuid; v_version uuid;
begin
  select id into v_template from public.workflow_templates where template_key = 'finance_pay_policy_approval';
  if v_template is null then
    insert into public.workflow_templates
      (template_key,module_key,workflow_type,name,description,status,is_active,current_version,definition)
    values
      ('finance_pay_policy_approval','finance_pay_policy','finance_pay_policy_approval',
       'Finance Pay Policy Approval','HR source review followed by Finance statutory review.','active',true,1,'{}')
    returning id into v_template;
  end if;
  insert into public.workflow_template_versions(template_id,version_no,version_status,definition,published_at)
  values (v_template,1,'published',jsonb_build_object(
    'schemaVersion',1,
    'steps',jsonb_build_array(
      jsonb_build_object('stepKey','source_review','stepName','HR Source Policy Review','stepType','approval','sequenceNo',1,
        'assignment',jsonb_build_object('type','role','value','hr_manager'),'dueDurationHours',72,'required',true,
        'decisionRules',jsonb_build_object('canApprove',true,'canReturn',true,'canReject',true,'canDelegate',false,
          'requireCommentOnApprove',false,'requireCommentOnReturn',true,'requireCommentOnReject',true,'requireAttachment',false)),
      jsonb_build_object('stepKey','statutory_review','stepName','Finance Statutory Review','stepType','approval','sequenceNo',2,
        'assignment',jsonb_build_object('type','role','value','finance_manager'),'dueDurationHours',72,'required',true,
        'decisionRules',jsonb_build_object('canApprove',true,'canReturn',true,'canReject',true,'canDelegate',false,
          'requireCommentOnApprove',false,'requireCommentOnReturn',true,'requireCommentOnReject',true,'requireAttachment',false))
    ),
    'transitions','[]'::jsonb,'notifications','[]'::jsonb,'handoffs','[]'::jsonb,
    'sourceStatusMap',jsonb_build_object('onStarted','pending_approval','onCompleted','approved',
      'onReturned','draft','onRejected','rejected','onCancelled','draft'),
    'settings',jsonb_build_object('allowReturn',true,'allowReject',true,'allowDelegate',false,
      'allowAdminOverride',true,'requireAuditAllTransitions',true)
  ),now())
  on conflict (template_id,version_no) do update set version_status='published',definition=excluded.definition,published_at=excluded.published_at
  returning id into v_version;
  delete from public.module_workflow_bindings
    where module_key='finance_pay_policy' and workflow_type='finance_pay_policy_approval'
      and trigger_event='finance.payroll.policy.submitted' and scope_type='global' and scope_id is null;
  insert into public.module_workflow_bindings
    (module_key,workflow_type,trigger_event,template_id,template_version_id,scope_type,is_active,priority)
  values ('finance_pay_policy','finance_pay_policy_approval','finance.payroll.policy.submitted',
    v_template,v_version,'global',true,100);
end $seed$;

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
  checksum:=encode(digest(manifest::text,'sha256'),'hex');
  return jsonb_build_object('ready',jsonb_array_length(blockers)=0,'blockers',blockers,'warnings',warnings,
    'checksum',checksum,'statutoryVersionId',statutory_id,
    'counts',jsonb_build_object('components',component_count,'requiredSources',source_count,'costingRules',costing_count));
end $fn$;

create or replace function public.finance_pay_policy_draft_command_tx(
  p_command text,p_policy_id uuid,p_version_id uuid,p_actor_id text,p_request_key text,p_input_hash text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare r public.finance_pay_policy_command_receipts%rowtype; pid uuid; vid uuid; vno int; token int; result jsonb;
begin
  select * into r from public.finance_pay_policy_command_receipts where request_key=p_request_key for update;
  if found then if r.input_hash<>p_input_hash then raise exception 'pay_policy: idempotency key payload mismatch' using errcode='WF409'; end if; return r.result; end if;
  if p_command='create' then
    insert into public.finance_pay_policies(code,name,description,policy_type,workforce_type,owner_id,created_by)
    values (upper(p_payload->>'code'),p_payload->>'name',coalesce(p_payload->>'description',''),p_payload->>'policyType',
      case when p_payload->>'policyType'='standard_salary' then 'salaried' else 'hourly' end,
      nullif(p_payload->>'ownerId',''),p_actor_id) returning id into pid;
    insert into public.finance_pay_policy_versions(policy_id,version_no,effective_from,effective_to,change_summary,day_boundary,prepared_by)
    values(pid,1,(p_payload->>'effectiveFrom')::date,nullif(p_payload->>'effectiveTo','')::date,coalesce(p_payload->>'changeSummary','Initial policy'),
      p_payload->>'dayBoundary',p_actor_id) returning id,lock_version into vid,token;
  elsif p_command='update' then
    select lock_version into token from public.finance_pay_policy_versions where id=p_version_id and policy_id=p_policy_id and status='draft' for update;
    if not found then raise exception 'pay_policy: only a draft version can be updated' using errcode='WF409'; end if;
    if token<>(p_payload->>'expectedLockVersion')::int then raise exception 'pay_policy: stale draft version' using errcode='WF409'; end if;
    pid:=p_policy_id; vid:=p_version_id;
    update public.finance_pay_policies set name=p_payload->>'name',description=coalesce(p_payload->>'description',''),
      owner_id=nullif(p_payload->>'ownerId','') where id=pid;
    update public.finance_pay_policy_versions set effective_from=(p_payload->>'effectiveFrom')::date,
      effective_to=nullif(p_payload->>'effectiveTo','')::date,change_summary=coalesce(p_payload->>'changeSummary',''),
      day_boundary=p_payload->>'dayBoundary',lock_version=lock_version+1 where id=vid returning lock_version into token;
  else raise exception 'pay_policy: unsupported draft command' using errcode='WF400'; end if;
  delete from public.finance_pay_policy_components where policy_version_id=vid;
  insert into public.finance_pay_policy_components(policy_version_id,component_id,calculation_basis,rate_source,eligibility_source,rule_parameters,is_required,sort_order)
  select vid,x.component_id,x.calculation_basis,x.rate_source,x.eligibility_source,x.rule_parameters,x.is_required,x.sort_order
    from jsonb_to_recordset(coalesce(p_payload->'components','[]')) as x(component_id uuid,calculation_basis text,rate_source text,eligibility_source text,rule_parameters jsonb,is_required boolean,sort_order int);
  delete from public.finance_pay_policy_source_rules where policy_version_id=vid;
  insert into public.finance_pay_policy_source_rules(policy_version_id,source_type,owner_role,required,reconciliation_key,late_input_policy,conflict_severity,conflict_outcome)
  select vid,x.source_type,x.owner_role,x.required,x.reconciliation_key,x.late_input_policy,x.conflict_severity,x.conflict_outcome
    from jsonb_to_recordset(coalesce(p_payload->'sourceRules','[]')) as x(source_type text,owner_role text,required boolean,reconciliation_key text,late_input_policy text,conflict_severity text,conflict_outcome text);
  insert into public.finance_pay_policy_costing_rules(policy_version_id,dimension,resolution_source)
    values(vid,'cost_centre','employee_assignment') on conflict(policy_version_id,dimension) do nothing;
  insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,actor_user_id,severity,payload,dedupe_key)
    values('finance.payroll.policy.draft_'||case when p_command='create' then 'created' else 'updated' end,'finance_pay_policy','pay_policy',pid::text,p_actor_id,'info',
      jsonb_build_object('policyId',pid,'versionId',vid), 'finance.pay_policy.'||p_command||':'||p_request_key);
  insert into public.hr_audit_log(submodule_key,record_id,actor_id,action,new_state)
    values('finance_pay_policy',pid::text,p_actor_id,'pay_policy.draft_'||case when p_command='create' then 'created' else 'updated' end,
      jsonb_build_object('versionId',vid,'lockVersion',token));
  result:=jsonb_build_object('policyId',pid,'versionId',vid,'lockVersion',token,'status','draft');
  insert into public.finance_pay_policy_command_receipts values(p_request_key,p_input_hash,p_command,pid,result,now());
  return result;
exception when unique_violation then raise exception 'pay_policy: code already exists' using errcode='WF409';
end $fn$;

create or replace function public.finance_pay_policy_copy_version_tx(
  p_policy_id uuid,p_source_version_id uuid,p_effective_from date,p_change_summary text,
  p_actor_id text,p_request_key text,p_input_hash text
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare r public.finance_pay_policy_command_receipts%rowtype; source public.finance_pay_policy_versions%rowtype;
  vid uuid; vno int; result jsonb;
begin
  select * into r from public.finance_pay_policy_command_receipts where request_key=p_request_key for update;
  if found then
    if r.input_hash<>p_input_hash then raise exception 'pay_policy: idempotency key payload mismatch' using errcode='WF409'; end if;
    return r.result;
  end if;
  perform 1 from public.finance_pay_policies where id=p_policy_id and status='active' for update;
  if not found then raise exception 'pay_policy: new versions require an active policy' using errcode='WF409'; end if;
  if exists(select 1 from public.finance_pay_policy_versions where policy_id=p_policy_id and status in ('draft','pending_approval','approved')) then
    raise exception 'pay_policy: finish the existing unpublished version first' using errcode='WF409';
  end if;
  select * into source from public.finance_pay_policy_versions
    where id=p_source_version_id and policy_id=p_policy_id and status in ('active','superseded','retired') for update;
  if not found then raise exception 'pay_policy: source version not found or is not published' using errcode='WF404'; end if;
  if char_length(trim(p_change_summary))<3 then raise exception 'pay_policy: change summary is required' using errcode='WF422'; end if;
  select coalesce(max(version_no),0)+1 into vno from public.finance_pay_policy_versions where policy_id=p_policy_id;
  insert into public.finance_pay_policy_versions(
    policy_id,version_no,status,effective_from,effective_to,change_summary,timezone,day_boundary,
    statutory_binding,currency,payment_destination,missing_bank_outcome,prepared_by
  ) values(
    p_policy_id,vno,'draft',p_effective_from,null,trim(p_change_summary),source.timezone,source.day_boundary,
    source.statutory_binding,source.currency,source.payment_destination,source.missing_bank_outcome,p_actor_id
  ) returning id into vid;
  insert into public.finance_pay_policy_components(
    policy_version_id,component_id,calculation_basis,rate_source,eligibility_source,rule_parameters,is_required,sort_order
  ) select vid,component_id,calculation_basis,rate_source,eligibility_source,rule_parameters,is_required,sort_order
    from public.finance_pay_policy_components where policy_version_id=source.id;
  insert into public.finance_pay_policy_source_rules(
    policy_version_id,source_type,owner_role,required,reconciliation_key,cutoff_policy,late_input_policy,conflict_severity,conflict_outcome
  ) select vid,source_type,owner_role,required,reconciliation_key,cutoff_policy,late_input_policy,conflict_severity,conflict_outcome
    from public.finance_pay_policy_source_rules where policy_version_id=source.id;
  insert into public.finance_pay_policy_costing_rules(
    policy_version_id,dimension,resolution_source,required,missing_outcome
  ) select vid,dimension,resolution_source,required,missing_outcome
    from public.finance_pay_policy_costing_rules where policy_version_id=source.id;
  insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,actor_user_id,severity,payload,dedupe_key)
    values('finance.payroll.policy.version_created','finance_pay_policy','pay_policy_version',vid::text,p_actor_id,'info',
      jsonb_build_object('policyId',p_policy_id,'versionId',vid,'versionNo',vno,'sourceVersionId',source.id),
      'finance.pay_policy.copy_version:'||p_request_key);
  insert into public.hr_audit_log(submodule_key,record_id,actor_id,action,new_state)
    values('finance_pay_policy',vid::text,p_actor_id,'pay_policy.version_created',
      jsonb_build_object('status','draft','versionNo',vno,'sourceVersionId',source.id,'effectiveFrom',p_effective_from));
  result:=jsonb_build_object('policyId',p_policy_id,'versionId',vid,'versionNo',vno,'lockVersion',1,'status','draft');
  insert into public.finance_pay_policy_command_receipts(request_key,input_hash,command,policy_id,result)
    values(p_request_key,p_input_hash,'copy_version',p_policy_id,result);
  return result;
end $fn$;

create or replace function public.finance_pay_policy_submit_tx(
  p_version_id uuid,p_actor_id text,p_request_key text,p_input_hash text,p_certifications jsonb
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare r public.finance_pay_policy_command_receipts%rowtype; v public.finance_pay_policy_versions%rowtype;
  p public.finance_pay_policies%rowtype; pf jsonb; tv uuid; wf jsonb; result jsonb;
begin
  select * into r from public.finance_pay_policy_command_receipts where request_key=p_request_key for update;
  if found then if r.input_hash<>p_input_hash then raise exception 'pay_policy: idempotency key payload mismatch' using errcode='WF409'; end if; return r.result; end if;
  select * into v from public.finance_pay_policy_versions where id=p_version_id for update;
  if not found then raise exception 'pay_policy: version not found' using errcode='WF404'; end if;
  if v.status<>'draft' then raise exception 'pay_policy: only draft versions can be submitted' using errcode='WF409'; end if;
  if coalesce((p_certifications->>'rulesReviewed')::boolean,false)=false
    or coalesce((p_certifications->>'sourcesOwned')::boolean,false)=false
    or coalesce((p_certifications->>'statutoryPaymentReady')::boolean,false)=false
    then raise exception 'pay_policy: all three certifications are required' using errcode='WF422'; end if;
  pf:=public.finance_pay_policy_preflight(v.id);
  if not (pf->>'ready')::boolean then raise exception 'pay_policy: preflight has blockers' using errcode='WF422'; end if;
  select * into p from public.finance_pay_policies where id=v.policy_id;
  select template_version_id into tv from public.module_workflow_bindings
    where module_key='finance_pay_policy' and workflow_type='finance_pay_policy_approval'
      and trigger_event='finance.payroll.policy.submitted' and is_active order by priority limit 1;
  if tv is null then raise exception 'pay_policy: approval workflow is not configured' using errcode='WF422'; end if;
  wf:=public.workflow_start_instance_tx(tv,'finance_pay_policy','finance_pay_policy_approval',v.id::text,p.code,
    'finance.payroll.policy.submitted',p_actor_id,p.owner_id,null,null,'high',
    jsonb_build_object('policyId',p.id,'policyCode',p.code,'versionNo',v.version_no,'checksum',pf->>'checksum'),
    jsonb_build_object('source_review',jsonb_build_object('roleKey','hr_manager')),'pps-wf:'||p_request_key);
  update public.finance_pay_policy_versions set status='pending_approval',workflow_id=(wf->>'workflowId')::uuid,
    canonical_checksum=pf->>'checksum',submitted_by=p_actor_id,submitted_at=now(),lock_version=lock_version+1 where id=v.id;
  insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,actor_user_id,severity,payload,dedupe_key)
    values('finance.payroll.policy.submitted','finance_pay_policy','pay_policy_version',v.id::text,p_actor_id,'info',
      jsonb_build_object('policyId',p.id,'policyCode',p.code,'workflowId',wf->>'workflowId','checksum',pf->>'checksum'),
      'finance.pay_policy.submit:'||p_request_key);
  insert into public.hr_audit_log(submodule_key,record_id,actor_id,action,previous_state,new_state)
    values('finance_pay_policy',v.id::text,p_actor_id,'pay_policy.submitted',jsonb_build_object('status','draft'),
      jsonb_build_object('status','pending_approval','workflowId',wf->>'workflowId','checksum',pf->>'checksum'));
  result:=jsonb_build_object('policyId',p.id,'versionId',v.id,'status','pending_approval','workflowId',wf->>'workflowId',
    'taskIds',coalesce(wf->'firstTasks','[]'::jsonb),'checksum',pf->>'checksum');
  insert into public.finance_pay_policy_command_receipts values(p_request_key,p_input_hash,'submit',p.id,result,now());
  return result;
end $fn$;

create or replace function public.finance_pay_policy_workflow_transition_tx(
  p_transition_id uuid,p_version_id uuid,p_actor_id text,p_target_status text,p_comment text,p_input_hash text
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare receipt public.workflow_source_receipts%rowtype; v public.finance_pay_policy_versions%rowtype;
  result jsonb; target text; event_id uuid;
begin
  select * into receipt from public.workflow_source_receipts where transition_id=p_transition_id;
  if found then if receipt.input_hash<>p_input_hash then raise exception 'pay_policy: transition receipt mismatch' using errcode='WF409'; end if; return receipt.result; end if;
  select * into v from public.finance_pay_policy_versions where id=p_version_id for update;
  if not found then raise exception 'pay_policy: version not found' using errcode='WF404'; end if;
  if v.status<>'pending_approval' then raise exception 'pay_policy: expected pending approval' using errcode='WF409'; end if;
  target:=case p_target_status when 'approved' then 'approved' when 'returned' then 'draft' when 'rejected' then 'rejected' when 'cancelled' then 'draft' else null end;
  if target is null then raise exception 'pay_policy: invalid workflow outcome' using errcode='WF400'; end if;
  if p_target_status='approved' and v.prepared_by=p_actor_id then raise exception 'pay_policy: preparer cannot approve' using errcode='WF422'; end if;
  update public.finance_pay_policy_versions set status=target,
    approved_by=case when target='approved' then p_actor_id else approved_by end,
    approved_at=case when target='approved' then now() else approved_at end where id=v.id;
  insert into public.hr_audit_log(submodule_key,record_id,actor_id,action,previous_state,new_state,reason)
    values('finance_pay_policy',v.id::text,p_actor_id,'pay_policy.'||p_target_status,
      jsonb_build_object('status',v.status),jsonb_build_object('status',target),nullif(p_comment,''));
  insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,actor_user_id,severity,payload,dedupe_key)
    values('finance.payroll.policy.'||p_target_status,'finance_pay_policy','pay_policy_version',v.id::text,p_actor_id,
      case when target='approved' then 'success' else 'warning' end,jsonb_build_object('status',target,'reason',p_comment),
      'finance.pay_policy.transition:'||p_transition_id) returning id into event_id;
  insert into public.notifications(
    user_id,type,title,body,is_read,link,event_id,module,severity,source_type,source_id,action_route,metadata,dedupe_key
  ) values(
    v.prepared_by,'finance.payroll.policy.'||p_target_status,
    case when target='approved' then 'Pay Policy Approved' else 'Pay Policy Review '||initcap(target) end,
    case when target='approved' then 'The policy version is ready for independent activation.'
      else 'The policy review finished with status '||replace(target,'_',' ')||'.' end,
    false,'/finance/payroll/setup?policy='||v.policy_id,event_id,'finance_pay_policy',
    case when target='approved' then 'success' else 'warning' end,'pay_policy_version',v.id::text,
    '/finance/payroll/setup?policy='||v.policy_id,jsonb_build_object('policyId',v.policy_id,'versionId',v.id,'reason',p_comment),
    'finance.pay_policy.transition:'||p_transition_id
  );
  result:=jsonb_build_object('versionId',v.id,'policyId',v.policy_id,'status',target);
  insert into public.workflow_source_receipts(transition_id,module_key,source_id,input_hash,result)
    values(p_transition_id,'finance_pay_policy',v.id::text,p_input_hash,result);
  return result;
end $fn$;

create or replace function public.finance_pay_policy_admin_command_tx(
  p_command text,p_policy_id uuid,p_version_id uuid,p_actor_id text,p_request_key text,p_input_hash text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare r public.finance_pay_policy_command_receipts%rowtype; p public.finance_pay_policies%rowtype;
  v public.finance_pay_policy_versions%rowtype; a public.finance_pay_group_policy_assignments%rowtype;
  pf jsonb; event_id uuid; result jsonb; prior jsonb; aid uuid;
begin
  select * into r from public.finance_pay_policy_command_receipts where request_key=p_request_key for update;
  if found then if r.input_hash<>p_input_hash then raise exception 'pay_policy: idempotency key payload mismatch' using errcode='WF409'; end if; return r.result; end if;
  select * into p from public.finance_pay_policies where id=p_policy_id for update;
  if not found then raise exception 'pay_policy: policy not found' using errcode='WF404'; end if;
  if p_command='activate' then
    perform pg_advisory_xact_lock(hashtextextended(p.id::text,0));
    select * into v from public.finance_pay_policy_versions where id=p_version_id and policy_id=p.id for update;
    if not found then raise exception 'pay_policy: version not found' using errcode='WF404'; end if;
    if v.status<>'approved' then raise exception 'pay_policy: only approved versions can be activated' using errcode='WF409'; end if;
    if v.prepared_by=p_actor_id then raise exception 'pay_policy: preparer cannot activate' using errcode='WF422'; end if;
    pf:=public.finance_pay_policy_preflight(v.id);
    if not (pf->>'ready')::boolean or pf->>'checksum'<>v.canonical_checksum then
      raise exception 'pay_policy: configuration changed or preflight has blockers' using errcode='WF409'; end if;
    update public.finance_pay_policy_versions set status='superseded',
      effective_to=least(coalesce(effective_to,v.effective_from-1),v.effective_from-1)
      where policy_id=p.id and status='active' and id<>v.id and effective_from<v.effective_from;
    if exists(select 1 from public.finance_pay_policy_versions where policy_id=p.id and status='active' and id<>v.id
      and daterange(effective_from,coalesce(effective_to+1,'infinity'::date),'[)') &&
          daterange(v.effective_from,coalesce(v.effective_to+1,'infinity'::date),'[)'))
      then raise exception 'pay_policy: active effective periods overlap' using errcode='WF409'; end if;
    update public.finance_pay_policy_versions set status='active',activated_by=p_actor_id,activated_at=now() where id=v.id;
    update public.finance_pay_policies set status='active' where id=p.id;
    insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,actor_user_id,severity,payload,dedupe_key)
      values('finance.payroll.policy.activated','finance_pay_policy','pay_policy_version',v.id::text,p_actor_id,'success',
        jsonb_build_object('policyId',p.id,'policyCode',p.code,'versionNo',v.version_no,'checksum',v.canonical_checksum),
        'finance.pay_policy.activate:'||p_request_key) returning id into event_id;
    insert into public.hr_audit_log(submodule_key,record_id,actor_id,action,previous_state,new_state)
      values('finance_pay_policy',v.id::text,p_actor_id,'pay_policy.activated',jsonb_build_object('status','approved'),
        jsonb_build_object('status','active','checksum',v.canonical_checksum));
    insert into public.notifications(user_id,type,title,body,is_read,link,event_id,module,severity,source_type,source_id,action_route,metadata,dedupe_key)
      values(v.prepared_by,'finance.payroll.policy.activated','Pay Policy '||p.code||' Activated',
        'Version '||v.version_no||' is approved for local TTD payroll.',false,'/finance/payroll/setup?policy='||p.id,event_id,
        'finance_pay_policy','success','pay_policy',p.id::text,'/finance/payroll/setup?policy='||p.id,
        jsonb_build_object('versionId',v.id),'finance.pay_policy.activated:'||v.id);
    insert into public.handoff_outbox(source_module,target_module,source_entity_type,source_entity_id,target_entity_type,payload,status,created_by)
      values('finance_pay_policy','finance_payroll','pay_policy_version',v.id::text,'pay_policy_version',
        jsonb_build_object('action','pay_policy_activated','policyId',p.id,'versionId',v.id,'effectiveFrom',v.effective_from,'checksum',v.canonical_checksum),'pending',p_actor_id);
    result:=jsonb_build_object('policyId',p.id,'versionId',v.id,'status','active','checksum',v.canonical_checksum);
  elsif p_command='assign' then
    perform pg_advisory_xact_lock(hashtextextended(p_payload->>'payGroupId',0));
    select * into v from public.finance_pay_policy_versions where id=p_version_id and policy_id=p.id and status='active';
    if not found then raise exception 'pay_policy: assignment requires an active version' using errcode='WF409'; end if;
    insert into public.finance_pay_group_policy_assignments(pay_group_id,policy_id,policy_version_id,effective_from,effective_to,assigned_by)
      values((p_payload->>'payGroupId')::uuid,p.id,v.id,(p_payload->>'effectiveFrom')::date,nullif(p_payload->>'effectiveTo','')::date,p_actor_id)
      returning id into aid;
    insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,actor_user_id,severity,payload,dedupe_key)
      values('finance.payroll.policy.pay_group_assigned','finance_pay_policy','pay_policy_assignment',aid::text,p_actor_id,'success',
        jsonb_build_object('policyId',p.id,'versionId',v.id,'payGroupId',p_payload->>'payGroupId'),'finance.pay_policy.assign:'||p_request_key);
    insert into public.hr_audit_log(submodule_key,record_id,actor_id,action,new_state)
      values('finance_pay_policy',aid::text,p_actor_id,'pay_policy.pay_group_assigned',
        jsonb_build_object('policyId',p.id,'versionId',v.id,'payGroupId',p_payload->>'payGroupId','effectiveFrom',p_payload->>'effectiveFrom'));
    insert into public.handoff_outbox(source_module,target_module,source_entity_type,source_entity_id,target_entity_type,payload,status,created_by)
      values('finance_pay_policy','finance_payroll','pay_policy_assignment',aid::text,'pay_policy_assignment',
        jsonb_build_object('action','pay_group_policy_assigned','policyId',p.id,'versionId',v.id,'payGroupId',p_payload->>'payGroupId'),'pending',p_actor_id);
    result:=jsonb_build_object('assignmentId',aid,'policyId',p.id,'versionId',v.id,'status','active');
  elsif p_command='end_assignment' then
    select * into a from public.finance_pay_group_policy_assignments where id=(p_payload->>'assignmentId')::uuid and policy_id=p.id for update;
    if not found then raise exception 'pay_policy: assignment not found' using errcode='WF404'; end if;
    if a.status<>'active' then raise exception 'pay_policy: assignment is already ended' using errcode='WF409'; end if;
    if (p_payload->>'effectiveTo')::date<a.effective_from then raise exception 'pay_policy: end date precedes assignment' using errcode='WF422'; end if;
    update public.finance_pay_group_policy_assignments set status='ended',effective_to=(p_payload->>'effectiveTo')::date,
      ended_by=p_actor_id,end_reason=p_payload->>'reason' where id=a.id;
    insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,actor_user_id,severity,payload,dedupe_key)
      values('finance.payroll.policy.pay_group_assignment_ended','finance_pay_policy','pay_policy_assignment',a.id::text,p_actor_id,'warning',
        jsonb_build_object('policyId',p.id,'effectiveTo',p_payload->>'effectiveTo','reason',p_payload->>'reason'),'finance.pay_policy.end_assignment:'||p_request_key);
    insert into public.hr_audit_log(submodule_key,record_id,actor_id,action,previous_state,new_state,reason)
      values('finance_pay_policy',a.id::text,p_actor_id,'pay_policy.pay_group_assignment_ended',jsonb_build_object('status','active'),
        jsonb_build_object('status','ended','effectiveTo',p_payload->>'effectiveTo'),p_payload->>'reason');
    result:=jsonb_build_object('assignmentId',a.id,'policyId',p.id,'status','ended','effectiveTo',p_payload->>'effectiveTo');
  elsif p_command='retire' then
    if p.status<>'active' then raise exception 'pay_policy: only active policies can be retired' using errcode='WF409'; end if;
    if exists(select 1 from public.finance_pay_policy_versions where policy_id=p.id and status in ('draft','pending_approval','approved')) then
      raise exception 'pay_policy: finish the unpublished version before retirement' using errcode='WF409';
    end if;
    update public.finance_pay_policies set status='retired' where id=p.id;
    update public.finance_pay_policy_versions set status='retired',retired_by=p_actor_id,retired_at=now(),
      effective_to=least(coalesce(effective_to,(p_payload->>'effectiveTo')::date),(p_payload->>'effectiveTo')::date)
      where policy_id=p.id and status='active';
    update public.finance_pay_group_policy_assignments set status='ended',effective_to=least(coalesce(effective_to,(p_payload->>'effectiveTo')::date),(p_payload->>'effectiveTo')::date),
      ended_by=p_actor_id,end_reason=p_payload->>'reason' where policy_id=p.id and status='active';
    insert into public.app_events(event_type,source_module,source_entity_type,source_entity_id,actor_user_id,severity,payload,dedupe_key)
      values('finance.payroll.policy.retired','finance_pay_policy','pay_policy',p.id::text,p_actor_id,'warning',
        jsonb_build_object('effectiveTo',p_payload->>'effectiveTo','reason',p_payload->>'reason'),'finance.pay_policy.retire:'||p_request_key);
    insert into public.hr_audit_log(submodule_key,record_id,actor_id,action,previous_state,new_state,reason)
      values('finance_pay_policy',p.id::text,p_actor_id,'pay_policy.retired',jsonb_build_object('status','active'),
        jsonb_build_object('status','retired','effectiveTo',p_payload->>'effectiveTo'),p_payload->>'reason');
    result:=jsonb_build_object('policyId',p.id,'status','retired','effectiveTo',p_payload->>'effectiveTo');
  else raise exception 'pay_policy: unsupported admin command' using errcode='WF400'; end if;
  insert into public.finance_pay_policy_command_receipts values(p_request_key,p_input_hash,p_command,p.id,result,now());
  return result;
exception when exclusion_violation then raise exception 'pay_policy: pay-group assignment overlaps an active assignment' using errcode='WF409';
end $fn$;

revoke all on function public.finance_pay_policy_preflight(uuid) from public,anon,authenticated;
revoke all on function public.finance_pay_policy_draft_command_tx(text,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.finance_pay_policy_copy_version_tx(uuid,uuid,date,text,text,text,text) from public,anon,authenticated;
revoke all on function public.finance_pay_policy_submit_tx(uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.finance_pay_policy_workflow_transition_tx(uuid,uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.finance_pay_policy_admin_command_tx(text,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finance_pay_policy_preflight(uuid) to service_role;
grant execute on function public.finance_pay_policy_draft_command_tx(text,uuid,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.finance_pay_policy_copy_version_tx(uuid,uuid,date,text,text,text,text) to service_role;
grant execute on function public.finance_pay_policy_submit_tx(uuid,text,text,text,jsonb) to service_role;
grant execute on function public.finance_pay_policy_workflow_transition_tx(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.finance_pay_policy_admin_command_tx(text,uuid,uuid,text,text,text,jsonb) to service_role;
