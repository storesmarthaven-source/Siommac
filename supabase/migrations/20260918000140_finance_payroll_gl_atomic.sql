-- ============================================================================
-- Finance Payroll -- ATOMIC GL POST (audit remediation P0-3, part 1 of 2)
-- ============================================================================
-- postRunGl previously issued separate PostgREST writes (header, then lines,
-- then run-link) with a best-effort compensating delete: two concurrent posts
-- could BOTH create journals before either linked the run, and a failed link
-- left a posted journal orphaned. post_payroll_gl_tx does the whole accounting
-- mutation in ONE transaction with a row lock on the run. A partial unique
-- index additionally guarantees at most ONE posted payroll journal per run.
-- The REVERSE function is in migration 20260918000141 (split to stay under the
-- SQL editor's input-size limit). Service_role only. Idempotent / re-runnable.
-- ============================================================================

create unique index if not exists fgj_one_posted_payroll_journal_per_run
  on public.finance_gl_journals ((metadata->>'payrollRunId'))
  where source_module = 'finance_payroll' and status = 'posted'
    and metadata ? 'payrollRunId';

create table if not exists public.finance_payroll_gl_command_receipts (
  request_key   text primary key,
  request_hash  text not null,
  run_id        uuid not null references public.finance_payroll_runs(id) on delete cascade,
  actor_id      text not null references public.app_users(id) on delete restrict,
  command       text not null check (command in ('post','reverse')),
  journal_id    uuid references public.finance_gl_journals(id) on delete set null,
  result        jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists finance_payroll_gl_receipts_run_idx
  on public.finance_payroll_gl_command_receipts(run_id, created_at desc);
alter table public.finance_payroll_gl_command_receipts enable row level security;
grant select, insert, update, delete
  on public.finance_payroll_gl_command_receipts to service_role;

drop function if exists public.post_payroll_gl_tx(
  uuid, text, date, text, text, jsonb, jsonb
);
drop function if exists public.post_payroll_gl_tx(
  uuid, text, text, jsonb, jsonb
);

create or replace function public.post_payroll_gl_tx(
  p_run_id          uuid,
  p_actor           text,
  p_idempotency_key text,
  p_metadata        jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $post_gl$
declare
  v_request_key  text;
  v_hash         text;
  v_receipt      public.finance_payroll_gl_command_receipts%rowtype;
  v_run          public.finance_payroll_runs%rowtype;
  v_version      public.finance_payroll_calculation_versions%rowtype;
  v_journal_id   uuid;
  v_journal_no   text;
  v_total_debit  numeric(15,2) := 0;
  v_total_credit numeric(15,2) := 0;
  v_count        integer := 0;
  v_missing_mapping_count integer := 0;
  v_expected_lines jsonb;
  v_control_checksum text;
  v_line         jsonb;
  v_line_no      integer := 0;
  v_event_id     uuid;
  v_handoff_id   uuid;
  v_result       jsonb;
  v_year         integer := extract(year from current_date)::integer;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'post_payroll_gl: actor is required'
      using errcode = 'PR400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'post_payroll_gl: idempotency key is required'
      using errcode = 'PR400';
  end if;
  if jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception 'post_payroll_gl: metadata must be an object'
      using errcode = 'PR422';
  end if;
  if not exists (
    select 1 from public.app_users
     where id = p_actor and status = 'active'
  ) then
    raise exception 'post_payroll_gl: actor is not an active user'
      using errcode = 'PR403';
  end if;

  v_request_key :=
    p_actor || '|payroll_gl.post|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'runId', p_run_id,
    'actorId', p_actor,
    'metadata', p_metadata
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));
  select *
    into v_receipt
    from public.finance_payroll_gl_command_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception 'post_payroll_gl: idempotency key was already used for a different request'
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
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_run.status <> 'locked' then
    return jsonb_build_object('status', 'not_lockable', 'current', v_run.status);
  end if;
  if v_run.gl_journal_id is not null then
    return jsonb_build_object('status', 'already_posted', 'journal_id', v_run.gl_journal_id);
  end if;
  if v_run.current_calculation_version_id is null then
    return jsonb_build_object(
      'status', 'invalid_calculation',
      'message', 'The locked run has no valid current calculation version.'
    );
  end if;
  select *
    into v_version
    from public.finance_payroll_calculation_versions v
   where v.id = v_run.current_calculation_version_id
     and v.run_id = v_run.id
     for share;
  if not found then
    return jsonb_build_object(
      'status', 'invalid_calculation',
      'message', 'The locked run has no valid current calculation version.'
    );
  end if;
  perform l.id
    from public.finance_payroll_calculation_version_lines l
   where l.calculation_version_id = v_version.id
   order by l.employee_id
     for share;

  -- Calculation breakdown amounts are part of the immutable payroll evidence.
  -- Reject malformed rows instead of silently treating tampered values as zero.
  if exists (
    select 1
      from public.finance_payroll_calculation_version_lines l
     where l.calculation_version_id = v_run.current_calculation_version_id
       and (
         (
           l.breakdown ? 'approvedOtAmount'
           and jsonb_typeof(l.breakdown->'approvedOtAmount') <> 'number'
         )
         or (
           l.breakdown ? 'taxableAllowances'
           and jsonb_typeof(l.breakdown->'taxableAllowances') <> 'number'
         )
         or (
           l.breakdown ? 'nonTaxableAllowances'
           and jsonb_typeof(l.breakdown->'nonTaxableAllowances') <> 'number'
         )
       )
  ) then
    return jsonb_build_object(
      'status', 'invalid_calculation',
      'message', 'The calculation version contains malformed GL evidence.'
    );
  end if;

  with totals as (
    select
      round(coalesce(sum(l.base), 0), 2) as salary_expense,
      round(coalesce(sum(
        case
          when l.breakdown ? 'approvedOtAmount'
            then (l.breakdown->>'approvedOtAmount')::numeric
          else 0
        end
      ), 0), 2) as overtime_expense,
      round(coalesce(sum(
        case
          when l.breakdown ? 'taxableAllowances'
            then (l.breakdown->>'taxableAllowances')::numeric
          else 0
        end
        + case
          when l.breakdown ? 'nonTaxableAllowances'
            then (l.breakdown->>'nonTaxableAllowances')::numeric
          else 0
        end
      ), 0), 2) as allowance_expense,
      round(coalesce(sum(l.nis_employer), 0), 2) as employer_nis_expense,
      round(coalesce(sum(l.paye), 0), 2) as paye_payable,
      round(coalesce(sum(l.nis_employee), 0), 2) as nis_employee_payable,
      round(coalesce(sum(l.nis_employer), 0), 2) as nis_employer_payable,
      round(coalesce(sum(l.health_surcharge), 0), 2) as health_surcharge_payable,
      round(coalesce(sum(l.voluntary_deductions), 0), 2) as deductions_payable
    from public.finance_payroll_calculation_version_lines l
    where l.calculation_version_id = v_run.current_calculation_version_id
  ),
  expected as (
    select *
    from totals t
    cross join lateral (
      values
        (1, 'salary_expense'::text, 'debit'::text, t.salary_expense, 'Salaries & Wages'::text),
        (2, 'overtime_expense', 'debit', t.overtime_expense, 'Overtime'),
        (3, 'allowance_expense', 'debit', t.allowance_expense, 'Allowances'),
        (4, 'employer_nis_expense', 'debit', t.employer_nis_expense, 'Employer NIS'),
        (5, 'paye_payable', 'credit', t.paye_payable, 'PAYE Payable'),
        (6, 'nis_employee_payable', 'credit', t.nis_employee_payable, 'NIS Employee Payable'),
        (7, 'nis_employer_payable', 'credit', t.nis_employer_payable, 'NIS Employer Payable'),
        (8, 'health_surcharge_payable', 'credit', t.health_surcharge_payable, 'Health Surcharge Payable'),
        (9, 'deductions_payable', 'credit', t.deductions_payable, 'Payroll Deductions Payable'),
        (
          10,
          'net_pay_clearing',
          'credit',
          round(
            t.salary_expense
            + t.overtime_expense
            + t.allowance_expense
            + t.employer_nis_expense
            - t.paye_payable
            - t.nis_employee_payable
            - t.nis_employer_payable
            - t.health_surcharge_payable
            - t.deductions_payable,
            2
          ),
          'Net Pay Clearing'
        )
    ) e(sort_order, mapping_key, side, amount, description)
    where e.amount > 0
  ),
  resolved as (
    select
      e.sort_order,
      e.mapping_key,
      e.side,
      e.amount,
      e.description,
      m.account_code,
      a.code as active_account_code
    from expected e
    left join public.finance_payroll_gl_mappings m
      on m.mapping_key = e.mapping_key
     and m.component_id is null
     and m.department_id is null
     and m.active = true
    left join public.finance_gl_accounts a
      on a.code = m.account_code
     and a.is_active = true
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'mapping_key', r.mapping_key,
          'account_code', r.account_code,
          'debit', case when r.side = 'debit' then r.amount else 0 end,
          'credit', case when r.side = 'credit' then r.amount else 0 end,
          'description', r.description
        )
        order by r.sort_order
      ),
      '[]'::jsonb
    ),
    count(*) filter (
      where r.account_code is null or r.active_account_code is null
    )::integer
    into v_expected_lines, v_missing_mapping_count
    from resolved r;

  if v_missing_mapping_count > 0 then
    return jsonb_build_object(
      'status', 'invalid_account',
      'message', v_missing_mapping_count ||
        ' required payroll GL mapping(s) are missing, inactive, or point to inactive accounts.'
    );
  end if;

  select md5(coalesce(
    jsonb_agg(
      jsonb_build_object(
        'lineNo', line.ordinality,
        'accountCode', line.value->>'account_code',
        'debit', (line.value->>'debit')::numeric,
        'credit', (line.value->>'credit')::numeric
      )
      order by line.ordinality
    )::text,
    '[]'
  ))
    into v_control_checksum
    from jsonb_array_elements(v_expected_lines)
      with ordinality as line(value, ordinality);
  for v_line in select value from jsonb_array_elements(v_expected_lines) loop
    v_count := v_count + 1;
    v_total_debit := v_total_debit + (v_line->>'debit')::numeric;
    v_total_credit := v_total_credit + (v_line->>'credit')::numeric;
  end loop;
  if v_count < 2 then
    return jsonb_build_object(
      'status', 'invalid_calculation',
      'message', 'The calculation version does not produce a valid payroll journal.'
    );
  end if;
  if abs(v_total_debit - v_total_credit) > 0.005 then
    return jsonb_build_object('status', 'unbalanced', 'total_debit', v_total_debit, 'total_credit', v_total_credit);
  end if;

  v_journal_no := 'JE-' || v_year::text || '-' ||
    lpad(public.increment_ref_counter('JE', v_year)::text, 4, '0');

  insert into public.finance_gl_journals
    (journal_no, entry_date, memo, status, source_module, source_ref,
     posted_at, posted_by, created_by, metadata)
  values
    (v_journal_no, coalesce(v_run.pay_date, v_run.period_month),
     'Payroll ' || v_run.run_no || ' - ' || to_char(v_run.period_month, 'YYYY-MM'),
     'posted', 'finance_payroll', v_run.run_no,
     now(), p_actor, p_actor,
      (p_metadata - 'runNo' - 'payrollRunId' - 'calculationVersionId'
        - 'payrollControlChecksum') || jsonb_build_object(
        'payrollRunId', p_run_id::text,
        'runNo', v_run.run_no,
        'calculationVersionId', v_run.current_calculation_version_id,
        'payrollControlChecksum', v_control_checksum
      ))
  returning id into v_journal_id;

  for v_line in select value from jsonb_array_elements(v_expected_lines) loop
    v_line_no := v_line_no + 1;
    insert into public.finance_gl_journal_lines
      (journal_id, line_no, account_code, debit, credit, description)
    values
      (v_journal_id, v_line_no, v_line->>'account_code',
       (v_line->>'debit')::numeric,
       (v_line->>'credit')::numeric,
       v_line->>'description');
  end loop;

  update public.finance_payroll_runs
     set gl_journal_id = v_journal_id, gl_posted_at = now()
   where id = p_run_id;

  insert into public.app_events (
    event_type, source_module, source_entity_type, source_entity_id,
    actor_user_id, severity, payload, dedupe_key
  )
  values (
    'finance.payroll.gl.posted', 'finance_payroll', 'payroll_run',
    v_run.id::text, p_actor, 'success',
    jsonb_build_object(
      'runNo', v_run.run_no,
      'journalId', v_journal_id,
      'journalNo', v_journal_no,
      'totalDebit', v_total_debit,
      'totalCredit', v_total_credit,
      'calculationVersionId', v_run.current_calculation_version_id,
      'payrollControlChecksum', v_control_checksum
    ),
    'finance.payroll.gl.posted:' || v_journal_id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key, record_id, actor_id, action, previous_state, new_state
  )
  values (
    'finance_payroll', v_run.id::text, p_actor, 'payroll_run.gl_posted',
    jsonb_build_object('glJournalId', null),
    jsonb_build_object(
      'journalId', v_journal_id,
      'journalNo', v_journal_no,
      'totalDebit', v_total_debit,
      'totalCredit', v_total_credit,
      'calculationVersionId', v_run.current_calculation_version_id,
      'payrollControlChecksum', v_control_checksum
    )
  );

  insert into public.handoff_outbox (
    source_module, target_module, source_entity_type, source_entity_id,
    target_entity_type, target_entity_id, payload, status, created_by
  )
  values (
    'finance_payroll', 'finance_gl', 'payroll_run', v_run.id::text,
    'gl_journal', v_journal_id::text,
    jsonb_build_object(
      'journalId', v_journal_id,
      'journalNo', v_journal_no,
      'runNo', v_run.run_no,
      'calculationVersionId', v_run.current_calculation_version_id,
      'payrollControlChecksum', v_control_checksum,
      'eventId', v_event_id
    ),
    'pending', p_actor
  )
  returning id into v_handoff_id;

  v_result := jsonb_build_object(
    'status', 'posted',
    'journal_id', v_journal_id,
    'journal_no', v_journal_no,
    'total_debit', v_total_debit,
    'total_credit', v_total_credit,
    'calculation_version_id', v_run.current_calculation_version_id,
    'payroll_control_checksum', v_control_checksum,
    'event_id', v_event_id,
    'handoff_id', v_handoff_id,
    'duplicate', false
  );

  insert into public.finance_payroll_gl_command_receipts (
    request_key, request_hash, run_id, actor_id, command, journal_id, result
  )
  values (
    v_request_key, v_hash, v_run.id, p_actor, 'post', v_journal_id, v_result
  );

  return v_result;
end;
$post_gl$;

revoke all on function public.post_payroll_gl_tx(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.post_payroll_gl_tx(uuid, text, text, jsonb)
  to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
