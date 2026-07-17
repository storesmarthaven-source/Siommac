-- ============================================================================
-- Finance payroll certification-state checksum fix
-- ============================================================================
-- Supersedes finance_payroll_certification_state created by 20260919000420.
-- That version signed `runStatus` into stateChecksum, so the certification went
-- stale the moment the run advanced past 'calculated' — lock (at 'approved')
-- always failed with "the approval certification is stale". This drops
-- `runStatus` from the signed checksum so one certification stays valid through
-- submit -> approve -> lock -> release. Function body only; 20260919000420's
-- source is corrected identically for clean installs. Idempotent / re-runnable.
-- ============================================================================

create or replace function public.finance_payroll_certification_state(
  p_run_id uuid,
  p_calculation_version_id uuid
) returns jsonb
language plpgsql
security invoker
stable
set search_path = public
as $fn$
declare
  v_run                       public.finance_payroll_runs%rowtype;
  v_version                   public.finance_payroll_calculation_versions%rowtype;
  v_snapshot                  public.finance_payroll_input_snapshots%rowtype;
  v_line_count                integer;
  v_gross_total               numeric(14,2);
  v_deduction_total           numeric(14,2);
  v_net_total                 numeric(14,2);
  v_nis_employer_total        numeric(14,2);
  v_salary_total              numeric(14,2);
  v_overtime_total            numeric(14,2);
  v_allowance_total           numeric(14,2);
  v_paye_total                numeric(14,2);
  v_nis_employee_total        numeric(14,2);
  v_health_total              numeric(14,2);
  v_voluntary_total           numeric(14,2);
  v_negative_net_count        integer;
  v_unresolved_blockers       integer;
  v_open_warnings             integer;
  v_running_attempts          integer;
  v_missing_bank_accounts     integer;
  v_duplicate_bank_accounts   integer;
  v_missing_gl_mappings       integer;
  v_population_matches        boolean;
  v_findings_checksum         text;
  v_bank_checksum             text;
  v_gl_checksum               text;
  v_state                     jsonb;
  v_ready                     boolean;
