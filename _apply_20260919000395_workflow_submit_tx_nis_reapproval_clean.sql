create or replace function public.workflow_submit_for_record_tx(
  p_source_table text,
  p_source_id    text,
  p_actor_id     text,
  p_binding_id   uuid,
  p_request_key  text,
  p_business     jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_hash          text;
  v_receipt_key   text;
  v_claim         jsonb;
  v_run           public.finance_payroll_runs%rowtype;
  v_tmpl          public.payroll_payslip_templates%rowtype;
  v_rem           public.finance_remittances%rowtype;
  v_loan          public.finance_employee_loans%rowtype;
  v_stat          public.finance_statutory_versions%rowtype;
  v_comp          public.hr_employee_pay_items%rowtype;
  v_disb          public.finance_disbursements%rowtype;
  v_exp           public.finance_expense_claims%rowtype;
  v_haz           public.hse_hazards%rowtype;
  v_hra           public.hse_risk_assessments%rowtype;
  v_hjsa          public.hse_jsa%rowtype;
  v_ts            public.hr_timesheets%rowtype;
  v_prof          public.hr_employee_statutory_profiles%rowtype;
  v_prior_module  text;
  v_prior_source  text;
  v_module_key    text;
  v_workflow_type text;
  v_trigger       text;
  v_from_status   text;
  v_to_status     text;
  v_owner         text;
  v_ref           text;
  v_period_month  text;
  v_biz_module    text;
  v_event_type    text;
  v_entity_type   text;
  v_audit_action  text;
  v_audit_target  text := 'hr_audit_log';
  v_priority      text;
  v_source_ctx    jsonb;
  v_binding       public.module_workflow_bindings%rowtype;
  v_ver           public.workflow_template_versions%rowtype;
  v_min_seq       numeric;
  v_step          jsonb;
  v_assignees     jsonb := '{}'::jsonb;
  v_prior_wf      uuid;
  v_prior_status  text;
  v_supersedes    uuid;
  v_res           jsonb;
  v_wf_id         uuid;
  v_event_id      uuid;
  v_result        jsonb;
  c_terminal      constant text[] := array['completed','approved','returned','rejected','cancelled','closed'];
  c_uuid_re       constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  p_business := coalesce(p_business, '{}'::jsonb);
  if jsonb_typeof(p_business) <> 'object' then
    raise exception 'workflow_submit: business payload must be a JSON object' using errcode = 'WF400';
  end if;

  if p_request_key is null or btrim(p_request_key) = '' then
    raise exception 'workflow_submit: request_key is required' using errcode = 'WF400';
  end if;
  v_receipt_key := coalesce(p_actor_id, '') || '|submit|' || coalesce(p_source_table, '') || '|' || p_request_key;
  v_priority    := coalesce(nullif(p_business->>'priority', ''), 'medium');

  v_hash := md5((jsonb_build_object(
              'table', p_source_table, 'source', p_source_id, 'actor', p_actor_id,
              'binding', p_binding_id, 'business', p_business))::text);

  v_claim := wf_internal._claim_request(v_receipt_key, v_hash);
  if v_claim->>'status' = 'duplicate' then
    return coalesce(nullif(v_claim->'result', 'null'::jsonb),
                    jsonb_build_object('workflowId', v_claim->>'workflowId', 'duplicate', true));
  end if;

  if p_source_table = 'finance_payroll_runs' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_run from public.finance_payroll_runs where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: payroll run % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_run.status not in ('calculated', 'returned') then
      raise exception 'workflow_submit: run % is % (only calculated/returned can be submitted)', p_source_id, v_run.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_payroll';
    v_workflow_type:= 'finance_payroll_approval';
    v_trigger      := 'finance.payroll.run.submitted';
    v_from_status  := v_run.status;
    v_to_status    := 'pending_approval';
    v_owner        := v_run.created_by;
    v_ref          := v_run.run_no;
    v_period_month := v_run.period_month::text;
    v_prior_wf     := v_run.workflow_id;
    v_biz_module   := 'finance_payroll';
    v_event_type   := 'finance.payroll.run.submitted';
    v_entity_type  := 'payroll_run';
    v_audit_action := 'payroll_run.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'runNo', v_run.run_no, 'periodMonth', v_period_month,
                        'sourceType', 'payroll_run', 'submittedBy', p_actor_id);

  elsif p_source_table = 'payroll_payslip_templates' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_tmpl from public.payroll_payslip_templates where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: payslip template % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_tmpl.status not in ('draft', 'changes_requested') then
      raise exception 'workflow_submit: template % is % (only draft/changes_requested can be submitted)', p_source_id, v_tmpl.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_payroll_templates';
    v_workflow_type:= 'payslip_template_approval';
    v_trigger      := 'finance.payroll.template.submitted';
    v_from_status  := v_tmpl.status;
    v_to_status    := 'pending_approval';
    v_owner        := v_tmpl.created_by;
    v_ref          := v_tmpl.name;
    v_prior_wf     := v_tmpl.workflow_id;
    v_biz_module   := 'finance_payroll';
    v_event_type   := 'finance.payroll.payslip_template.submitted';
    v_entity_type  := 'payslip_template';
    v_audit_action := 'payslip_template.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'templateName', v_tmpl.name, 'version', v_tmpl.version,
                        'sourceType', 'payslip_template', 'submittedBy', p_actor_id);

  elsif p_source_table = 'finance_remittances' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_rem from public.finance_remittances where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: remittance % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_rem.status <> 'draft' then
      raise exception 'workflow_submit: remittance % is % (only draft can be submitted)', p_source_id, v_rem.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_remittances';
    v_workflow_type:= 'finance_remittance_approval';
    v_trigger      := 'finance.remittance.submitted';
    v_from_status  := v_rem.status;
    v_to_status    := 'submitted';
    v_owner        := v_rem.created_by;
    v_ref          := v_rem.remittance_no;
    v_prior_wf     := v_rem.workflow_id;
    v_biz_module   := 'finance_remittances';
    v_event_type   := 'finance.remittance.submitted';
    v_entity_type  := 'remittance';
    v_audit_action := 'remittance.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'remittanceNo', v_rem.remittance_no, 'authority', v_rem.authority,
                        'sourceType', 'remittance', 'submittedBy', p_actor_id);

  elsif p_source_table = 'finance_employee_loans' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_loan from public.finance_employee_loans where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: loan % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_loan.status not in ('draft', 'rejected') then
      raise exception 'workflow_submit: loan % is % (only draft/rejected can be submitted)', p_source_id, v_loan.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_loan';
    v_workflow_type:= 'finance_loan_approval';
    v_trigger      := 'finance.loan.submitted';
    v_from_status  := v_loan.status;
    v_to_status    := 'pending_approval';
    v_owner        := v_loan.created_by;
    v_ref          := v_loan.reference;
    v_prior_wf     := v_loan.workflow_id;
    v_biz_module   := 'finance_loan';
    v_event_type   := 'finance.loan.submitted';
    v_entity_type  := 'employee_loan';
    v_audit_action := 'loan.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'reference', v_loan.reference, 'employeeId', v_loan.employee_id,
                        'sourceType', 'employee_loan', 'submittedBy', p_actor_id);

  elsif p_source_table = 'finance_statutory_versions' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_stat from public.finance_statutory_versions where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: statutory version % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_stat.status not in ('draft', 'approved') then
      raise exception 'workflow_submit: statutory version % is % (only draft or approved can be submitted for re-approval)', p_source_id, v_stat.status using errcode = 'WF409';
    end if;
    v_ref          := 'SV-' || upper(left(p_source_id, 8));
    v_module_key   := 'finance_statutory';
    v_workflow_type:= 'finance_statutory_approval';
    v_trigger      := 'finance.statutory.version.submitted';
    v_from_status  := v_stat.status;
    v_to_status    := 'pending_approval';
    v_owner        := v_stat.created_by;
    v_prior_wf     := v_stat.workflow_id;
    v_biz_module   := 'finance_statutory';
    v_event_type   := 'finance.statutory.version.submitted';
    v_entity_type  := 'statutory_version';
    v_audit_action := case when v_stat.status = 'approved'
                          then 'statutory_version.reopened_by_edit'
                          else 'statutory_version.submitted' end;
    v_source_ctx   := p_business || jsonb_build_object(
                        'ref', v_ref, 'sourceType', 'statutory_version', 'submittedBy', p_actor_id);

  elsif p_source_table = 'hr_employee_pay_items' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_comp from public.hr_employee_pay_items where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: pay item % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_comp.status <> 'draft' then
      raise exception 'workflow_submit: pay item % is % (only draft can be submitted)', p_source_id, v_comp.status using errcode = 'WF409';
    end if;
    v_ref          := coalesce(v_comp.item_no, 'PIT-' || upper(left(p_source_id, 8)));
    v_module_key   := 'hr_compensation';
    v_workflow_type:= 'hr_compensation_change_approval';
    v_trigger      := 'hr.compensation.item.submitted';
    v_from_status  := v_comp.status;
    v_to_status    := 'pending_approval';
    v_owner        := v_comp.created_by;
    v_prior_wf     := v_comp.workflow_id;
    v_biz_module   := 'hr_compensation';
    v_event_type   := 'hr.compensation.item.submitted';
    v_entity_type  := 'pay_item';
    v_audit_action := 'pay_item.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'ref', v_ref, 'employeeId', v_comp.employee_id,
                        'sourceType', 'pay_item', 'submittedBy', p_actor_id);

  elsif p_source_table = 'finance_disbursements' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_disb from public.finance_disbursements where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: disbursement % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_disb.status <> 'draft' then
      raise exception 'workflow_submit: disbursement % is % (only draft can be submitted)', p_source_id, v_disb.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_disbursements';
    v_workflow_type:= 'finance_disbursement_approval';
    v_trigger      := 'finance.disbursement.submitted';
    v_from_status  := v_disb.status;
    v_to_status    := 'submitted';
    v_owner        := v_disb.created_by;
    v_ref          := v_disb.disbursement_no;
    v_prior_wf     := v_disb.workflow_id;
    v_biz_module   := 'finance_disbursements';
    v_event_type   := 'finance.disbursement.submitted';
    v_entity_type  := 'disbursement';
    v_audit_action := 'disbursement.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'disbursementNo', v_ref, 'sourceType', 'disbursement', 'submittedBy', p_actor_id);

  elsif p_source_table = 'finance_expense_claims' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_exp from public.finance_expense_claims where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: expense claim % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_exp.status <> 'draft' then
      raise exception 'workflow_submit: expense claim % is % (only draft can be submitted)', p_source_id, v_exp.status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_expenses';
    v_workflow_type:= 'finance_expense_approval';
    v_trigger      := 'finance.expense.submitted';
    v_from_status  := v_exp.status;
    v_to_status    := 'submitted';
    v_owner        := v_exp.claimant_id;
    v_ref          := v_exp.claim_no;
    v_prior_wf     := v_exp.workflow_id;
    v_biz_module   := 'finance_expenses';
    v_event_type   := 'finance.expense.submitted';
    v_entity_type  := 'expense_claim';
    v_audit_action := 'expense.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'claimNo', v_ref, 'sourceType', 'expense_claim', 'submittedBy', p_actor_id);

  elsif p_source_table = 'hse_hazards' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_haz from public.hse_hazards where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: hazard % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_haz.status in ('under_review', 'approved', 'archived') then
      raise exception 'workflow_submit: hazard % is % (cannot be submitted)', p_source_id, v_haz.status using errcode = 'WF409';
    end if;
    v_audit_target := 'audit_logs';
    v_module_key   := 'hse_hazards';
    v_workflow_type:= 'hazard_review';
    v_trigger      := 'hazard.submitted';
    v_from_status  := v_haz.status;
    v_to_status    := 'under_review';
    v_owner        := coalesce(v_haz.owner_user_id, p_actor_id);
    v_ref          := v_haz.ref;
    v_prior_wf     := v_haz.workflow_id;
    v_biz_module   := 'hse';
    v_event_type   := 'hse.hazard.submitted';
    v_entity_type  := 'hazard';
    v_audit_action := 'hse.hazard.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'ref', v_ref, 'title', v_haz.title, 'sourceType', 'hazard', 'submittedBy', p_actor_id);

  elsif p_source_table = 'hse_risk_assessments' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_hra from public.hse_risk_assessments where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: risk assessment % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_hra.status not in ('draft', 'returned') then
      raise exception 'workflow_submit: risk assessment % is % (only draft/returned can be submitted)', p_source_id, v_hra.status using errcode = 'WF409';
    end if;
    v_audit_target := 'audit_logs';
    v_module_key   := 'hse_risk_assessments';
    v_workflow_type:= 'risk_assessment_review';
    v_trigger      := 'risk_assessment.submitted';
    v_from_status  := v_hra.status;
    v_to_status    := 'under_review';
    v_owner        := coalesce(v_hra.owner_user_id, p_actor_id);
    v_ref          := v_hra.ref;
    v_prior_wf     := v_hra.workflow_id;
    v_biz_module   := 'hse';
    v_event_type   := 'hse.risk_assessment.submitted';
    v_entity_type  := 'risk_assessment';
    v_audit_action := 'hse.risk_assessment.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'ref', v_ref, 'title', v_hra.title, 'sourceType', 'risk_assessment', 'submittedBy', p_actor_id);

  elsif p_source_table = 'hse_jsa' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_hjsa from public.hse_jsa where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: jsa % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_hjsa.status not in ('draft', 'returned') then
      raise exception 'workflow_submit: jsa % is % (only draft/returned can be submitted)', p_source_id, v_hjsa.status using errcode = 'WF409';
    end if;
    v_audit_target := 'audit_logs';
    v_module_key   := 'hse_jsa';
    v_workflow_type:= 'jsa_review';
    v_trigger      := 'jsa.submitted';
    v_from_status  := v_hjsa.status;
    v_to_status    := 'under_review';
    v_owner        := coalesce(v_hjsa.owner_user_id, p_actor_id);
    v_ref          := v_hjsa.ref;
    v_prior_wf     := v_hjsa.workflow_id;
    v_biz_module   := 'hse';
    v_event_type   := 'hse.jsa.submitted';
    v_entity_type  := 'jsa';
    v_audit_action := 'hse.jsa.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'ref', v_ref, 'title', v_hjsa.title, 'sourceType', 'jsa', 'submittedBy', p_actor_id);

  elsif p_source_table = 'hr_timesheets' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_ts from public.hr_timesheets where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: timesheet % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_ts.status not in ('draft', 'reopened') then
      raise exception 'workflow_submit: timesheet % is % (only draft/reopened can be submitted)', p_source_id, v_ts.status using errcode = 'WF409';
    end if;
    v_module_key   := 'hr_attendance';
    v_workflow_type:= 'hr_timesheet_approval';
    v_trigger      := 'hr.timesheet.submitted';
    v_from_status  := v_ts.status;
    v_to_status    := 'in_review';
    v_owner        := v_ts.employee_id;
    v_ref          := v_ts.timesheet_no;
    v_prior_wf     := v_ts.workflow_id;
    v_biz_module   := 'hr_attendance';
    v_event_type   := 'hr.timesheet.submitted';
    v_entity_type  := 'timesheet';
    v_audit_action := 'timesheet.submitted';
    v_source_ctx   := p_business || jsonb_build_object(
                        'ref', v_ts.timesheet_no, 'employeeId', v_ts.employee_id,
                        'sourceType', 'timesheet', 'submittedBy', p_actor_id);

  elsif p_source_table = 'hr_employee_statutory_profiles' then
    if p_source_id !~* c_uuid_re then
      raise exception 'workflow_submit: source id % is not a valid uuid', p_source_id using errcode = 'WF400';
    end if;
    select * into v_prof from public.hr_employee_statutory_profiles where id = p_source_id::uuid for update;
    if not found then
      raise exception 'workflow_submit: statutory profile % not found', p_source_id using errcode = 'WF404';
    end if;
    if v_prof.nis_status not in ('pending_verification', 'not_available') then
      raise exception 'workflow_submit: statutory profile % is % (only pending_verification/not_available can be submitted)', p_source_id, v_prof.nis_status using errcode = 'WF409';
    end if;
    v_module_key   := 'finance_payroll';
    v_workflow_type:= 'finance_nis_profile_verification';
    v_trigger      := 'finance.nis.profile.submitted';
    v_from_status  := v_prof.nis_status;
    v_to_status    := v_prof.nis_status;
    v_owner        := v_prof.created_by;
    v_ref          := 'NIS-' || upper(left(p_source_id, 8));
    v_prior_wf     := v_prof.workflow_id;
    v_biz_module   := 'hr_statutory';
    v_event_type   := 'finance.nis.profile.submitted';
    v_entity_type  := 'statutory_profile';
    v_audit_action := 'statutory_profile.submitted';
    v_source_ctx   := jsonb_build_object(
                        'employeeId', v_prof.employee_id, 'jurisdiction', v_prof.jurisdiction,
                        'nisNumber', v_prof.nis_number, 'nisApplicable', v_prof.nis_applicable);

  else
    raise exception 'workflow_submit: unsupported source table %', p_source_table using errcode = 'WF400';
  end if;

  if v_prior_wf is not null then
    select status, module_key, source_record_id
      into v_prior_status, v_prior_module, v_prior_source
      from public.workflow_instances where id = v_prior_wf;
    if v_prior_status is null then
      v_supersedes := null;
    else
      if v_prior_module is distinct from v_module_key or v_prior_source is distinct from p_source_id then
        raise exception 'workflow_submit: stored workflow % for record % belongs to a different record', v_prior_wf, p_source_id using errcode = 'WF409';
      end if;
      if not (v_prior_status = any (c_terminal)) then
        raise exception 'workflow_submit: record % already has an active workflow (%)', p_source_id, v_prior_status using errcode = 'WF409';
      end if;
      v_supersedes := v_prior_wf;
    end if;
  end if;

  lock table public.module_workflow_bindings in share mode;
  select * into v_binding from public.module_workflow_bindings where id = p_binding_id;
  if not found then
    raise exception 'workflow_submit: binding % not found', p_binding_id using errcode = 'WF404';
  end if;
  if v_binding.template_version_id is not null then
    select * into v_ver from public.workflow_template_versions where id = v_binding.template_version_id for share;
  else
    select * into v_ver from public.workflow_template_versions
      where template_id = v_binding.template_id and version_status = 'published'
      order by version_no desc limit 1 for share;
  end if;
  if v_ver.id is null then
    raise exception 'workflow_submit: binding % has no published version', p_binding_id using errcode = 'WF422';
  end if;

  select min((s.value->>'sequenceNo')::numeric) into v_min_seq
    from jsonb_array_elements(coalesce(v_ver.definition->'steps', '[]'::jsonb)) s;
  for v_step in
    select s.value from jsonb_array_elements(coalesce(v_ver.definition->'steps', '[]'::jsonb)) s
     where (s.value->>'sequenceNo')::numeric = v_min_seq
  loop
    v_assignees := v_assignees || jsonb_build_object(
      v_step->>'stepKey',
      wf_internal._resolve_and_validate_assignee(v_step->'assignment', v_source_ctx, v_owner));
  end loop;

  v_res := wf_internal._create_instance(
    p_binding_id, null, null, v_module_key, v_workflow_type, p_source_id, v_ref,
    v_trigger, p_actor_id, v_owner, null, null, v_priority,
    v_source_ctx, v_assignees, v_supersedes);
  v_wf_id := (v_res->>'workflowId')::uuid;

  if p_source_table = 'finance_payroll_runs' then
    update public.finance_payroll_runs
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'payroll_payslip_templates' then
    update public.payroll_payslip_templates
       set status = v_to_status, workflow_id = v_wf_id, submitted_by = p_actor_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'finance_remittances' then
    update public.finance_remittances
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'finance_employee_loans' then
    update public.finance_employee_loans
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'finance_statutory_versions' then
    update public.finance_statutory_versions
       set status      = v_to_status,
           workflow_id = v_wf_id,
           approved_by = case when v_from_status = 'approved' then null else approved_by end
     where id = p_source_id::uuid;
  elsif p_source_table = 'hr_employee_pay_items' then
    update public.hr_employee_pay_items
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'finance_disbursements' then
    update public.finance_disbursements
       set status = v_to_status, workflow_id = v_wf_id,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('submittedAt', now())
     where id = p_source_id::uuid;
  elsif p_source_table = 'finance_expense_claims' then
    update public.finance_expense_claims
       set status = v_to_status, workflow_id = v_wf_id
     where id = p_source_id::uuid;
  elsif p_source_table = 'hse_hazards' then
    update public.hse_hazards
       set status = v_to_status, workflow_id = v_wf_id, updated_at = now()
     where id = p_source_id::uuid;
  elsif p_source_table = 'hse_risk_assessments' then
    update public.hse_risk_assessments
       set status = v_to_status, workflow_id = v_wf_id, updated_at = now()
     where id = p_source_id::uuid;
  elsif p_source_table = 'hse_jsa' then
    update public.hse_jsa
       set status = v_to_status, workflow_id = v_wf_id, updated_at = now()
     where id = p_source_id::uuid;
  elsif p_source_table = 'hr_timesheets' then
    update public.hr_timesheets
       set status = v_to_status, workflow_id = v_wf_id, submitted_by = p_actor_id, submitted_at = now()
     where id = p_source_id::uuid;
  elsif p_source_table = 'hr_employee_statutory_profiles' then
    update public.hr_employee_statutory_profiles
       set nis_status = v_to_status, workflow_id = v_wf_id, updated_by = p_actor_id, updated_at = now()
     where id = p_source_id::uuid;
  end if;

  if v_audit_target = 'audit_logs' then
    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, v_ref, p_actor_id, 'info',
       jsonb_build_object('title', p_business->>'title', 'note', p_business->>'note',
                          'workflowId', v_wf_id, 'fromStatus', v_from_status),
       v_event_type || ':' || v_ref || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.audit_logs (action, table_name, record_id, user_id, changes, created_at)
    values
      (v_audit_action, v_entity_type, v_ref, p_actor_id,
       jsonb_build_object('fromStatus', v_from_status, 'toStatus', v_to_status,
                          'workflowId', v_wf_id, 'title', p_business->>'title'),
       now());
  else
    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, v_biz_module, v_entity_type, p_source_id, p_actor_id, 'info',
       jsonb_build_object('ref', v_ref, 'workflowId', v_wf_id, 'fromStatus', v_from_status),
       v_event_type || ':' || p_source_id || ':' || v_wf_id::text)
    returning id into v_event_id;

    insert into public.hr_audit_log
      (submodule_key, record_id, actor_id, action, previous_state, new_state)
    values
      (v_biz_module, p_source_id, p_actor_id, v_audit_action,
       jsonb_build_object('status', v_from_status),
       jsonb_build_object('status', v_to_status, 'workflowId', v_wf_id));
  end if;

  if p_source_table = 'finance_payroll_runs' then
    insert into public.handoff_outbox
      (source_module, target_module, source_entity_type, source_entity_id, target_entity_type, payload, status, created_by)
    values
      (v_biz_module, v_biz_module, 'payroll_run', p_source_id, 'payroll_approval',
       jsonb_build_object('runNo', v_ref, 'periodMonth', v_period_month, 'workflowId', v_wf_id, 'submittedBy', p_actor_id),
       'pending', p_actor_id);
  end if;

  v_result := jsonb_build_object(
    'workflowId', v_wf_id, 'workflowNo', v_res->>'workflowNo',
    'status', v_to_status, 'fromStatus', v_from_status,
    'firstTasks', coalesce(v_res->'firstTasks', '[]'::jsonb),
    'supersededWorkflowId', v_supersedes,
    'businessEventId', v_event_id);

  perform wf_internal._record_request(v_receipt_key, v_hash, 'submit', v_module_key, p_source_id, v_wf_id, v_result);

  return v_result;
end
$fn$;

revoke all    on function public.workflow_submit_for_record_tx(text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.workflow_submit_for_record_tx(text, text, text, uuid, text, jsonb) to service_role;
