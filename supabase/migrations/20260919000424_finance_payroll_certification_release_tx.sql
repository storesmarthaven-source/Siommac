-- ============================================================================
-- Finance payroll certification, funding and release commands
-- ============================================================================
-- Processor certification is version-bound and required by the submission
-- trigger. Funding confirmation and release use independent permissions and
-- immutable receipts. Release atomically creates/links only DRAFT downstream
-- artifacts; bank and statutory approval/payment/filing stay in their modules.
-- ============================================================================

create or replace function public.finance_payroll_certify_run_tx(
  p_run_id          uuid,
  p_actor_id        text,
  p_idempotency_key text,
  p_attestations    jsonb,
  p_note            text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_request_key  text;
  v_hash         text;
  v_receipt      public.finance_payroll_release_command_receipts%rowtype;
  v_run          public.finance_payroll_runs%rowtype;
  v_state        jsonb;
  v_cert         public.finance_payroll_certifications%rowtype;
  v_supersedes   uuid;
  v_cert_no      integer;
  v_evidence     jsonb;
  v_result       jsonb;
  v_event_id     uuid;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_certify: actor is required'
      using errcode = 'PR400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_certify: idempotency key is required'
      using errcode = 'PR400';
  end if;
  if p_attestations is null or jsonb_typeof(p_attestations) <> 'object' then
    raise exception 'finance_payroll_certify: attestations must be a JSON object'
      using errcode = 'PR400';
  end if;
  if p_attestations->'populationReconciled' is distinct from 'true'::jsonb
     or p_attestations->'inputsReviewed' is distinct from 'true'::jsonb
     or p_attestations->'statutoryReviewed' is distinct from 'true'::jsonb
     or p_attestations->'variancesReviewed' is distinct from 'true'::jsonb
     or p_attestations->'paymentReadinessReviewed' is distinct from 'true'::jsonb
     or p_attestations->'glReadinessReviewed' is distinct from 'true'::jsonb then
    raise exception 'finance_payroll_certify: every required attestation must be true'
      using errcode = 'PR422';
  end if;
  if not exists (
    select 1 from public.app_users u
     where u.id = p_actor_id and u.status = 'active'
  ) then
    raise exception 'finance_payroll_certify: actor is not an active user'
      using errcode = 'PR403';
  end if;

  v_request_key :=
    p_actor_id || '|payroll_run.certify|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'runId', p_run_id,
    'actorId', p_actor_id,
    'attestations', p_attestations,
    'note', nullif(btrim(p_note), '')
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  select *
    into v_receipt
    from public.finance_payroll_release_command_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception 'finance_payroll_certify: idempotency key was already used for different inputs'
        using errcode = 'PR409';
    end if;
    return v_receipt.result || jsonb_build_object('duplicate', true);
  end if;

  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id
   for update;
  if not found then
    raise exception 'finance_payroll_certify: run % was not found', p_run_id
      using errcode = 'PR404';
  end if;
  if v_run.status not in ('calculated','returned') then
    raise exception 'finance_payroll_certify: run % is % (only calculated or returned can be certified)',
      p_run_id, v_run.status using errcode = 'PR422';
  end if;
  if v_run.current_calculation_version_id is null
     or v_run.current_input_snapshot_id is null then
    raise exception 'finance_payroll_certify: current calculation and input snapshot are required'
      using errcode = 'PR409';
  end if;

  v_state := public.finance_payroll_certification_state(
    v_run.id,
    v_run.current_calculation_version_id
  );
  if coalesce((v_state->>'ready')::boolean, false) is not true then
    raise exception 'finance_payroll_certify: payroll controls are not ready: %',
      jsonb_build_object(
        'unresolvedBlockers', v_state->'unresolvedBlockerCount',
        'runningAttempts', v_state->'runningAttemptCount',
        'negativeNet', v_state->'negativeNetCount',
        'missingBankAccounts', v_state->'missingBankAccountCount',
        'duplicateBankAccounts', v_state->'duplicateBankAccountCount',
        'missingGlMappings', v_state->'missingGlMappingCount',
        'totalsMatch', v_state->'totalsMatch'
      )::text
      using errcode = 'PR422';
  end if;

  select c.id
    into v_supersedes
    from public.finance_payroll_certifications c
   where c.run_id = v_run.id
     and c.calculation_version_id = v_run.current_calculation_version_id
     and c.certification_type = 'processor'
   order by c.certified_at desc, c.certification_no desc
   limit 1;

  select coalesce(max(c.certification_no), 0) + 1
    into v_cert_no
    from public.finance_payroll_certifications c
   where c.run_id = v_run.id
     and c.calculation_version_id = v_run.current_calculation_version_id
     and c.certification_type = 'processor';

  v_evidence := jsonb_build_object(
    'attestations', p_attestations,
    'controlState', v_state,
    'note', nullif(btrim(p_note), '')
  );

  insert into public.finance_payroll_certifications (
    run_id,
    calculation_version_id,
    input_snapshot_id,
    certification_no,
    certification_type,
    evidence,
    state_checksum,
    checksum,
    supersedes_id,
    certified_by
  )
  values (
    v_run.id,
    v_run.current_calculation_version_id,
    v_run.current_input_snapshot_id,
    v_cert_no,
    'processor',
    v_evidence,
    v_state->>'stateChecksum',
    md5(jsonb_build_object(
      'runId', v_run.id,
      'calculationVersionId', v_run.current_calculation_version_id,
      'certificationNo', v_cert_no,
      'stateChecksum', v_state->>'stateChecksum',
      'attestations', p_attestations,
      'note', nullif(btrim(p_note), ''),
      'actorId', p_actor_id
    )::text),
    v_supersedes,
    p_actor_id
  )
  returning * into v_cert;

  insert into public.app_events (
    event_type,
    source_module,
    source_entity_type,
    source_entity_id,
    actor_user_id,
    severity,
    payload,
    dedupe_key
  )
  values (
    'finance.payroll.run.certified',
    'finance_payroll',
    'payroll_run',
    v_run.id::text,
    p_actor_id,
    'success',
    jsonb_build_object(
      'runNo', v_run.run_no,
      'certificationId', v_cert.id,
      'certificationNo', v_cert.certification_no,
      'calculationVersionId', v_cert.calculation_version_id,
      'checksum', v_cert.checksum
    ),
    'finance.payroll.run.certified:' || v_cert.id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key,
    record_id,
    actor_id,
    action,
    previous_state,
    new_state,
    reason
  )
  values (
    'finance_payroll',
    v_run.id::text,
    p_actor_id,
    'payroll_run.certified',
    case
      when v_supersedes is null then null
      else jsonb_build_object('supersededCertificationId', v_supersedes)
    end,
    jsonb_build_object(
      'certificationId', v_cert.id,
      'certificationNo', v_cert.certification_no,
      'calculationVersionId', v_cert.calculation_version_id,
      'stateChecksum', v_cert.state_checksum
    ),
    nullif(btrim(p_note), '')
  );

  v_result := jsonb_build_object(
    'certification', to_jsonb(v_cert),
    'controlState', v_state,
    'eventId', v_event_id,
    'duplicate', false
  );

  insert into public.finance_payroll_release_command_receipts (
    request_key,
    request_hash,
    run_id,
    actor_id,
    command,
    result
  )
  values (
    v_request_key,
    v_hash,
    v_run.id,
    p_actor_id,
    'certify',
    v_result
  );

  return v_result;
end
$fn$;

create or replace function public.finance_payroll_release_run_tx(
  p_run_id          uuid,
  p_actor_id        text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_request_key          text;
  v_hash                 text;
  v_receipt              public.finance_payroll_release_command_receipts%rowtype;
  v_run                  public.finance_payroll_runs%rowtype;
  v_cert                 public.finance_payroll_certifications%rowtype;
  v_funding              public.finance_payroll_funding_confirmations%rowtype;
  v_journal              public.finance_gl_journals%rowtype;
  v_disbursement         public.finance_disbursements%rowtype;
  v_remittance           public.finance_remittances%rowtype;
  v_release              public.finance_payroll_release_certificates%rowtype;
  v_preflight            jsonb;
  v_result               jsonb;
  v_event_id             uuid;
  v_ref_year             integer;
  v_ref                  text;
  v_authority            text;
  v_period_month         date;
  v_due_date             date;
  v_employee_portion     numeric(15,2);
  v_employer_portion     numeric(15,2);
  v_total_due            numeric(15,2);
  v_existing_line_count  integer;
  v_existing_line_total  numeric(15,2);
  v_locked_bank_count    integer;
  v_inserted_line_count  integer;
  v_inserted_line_total  numeric(15,2);
  v_mismatch_count       integer;
  v_nis_period_schedule  jsonb;
  v_remittance_manifest  jsonb := '[]'::jsonb;
  v_payslip_manifest     jsonb;
  v_gl_checksum          text;
  v_disbursement_checksum text;
  v_artifact_checksums   jsonb;
  v_control_totals       jsonb;
  v_release_checksum     text;
  v_disbursement_created boolean := false;
  v_remittance_created   boolean := false;
  v_artifact_event_id    uuid;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_release: actor is required'
      using errcode = 'PR400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_release: idempotency key is required'
      using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users u
     where u.id = p_actor_id and u.status = 'active'
  ) then
    raise exception 'finance_payroll_release: actor is not an active user'
      using errcode = 'PR403';
  end if;

  v_request_key :=
    p_actor_id || '|payroll_run.release|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'runId', p_run_id,
    'actorId', p_actor_id
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  select *
    into v_receipt
    from public.finance_payroll_release_command_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception 'finance_payroll_release: idempotency key was already used for a different run'
        using errcode = 'PR409';
    end if;
    return v_receipt.result || jsonb_build_object('duplicate', true);
  end if;

  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id
   for update;
  if not found then
    raise exception 'finance_payroll_release: run % was not found', p_run_id
      using errcode = 'PR404';
  end if;

  if v_run.status = 'released' then
    raise exception 'finance_payroll_release: run is already released; replay the original idempotency key'
      using errcode = 'PR409';
  end if;

  if v_run.status <> 'locked' then
    raise exception 'finance_payroll_release: run % is % (only locked can be released)',
      p_run_id, v_run.status using errcode = 'PR422';
  end if;
  if v_run.created_by is null or v_run.approved_by is null then
    raise exception 'finance_payroll_release: preparer and approver provenance are required'
      using errcode = 'PR409';
  end if;
  if p_actor_id = v_run.created_by or p_actor_id = v_run.approved_by then
    raise exception 'finance_payroll_release: releaser must differ from both preparer and approver'
      using errcode = 'PR403';
  end if;

  -- Hold the exact evidence population stable from preflight through release
  -- certificate creation. The mutable primary bank rows are locked and
  -- revalidated separately immediately before the disbursement is built.
  perform l.id
    from public.finance_payroll_calculation_version_lines l
   where l.calculation_version_id = v_run.current_calculation_version_id
   order by l.employee_id
     for share;
  perform p.id
    from public.finance_payslips p
   where p.run_id = v_run.id
   order by p.employee_id
     for share;
  perform jl.id
    from public.finance_gl_journal_lines jl
   where jl.journal_id = v_run.gl_journal_id
   order by jl.line_no
     for share;

  v_preflight := public.finance_payroll_release_preflight(v_run.id);
  if coalesce((v_preflight->>'ready')::boolean, false) is not true then
    raise exception 'finance_payroll_release: release preflight failed: %',
      (v_preflight->'blockers')::text using errcode = 'PR422';
  end if;

  select *
    into v_cert
    from public.finance_payroll_certifications
   where id = v_run.approval_certification_id
     and run_id = v_run.id
     and calculation_version_id = v_run.current_calculation_version_id
   for share;
  if not found then
    raise exception 'finance_payroll_release: approval certification is invalid'
      using errcode = 'PR409';
  end if;
  if p_actor_id = v_cert.certified_by then
    raise exception 'finance_payroll_release: releaser must differ from the payroll certifier'
      using errcode = 'PR403';
  end if;

  select *
    into v_funding
    from public.finance_payroll_funding_confirmations f
   where f.run_id = v_run.id
     and f.calculation_version_id = v_run.current_calculation_version_id
   order by f.confirmed_at desc, f.confirmation_no desc
   limit 1
   for share;
  if not found
     or v_funding.confirmed_amount is distinct from v_run.net_total then
    raise exception 'finance_payroll_release: matching funding confirmation is required'
      using errcode = 'PR409';
  end if;
  if v_funding.confirmed_by is distinct from p_actor_id then
    raise exception 'finance_payroll_release: the funding confirmer must perform the release'
      using errcode = 'PR403';
  end if;

  select *
    into v_journal
    from public.finance_gl_journals
   where id = v_run.gl_journal_id
     and status = 'posted'
     and source_module = 'finance_payroll'
     and metadata->>'payrollRunId' = v_run.id::text
     and metadata->>'calculationVersionId'
       = v_run.current_calculation_version_id::text
    for share;
  if not found then
    raise exception 'finance_payroll_release: a valid posted payroll journal is required'
      using errcode = 'PR409';
  end if;

  -- Freeze the exact bank accounts copied to the draft disbursement. The
  -- partial unique index prevents a concurrent second primary account.
  perform b.id
    from public.finance_employee_bank_accounts b
    join public.finance_payroll_calculation_version_lines l
      on l.employee_id = b.employee_id
     and l.calculation_version_id = v_run.current_calculation_version_id
   where b.is_primary = true
     and b.is_active = true
    for share of b;
  select count(*)::integer
    into v_locked_bank_count
    from public.finance_payroll_calculation_version_lines l
    join public.finance_employee_bank_accounts b
      on b.employee_id = l.employee_id
     and b.is_primary = true
     and b.is_active = true
   where l.calculation_version_id = v_run.current_calculation_version_id;
  if v_locked_bank_count <> v_run.employee_count then
    raise exception
      'finance_payroll_release: bank-account population changed during release (% of % remain ready)',
      v_locked_bank_count, v_run.employee_count using errcode = 'PR409';
  end if;

  v_ref_year := extract(year from current_date)::integer;
  select *
    into v_disbursement
    from public.finance_disbursements d
   where d.payroll_run_id = v_run.id
     and d.status <> 'cancelled'
    for update;

  if not found then
    v_disbursement_created := true;
    v_ref := 'DSB-' || v_ref_year::text || '-' ||
      lpad(public.increment_ref_counter('DSB', v_ref_year)::text, 4, '0');
    insert into public.finance_disbursements (
      disbursement_no,
      payroll_run_id,
      status,
      total_amount,
      employee_count,
      currency,
      created_by,
      metadata
    )
    values (
      v_ref,
      v_run.id,
      'draft',
      v_run.net_total,
      v_run.employee_count,
      'TTD',
      p_actor_id,
      jsonb_build_object(
        'createdByPayrollRelease', true,
        'calculationVersionId', v_run.current_calculation_version_id,
        'certificationId', v_cert.id,
        'fundingConfirmationId', v_funding.id
      )
    )
    returning * into v_disbursement;

    insert into public.finance_disbursement_lines (
      disbursement_id,
      employee_id,
      bank_account_id,
      bank_name_snapshot,
      branch_snapshot,
      account_type_snapshot,
      account_number_snapshot,
      account_number_masked_snapshot,
      transit_number_snapshot,
      routing_snapshot_checksum,
      net_amount,
      metadata
    )
    select
      v_disbursement.id,
      l.employee_id,
      b.id,
      b.bank_name,
      b.branch,
      b.account_type,
      b.account_number,
      b.account_number_masked,
      b.transit_number,
      md5(jsonb_build_object(
        'bankAccountId', b.id,
        'bankName', b.bank_name,
        'branch', b.branch,
        'accountType', b.account_type,
        'accountNumber', b.account_number,
        'accountNumberMasked', b.account_number_masked,
        'transitNumber', b.transit_number
      )::text),
      l.net,
      jsonb_build_object(
        'createdByPayrollRelease', true,
        'calculationVersionLineId', l.id,
        'calculationVersionId', l.calculation_version_id
      )
    from public.finance_payroll_calculation_version_lines l
    join public.finance_employee_bank_accounts b
      on b.employee_id = l.employee_id
     and b.is_primary = true
     and b.is_active = true
    where l.calculation_version_id = v_run.current_calculation_version_id
    order by l.employee_id;

    get diagnostics v_inserted_line_count = row_count;
    select coalesce(sum(dl.net_amount), 0)::numeric(15,2)
      into v_inserted_line_total
      from public.finance_disbursement_lines dl
     where dl.disbursement_id = v_disbursement.id;
    if v_inserted_line_count <> v_run.employee_count
       or v_inserted_line_total is distinct from v_run.net_total then
      raise exception
        'finance_payroll_release: frozen bank lines do not reconcile to the released payroll'
        using errcode = 'PR409';
    end if;
  else
    if v_disbursement.status <> 'draft'
       or v_disbursement.total_amount is distinct from v_run.net_total
       or v_disbursement.employee_count is distinct from v_run.employee_count then
      raise exception 'finance_payroll_release: existing disbursement is not a matching draft'
        using errcode = 'PR409';
    end if;

    select count(*)::integer, coalesce(sum(dl.net_amount), 0)::numeric(15,2)
      into v_existing_line_count, v_existing_line_total
      from public.finance_disbursement_lines dl
     where dl.disbursement_id = v_disbursement.id;
    select count(*)::integer
      into v_mismatch_count
      from public.finance_payroll_calculation_version_lines l
      left join public.finance_employee_bank_accounts b
        on b.employee_id = l.employee_id
       and b.is_primary = true
       and b.is_active = true
      left join public.finance_disbursement_lines dl
        on dl.disbursement_id = v_disbursement.id
       and dl.employee_id = l.employee_id
     where l.calculation_version_id = v_run.current_calculation_version_id
       and (
         dl.id is null
         or dl.net_amount is distinct from l.net
         or dl.bank_account_id is distinct from b.id
         or dl.bank_name_snapshot is distinct from b.bank_name
         or dl.branch_snapshot is distinct from b.branch
         or dl.account_type_snapshot is distinct from b.account_type
         or dl.account_number_snapshot is distinct from b.account_number
         or dl.account_number_masked_snapshot is distinct from b.account_number_masked
         or dl.transit_number_snapshot is distinct from b.transit_number
         or dl.routing_snapshot_checksum is distinct from md5(jsonb_build_object(
           'bankAccountId', b.id,
           'bankName', b.bank_name,
           'branch', b.branch,
           'accountType', b.account_type,
           'accountNumber', b.account_number,
           'accountNumberMasked', b.account_number_masked,
           'transitNumber', b.transit_number
         )::text)
        );
    if v_existing_line_count <> v_run.employee_count
       or v_existing_line_total is distinct from v_run.net_total
       or v_mismatch_count > 0 then
      raise exception 'finance_payroll_release: existing disbursement lines do not match the current calculation'
        using errcode = 'PR409';
    end if;

    update public.finance_disbursements
       set metadata = metadata || jsonb_build_object(
         'linkedByPayrollRelease', true,
         'calculationVersionId', v_run.current_calculation_version_id,
         'certificationId', v_cert.id,
         'fundingConfirmationId', v_funding.id
       )
     where id = v_disbursement.id
    returning * into v_disbursement;
  end if;

  if v_disbursement_created then
    insert into public.app_events (
      event_type,
      source_module,
      source_entity_type,
      source_entity_id,
      actor_user_id,
      severity,
      payload,
      dedupe_key
    )
    values (
      'finance.disbursement.created',
      'finance_disbursements',
      'disbursement',
      v_disbursement.id::text,
      p_actor_id,
      'info',
      jsonb_build_object(
        'disbursementNo', v_disbursement.disbursement_no,
        'payrollRunId', v_run.id,
        'payrollRunNo', v_run.run_no,
        'calculationVersionId', v_run.current_calculation_version_id,
        'totalAmount', v_disbursement.total_amount,
        'employeeCount', v_disbursement.employee_count
      ),
      'finance.disbursement.created:' || v_disbursement.id::text
    )
    returning id into v_artifact_event_id;

    insert into public.hr_audit_log (
      submodule_key,
      record_id,
      actor_id,
      action,
      previous_state,
      new_state
    )
    values (
      'finance_disbursements',
      v_disbursement.id::text,
      p_actor_id,
      'disbursement.created',
      null,
      jsonb_build_object(
        'status', v_disbursement.status,
        'disbursementNo', v_disbursement.disbursement_no,
        'payrollRunId', v_run.id,
        'totalAmount', v_disbursement.total_amount,
        'employeeCount', v_disbursement.employee_count
      )
    );

    insert into public.handoff_outbox (
      source_module,
      target_module,
      source_entity_type,
      source_entity_id,
      target_entity_type,
      target_entity_id,
      payload,
      status,
      created_by
    )
    values (
      'finance_payroll',
      'finance_disbursements',
      'payroll_run',
      v_run.id::text,
      'disbursement',
      v_disbursement.id::text,
      jsonb_build_object(
        'runId', v_run.id,
        'runNo', v_run.run_no,
        'disbursementId', v_disbursement.id,
        'disbursementNo', v_disbursement.disbursement_no,
        'calculationVersionId', v_run.current_calculation_version_id,
        'eventId', v_artifact_event_id
      ),
      'pending',
      p_actor_id
    );
  end if;

  -- Each employee carries the exact contribution-week allocation frozen by
  -- calculation. Different employees may legitimately span different NIBTT
  -- contribution months because of hire/termination dates and worked weeks.
  select count(*)::integer
    into v_mismatch_count
    from public.finance_payroll_calculation_version_lines l
   where l.calculation_version_id = v_run.current_calculation_version_id
     and (
       jsonb_typeof(l.breakdown->'nisContributionPeriods') is distinct from 'array'
       or jsonb_typeof(l.breakdown->'weeksInPeriod') is distinct from 'number'
       or case
         when jsonb_typeof(l.breakdown->'nisContributionPeriods') = 'array'
          and jsonb_typeof(l.breakdown->'weeksInPeriod') = 'number'
         then
           (
             jsonb_array_length(l.breakdown->'nisContributionPeriods') = 0
             and (
               l.nis_employee <> 0
               or l.nis_employer <> 0
               or (l.breakdown->>'weeksInPeriod')::numeric <> 0
             )
           )
           or exists (
             select 1
               from jsonb_array_elements(
                 l.breakdown->'nisContributionPeriods'
               ) period_item
              where case
                when jsonb_typeof(period_item) <> 'object' then true
                when jsonb_typeof(period_item->'periodMonth') <> 'string' then true
                when (period_item->>'periodMonth') !~ '^[0-9]{4}-[0-9]{2}-01$' then true
                when to_char(
                  to_date(period_item->>'periodMonth', 'YYYY-MM-DD'),
                  'YYYY-MM-DD'
                ) is distinct from period_item->>'periodMonth' then true
                when jsonb_typeof(period_item->'weeks') <> 'number' then true
                when (period_item->>'weeks')::numeric <= 0 then true
                when (period_item->>'weeks')::numeric
                  <> trunc((period_item->>'weeks')::numeric) then true
                when jsonb_typeof(period_item->'employeeAmount') <> 'number' then true
                when (period_item->>'employeeAmount')::numeric < 0 then true
                when jsonb_typeof(period_item->'employerAmount') <> 'number' then true
                when (period_item->>'employerAmount')::numeric < 0 then true
                else false
              end
           )
         else false
       end
     );
  if v_mismatch_count > 0 then
    raise exception
      'finance_payroll_release: % calculation lines have invalid NIS contribution-period evidence; reopen and recalculate the run',
      v_mismatch_count using errcode = 'PR409';
  end if;

  select count(*)::integer
    into v_mismatch_count
    from public.finance_payroll_calculation_version_lines l
   where l.calculation_version_id = v_run.current_calculation_version_id
     and (
       (
         select count(*)
         from jsonb_array_elements(l.breakdown->'nisContributionPeriods')
       ) <> (
         select count(distinct period_item->>'periodMonth')
         from jsonb_array_elements(l.breakdown->'nisContributionPeriods') period_item
       )
       or (
          select coalesce(sum((period_item->>'employeeAmount')::numeric), 0)
          from jsonb_array_elements(l.breakdown->'nisContributionPeriods') period_item
        ) is distinct from l.nis_employee
       or (
          select coalesce(sum((period_item->>'employerAmount')::numeric), 0)
          from jsonb_array_elements(l.breakdown->'nisContributionPeriods') period_item
        ) is distinct from l.nis_employer
       or (
          select coalesce(sum((period_item->>'weeks')::numeric), 0)
          from jsonb_array_elements(l.breakdown->'nisContributionPeriods') period_item
        ) is distinct from (l.breakdown->>'weeksInPeriod')::numeric
      );
  if v_mismatch_count > 0 then
    raise exception
      'finance_payroll_release: % calculation lines do not reconcile to their employee-specific NIS contribution evidence; reopen and recalculate the run',
      v_mismatch_count using errcode = 'PR409';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('periodMonth', schedule.period_month)
      order by schedule.period_month
    ),
    '[]'::jsonb
  )
    into v_nis_period_schedule
    from (
      select distinct period_item->>'periodMonth' as period_month
        from public.finance_payroll_calculation_version_lines l
        cross join lateral jsonb_array_elements(
          l.breakdown->'nisContributionPeriods'
        ) period_item
       where l.calculation_version_id = v_run.current_calculation_version_id
    ) schedule;

  -- A zero-NIS payroll still needs one zero-value NIBTT artifact. Anchor it to
  -- the worked payroll period, never to a later pay date.
  if jsonb_array_length(v_nis_period_schedule) = 0 then
    v_period_month := date_trunc('month', v_run.period_end)::date;
    v_nis_period_schedule := jsonb_build_array(
      jsonb_build_object(
        'periodMonth', to_char(v_period_month, 'YYYY-MM-DD')
      )
    );
  end if;

  for v_authority, v_period_month in
    select authority, period_month
      from (
        values
          ('paye_bir'::text, v_run.period_month),
          ('health_surcharge'::text, v_run.period_month)
        union all
        select
          'nis_nibtt'::text,
          (period_item->>'periodMonth')::date
        from jsonb_array_elements(v_nis_period_schedule) period_item
      ) remittance_periods(authority, period_month)
     order by period_month, authority
  loop
    v_due_date := case v_authority
      when 'nis_nibtt' then
        (v_period_month + interval '1 month - 1 day')::date
      else
        (v_period_month + interval '1 month 14 days')::date
    end;

    select
      coalesce(sum(
        case v_authority
          when 'paye_bir' then l.paye
          when 'health_surcharge' then l.health_surcharge
          else coalesce(nis_period.employee_amount, 0)
        end
      ), 0)::numeric(15,2),
      coalesce(sum(
        case v_authority
          when 'nis_nibtt' then coalesce(nis_period.employer_amount, 0)
          else 0
        end
      ), 0)::numeric(15,2)
      into v_employee_portion, v_employer_portion
      from public.finance_payroll_calculation_version_lines l
      left join lateral (
        select
          sum((period_item->>'employeeAmount')::numeric) as employee_amount,
          sum((period_item->>'employerAmount')::numeric) as employer_amount
        from jsonb_array_elements(l.breakdown->'nisContributionPeriods') period_item
        where period_item->>'periodMonth' = to_char(v_period_month, 'YYYY-MM-DD')
      ) nis_period on true
     where l.calculation_version_id = v_run.current_calculation_version_id;
    v_total_due := v_employee_portion + v_employer_portion;

    v_remittance_created := false;
    select *
      into v_remittance
      from public.finance_remittances r
     where r.payroll_run_id = v_run.id
       and r.authority = v_authority
       and r.period_year = extract(year from v_period_month)::integer
       and r.period_month = extract(month from v_period_month)::integer
       and r.status <> 'cancelled'
      for update;
    if not found then
      v_remittance_created := true;
      v_ref := 'REM-' || v_ref_year::text || '-' ||
        lpad(public.increment_ref_counter('REM', v_ref_year)::text, 4, '0');
      insert into public.finance_remittances (
        remittance_no,
        period_year,
        period_month,
        authority,
        payroll_run_id,
        employee_portion,
        employer_portion,
        total_due,
        currency,
        status,
        due_date,
        created_by,
        metadata
      )
      values (
        v_ref,
        extract(year from v_period_month)::integer,
        extract(month from v_period_month)::integer,
        v_authority,
        v_run.id,
        v_employee_portion,
        v_employer_portion,
        v_total_due,
        'TTD',
        'draft',
        v_due_date,
        p_actor_id,
        jsonb_build_object(
          'createdByPayrollRelease', true,
          'calculationVersionId', v_run.current_calculation_version_id,
          'certificationId', v_cert.id,
          'statutoryPeriod', to_char(v_period_month, 'YYYY-MM'),
          'dueDateRule', case v_authority
            when 'nis_nibtt' then 'contribution_month_end'
            else 'fifteenth_of_following_month'
          end
        )
      )
      returning * into v_remittance;

      insert into public.finance_remittance_lines (
        remittance_id,
        employee_id,
        employee_portion,
        employer_portion,
        line_total,
        source_line_id,
        metadata
      )
      select
        v_remittance.id,
        l.employee_id,
        case v_authority
          when 'paye_bir' then l.paye
          when 'health_surcharge' then l.health_surcharge
          else coalesce(nis_period.employee_amount, 0)
        end,
        case v_authority
          when 'nis_nibtt' then coalesce(nis_period.employer_amount, 0)
          else 0
        end,
        case v_authority
          when 'paye_bir' then l.paye
          when 'health_surcharge' then l.health_surcharge
          else coalesce(nis_period.employee_amount, 0)
             + coalesce(nis_period.employer_amount, 0)
        end,
        current_line.id,
        jsonb_build_object(
          'calculationVersionLineId', l.id,
          'calculationVersionId', l.calculation_version_id,
          'statutoryPeriod', to_char(v_period_month, 'YYYY-MM')
        )
      from public.finance_payroll_calculation_version_lines l
      left join public.finance_payroll_run_lines current_line
        on current_line.run_id = v_run.id
       and current_line.employee_id = l.employee_id
       and current_line.calculation_version_id = l.calculation_version_id
      left join lateral (
        select
          sum((period_item->>'employeeAmount')::numeric) as employee_amount,
          sum((period_item->>'employerAmount')::numeric) as employer_amount
        from jsonb_array_elements(l.breakdown->'nisContributionPeriods') period_item
        where period_item->>'periodMonth' = to_char(v_period_month, 'YYYY-MM-DD')
      ) nis_period on true
      where l.calculation_version_id = v_run.current_calculation_version_id
      order by l.employee_id;
    else
      if v_remittance.status <> 'draft'
         or v_remittance.due_date is distinct from v_due_date
         or v_remittance.employee_portion is distinct from v_employee_portion
         or v_remittance.employer_portion is distinct from v_employer_portion
         or v_remittance.total_due is distinct from v_total_due then
        raise exception
          'finance_payroll_release: existing % remittance for % is not a matching draft',
          v_authority, to_char(v_period_month, 'YYYY-MM') using errcode = 'PR409';
      end if;

      select count(*)::integer, coalesce(sum(rl.line_total), 0)::numeric(15,2)
        into v_existing_line_count, v_existing_line_total
        from public.finance_remittance_lines rl
       where rl.remittance_id = v_remittance.id;
      select count(*)::integer
        into v_mismatch_count
        from public.finance_payroll_calculation_version_lines l
        left join public.finance_remittance_lines rl
          on rl.remittance_id = v_remittance.id
         and rl.employee_id = l.employee_id
        left join lateral (
          select
            sum((period_item->>'employeeAmount')::numeric) as employee_amount,
            sum((period_item->>'employerAmount')::numeric) as employer_amount
          from jsonb_array_elements(l.breakdown->'nisContributionPeriods') period_item
          where period_item->>'periodMonth' = to_char(v_period_month, 'YYYY-MM-DD')
        ) nis_period on true
       where l.calculation_version_id = v_run.current_calculation_version_id
         and (
           rl.id is null
           or rl.employee_portion is distinct from
             case v_authority
               when 'paye_bir' then l.paye
               when 'health_surcharge' then l.health_surcharge
               else coalesce(nis_period.employee_amount, 0)
             end
           or rl.employer_portion is distinct from
             case v_authority
               when 'nis_nibtt' then coalesce(nis_period.employer_amount, 0)
               else 0
             end
         );
      if v_existing_line_count <> v_run.employee_count
         or v_existing_line_total is distinct from v_total_due
         or v_mismatch_count > 0 then
        raise exception
          'finance_payroll_release: existing % remittance lines for % do not match the current calculation',
          v_authority, to_char(v_period_month, 'YYYY-MM') using errcode = 'PR409';
      end if;

      update public.finance_remittances
         set metadata = metadata || jsonb_build_object(
           'linkedByPayrollRelease', true,
           'calculationVersionId', v_run.current_calculation_version_id,
           'certificationId', v_cert.id,
           'statutoryPeriod', to_char(v_period_month, 'YYYY-MM')
         )
       where id = v_remittance.id
      returning * into v_remittance;
    end if;

    if v_remittance_created then
      insert into public.app_events (
        event_type,
        source_module,
        source_entity_type,
        source_entity_id,
        actor_user_id,
        severity,
        payload,
        dedupe_key
      )
      values (
        'finance.remittance.created',
        'finance_remittances',
        'remittance',
        v_remittance.id::text,
        p_actor_id,
        'info',
        jsonb_build_object(
          'remittanceNo', v_remittance.remittance_no,
          'payrollRunId', v_run.id,
          'payrollRunNo', v_run.run_no,
          'authority', v_remittance.authority,
          'periodYear', v_remittance.period_year,
          'periodMonth', v_remittance.period_month,
          'dueDate', v_remittance.due_date,
          'totalDue', v_remittance.total_due
        ),
        'finance.remittance.created:' || v_remittance.id::text
      )
      returning id into v_artifact_event_id;

      insert into public.hr_audit_log (
        submodule_key,
        record_id,
        actor_id,
        action,
        previous_state,
        new_state
      )
      values (
        'finance_remittances',
        v_remittance.id::text,
        p_actor_id,
        'remittance.created',
        null,
        jsonb_build_object(
          'status', v_remittance.status,
          'remittanceNo', v_remittance.remittance_no,
          'payrollRunId', v_run.id,
          'authority', v_remittance.authority,
          'periodYear', v_remittance.period_year,
          'periodMonth', v_remittance.period_month,
          'totalDue', v_remittance.total_due
        )
      );

      insert into public.handoff_outbox (
        source_module,
        target_module,
        source_entity_type,
        source_entity_id,
        target_entity_type,
        target_entity_id,
        payload,
        status,
        created_by
      )
      values (
        'finance_payroll',
        'finance_remittances',
        'payroll_run',
        v_run.id::text,
        'remittance',
        v_remittance.id::text,
        jsonb_build_object(
          'runId', v_run.id,
          'runNo', v_run.run_no,
          'remittanceId', v_remittance.id,
          'remittanceNo', v_remittance.remittance_no,
          'authority', v_remittance.authority,
          'periodYear', v_remittance.period_year,
          'periodMonth', v_remittance.period_month,
          'eventId', v_artifact_event_id
        ),
        'pending',
        p_actor_id
      );
    end if;

    v_remittance_manifest := v_remittance_manifest || jsonb_build_array(
      jsonb_build_object(
        'id', v_remittance.id,
        'authority', v_remittance.authority,
        'remittanceNo', v_remittance.remittance_no,
        'periodYear', v_remittance.period_year,
        'periodMonth', v_remittance.period_month,
        'dueDate', v_remittance.due_date,
        'employeePortion', v_remittance.employee_portion,
        'employerPortion', v_remittance.employer_portion,
        'totalDue', v_remittance.total_due
      )
    );
  end loop;

  select jsonb_build_object(
    'count', count(*),
    'renderedThrough', max(p.pdf_rendered_at),
    'checksum', md5(coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'employeeId', p.employee_id,
          'filePath', p.file_path,
          'pdfChecksum', p.pdf_checksum
        )
        order by p.employee_id
      )::text,
      '[]'
    ))
  )
    into v_payslip_manifest
    from public.finance_payslips p
   where p.run_id = v_run.id;

  select md5(coalesce(
    jsonb_agg(
      jsonb_build_object(
        'lineNo', l.line_no,
        'accountCode', l.account_code,
        'debit', l.debit,
        'credit', l.credit
      )
      order by l.line_no
    )::text,
    '[]'
  ))
    into v_gl_checksum
    from public.finance_gl_journal_lines l
   where l.journal_id = v_journal.id;
  if v_journal.metadata->>'payrollControlChecksum'
       is distinct from v_gl_checksum then
    raise exception
      'finance_payroll_release: payroll journal lines no longer match the posting control checksum'
      using errcode = 'PR409';
  end if;

  select md5(jsonb_build_object(
    'headerId', v_disbursement.id,
    'totalAmount', v_disbursement.total_amount,
    'employeeCount', v_disbursement.employee_count,
    'lines', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'employeeId', dl.employee_id,
          'bankAccountId', dl.bank_account_id,
          'bankName', dl.bank_name_snapshot,
          'branch', dl.branch_snapshot,
          'accountType', dl.account_type_snapshot,
          'accountNumber', dl.account_number_snapshot,
          'transitNumber', dl.transit_number_snapshot,
          'routingSnapshotChecksum', dl.routing_snapshot_checksum,
          'netAmount', dl.net_amount
        )
        order by dl.employee_id
      ),
      '[]'::jsonb
    )
  )::text)
    into v_disbursement_checksum
    from public.finance_disbursement_lines dl
   where dl.disbursement_id = v_disbursement.id;

  v_control_totals := jsonb_build_object(
    'employeeCount', v_run.employee_count,
    'grossTotal', v_run.gross_total,
    'deductionTotal', v_run.deduction_total,
    'netTotal', v_run.net_total,
    'nisEmployerTotal', v_run.nis_employer_total,
    'currency', 'TTD',
    'glDebit', v_preflight->'glDebit',
    'glCredit', v_preflight->'glCredit',
    'remittances', v_remittance_manifest
  );
  v_artifact_checksums := jsonb_build_object(
    'calculation', (
      select checksum
        from public.finance_payroll_calculation_versions
       where id = v_run.current_calculation_version_id
    ),
    'inputSnapshot', (
      select checksum
        from public.finance_payroll_input_snapshots
       where id = v_run.current_input_snapshot_id
    ),
    'certification', v_cert.checksum,
    'fundingConfirmation', v_funding.checksum,
    'glJournal', v_gl_checksum,
    'payslips', v_payslip_manifest->>'checksum',
    'disbursement', v_disbursement_checksum,
    'remittances', md5(v_remittance_manifest::text)
  );
  v_release_checksum := md5(jsonb_build_object(
    'runId', v_run.id,
    'calculationVersionId', v_run.current_calculation_version_id,
    'certificationId', v_cert.id,
    'fundingConfirmationId', v_funding.id,
    'glJournalId', v_journal.id,
    'disbursementId', v_disbursement.id,
    'controlTotals', v_control_totals,
    'payslipManifest', v_payslip_manifest,
    'artifactChecksums', v_artifact_checksums,
    'releasedBy', p_actor_id
  )::text);

  insert into public.finance_payroll_release_certificates (
    run_id,
    calculation_version_id,
    certification_id,
    funding_confirmation_id,
    gl_journal_id,
    disbursement_id,
    control_totals,
    payslip_manifest,
    artifact_checksums,
    checksum,
    released_by
  )
  values (
    v_run.id,
    v_run.current_calculation_version_id,
    v_cert.id,
    v_funding.id,
    v_journal.id,
    v_disbursement.id,
    v_control_totals,
    v_payslip_manifest,
    v_artifact_checksums,
    v_release_checksum,
    p_actor_id
  )
  returning * into v_release;

  insert into public.finance_payroll_release_remittances (
    release_certificate_id,
    remittance_id,
    authority,
    period_year,
    period_month
  )
  select
    v_release.id,
    (item->>'id')::uuid,
    item->>'authority',
    (item->>'periodYear')::integer,
    (item->>'periodMonth')::integer
  from jsonb_array_elements(v_remittance_manifest) item;

  update public.finance_payroll_runs
     set status = 'released',
         release_certificate_id = v_release.id,
         released_by = p_actor_id,
         released_at = v_release.released_at
   where id = v_run.id
  returning * into v_run;

  insert into public.app_events (
    event_type,
    source_module,
    source_entity_type,
    source_entity_id,
    actor_user_id,
    severity,
    payload,
    dedupe_key
  )
  values (
    'finance.payroll.run.released',
    'finance_payroll',
    'payroll_run',
    v_run.id::text,
    p_actor_id,
    'success',
    jsonb_build_object(
      'runNo', v_run.run_no,
      'releaseCertificateId', v_release.id,
      'calculationVersionId', v_run.current_calculation_version_id,
      'disbursementId', v_disbursement.id,
      'remittances', v_remittance_manifest,
      'netPayroll', v_run.net_total,
      'releasedAt', v_release.released_at
    ),
    'finance.payroll.run.released:' || v_release.id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key,
    record_id,
    actor_id,
    action,
    previous_state,
    new_state
  )
  values (
    'finance_payroll',
    v_run.id::text,
    p_actor_id,
    'payroll_run.released',
    jsonb_build_object(
      'status', 'locked',
      'certificationId', v_cert.id,
      'fundingConfirmationId', v_funding.id
    ),
    jsonb_build_object(
      'status', 'released',
      'releaseCertificateId', v_release.id,
      'disbursementId', v_disbursement.id,
      'releasedAt', v_release.released_at,
      'checksum', v_release.checksum
    )
  );

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    is_read,
    link,
    event_id,
    module,
    severity,
    source_type,
    source_id,
    action_route,
    metadata,
    dedupe_key
  )
  select distinct
    recipient.user_id,
    'finance.payroll.run.released',
    'Payroll ' || v_run.run_no || ' released',
    'Payroll release completed for TTD ' || v_run.net_total::text ||
      '. Bank and statutory artifacts are ready for their downstream workflows.',
    false,
    '/finance/payroll/runs/' || v_run.id::text,
    v_event_id,
    'finance_payroll',
    'success',
    'payroll_run',
    v_run.id::text,
    '/finance/payroll/runs/' || v_run.id::text,
    jsonb_build_object(
      'releaseCertificateId', v_release.id,
      'disbursementId', v_disbursement.id
    ),
    'finance.payroll.run.released:' || v_release.id::text
  from (
    values (v_run.created_by), (v_run.approved_by)
  ) as recipient(user_id)
  where recipient.user_id is not null
  on conflict do nothing;

  v_result := jsonb_build_object(
    'run', to_jsonb(v_run),
    'releaseCertificate', to_jsonb(v_release),
    'disbursement', to_jsonb(v_disbursement),
    'remittances', v_remittance_manifest,
    'eventId', v_event_id,
    'duplicate', false
  );

  insert into public.finance_payroll_release_command_receipts (
    request_key,
    request_hash,
    run_id,
    actor_id,
    command,
    result
  )
  values (
    v_request_key,
    v_hash,
    v_run.id,
    p_actor_id,
    'release',
    v_result
  );

  return v_result;