begin
  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id;
  if not found then
    raise exception 'finance_payroll_certification: run % was not found', p_run_id
      using errcode = 'PR404';
  end if;

  select *
    into v_version
    from public.finance_payroll_calculation_versions
   where id = p_calculation_version_id
     and run_id = p_run_id;
  if not found then
    raise exception 'finance_payroll_certification: calculation version is not part of the run'
      using errcode = 'PR422';
  end if;

  select *
    into v_snapshot
    from public.finance_payroll_input_snapshots
   where id = v_version.input_snapshot_id
     and run_id = p_run_id;
  if not found then
    raise exception 'finance_payroll_certification: calculation input snapshot was not found'
      using errcode = 'PR422';
  end if;

  select
    count(*)::integer,
    coalesce(sum(l.gross), 0)::numeric(14,2),
    coalesce(sum(
      l.nis_employee + l.health_surcharge + l.paye + l.voluntary_deductions
    ), 0)::numeric(14,2),
    coalesce(sum(l.net), 0)::numeric(14,2),
    coalesce(sum(l.nis_employer), 0)::numeric(14,2),
    coalesce(sum(l.base), 0)::numeric(14,2),
    coalesce(sum(
      case
        when jsonb_typeof(l.breakdown->'approvedOtAmount') = 'number'
          then (l.breakdown->>'approvedOtAmount')::numeric
        else 0
      end
    ), 0)::numeric(14,2),
    coalesce(sum(
      case
        when jsonb_typeof(l.breakdown->'taxableAllowances') = 'number'
          then (l.breakdown->>'taxableAllowances')::numeric
        else 0
      end
      +
      case
        when jsonb_typeof(l.breakdown->'nonTaxableAllowances') = 'number'
          then (l.breakdown->>'nonTaxableAllowances')::numeric
        else 0
      end
    ), 0)::numeric(14,2),
    coalesce(sum(l.paye), 0)::numeric(14,2),
    coalesce(sum(l.nis_employee), 0)::numeric(14,2),
    coalesce(sum(l.health_surcharge), 0)::numeric(14,2),
    coalesce(sum(l.voluntary_deductions), 0)::numeric(14,2),
    count(*) filter (where l.net < 0)::integer
    into
      v_line_count,
      v_gross_total,
      v_deduction_total,
      v_net_total,
      v_nis_employer_total,
      v_salary_total,
      v_overtime_total,
      v_allowance_total,
      v_paye_total,
      v_nis_employee_total,
      v_health_total,
      v_voluntary_total,
      v_negative_net_count
    from public.finance_payroll_calculation_version_lines l
   where l.calculation_version_id = v_version.id;

  select
    not exists (
      (
        select distinct s.employee_id
          from public.finance_payroll_input_snapshot_lines s
         where s.input_snapshot_id = v_snapshot.id
        except
        select distinct l.employee_id
          from public.finance_payroll_calculation_version_lines l
         where l.calculation_version_id = v_version.id
      )
      union all
      (
        select distinct l.employee_id
          from public.finance_payroll_calculation_version_lines l
         where l.calculation_version_id = v_version.id
        except
        select distinct s.employee_id
          from public.finance_payroll_input_snapshot_lines s
         where s.input_snapshot_id = v_snapshot.id
      )
    )
    and (
      select count(distinct s.employee_id)
        from public.finance_payroll_input_snapshot_lines s
       where s.input_snapshot_id = v_snapshot.id
    ) = v_snapshot.employee_count
    into v_population_matches;

  select
    count(*) filter (
      where f.severity = 'blocker' and f.state <> 'resolved'
    )::integer,
    count(*) filter (
      where f.severity = 'warning' and f.state in ('open','in_progress')
    )::integer,
    md5(coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'severity', f.severity,
          'state', f.state,
          'version', f.version,
          'updatedAt', f.updated_at
        )
        order by f.id
      )::text,
      '[]'
    ))
    into v_unresolved_blockers, v_open_warnings, v_findings_checksum
    from public.finance_payroll_control_findings f
   where f.calculation_version_id = v_version.id;

  select count(*)::integer
    into v_running_attempts
    from public.finance_payroll_calculation_attempts a
   where a.run_id = p_run_id
     and a.status = 'running';

  select
    count(*) filter (where bank_count = 0)::integer,
    count(*) filter (where bank_count > 1)::integer,
    md5(coalesce(
      jsonb_agg(
        jsonb_build_object(
          'employeeId', employee_id,
          'accounts', account_state
        )
        order by employee_id
      )::text,
      '[]'
    ))
    into
      v_missing_bank_accounts,
      v_duplicate_bank_accounts,
      v_bank_checksum
    from (
      select
        l.employee_id,
        count(b.id)::integer as bank_count,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', b.id,
              'masked', b.account_number_masked,
              'updatedAt', b.updated_at
            )
            order by b.id
          ) filter (where b.id is not null),
          '[]'::jsonb
        ) as account_state
      from public.finance_payroll_calculation_version_lines l
      left join public.finance_employee_bank_accounts b
        on b.employee_id = l.employee_id
       and b.is_primary = true
       and b.is_active = true
      where l.calculation_version_id = v_version.id
      group by l.employee_id
    ) bank_state;

  with required(mapping_key, amount) as (
    values
      ('salary_expense', v_salary_total),
      ('overtime_expense', v_overtime_total),
      ('allowance_expense', v_allowance_total),
      ('employer_nis_expense', v_nis_employer_total),
      ('paye_payable', v_paye_total),
      ('nis_employee_payable', v_nis_employee_total),
      ('nis_employer_payable', v_nis_employer_total),
      ('health_surcharge_payable', v_health_total),
      ('deductions_payable', v_voluntary_total),
      ('net_pay_clearing', v_net_total)
  ),
  mapping_state as (
    select
      r.mapping_key,
      r.amount,
      m.id as mapping_id,
      m.account_code,
      m.updated_at as mapping_updated_at,
      a.id as account_id,
      a.is_active as account_active,
      a.updated_at as account_updated_at
    from required r
    left join public.finance_payroll_gl_mappings m
      on m.mapping_key = r.mapping_key
     and m.component_id is null
     and m.department_id is null
     and m.active = true
    left join public.finance_gl_accounts a
      on a.code = m.account_code
     and a.is_active = true
    where r.amount > 0
  )
  select
    count(*) filter (
      where mapping_id is null or account_id is null or account_active is distinct from true
    )::integer,
    md5(coalesce(
      jsonb_agg(
        jsonb_build_object(
          'mappingKey', mapping_key,
          'amount', amount,
          'accountCode', account_code,
          'mappingUpdatedAt', mapping_updated_at,
          'accountUpdatedAt', account_updated_at
        )
        order by mapping_key
      )::text,
      '[]'
    ))
    into v_missing_gl_mappings, v_gl_checksum
    from mapping_state;

  -- Certification proves the calculation package is internally coherent.
  -- Bank-account and GL-mapping state is included in the signed checksum for
  -- visibility/staleness detection, but is enforced by release preflight after
  -- lock, when payslips and the posted journal can exist.
  v_ready :=
    v_run.current_calculation_version_id = v_version.id
    and v_run.current_input_snapshot_id = v_version.input_snapshot_id
    and v_run.statutory_version_id = v_version.statutory_version_id
    and v_population_matches
    and v_line_count = v_version.employee_count
    and v_line_count = v_run.employee_count
    and v_gross_total = v_version.gross_total
    and v_gross_total = v_run.gross_total
    and v_deduction_total = v_version.deduction_total
    and v_deduction_total = v_run.deduction_total
    and v_net_total = v_version.net_total
    and v_net_total = v_run.net_total
    and v_nis_employer_total = v_version.nis_employer_total
    and v_nis_employer_total = v_run.nis_employer_total
    and v_negative_net_count = 0
    and v_unresolved_blockers = 0
    and v_running_attempts = 0;

  v_state := jsonb_build_object(
    'runId', v_run.id,
    'runStatus', v_run.status,
    'calculationVersionId', v_version.id,
    'calculationVersionNo', v_version.version_no,
    'calculationChecksum', v_version.checksum,
    'inputSnapshotId', v_snapshot.id,
    'inputSnapshotNo', v_snapshot.snapshot_no,
    'inputChecksum', v_snapshot.checksum,
    'statutoryVersionId', v_version.statutory_version_id,
    'currentCalculationMatches', v_run.current_calculation_version_id = v_version.id,
    'currentSnapshotMatches', v_run.current_input_snapshot_id = v_version.input_snapshot_id,
    'statutoryVersionMatches', v_run.statutory_version_id = v_version.statutory_version_id,
    'populationMatchesInputSnapshot', v_population_matches,
    'employeeCount', v_line_count,
    'grossTotal', v_gross_total,
    'deductionTotal', v_deduction_total,
    'netTotal', v_net_total,
    'nisEmployerTotal', v_nis_employer_total,
    'totalsMatch',
      v_line_count = v_version.employee_count
      and v_line_count = v_run.employee_count
      and v_population_matches
      and v_gross_total = v_version.gross_total
      and v_gross_total = v_run.gross_total
      and v_deduction_total = v_version.deduction_total
      and v_deduction_total = v_run.deduction_total
      and v_net_total = v_version.net_total
      and v_net_total = v_run.net_total
      and v_nis_employer_total = v_version.nis_employer_total
      and v_nis_employer_total = v_run.nis_employer_total,
    'negativeNetCount', v_negative_net_count,
    'unresolvedBlockerCount', v_unresolved_blockers,
    'openWarningCount', v_open_warnings,
    'runningAttemptCount', v_running_attempts,
    'missingBankAccountCount', v_missing_bank_accounts,
    'duplicateBankAccountCount', v_duplicate_bank_accounts,
    'missingGlMappingCount', v_missing_gl_mappings,
    'findingsChecksum', v_findings_checksum,
    'bankAccountChecksum', v_bank_checksum,
    'glMappingChecksum', v_gl_checksum
  );

  return v_state || jsonb_build_object(
    'ready', v_ready,
    -- The checksum signs the CALCULATION package's coherence, not the run's
    -- lifecycle position. `runStatus` is excluded because it legitimately
    -- advances calculated -> pending_approval -> approved -> locked while the
    -- same certification must stay valid through lock/release (submit certifies,
    -- the checker approves, then lock/release re-verify the SAME certification).
    -- Bank accounts and GL mappings are release-readiness inputs, visible in the
    -- state response but not part of the signed processor certification.
    'stateChecksum', md5((
      v_state
        - 'runStatus'
        - 'missingBankAccountCount'
        - 'duplicateBankAccountCount'
        - 'missingGlMappingCount'
        - 'bankAccountChecksum'
        - 'glMappingChecksum'
    )::text)
  );
end
$fn$;

revoke all on function public.finance_payroll_certification_state(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.finance_payroll_certification_state(uuid, uuid)

notify pgrst, 'reload schema';
