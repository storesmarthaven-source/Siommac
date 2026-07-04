// ============================================================================
// Finance -- Expenses / Cost Entries (F4)
// ============================================================================
import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { nextRef } from '../refGenerator';
import { startWorkflowForRecord } from '../workflow/service';
import { assertDifferentApprover } from './statutoryConfig';
import { createAttachmentUploadUrl } from '../upload';
import type { ModuleWorkflowContext } from '../workflow/definitionTypes';

export const EXPENSE_RECEIPT_BUCKET = 'finance-receipts';

export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'reimbursed' | 'cancelled';

export interface ExpenseClaimDto {
  id: string;
  claimNo: string;
  claimantId: string;
  title: string;
  expenseDate: string;
  category: string;
  totalAmount: number;
  currency: string;
  status: ExpenseStatus;
  receiptPath: string | null;
  reimbursable: boolean;
  reimbursedAt: string | null;
  approvedBy: string | null;
  createdBy: string | null;
  cancelReason: string | null;
  rejectReason: string | null;
  workflowId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCostEntryDto {
  id: string;
  ref: string;
  costCenterId: string | null;
  amount: number;
  currency: string;
  description: string | null;
  expenseClaimId: string | null;
  createdAt: string;
}

export interface ExpenseReportRow {
  id: string;
  claimNo: string;
  claimantId: string;
  title: string;
  expenseDate: string;
  category: string;
  totalAmount: number;
  currency: string;
  status: string;
  reimbursable: boolean;
  reimbursedAt: string | null;
  createdAt: string;
}

interface DbClaimRow {
  id: string; claim_no: string; claimant_id: string;
  title: string; expense_date: string; category: string;
  total_amount: string; currency: string; status: string;
  receipt_path: string | null; reimbursable: boolean;
  reimbursed_at: string | null; approved_by: string | null;
  created_by: string | null; cancel_reason: string | null;
  reject_reason: string | null; workflow_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string; updated_at: string;
}

interface DbEntryRow {
  id: string; ref: string; cost_center_id: string | null;
  amount: string; currency: string; description: string | null;
  expense_claim_id: string | null; created_at: string;
}

function toDto(r: DbClaimRow): ExpenseClaimDto {
  return {
    id: r.id, claimNo: r.claim_no, claimantId: r.claimant_id,
    title: r.title, expenseDate: r.expense_date, category: r.category,
    totalAmount: Number(r.total_amount), currency: r.currency,
    status: r.status as ExpenseStatus,
    receiptPath: r.receipt_path, reimbursable: r.reimbursable,
    reimbursedAt: r.reimbursed_at, approvedBy: r.approved_by,
    createdBy: r.created_by, cancelReason: r.cancel_reason,
    rejectReason: r.reject_reason, workflowId: r.workflow_id,
    metadata: r.metadata,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toEntryDto(r: DbEntryRow): ExpenseCostEntryDto {
  return {
    id: r.id, ref: r.ref,
    costCenterId: r.cost_center_id,
    amount: Number(r.amount), currency: r.currency,
    description: r.description,
    expenseClaimId: r.expense_claim_id,
    createdAt: r.created_at,
  };
}

export async function listExpenseClaims(opts: {
  claimantId?: string;
  status?: ExpenseStatus;
  category?: string;
} = {}): Promise<ExpenseClaimDto[]> {
  let q = sb.from('finance_expense_claims').select('*')
    .order('created_at', { ascending: false });
  if (opts.claimantId) q = q.eq('claimant_id', opts.claimantId);
  if (opts.status)     q = q.eq('status', opts.status);
  if (opts.category)   q = q.eq('category', opts.category);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listExpenseClaims: ' + error.message), { status: 500 });
  return ((data ?? []) as DbClaimRow[]).map(toDto);
}

export async function getExpenseClaim(id: string): Promise<ExpenseClaimDto | null> {
  const { data, error } = await sb.from('finance_expense_claims')
    .select('*').eq('id', id).maybeSingle<DbClaimRow>();
  if (error) throw Object.assign(new Error('getExpenseClaim: ' + error.message), { status: 500 });
  return data ? toDto(data) : null;
}

export async function listExpenseCostEntries(claimId: string): Promise<ExpenseCostEntryDto[]> {
  const { data, error } = await sb.from('finance_cost_entries')
    .select('id, ref, cost_center_id, amount, currency, description, expense_claim_id, created_at')
    .eq('expense_claim_id', claimId)
    .order('created_at');
  if (error) throw Object.assign(new Error('listExpenseCostEntries: ' + error.message), { status: 500 });
  return ((data ?? []) as DbEntryRow[]).map(toEntryDto);
}

export interface AllocationLine {
  costCenterId: string;
  amount: number;
  description?: string;
}

export interface CreateExpenseClaimInput {
  claimantId: string;
  title: string;
  expenseDate: string;
  category: string;
  totalAmount: number;
  currency?: string;
  receiptPath?: string | null;
  reimbursable?: boolean;
  allocationLines: AllocationLine[];
  metadata?: Record<string, unknown>;
  actorId: string;
}

export async function createExpenseClaim(
  input: CreateExpenseClaimInput,
): Promise<ExpenseClaimDto> {
  const lineSum = input.allocationLines.reduce((s, l) => s + l.amount, 0);
  const delta   = Math.abs(lineSum - input.totalAmount);
  if (delta > 0.01) {
    throw Object.assign(
      new Error(
        'Allocation lines sum (' + lineSum.toFixed(2) + ') does not equal total amount (' + input.totalAmount.toFixed(2) + '). ' +
        'All lines must sum exactly to the claim total.'
      ),
      { status: 422 },
    );
  }

  const claimNo = await nextRef('EXP');
  const currency = input.currency ?? 'TTD';

  const patch = {
    claim_no:     claimNo,
    claimant_id:  input.claimantId,
    title:        input.title,
    expense_date: input.expenseDate,
    category:     input.category,
    total_amount: input.totalAmount,
    currency,
    status:       'draft' as const,
    receipt_path: input.receiptPath ?? null,
    reimbursable: input.reimbursable ?? true,
    metadata:     input.metadata ?? {},
    created_by:   input.actorId,
  };

  const { data, error } = await sb.from('finance_expense_claims')
    .insert(patch).select().single<DbClaimRow>();
  if (error) {
    throw Object.assign(new Error('createExpenseClaim: ' + error.message), { status: 500 });
  }
  const row = toDto(data);

  if (input.allocationLines.length > 0) {
    const entryRefs = await Promise.all(
      input.allocationLines.map(() => nextRef('CE'))
    );
    const entryRows = input.allocationLines.map((l, i) => ({
      ref:                entryRefs[i],
      source_module:      'finance_expenses',
      source_entity_type: 'expense_claim',
      source_entity_id:   row.id,
      cost_center_id:     l.costCenterId,
      amount:             l.amount,
      currency,
      description:        l.description ?? null,
      status:             'pending',
      expense_claim_id:   row.id,
    }));
    const { error: entryErr } = await sb.from('finance_cost_entries').insert(entryRows);
    if (entryErr) {
      await sb.from('finance_expense_claims').delete().eq('id', row.id);
      throw Object.assign(
        new Error('createExpenseClaim cost entries: ' + entryErr.message + ' -- claim rolled back.'),
        { status: 500 },
      );
    }
  }

  void emitAppEvent({
    eventType:        'finance.expense.created',
    sourceModule:     'finance_expenses',
    sourceEntityType: 'expense_claim',
    sourceEntityId:   row.id,
    actorUserId:      input.actorId,
    severity:         'info',
    payload: { claimNo: row.claimNo, title: row.title, totalAmount: row.totalAmount, category: row.category },
  });

  await writeHrAudit({
    submoduleKey: 'finance_expenses', recordId: row.id, actorId: input.actorId,
    action:       'expense.created',
    previousState: null,
    newState: { status: 'draft', claimNo: row.claimNo, totalAmount: row.totalAmount },
  });

  return row;
}

export async function getReceiptUploadUrl(
  fileName: string,
  mimeType: string,
): Promise<{ uploadUrl: string; token: string; path: string; bucket: string }> {
  const result = await createAttachmentUploadUrl(EXPENSE_RECEIPT_BUCKET, fileName, mimeType);
  return { uploadUrl: result.uploadUrl, token: result.token, path: result.path, bucket: EXPENSE_RECEIPT_BUCKET };
}

export async function commitReceipt(
  claimId: string,
  path: string,
  actorId: string,
): Promise<ExpenseClaimDto> {
  const existing = await getExpenseClaim(claimId);
  if (!existing) throw Object.assign(new Error('Expense claim not found.'), { status: 404 });
  if (!['draft', 'submitted'].includes(existing.status)) {
    throw Object.assign(new Error('Receipt can only be attached to draft or submitted claims.'), { status: 422 });
  }
  const { data, error } = await sb.from('finance_expense_claims')
    .update({ receipt_path: path })
    .eq('id', claimId).select().single<DbClaimRow>();
  if (error) throw Object.assign(new Error('commitReceipt: ' + error.message), { status: 500 });
  const row = toDto(data);
  void emitAppEvent({ eventType: 'finance.expense.receipt_attached', sourceModule: 'finance_expenses', sourceEntityType: 'expense_claim', sourceEntityId: claimId, actorUserId: actorId, severity: 'info', payload: { path } });
  await writeHrAudit({ submoduleKey: 'finance_expenses', recordId: claimId, actorId, action: 'expense.receipt_attached', previousState: { receiptPath: existing.receiptPath }, newState: { receiptPath: path } });
  return row;
}

export async function submitExpenseClaim(
  id: string,
  actorId: string,
): Promise<ExpenseClaimDto> {
  const existing = await getExpenseClaim(id);
  if (!existing) throw Object.assign(new Error('Expense claim not found.'), { status: 404 });
  if (existing.status !== 'draft') {
    throw Object.assign(new Error('Only draft expense claims can be submitted for approval.'), { status: 422 });
  }
  const { data, error } = await sb.from('finance_expense_claims')
    .update({ status: 'submitted' })
    .eq('id', id).select().single<DbClaimRow>();
  if (error) throw Object.assign(new Error('submitExpenseClaim: ' + error.message), { status: 500 });
  const row = toDto(data);

  void emitAppEvent({ eventType: 'finance.expense.submitted', sourceModule: 'finance_expenses', sourceEntityType: 'expense_claim', sourceEntityId: id, actorUserId: actorId, severity: 'info', payload: { claimNo: existing.claimNo, totalAmount: existing.totalAmount, category: existing.category } });
  await writeHrAudit({ submoduleKey: 'finance_expenses', recordId: id, actorId, action: 'expense.submitted', previousState: { status: 'draft' }, newState: { status: 'submitted' } });

  const ctx: ModuleWorkflowContext = {
    moduleKey: 'finance_expenses', workflowType: 'finance_expense_approval',
    triggerEvent: 'finance.expense.submitted', sourceRecordId: id,
    sourceRecordRef: existing.claimNo, requestedBy: actorId, priority: 'normal',
    recordData: { claimNo: existing.claimNo, title: existing.title, totalAmount: existing.totalAmount, category: existing.category },
  };
  try {
    const wf = await startWorkflowForRecord({ context: ctx, actor: { id: actorId } });
    if (wf?.id) { await sb.from('finance_expense_claims').update({ workflow_id: wf.id }).eq('id', id); }
  } catch (wfErr) {
    await sb.from('finance_expense_claims').update({ status: 'draft' }).eq('id', id);
    throw Object.assign(new Error('Workflow start failed -- expense claim rolled back to draft: ' + String(wfErr)), { status: 500 });
  }
  return row;
}

export async function approveExpenseClaim(
  id: string,
  actorId: string,
): Promise<ExpenseClaimDto> {
  const existing = await getExpenseClaim(id);
  if (!existing) throw Object.assign(new Error('Expense claim not found.'), { status: 404 });
  if (existing.status !== 'submitted') {
    throw Object.assign(new Error('Only submitted expense claims can be approved.'), { status: 422 });
  }
  assertDifferentApprover({ actorId, createdBy: existing.claimantId, action: 'approve an expense claim they submitted' });

  const { data, error } = await sb.from('finance_expense_claims')
    .update({ status: 'approved', approved_by: actorId })
    .eq('id', id).select().single<DbClaimRow>();
  if (error) throw Object.assign(new Error('approveExpenseClaim: ' + error.message), { status: 500 });
  const row = toDto(data);

  await sb.from('finance_cost_entries')
    .update({ status: 'approved', approved_by: actorId, approved_at: new Date().toISOString() })
    .eq('expense_claim_id', id);

  void emitAppEvent({ eventType: 'finance.expense.approved', sourceModule: 'finance_expenses', sourceEntityType: 'expense_claim', sourceEntityId: id, actorUserId: actorId, severity: 'success', payload: { claimNo: existing.claimNo, totalAmount: existing.totalAmount } });
  await writeHrAudit({ submoduleKey: 'finance_expenses', recordId: id, actorId, action: 'expense.approved', previousState: { status: 'submitted' }, newState: { status: 'approved' } });
  return row;
}

export async function rejectExpenseClaim(
  id: string,
  actorId: string,
  reason: string,
): Promise<ExpenseClaimDto> {
  if (!reason || !reason.trim()) {
    throw Object.assign(new Error('A reason is required to reject an expense claim.'), { status: 422 });
  }
  const existing = await getExpenseClaim(id);
  if (!existing) throw Object.assign(new Error('Expense claim not found.'), { status: 404 });
  if (existing.status !== 'submitted') {
    throw Object.assign(new Error('Only submitted expense claims can be rejected.'), { status: 422 });
  }
  const { data, error } = await sb.from('finance_expense_claims')
    .update({ status: 'rejected', reject_reason: reason.trim() })
    .eq('id', id).select().single<DbClaimRow>();
  if (error) throw Object.assign(new Error('rejectExpenseClaim: ' + error.message), { status: 500 });
  const row = toDto(data);
  void emitAppEvent({ eventType: 'finance.expense.rejected', sourceModule: 'finance_expenses', sourceEntityType: 'expense_claim', sourceEntityId: id, actorUserId: actorId, severity: 'warning', payload: { claimNo: existing.claimNo, reason } });
  await writeHrAudit({ submoduleKey: 'finance_expenses', recordId: id, actorId, action: 'expense.rejected', previousState: { status: 'submitted' }, newState: { status: 'rejected' }, reason });
  return row;
}

export async function markExpenseReimbursed(
  id: string,
  actorId: string,
  opts: { reimbursedAt?: string } = {},
): Promise<ExpenseClaimDto> {
  const existing = await getExpenseClaim(id);
  if (!existing) throw Object.assign(new Error('Expense claim not found.'), { status: 404 });
  if (existing.status !== 'approved') {
    throw Object.assign(new Error('Only approved expense claims can be marked reimbursed.'), { status: 422 });
  }
  const reimbursedAt = opts.reimbursedAt ?? new Date().toISOString();
  const { data, error } = await sb.from('finance_expense_claims')
    .update({ status: 'reimbursed', reimbursed_at: reimbursedAt })
    .eq('id', id).select().single<DbClaimRow>();
  if (error) throw Object.assign(new Error('markExpenseReimbursed: ' + error.message), { status: 500 });
  const row = toDto(data);
  await sb.from('finance_cost_entries').update({ status: 'reimbursed' }).eq('expense_claim_id', id);
  void emitAppEvent({ eventType: 'finance.expense.reimbursed', sourceModule: 'finance_expenses', sourceEntityType: 'expense_claim', sourceEntityId: id, actorUserId: actorId, severity: 'success', payload: { claimNo: existing.claimNo, totalAmount: existing.totalAmount, reimbursedAt } });
  await writeHrAudit({ submoduleKey: 'finance_expenses', recordId: id, actorId, action: 'expense.reimbursed', previousState: { status: 'approved' }, newState: { status: 'reimbursed', reimbursedAt } });
  return row;
}

export async function cancelExpenseClaim(
  id: string,
  actorId: string,
  reason: string,
): Promise<ExpenseClaimDto> {
  if (!reason || !reason.trim()) {
    throw Object.assign(new Error('A reason is required to cancel an expense claim.'), { status: 422 });
  }
  const existing = await getExpenseClaim(id);
  if (!existing) throw Object.assign(new Error('Expense claim not found.'), { status: 404 });
  if (!['draft', 'submitted'].includes(existing.status)) {
    throw Object.assign(new Error('Only draft or submitted expense claims can be cancelled.'), { status: 422 });
  }
  const { data, error } = await sb.from('finance_expense_claims')
    .update({ status: 'cancelled', cancel_reason: reason.trim() })
    .eq('id', id).select().single<DbClaimRow>();
  if (error) throw Object.assign(new Error('cancelExpenseClaim: ' + error.message), { status: 500 });
  const row = toDto(data);
  void emitAppEvent({ eventType: 'finance.expense.cancelled', sourceModule: 'finance_expenses', sourceEntityType: 'expense_claim', sourceEntityId: id, actorUserId: actorId, severity: 'warning', payload: { claimNo: existing.claimNo, reason } });
  await writeHrAudit({ submoduleKey: 'finance_expenses', recordId: id, actorId, action: 'expense.cancelled', previousState: { status: existing.status }, newState: { status: 'cancelled' }, reason });
  return row;
}

export async function listExpensesReport(opts: {
  claimantId?: string;
  status?: ExpenseStatus;
  category?: string;
} = {}): Promise<ExpenseReportRow[]> {
  let q = sb.from('finance_expense_claims')
    .select('id, claim_no, claimant_id, title, expense_date, category, total_amount, currency, status, reimbursable, reimbursed_at, created_at')
    .order('created_at', { ascending: false });
  if (opts.claimantId) q = q.eq('claimant_id', opts.claimantId);
  if (opts.status)     q = q.eq('status', opts.status);
  if (opts.category)   q = q.eq('category', opts.category);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listExpensesReport: ' + error.message), { status: 500 });
  return ((data ?? []) as Array<{
    id: string; claim_no: string; claimant_id: string; title: string;
    expense_date: string; category: string; total_amount: string;
    currency: string; status: string; reimbursable: boolean;
    reimbursed_at: string | null; created_at: string;
  }>).map(r => ({
    id: r.id, claimNo: r.claim_no, claimantId: r.claimant_id,
    title: r.title, expenseDate: r.expense_date, category: r.category,
    totalAmount: Number(r.total_amount), currency: r.currency,
    status: r.status, reimbursable: r.reimbursable,
    reimbursedAt: r.reimbursed_at, createdAt: r.created_at,
  }));
}