end
$fn$;

create or replace function public.finance_payroll_confirm_funding_tx(
  p_run_id                uuid,
  p_actor_id              text,
  p_idempotency_key       text,
  p_confirmed_amount      numeric,
  p_confirmation_reference text,
  p_account_reference     text default null,
  p_note                  text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_request_key  text;
  v_hash         text;
  v_receipt      public.finance_payroll_release_command_receipts%rowtype;
  v_run          public.finance_payroll_runs%rowtype;
  v_cert         public.finance_payroll_certifications%rowtype;
  v_funding      public.finance_payroll_funding_confirmations%rowtype;
  v_supersedes   uuid;
  v_confirm_no   integer;
  v_evidence     jsonb;
  v_result       jsonb;
  v_event_id     uuid;
begin
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_funding: actor is required'
      using errcode = 'PR400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_funding: idempotency key is required'
      using errcode = 'PR400';
  end if;
  if p_confirmation_reference is null
     or btrim(p_confirmation_reference) = '' then
    raise exception 'finance_payroll_funding: confirmation reference is required'
      using errcode = 'PR400';
  end if;
  if p_confirmed_amount is null or p_confirmed_amount < 0 then
    raise exception 'finance_payroll_funding: confirmed amount must be non-negative'
      using errcode = 'PR400';
  end if;
  if not exists (
    select 1 from public.app_users u
     where u.id = p_actor_id and u.status = 'active'
  ) then
    raise exception 'finance_payroll_funding: actor is not an active user'
      using errcode = 'PR403';
  end if;

  v_request_key :=
    p_actor_id || '|payroll_run.confirm_funding|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'runId', p_run_id,
    'actorId', p_actor_id,
    'confirmedAmount', round(p_confirmed_amount, 2),
    'confirmationReference', btrim(p_confirmation_reference),
    'accountReference', nullif(btrim(p_account_reference), ''),
    'note', nullif(btrim(p_note), '')
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  select *
    into v_receipt
    from public.finance_payroll_release_command_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception 'finance_payroll_funding: idempotency key was already used for different inputs'
        using errcode = 'PR409';
    end if;
    return v_receipt.result || jsonb_build_object('duplicate', true);
  end if;

  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id
   for update;
  if not found then
    raise exception 'finance_payroll_funding: run % was not found', p_run_id
      using errcode = 'PR404';
  end if;
  if v_run.status <> 'locked' then
    raise exception 'finance_payroll_funding: run % is % (only locked can be funded)',
      p_run_id, v_run.status using errcode = 'PR422';
  end if;
  if v_run.current_calculation_version_id is null
     or v_run.approval_certification_id is null
     or v_run.approved_by is null then
    raise exception 'finance_payroll_funding: approved calculation and certification are required'
      using errcode = 'PR409';
  end if;
  if p_actor_id = v_run.created_by or p_actor_id = v_run.approved_by then
    raise exception 'finance_payroll_funding: the preparer and payroll approver cannot confirm funding'
      using errcode = 'PR403';
  end if;
  select *
    into v_cert
    from public.finance_payroll_certifications c
   where c.id = v_run.approval_certification_id
     and c.run_id = v_run.id
     and c.calculation_version_id = v_run.current_calculation_version_id
   for share;
  if not found then
    raise exception 'finance_payroll_funding: approval certification is invalid'
      using errcode = 'PR409';
  end if;
  if p_actor_id = v_cert.certified_by then
    raise exception 'finance_payroll_funding: the payroll certifier cannot confirm funding'
      using errcode = 'PR403';
  end if;
  if round(p_confirmed_amount, 2) is distinct from v_run.net_total then
    raise exception 'finance_payroll_funding: confirmed amount % does not match net payroll %',
      round(p_confirmed_amount, 2), v_run.net_total using errcode = 'PR422';
  end if;

  select f.id
    into v_supersedes
    from public.finance_payroll_funding_confirmations f
   where f.run_id = v_run.id
     and f.calculation_version_id = v_run.current_calculation_version_id
   order by f.confirmed_at desc, f.confirmation_no desc
   limit 1;

  select coalesce(max(f.confirmation_no), 0) + 1
    into v_confirm_no
    from public.finance_payroll_funding_confirmations f
   where f.run_id = v_run.id
     and f.calculation_version_id = v_run.current_calculation_version_id;

  v_evidence := jsonb_build_object(
    'runNo', v_run.run_no,
    'calculationVersionId', v_run.current_calculation_version_id,
    'netPayroll', v_run.net_total,
    'confirmationReference', btrim(p_confirmation_reference),
    'accountReference', nullif(btrim(p_account_reference), ''),
    'note', nullif(btrim(p_note), '')
  );

  insert into public.finance_payroll_funding_confirmations (
    run_id,
    calculation_version_id,
    confirmation_no,
    confirmed_amount,
    currency,
    confirmation_reference,
    account_reference,
    evidence,
    checksum,
    supersedes_id,
    confirmed_by
  )
  values (
    v_run.id,
    v_run.current_calculation_version_id,
    v_confirm_no,
    round(p_confirmed_amount, 2),
    'TTD',
    btrim(p_confirmation_reference),
    nullif(btrim(p_account_reference), ''),
    v_evidence,
    md5(jsonb_build_object(
      'runId', v_run.id,
      'calculationVersionId', v_run.current_calculation_version_id,
      'confirmationNo', v_confirm_no,
      'confirmedAmount', round(p_confirmed_amount, 2),
      'confirmationReference', btrim(p_confirmation_reference),
      'accountReference', nullif(btrim(p_account_reference), ''),
      'actorId', p_actor_id
    )::text),
    v_supersedes,
    p_actor_id
  )
  returning * into v_funding;

  insert into public.app_events (
    event_type,
    source_module,
    source_entity_type,
    source_entity_id,
    actor_user_id,
    severity,
    payload,
    dedupe_key
  )
  values (
    'finance.payroll.run.funding_confirmed',
    'finance_payroll',
    'payroll_run',
    v_run.id::text,
    p_actor_id,
    'success',
    jsonb_build_object(
      'runNo', v_run.run_no,
      'fundingConfirmationId', v_funding.id,
      'confirmedAmount', v_funding.confirmed_amount,
      'currency', v_funding.currency,
      'calculationVersionId', v_funding.calculation_version_id
    ),
    'finance.payroll.run.funding_confirmed:' || v_funding.id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key,
    record_id,
    actor_id,
    action,
    previous_state,
    new_state,
    reason
  )
  values (
    'finance_payroll',
    v_run.id::text,
    p_actor_id,
    'payroll_run.funding_confirmed',
    case
      when v_supersedes is null then null
      else jsonb_build_object('supersededFundingConfirmationId', v_supersedes)
    end,
    jsonb_build_object(
      'fundingConfirmationId', v_funding.id,
      'confirmationNo', v_funding.confirmation_no,
      'confirmedAmount', v_funding.confirmed_amount,
      'currency', v_funding.currency,
      'confirmationReference', v_funding.confirmation_reference
    ),
    nullif(btrim(p_note), '')
  );

  v_result := jsonb_build_object(
    'fundingConfirmation', to_jsonb(v_funding),
    'eventId', v_event_id,
    'duplicate', false
  );

  insert into public.finance_payroll_release_command_receipts (
    request_key,
    request_hash,
    run_id,
    actor_id,
    command,
    result
  )
  values (
    v_request_key,
    v_hash,
    v_run.id,
    p_actor_id,
    'confirm_funding',
    v_result
  );

  return v_result;
end
$fn$;

create or replace function public.finance_payroll_release_preflight(
  p_run_id uuid
) returns jsonb
language plpgsql
security invoker
stable
set search_path = public
as $fn$
declare
  v_run                     public.finance_payroll_runs%rowtype;
  v_version                 public.finance_payroll_calculation_versions%rowtype;
  v_cert                    public.finance_payroll_certifications%rowtype;
  v_funding                 public.finance_payroll_funding_confirmations%rowtype;
  v_journal                 public.finance_gl_journals%rowtype;
  v_disbursement            public.finance_disbursements%rowtype;
  v_blockers                jsonb := '[]'::jsonb;
  v_payslip_count           integer := 0;
  v_rendered_payslip_count  integer := 0;
  v_missing_bank_count      integer := 0;
  v_journal_line_count      integer := 0;
  v_journal_debit           numeric(15,2) := 0;
  v_journal_credit          numeric(15,2) := 0;
  v_journal_checksum        text;
  v_invalid_gl_account_count integer := 0;
  v_invalid_nis_period_count integer := 0;
  v_conflicting_remittances integer := 0;
  v_ready                   boolean;
begin
  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id;
  if not found then
    raise exception 'finance_payroll_release: run % was not found', p_run_id
      using errcode = 'PR404';
  end if;

  if v_run.status not in ('locked','released') then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'run_not_locked',
      'message', 'Only a locked payroll run can be released.'
    ));
  end if;
  if v_run.current_calculation_version_id is null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'calculation_version_missing',
      'message', 'The run has no current calculation version.'
    ));
  else
    select *
      into v_version
      from public.finance_payroll_calculation_versions
     where id = v_run.current_calculation_version_id
       and run_id = v_run.id;
    if not found then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'calculation_version_invalid',
        'message', 'The current calculation version does not belong to the run.'
      ));
    end if;
  end if;

  if v_run.approval_certification_id is null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'certification_missing',
      'message', 'The approved certification package is missing.'
    ));
  elsif v_run.current_calculation_version_id is not null then
    select *
      into v_cert
      from public.finance_payroll_certifications
     where id = v_run.approval_certification_id
       and run_id = v_run.id
       and calculation_version_id = v_run.current_calculation_version_id;
    if not found then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'certification_version_mismatch',
        'message', 'The approved certification does not match the current calculation.'
      ));
    end if;
  end if;

  if v_run.current_calculation_version_id is not null then
    select *
      into v_funding
      from public.finance_payroll_funding_confirmations f
     where f.run_id = v_run.id
       and f.calculation_version_id = v_run.current_calculation_version_id
     order by f.confirmed_at desc, f.confirmation_no desc
     limit 1;
    if not found then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'funding_confirmation_missing',
        'message', 'Payroll funding has not been confirmed.'
      ));
    elsif v_funding.confirmed_amount is distinct from v_run.net_total then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'funding_amount_mismatch',
        'message', 'Confirmed funding does not match net payroll.'
      ));
    end if;
  end if;

  if v_run.gl_journal_id is null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'gl_journal_missing',
      'message', 'Post the payroll journal before release.'
    ));
  else
    select *
      into v_journal
      from public.finance_gl_journals
     where id = v_run.gl_journal_id;
    if not found
       or v_journal.status <> 'posted'
       or v_journal.source_module <> 'finance_payroll'
       or v_journal.metadata->>'payrollRunId' is distinct from v_run.id::text
       or v_journal.metadata->>'calculationVersionId'
         is distinct from v_run.current_calculation_version_id::text then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'gl_journal_invalid',
        'message', 'The linked payroll journal is not a valid posted journal for this run.'
      ));
    else
      select
        count(*)::integer,
        coalesce(sum(l.debit), 0)::numeric(15,2),
        coalesce(sum(l.credit), 0)::numeric(15,2),
        md5(coalesce(
          jsonb_agg(
            jsonb_build_object(
              'lineNo', l.line_no,
              'accountCode', l.account_code,
              'debit', l.debit,
              'credit', l.credit
            )
            order by l.line_no
          )::text,
          '[]'
        ))
        into
          v_journal_line_count,
          v_journal_debit,
          v_journal_credit,
          v_journal_checksum
        from public.finance_gl_journal_lines l
       where l.journal_id = v_journal.id;
      if v_journal_line_count < 2
         or abs(v_journal_debit - v_journal_credit) > 0.005 then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'gl_journal_unbalanced',
          'message', 'The linked payroll journal is incomplete or unbalanced.'
        ));
      end if;
      if v_journal.metadata->>'payrollControlChecksum'
           is distinct from v_journal_checksum then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'gl_journal_checksum_mismatch',
          'message', 'The payroll journal lines no longer match their posting control checksum.'
        ));
      end if;

      select count(*)::integer
        into v_invalid_gl_account_count
        from public.finance_gl_journal_lines l
        left join public.finance_gl_accounts a
          on a.code = l.account_code
         and a.is_active = true
       where l.journal_id = v_journal.id
         and a.id is null;
      if v_invalid_gl_account_count > 0 then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'gl_accounts_invalid',
          'message', v_invalid_gl_account_count ||
            ' payroll journal line account(s) are missing or inactive.'
        ));
      end if;
    end if;
  end if;

  if v_run.current_calculation_version_id is not null then
    select count(*)::integer
      into v_invalid_nis_period_count
      from public.finance_payroll_calculation_version_lines l
     where l.calculation_version_id = v_run.current_calculation_version_id
       and (
         jsonb_typeof(l.breakdown->'nisContributionPeriods') is distinct from 'array'
         or jsonb_typeof(l.breakdown->'weeksInPeriod') is distinct from 'number'
         or case
           when jsonb_typeof(l.breakdown->'nisContributionPeriods') = 'array'
            and jsonb_typeof(l.breakdown->'weeksInPeriod') = 'number'
           then
             (
               jsonb_array_length(l.breakdown->'nisContributionPeriods') = 0
               and (
                 l.nis_employee <> 0
                 or l.nis_employer <> 0
                 or (l.breakdown->>'weeksInPeriod')::numeric <> 0
               )
             )
             or exists (
               select 1
                 from jsonb_array_elements(
                   l.breakdown->'nisContributionPeriods'
                 ) period_item
                where case
                  when jsonb_typeof(period_item) <> 'object' then true
                  when jsonb_typeof(period_item->'periodMonth') <> 'string' then true
                  when (period_item->>'periodMonth') !~ '^[0-9]{4}-[0-9]{2}-01$' then true
                  when to_char(
                    to_date(period_item->>'periodMonth', 'YYYY-MM-DD'),
                    'YYYY-MM-DD'
                  ) is distinct from period_item->>'periodMonth' then true
                  when jsonb_typeof(period_item->'weeks') <> 'number' then true
                  when (period_item->>'weeks')::numeric <= 0 then true
                  when (period_item->>'weeks')::numeric
                    <> trunc((period_item->>'weeks')::numeric) then true
                  when jsonb_typeof(period_item->'employeeAmount') <> 'number' then true
                  when (period_item->>'employeeAmount')::numeric < 0 then true
                  when jsonb_typeof(period_item->'employerAmount') <> 'number' then true
                  when (period_item->>'employerAmount')::numeric < 0 then true
                  else false
                end
             )
           else false
         end
       );
    if v_invalid_nis_period_count = 0 then
      select count(*)::integer
        into v_invalid_nis_period_count
        from public.finance_payroll_calculation_version_lines l
       where l.calculation_version_id = v_run.current_calculation_version_id
         and (
           (
             select count(*)
             from jsonb_array_elements(l.breakdown->'nisContributionPeriods')
           ) <> (
             select count(distinct period_item->>'periodMonth')
             from jsonb_array_elements(l.breakdown->'nisContributionPeriods') period_item
           )
           or (
             select coalesce(sum((period_item->>'employeeAmount')::numeric), 0)
             from jsonb_array_elements(l.breakdown->'nisContributionPeriods') period_item
           ) is distinct from l.nis_employee
           or (
             select coalesce(sum((period_item->>'employerAmount')::numeric), 0)
             from jsonb_array_elements(l.breakdown->'nisContributionPeriods') period_item
           ) is distinct from l.nis_employer
           or (
             select coalesce(sum((period_item->>'weeks')::numeric), 0)
             from jsonb_array_elements(l.breakdown->'nisContributionPeriods') period_item
           ) is distinct from (l.breakdown->>'weeksInPeriod')::numeric
         );
    end if;
    if v_invalid_nis_period_count > 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'nis_period_evidence_invalid',
        'message', v_invalid_nis_period_count ||
          ' calculation line(s) have invalid or unreconciled employee-specific NIS evidence. Reopen and recalculate the run.'
      ));
    end if;

    select
      count(*)::integer,
      count(*) filter (
        where p.file_path is not null
          and p.pdf_rendered_at is not null
          and p.pdf_checksum is not null
          and btrim(p.pdf_checksum) <> ''
      )::integer
      into v_payslip_count, v_rendered_payslip_count
      from public.finance_payslips p
      join public.finance_payroll_run_lines l
        on l.id = p.run_line_id
       and l.run_id = v_run.id
       and l.calculation_version_id = v_run.current_calculation_version_id
     where p.run_id = v_run.id;

    if v_payslip_count <> v_run.employee_count
       or v_rendered_payslip_count <> v_run.employee_count then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'payslips_not_ready',
        'message', 'Every employee must have a rendered, checksummed payslip.'
      ));
    end if;

    select count(*)::integer
      into v_missing_bank_count
      from public.finance_payroll_calculation_version_lines l
     where l.calculation_version_id = v_run.current_calculation_version_id
       and not exists (
         select 1
           from public.finance_employee_bank_accounts b
          where b.employee_id = l.employee_id
            and b.is_primary = true
            and b.is_active = true
       );
    if v_missing_bank_count > 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'bank_accounts_missing',
        'message', v_missing_bank_count || ' employee bank account(s) are missing.'
      ));
    end if;
  end if;

  select *
    into v_disbursement
    from public.finance_disbursements d
   where d.payroll_run_id = v_run.id
     and d.status <> 'cancelled';
  if found and (
    v_disbursement.status <> 'draft'
    or v_disbursement.total_amount is distinct from v_run.net_total
    or v_disbursement.employee_count is distinct from v_run.employee_count
  ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'disbursement_conflict',
      'message', 'The existing disbursement is not a matching draft artifact.'
    ));
  end if;

  select count(*)::integer
    into v_conflicting_remittances
    from public.finance_remittances r
   where r.payroll_run_id = v_run.id
     and r.status not in ('draft','cancelled');
  if v_conflicting_remittances > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'remittance_conflict',
      'message', 'Existing statutory remittances must still be draft at payroll release.'
    ));
  end if;

  if exists (
    select 1
      from public.finance_payroll_control_findings f
     where f.run_id = v_run.id
       and f.calculation_version_id = v_run.current_calculation_version_id
       and f.severity = 'blocker'
       and f.state <> 'resolved'
  ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'control_blockers_open',
      'message', 'Unresolved payroll control blockers remain.'
    ));
  end if;

  v_ready :=
    jsonb_array_length(v_blockers) = 0
    and v_run.status = 'locked';

  return jsonb_build_object(
    'runId', v_run.id,
    'runNo', v_run.run_no,
    'status', v_run.status,
    'ready', v_ready,
    'alreadyReleased', v_run.status = 'released',
    'blockers', v_blockers,
    'calculationVersionId', v_run.current_calculation_version_id,
    'certificationId', v_cert.id,
    'fundingConfirmationId', v_funding.id,
    'glJournalId', v_run.gl_journal_id,
    'glDebit', v_journal_debit,
    'glCredit', v_journal_credit,
    'invalidGlAccountCount', v_invalid_gl_account_count,
    'invalidNisPeriodCount', v_invalid_nis_period_count,
    'payslipCount', v_payslip_count,
    'renderedPayslipCount', v_rendered_payslip_count,
    'missingBankAccountCount', v_missing_bank_count,
    'disbursementId', v_disbursement.id,
    'netPayroll', v_run.net_total,
    'employeeCount', v_run.employee_count
  );
