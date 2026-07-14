-- ============================================================================
-- Finance Employee-Loan — workflow source-transition receipt RPC (finding #1)
-- Design: DECIDE_TX_DESIGN.md §5/§8. Depends on 150 (workflow_source_receipts).
-- Operator-applied; idempotent. After applying: NOTIFY pgrst, 'reload schema';
--
-- Converts the multi-write financeLoanAdapter (source UPDATE + hr_audit_log +
-- app_events) into ONE transactional, receipt-producing operation keyed by
-- transition_id. Approval mirrors the adapter: SoD (creator != approver),
-- pending_approval → active (+ approved_by/at) + the 'finance.loan.activated'
-- event. return → draft, reject → rejected, cancel → cancelled. A retry returns
-- the stored result and writes NOTHING → exactly-once observable effects. The
-- borrower "loan approved" notification is delivered after commit in the outbox
-- worker (afterCommit). NOTE: loan repayment-ledger deductions happen at payroll
-- LOCK time (a separate action), never here.
-- ============================================================================

create or replace function public.finance_loan_workflow_transition_tx(
  p_transition_id uuid,
  p_loan_id       uuid,
  p_actor_id      text,
  p_target_status text,          -- approved | returned | rejected | cancelled
  p_comment       text,
  p_input_hash    text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_receipt      public.workflow_source_receipts%rowtype;
  v_status       text;
  v_created_by   text;
  v_reference    text;
  v_employee_id  text;
  v_installment  numeric;
  v_new_status   text;
  v_audit_action text;
  v_event_type   text;
  v_severity     text;
  v_now          timestamptz := now();
  v_result       jsonb;
begin
  if p_target_status not in ('approved','returned','rejected','cancelled') then
    raise exception 'finance_loan_transition: invalid target %', p_target_status using errcode = 'WF400';
  end if;

  select * into v_receipt from public.workflow_source_receipts where transition_id = p_transition_id;
  if found then
    if v_receipt.input_hash = p_input_hash then
      return v_receipt.result;
    end if;
    raise exception 'finance_loan_transition: receipt input hash mismatch for %', p_transition_id using errcode = 'WF409';
  end if;

  select status, created_by, reference, employee_id, installment_amount
    into v_status, v_created_by, v_reference, v_employee_id, v_installment
    from public.finance_employee_loans where id = p_loan_id for update;
  if not found then
    raise exception 'finance_loan_transition: loan % not found', p_loan_id using errcode = 'WF404';
  end if;

  if p_target_status = 'approved' then
    if v_status <> 'pending_approval' then
      raise exception 'finance_loan_transition: loan % is % (expected pending_approval)', p_loan_id, v_status using errcode = 'WF409';
    end if;
    if v_created_by is not null and v_created_by = p_actor_id then
      raise exception 'finance_loan_transition: segregation of duties — creator cannot approve their own loan' using errcode = 'WF422';
    end if;
    v_new_status := 'active'; v_audit_action := 'loan.approved';
    v_event_type := 'finance.loan.activated'; v_severity := 'success';
    update public.finance_employee_loans
       set status = 'active', approved_by = p_actor_id, approved_at = v_now where id = p_loan_id;
  elsif p_target_status = 'returned' then
    v_new_status := 'draft'; v_audit_action := 'loan.returned';
    v_event_type := 'finance.loan.returned'; v_severity := 'warning';
    update public.finance_employee_loans set status = 'draft' where id = p_loan_id;
  elsif p_target_status = 'rejected' then
    v_new_status := 'rejected'; v_audit_action := 'loan.rejected';
    v_event_type := 'finance.loan.rejected'; v_severity := 'warning';
    update public.finance_employee_loans set status = 'rejected' where id = p_loan_id;
  else -- cancelled
    v_new_status := 'cancelled'; v_audit_action := 'loan.workflow_cancelled';
    v_event_type := 'finance.loan.cancelled'; v_severity := 'warning';
    update public.finance_employee_loans set status = 'cancelled' where id = p_loan_id;
  end if;

  insert into public.hr_audit_log
    (submodule_key, record_id, actor_id, action, previous_state, new_state, reason)
  values
    ('finance_loan', p_loan_id::text, nullif(p_actor_id, ''), v_audit_action,
     jsonb_build_object('status', v_status), jsonb_build_object('status', v_new_status), nullif(p_comment, ''));

  -- The adapter emits no app_event on cancel (audit only); mirror that.
  if p_target_status <> 'cancelled' then
    insert into public.app_events
      (event_type, source_module, source_entity_type, source_entity_id, actor_user_id, severity, payload, dedupe_key)
    values
      (v_event_type, 'finance_loan', 'employee_loan', p_loan_id::text, nullif(p_actor_id, ''), v_severity,
       jsonb_build_object('reference', v_reference, 'employeeId', v_employee_id,
                          'installmentAmount', v_installment, 'reason', p_comment),
       'finance_loan.' || v_event_type || ':' || p_transition_id::text);
  end if;

  v_result := jsonb_build_object(
    'loanId', p_loan_id, 'reference', v_reference, 'employeeId', v_employee_id,
    'status', v_new_status, 'approvedBy', case when p_target_status = 'approved' then p_actor_id end);

  insert into public.workflow_source_receipts (transition_id, module_key, source_id, input_hash, result)
  values (p_transition_id, 'finance_loan', p_loan_id::text, p_input_hash, v_result);

  return v_result;
end
$fn$;

revoke all    on function public.finance_loan_workflow_transition_tx(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finance_loan_workflow_transition_tx(uuid, uuid, text, text, text, text) to service_role;

-- After applying:  NOTIFY pgrst, 'reload schema';
