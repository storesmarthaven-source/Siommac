// ============================================================================
// Finance Payroll — Employee loans & salary advances (Wave 5)
// ============================================================================
// Fixed-installment loans/advances with an optional FLAT interest amount.
//   total_repayable = principal + interest_amount
//   a fixed installment_amount deducts each pay cycle until the balance clears.
// The finance_loan_deductions ledger is the SOURCE OF TRUTH for the balance
// (balance = total_repayable − Σ ledger). One ledger row per (loan, run) makes
// lock/recalc idempotent; reopening a run reverses its ledger + restores balances.
// Maker-checker via the central workflow (finance_loan_approval) with SoD.
// ============================================================================

import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { cancelWorkflow, rpcHttpError } from '../workflow/service';
import { selectWorkflowBinding } from '../workflow/bindingResolver';
import { notifyUsersByRole } from './financeEvents';
import { notify } from '../notify';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

export type LoanType = 'loan' | 'advance';
export type LoanStatus = 'draft' | 'pending_approval' | 'active' | 'settled' | 'cancelled' | 'rejected';

export interface LoanDto {
  id: string;
  reference: string;
  employeeId: string;
  loanType: LoanType;
  principal: number;
  interestAmount: number;
  totalRepayable: number;
  installmentAmount: number;
  balance: number;
  startPeriod: string | null;
  status: LoanStatus;
  reason: string | null;
  notes: string | null;
  workflowId: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbLoanRow {
  id: string; reference: string; employee_id: string; loan_type: string;
  principal: number; interest_amount: number; total_repayable: number;
  installment_amount: number; balance: number; start_period: string | null;
  status: string; reason: string | null; notes: string | null; workflow_id: string | null;
  created_by: string | null; approved_by: string | null; approved_at: string | null;
  settled_at: string | null; created_at: string; updated_at: string;
}

export function toLoanDto(r: DbLoanRow): LoanDto {
  return {
    id: r.id, reference: r.reference, employeeId: r.employee_id, loanType: r.loan_type as LoanType,
    principal: Number(r.principal), interestAmount: Number(r.interest_amount),
    totalRepayable: Number(r.total_repayable), installmentAmount: Number(r.installment_amount),
    balance: Number(r.balance), startPeriod: r.start_period, status: r.status as LoanStatus,
    reason: r.reason, notes: r.notes, workflowId: r.workflow_id,
    createdBy: r.created_by, approvedBy: r.approved_by, approvedAt: r.approved_at,
    settledAt: r.settled_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const SEL = 'id, reference, employee_id, loan_type, principal, interest_amount, total_repayable, installment_amount, balance, start_period, status, reason, notes, workflow_id, created_by, approved_by, approved_at, settled_at, created_at, updated_at';

// ── Read ────────────────────────────────────────────────────────────────────

export async function listLoans(opts: { employeeId?: string; status?: string } = {}): Promise<LoanDto[]> {
  let q = sb.from('finance_employee_loans').select(SEL).order('created_at', { ascending: false });
  if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw err(500, 'listLoans: ' + error.message);
  return ((data ?? []) as DbLoanRow[]).map(toLoanDto);
}

export async function getLoan(id: string): Promise<LoanDto | null> {
  const { data, error } = await sb.from('finance_employee_loans').select(SEL).eq('id', id).maybeSingle<DbLoanRow>();
  if (error) throw err(500, 'getLoan: ' + error.message);
  return data ? toLoanDto(data) : null;
}

// ── Create (draft) ──────────────────────────────────────────────────────────

export interface CreateLoanInput {
  employeeId: string;
  loanType: LoanType;
  principal: number;
  interestAmount?: number;
  installmentAmount: number;
  startPeriod?: string | null;   // YYYY-MM-DD, first pay-period month to deduct from
  reason?: string | null;
  notes?: string | null;
}

export async function createLoan(input: CreateLoanInput, actorId: string): Promise<LoanDto> {
  const principal = round2(input.principal);
  const interest = round2(input.interestAmount ?? 0);
  const installment = round2(input.installmentAmount);
  if (!(principal > 0)) throw err(422, 'Principal must be greater than 0.');
  if (interest < 0) throw err(422, 'Interest amount cannot be negative.');
  if (!(installment > 0)) throw err(422, 'Installment amount must be greater than 0.');
  const totalRepayable = round2(principal + interest);
  if (installment > totalRepayable) throw err(422, 'Installment cannot exceed the total repayable amount.');

  // Employee must exist + be active.
  const { data: emp } = await sb.from('app_users').select('id, status').eq('id', input.employeeId).maybeSingle<{ id: string; status: string }>();
  if (!emp) throw err(422, 'Employee not found.');

  const reference = await nextRef('LOAN');
  const { data, error } = await sb.from('finance_employee_loans').insert({
    reference, employee_id: input.employeeId, loan_type: input.loanType,
    principal, interest_amount: interest, total_repayable: totalRepayable,
    installment_amount: installment, balance: totalRepayable,
    start_period: input.startPeriod ?? null, status: 'draft',
    reason: input.reason ?? null, notes: input.notes ?? null, created_by: actorId,
  }).select(SEL).single<DbLoanRow>();
  if (error) throw err(500, 'createLoan: ' + error.message);
  const loan = toLoanDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_loan', recordId: loan.id, actorId,
    action: 'loan.created', newState: { reference: loan.reference, employeeId: loan.employeeId, loanType: loan.loanType, totalRepayable: loan.totalRepayable, installmentAmount: loan.installmentAmount },
  });
  void emitAppEvent({
    eventType: 'finance.loan.created', sourceModule: 'finance_loan',
    sourceEntityType: 'employee_loan', sourceEntityId: loan.id, actorUserId: actorId, severity: 'info',
    payload: { reference: loan.reference, employeeId: loan.employeeId, totalRepayable: loan.totalRepayable },
  });
  return loan;
}

// ── Submit for approval (draft → pending_approval + workflow) ─────────────────

export async function submitLoan(id: string, actorId: string, idempotencyKey: string): Promise<LoanDto> {
  // ATOMIC (finding #3): the source status flip (draft/rejected -> pending_approval),
  // workflow_id, the whole workflow, the business event and hr_audit_log are ALL
  // committed in ONE transaction by workflow_submit_for_record_tx
  // (finance_employee_loans branch) — no strand, no crash-window, no compensating
  // rollback, no double-start. The RPC owns idempotency; only the assignee
  // notification stays here (best-effort, post-commit — it replaces the fan-out
  // startWorkflowForRecord used to do via notifyTaskAssigned).
  const requestKey = idempotencyKey?.trim();
  if (!requestKey) throw err(400, 'An idempotency key is required to submit a loan.');

  const loan = await getLoan(id);
  if (!loan) throw err(404, 'Loan not found.');

  const binding = await selectWorkflowBinding(sb, {
    moduleKey:      'finance_loan',
    workflowType:   'finance_loan_approval',
    triggerEvent:   'finance.loan.submitted',
    sourceRecordId: id,
    requestedBy:    actorId,
    recordData:     {},
  });
  if (!binding) throw err(422, 'No approval workflow is configured for employee loans.');

  const { data, error } = await sb.rpc('workflow_submit_for_record_tx', {
    p_source_table: 'finance_employee_loans',
    p_source_id:    id,
    p_actor_id:     actorId,
    p_binding_id:   binding.id,
    p_request_key:  requestKey,
    p_business:     { employeeId: loan.employeeId, loanType: loan.loanType, principal: loan.principal, totalRepayable: loan.totalRepayable, installmentAmount: loan.installmentAmount },
  });
  if (error) throw rpcHttpError(error as { code?: string | null; message: string });
  const result = (data ?? {}) as { workflowId?: string | null };

  // Notify the finance_manager assignees (best-effort, post-commit). Workflow id in
  // the dedupe key so a RESUBMIT notifies afresh.
  void notifyUsersByRole('finance_manager', {
    type:           'finance.loan.pending_approval',
    title:          `Loan ${loan.reference} submitted for approval`,
    body:           `A ${loan.loanType === 'advance' ? 'salary advance' : 'loan'} of ${loan.totalRepayable.toFixed(2)} is awaiting your approval.`,
    module:         'finance_loan',
    severity:       'warning',
    sourceType:     'employee_loan',
    sourceId:       id,
    actionRequired: true,
    dedupeKey:      `loan.pending_approval.${id}.${result.workflowId ?? ''}`,
  });

  const updated = await getLoan(id);
  if (!updated) throw err(503, 'Loan submitted but could not be reloaded — retry to fetch the result.');
  return updated;
}

// ── Approval side-effects (called by the workflow adapter) ────────────────────

/** Notify the borrower + emit the activated event when a loan becomes active. */
export async function emitLoanActivatedSideEffects(loan: LoanDto, actorId: string | null): Promise<void> {
  void notify({
    userId: loan.employeeId,
    type: 'finance.loan.activated',
    title: `Loan ${loan.reference} approved`,
    body: `Your ${loan.loanType === 'advance' ? 'salary advance' : 'loan'} of ${loan.totalRepayable.toFixed(2)} is approved — ${loan.installmentAmount.toFixed(2)} will be deducted each pay period until it clears.`,
    module: 'finance_loan',
    severity: 'success',
    sourceType: 'employee_loan',
    sourceId: loan.id,
    dedupeKey: `finance.loan.activated.${loan.id}`,
  });
  void emitAppEvent({
    eventType: 'finance.loan.activated', sourceModule: 'finance_loan',
    sourceEntityType: 'employee_loan', sourceEntityId: loan.id, actorUserId: actorId ?? 'workflow', severity: 'success',
    payload: { reference: loan.reference, employeeId: loan.employeeId, installmentAmount: loan.installmentAmount },
  });
}

// ── Settle (early settlement: active → settled) ───────────────────────────────

export async function settleLoan(id: string, actorId: string): Promise<LoanDto> {
  const loan = await getLoan(id);
  if (!loan) throw err(404, 'Loan not found.');
  if (loan.status !== 'active') throw err(422, `Only active loans can be settled (loan is '${loan.status}').`);
  if (!(loan.balance > 0)) throw err(422, 'Loan has no outstanding balance to settle.');

  // The LEDGER is the source of truth — record the external payment FIRST, so a
  // balance recompute can never resurrect a settled loan. One settlement per loan
  // (partial unique index); a concurrent double-settle loses on the insert.
  const now = new Date().toISOString();
  const { data: ledgerRow, error: ledErr } = await sb.from('finance_loan_deductions').insert({
    loan_id: id, run_id: null, entry_type: 'settlement',
    amount: loan.balance, balance_after: 0,
  }).select('id').single<{ id: string }>();
  if (ledErr) {
    if (ledErr.code === '23505') throw err(409, 'This loan already has a settlement recorded.');
    throw err(500, 'settleLoan/ledger: ' + ledErr.message);
  }

  const { error } = await sb.from('finance_employee_loans')
    .update({ status: 'settled', balance: 0, settled_at: now })
    .eq('id', id).eq('status', 'active');
  if (error) {
    // Compensating rollback — never leave a settlement row without the settled status.
    await sb.from('finance_loan_deductions').delete().eq('id', ledgerRow.id);
    throw err(500, 'settleLoan: ' + error.message);
  }

  await writeHrAudit({
    submoduleKey: 'finance_loan', recordId: id, actorId,
    action: 'loan.settled', previousState: { status: 'active', balance: loan.balance }, newState: { status: 'settled', balance: 0, settlementLedgerId: ledgerRow.id },
  });
  void emitAppEvent({
    eventType: 'finance.loan.settled', sourceModule: 'finance_loan',
    sourceEntityType: 'employee_loan', sourceEntityId: id, actorUserId: actorId, severity: 'success',
    payload: { reference: loan.reference, employeeId: loan.employeeId, clearedBalance: loan.balance },
  });
  return (await getLoan(id))!;
}

// ── Cancel (draft / pending_approval / rejected → cancelled) ───────────────────

/**
 * Cancel a loan that has NOT taken effect. An ACTIVE loan cannot be cancelled —
 * its outstanding balance is real money: it must be settled (paid off) or written
 * off through its own approval, never zeroed by a single actor's cancel click.
 * Cancelling a pending_approval loan also cancels its open workflow instance so
 * no orphaned approval task remains.
 */
export async function cancelLoan(id: string, actorId: string, reason?: string): Promise<LoanDto> {
  const loan = await getLoan(id);
  if (!loan) throw err(404, 'Loan not found.');
  if (!['draft', 'pending_approval', 'rejected'].includes(loan.status)) {
    throw err(422, loan.status === 'active'
      ? 'An active loan cannot be cancelled — settle it (paid off) or process a write-off via approval.'
      : `A ${loan.status} loan cannot be cancelled.`);
  }

  if (loan.status === 'pending_approval' && loan.workflowId) {
    // Cancel the WORKFLOW — its adapter (onWorkflowCancelled) sets the loan to
    // 'cancelled'. One authority: no direct status write alongside the engine,
    // and no orphaned open approval task.
    await cancelWorkflow({ workflowId: loan.workflowId, actor: { id: actorId }, reason: reason?.trim() || 'Loan cancelled by finance.' });
  } else {
    const { error } = await sb.from('finance_employee_loans')
      .update({ status: 'cancelled' })
      .eq('id', id).in('status', ['draft', 'rejected']);
    if (error) throw err(500, 'cancelLoan: ' + error.message);
  }

  await writeHrAudit({
    submoduleKey: 'finance_loan', recordId: id, actorId,
    action: 'loan.cancelled', previousState: { status: loan.status }, newState: { status: 'cancelled' }, reason: reason ?? null,
  });
  void emitAppEvent({
    eventType: 'finance.loan.cancelled', sourceModule: 'finance_loan',
    sourceEntityType: 'employee_loan', sourceEntityId: id, actorUserId: actorId, severity: 'warning',
    payload: { reference: loan.reference, reason: reason ?? null },
  });
  return (await getLoan(id))!;
}

// ── Payroll integration ───────────────────────────────────────────────────────

export interface LoanInstallment { loanId: string; reference: string; amount: number }

/**
 * Active-loan installments to deduct for the given employees in a run period.
 * installment = min(installment_amount, outstanding balance). Loans whose
 * start_period is after the run period are not yet due.
 */
export async function loadLoanInstallments(
  employeeIds: string[],
  periodMonth: string,
): Promise<Map<string, LoanInstallment[]>> {
  const byEmp = new Map<string, LoanInstallment[]>();
  if (employeeIds.length === 0) return byEmp;
  type LoanRow = { id: string; reference: string; employee_id: string; installment_amount: number; balance: number; start_period: string | null };
  // Chunk the IN() list — 1000+ employee ids overflow the request URL.
  const rows: LoanRow[] = [];
  for (let i = 0; i < employeeIds.length; i += 300) {
    const { data, error } = await sb.from('finance_employee_loans')
      .select('id, reference, employee_id, installment_amount, balance, start_period')
      .eq('status', 'active').gt('balance', 0).in('employee_id', employeeIds.slice(i, i + 300));
    if (error) throw err(500, 'loadLoanInstallments: ' + error.message);
    rows.push(...((data ?? []) as LoanRow[]));
  }
  for (const l of rows) {
    if (l.start_period && l.start_period > periodMonth) continue; // not yet due
    const amount = round2(Math.min(Number(l.installment_amount), Number(l.balance)));
    if (!(amount > 0)) continue;
    const list = byEmp.get(l.employee_id) ?? [];
    list.push({ loanId: l.id, reference: l.reference, amount });
    byEmp.set(l.employee_id, list);
  }
  return byEmp;
}

/** Recompute a loan's balance from its ledger; settle when it reaches 0, reactivate if reopened above 0. */
async function recomputeLoanBalance(loanId: string): Promise<void> {
  const { data: loan } = await sb.from('finance_employee_loans')
    .select('total_repayable, status, settled_at').eq('id', loanId).maybeSingle<{ total_repayable: number; status: string; settled_at: string | null }>();
  if (!loan) return;
  const { data: led } = await sb.from('finance_loan_deductions').select('amount').eq('loan_id', loanId);
  const paid = (led ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0);
  const balance = Math.max(0, round2(Number(loan.total_repayable) - paid));
  const patch: Record<string, unknown> = { balance };
  // Auto-settle at zero; re-activate a previously-settled loan if a reopen restored balance.
  if (balance <= 0 && loan.status === 'active') { patch['status'] = 'settled'; patch['settled_at'] = new Date().toISOString(); }
  else if (balance > 0 && loan.status === 'settled') { patch['status'] = 'active'; patch['settled_at'] = null; }
  await sb.from('finance_employee_loans').update(patch).eq('id', loanId);
}

/**
 * Record loan deductions for a run when it is finalized (lock). Reads the loan
 * deduction input rows snapshotted at lock-inputs, writes one ledger row per
 * (loan, run) — idempotent via the unique constraint — and recomputes balances.
 */
export async function recordLoanDeductionsForRun(runId: string, actorId: string): Promise<void> {
  const { data: inputs, error } = await sb.from('finance_payroll_run_inputs')
    .select('employee_id, amount, metadata').eq('run_id', runId).contains('metadata', { loan: true });
  if (error) throw err(500, 'recordLoanDeductionsForRun: ' + error.message);
  const rows = (inputs ?? []) as Array<{ employee_id: string; amount: number; metadata: Record<string, unknown> }>;
  const touched = new Set<string>();
  for (const row of rows) {
    const loanId = row.metadata?.['loan_id'] as string | undefined;
    if (!loanId) continue;
    const amount = round2(Number(row.amount));
    if (!(amount > 0)) continue;
    // Idempotent: one ledger row per (loan, run). balance_after is recomputed below.
    const { error: insErr } = await sb.from('finance_loan_deductions')
      .insert({ loan_id: loanId, run_id: runId, amount, balance_after: 0 })
      .select('id').maybeSingle();
    // 23505 = already recorded for this run (idempotent re-lock) — skip, don't fail.
    if (insErr && (insErr as { code?: string }).code !== '23505') throw err(500, 'recordLoanDeductionsForRun/insert: ' + insErr.message);
    touched.add(loanId);
  }
  for (const loanId of touched) {
    await recomputeLoanBalance(loanId);
    const { data: after } = await sb.from('finance_loan_deductions')
      .select('id, balance_after').eq('loan_id', loanId).eq('run_id', runId).maybeSingle<{ id: string; balance_after: number }>();
    const { data: loan } = await sb.from('finance_employee_loans').select('balance').eq('id', loanId).maybeSingle<{ balance: number }>();
    if (after && loan) await sb.from('finance_loan_deductions').update({ balance_after: Number(loan.balance) }).eq('id', after.id);
    void emitAppEvent({
      eventType: 'finance.loan.deduction_recorded', sourceModule: 'finance_loan',
      sourceEntityType: 'employee_loan', sourceEntityId: loanId, actorUserId: actorId, severity: 'info',
      payload: { runId },
    });
  }
}

/** Reverse a run's loan deductions when it is reopened — delete ledger rows + restore balances. */
export async function reverseLoanDeductionsForRun(runId: string): Promise<void> {
  const { data: led } = await sb.from('finance_loan_deductions').select('loan_id').eq('run_id', runId);
  const loanIds = [...new Set((led ?? []).map((r: { loan_id: string }) => r.loan_id))];
  if (loanIds.length === 0) return;
  await sb.from('finance_loan_deductions').delete().eq('run_id', runId);
  for (const loanId of loanIds) await recomputeLoanBalance(loanId);
}