end
$fn$;

revoke all on function public.finance_payroll_certify_run_tx(
  uuid, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.finance_payroll_certify_run_tx(
  uuid, text, text, jsonb, text
) to service_role;

revoke all on function public.finance_payroll_confirm_funding_tx(
  uuid, text, text, numeric, text, text, text
) from public, anon, authenticated;
grant execute on function public.finance_payroll_confirm_funding_tx(
  uuid, text, text, numeric, text, text, text
) to service_role;

revoke all on function public.finance_payroll_release_preflight(uuid)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_release_preflight(uuid)
  to service_role;

revoke all on function public.finance_payroll_release_run_tx(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_release_run_tx(uuid, text, text)
  to service_role;

-- Certification belongs to payroll preparation. Funding confirmation and
-- release are manager-only authorities and remain separate route checks.
insert into public.role_permissions (role_name, permission)
select rp.role_name, 'finance.payroll.certify'
from public.role_permissions rp
where rp.permission = 'finance.payroll.run.manage'
on conflict (role_name, permission) do nothing;

insert into public.role_permissions (role_name, permission)
select rp.role_name, p.permission
from public.role_permissions rp
cross join (
  values
    ('finance.payroll.funding.approve'),
    ('finance.payroll.release')
) as p(permission)
where rp.permission = 'finance.payroll.approve'
on conflict (role_name, permission) do nothing;

-- PostgREST schema cache is refreshed by the operator after migration apply.
