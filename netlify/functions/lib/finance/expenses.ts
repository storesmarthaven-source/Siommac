// ============================================================================
// Finance -- Expenses / Cost Entries (F4) — Wave 2B Aurora deepening
// ============================================================================
import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { startWorkflowForRecord } from '../workflow/service';
import { assertDifferentApprover } from './statutoryConfig';
import { createAttachmentUploadUrl } from '../upload';
import { emitFinanceMutationBackbone } from './backbone';
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

export interface ExpenseClaimDetailDto extends ExpenseClaimDto {
  lines: ExpenseCostEntryDto[];
  attachmentCount: number;
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

// ── Policy check types ────────────────────────────────────────────────────────

export type PolicyIssueType =
  | 'category_limit_exceeded'
  | 'missing_receipt'
  | 'date_window_exceeded'
  | 'invalid_cost_centre'
  | 'duplicate_candidate';

export interface PolicyIssue {
  type: PolicyIssueType;
  severity: 'warning' | 'error';
  message: string;
  lineId?: string;
}

export interface PolicyCheckResult {
  claimId: string;
  issues: PolicyIssue[];
  approvalRoute: { role: string; label: string } | null;
  canSubmit: boolean;
}

// ── Extended mark-reimbursed ──────────────────────────────────────────────────

export interface MarkReimbursedFullInput {
  reimbursedAt?: string;
  paymentMethod?: string;
  reference?: string;
  paidAmount?: number;
  sourceDisbursement?: string;
  notes?: string;
}

// ── Report ────────────────────────────────────────────────────────────────────

export interface ExpenseReportResult {
  report: string;
  generatedAt: string;
  rows: Record<string, unknown>[];
}

// ── Trend ─────────────────────────────────────────────────────────────────────

export interface ExpenseTrendPoint {
  month: string;
  amount: number;
  count: number;
}

// ── Internal DB row types ─────────────────────────────────────────────────────

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

// ── Category policy limits (TTD) ──────────────────────────────────────────────

const CATEGORY_LIMITS: Record<string, number> = {
  travel:           5_000,
  accommodation:    3_000,
  meals:              500,
  equipment:       10_000,
  supplies:         2_000,
  professional_fees:20_000,
  utilities:        5_000,
  other:            1_000,
};

// ── Approval route tiers ─────────────────────────────────────────────────────

function approvalRoute(amount: number): { role: string; label: string } {
  if (amount < 1_000) return { role: 'finance_staff', label: 'Finance Staff (< $1,000)' };
  if (amount < 10_000) return { role: 'finance_manager', label: 'Finance Manager ($1,000 – $10,000)' };
  return { role: 'finance_director', label: 'Finance Director (> $10,000)' };
}

// ── Mappers ───────────────────────────────────────────────────────────────────

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

// ============================================================================
// Queries
// ============================================================================

export async function listExpenseClaims(opts: {
  claimantId?: string;
  status?: ExpenseStatus;
  category?: string;
  search?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ data: ExpenseClaimDto[]; total: number }> {
  const pageSize = opts.pageSize ?? 50;
  const page = opts.page ?? 0;

  let q = sb.from('finance_expense_claims').select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  if (opts.claimantId) q = q.eq('claimant_id', opts.claimantId);
  if (opts.status)     q = q.eq('status', opts.status);
  if (opts.category)   q = q.eq('category', opts.category);
  if (opts.search)     q = q.or(`title.ilike.%${opts.search}%,claim_no.ilike.%${opts.search}%`);
  const { data, error, count } = await q;
  if (error) throw Object.assign(new Error('listExpenseClaims: ' + error.message), { status: 500 });
  return { data: ((data ?? []) as DbClaimRow[]).map(toDto), total: count ?? 0 };
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

export async function getExpenseClaimDetail(id: string): Promise<ExpenseClaimDetailDto | null> {
  const claim = await getExpenseClaim(id);
  if (!claim) return null;
  const lines = await listExpenseCostEntries(id);
  const { count: attachmentCount } = await sb.from('finance_expense_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('claim_id', id);
  return { ...claim, lines, attachmentCount: attachmentCount ?? 0 };
}

// ============================================================================
// Policy check
// ============================================================================

export async function runExpensePolicyCheck(claimId: string): Promise<PolicyCheckResult> {
  const claim = await getExpenseClaim(claimId);
  if (!claim) throw Object.assign(new Error('Expense claim not found.'), { status: 404 });

  const lines = await listExpenseCostEntries(claimId);
  const issues: PolicyIssue[] = [];

  // 1. Category limit
  const limit = CATEGORY_LIMITS[claim.category];
  if (limit !== undefined && claim.totalAmount > limit) {
    issues.push({
      type: 'category_limit_exceeded',
      severity: 'warning',
      message: `Total $${claim.totalAmount.toFixed(2)} exceeds the ${claim.category} policy limit of $${limit.toFixed(2)}.`,
    });
  }

  // 2. Missing receipt (reimbursable only)
  if (claim.reimbursable && !claim.receiptPath) {
    const { count: attCount } = await sb.from('finance_expense_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('claim_id', claimId);
    if (!attCount) {
      issues.push({
        type: 'missing_receipt',
        severity: 'warning',
        message: 'Reimbursable claim has no receipt attached. Please upload a receipt before submitting.',
      });
    }
  }

  // 3. Date window (> 90 days in the past or in the future)
  if (claim.expenseDate) {
    const expDate = new Date(claim.expenseDate);
    const today = new Date();
    const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
    if (expDate < ninetyDaysAgo) {
      issues.push({
        type: 'date_window_exceeded',
        severity: 'warning',
        message: `Expense date ${claim.expenseDate} is more than 90 days ago.`,
      });
    } else if (expDate > today) {
      issues.push({
        type: 'date_window_exceeded',
        severity: 'error',
        message: `Expense date ${claim.expenseDate} is in the future.`,
      });
    }
  }

  // 4. Invalid cost centres
  const costCentreIds = [...new Set(lines.map(l => l.costCenterId).filter(Boolean) as string[])];
  if (costCentreIds.length > 0) {
    const { data: validCc } = await sb.from('finance_cost_centers')
      .select('id').in('id', costCentreIds);
    const validSet = new Set((validCc ?? []).map((c: { id: string }) => c.id));
    for (const line of lines) {
      if (line.costCenterId && !validSet.has(line.costCenterId)) {
        issues.push({
          type: 'invalid_cost_centre',
          severity: 'error',
          message: `Cost centre ${line.costCenterId} does not exist.`,
          lineId: line.id,
        });
      }
    }
  }

  // 5. Duplicate candidate (same claimant + category + amount + date within 7 days)
  const sevenDaysAgo = new Date(new Date(claim.expenseDate).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const sevenDaysAfter = new Date(new Date(claim.expenseDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: potentialDupes } = await sb.from('finance_expense_claims')
    .select('id, claim_no')
    .eq('claimant_id', claim.claimantId)
    .eq('category', claim.category)
    .eq('total_amount', claim.totalAmount)
    .gte('expense_date', sevenDaysAgo)
    .lte('expense_date', sevenDaysAfter)
    .neq('id', claimId)
    .not('status', 'in', '("cancelled","rejected")');
  if ((potentialDupes ?? []).length > 0) {
    const refs = (potentialDupes ?? []).map((d: { claim_no: string }) => d.claim_no).join(', ');
    issues.push({
      type: 'duplicate_candidate',
      severity: 'warning',
      message: `Possible duplicate of claim(s): ${refs}.`,
    });
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;

  return {
    claimId,
    issues,
    approvalRoute: approvalRoute(claim.totalAmount),
    canSubmit: errorCount === 0,
  };
}

// ============================================================================
// Mutations — all use emitFinanceMutationBackbone with compensating rollback
// ============================================================================

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
  notes?: string;
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
        `Allocation lines sum (${lineSum.toFixed(2)}) does not equal total amount (${input.totalAmount.toFixed(2)}). ` +
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
    metadata:     { ...(input.metadata ?? {}), ...(input.notes ? { notes: input.notes } : {}) },
    created_by:   input.actorId,
  };

  const { data, error } = await sb.from('finance_expense_claims')
    .insert(patch).select().single<DbClaimRow>();
  if (error) {
    throw Object.assign(new Error('createExpenseClaim: ' + error.message), { status: 500 });
  }
  const row = toDto(data);

  if (input.allocationLines.length > 0) {
    const entryRefs = await Promise.all(input.allocationLines.map(() => nextRef('CE')));
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
        new Error('createExpenseClaim cost entries: ' + entryErr.message + ' — claim rolled back.'),
        { status: 500 },
      );
    }
  }

  try {
    await emitFinanceMutationBackbone({
      actorUserId:   input.actorId,
      module:        'finance_expenses',
      entityType:    'expense_claim',
      entityId:      row.id,
      eventType:     'finance.expense.created',
      auditAction:   'expense.created',
      previousState: null,
      newState:      { status: 'draft', claimNo: row.claimNo, totalAmount: row.totalAmount },
      severity:      'info',
      metadata:      { claimNo: row.claimNo, title: row.title, totalAmount: row.totalAmount, category: row.category },
    });
  } catch (rollbackErr) {
    // Compensating rollback: delete claim + entries (entries cascade via expense_claim_id FK)
    await sb.from('finance_cost_entries').delete().eq('expense_claim_id', row.id);
    await sb.from('finance_expense_claims').delete().eq('id', row.id);
    throw rollbackErr;
  }

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

  try {
    await emitFinanceMutationBackbone({
      actorUserId:   actorId,
      module:        'finance_expenses',
      entityType:    'expense_claim',
      entityId:      claimId,
      eventType:     'finance.expense.receipt_attached',
      auditAction:   'expense.receipt_attached',
      previousState: { receiptPath: existing.receiptPath },
      newState:      { receiptPath: path },
      severity:      'info',
    });
  } catch (rollbackErr) {
    // Compensate: restore previous receipt_path
    await sb.from('finance_expense_claims').update({ receipt_path: existing.receiptPath }).eq('id', claimId);
    throw rollbackErr;
  }
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

  // Check for missing receipt before backbone (used for notification/ticket)
  let hasMissingReceipt = false;
  if (existing.reimbursable && !existing.receiptPath) {
    const { count: attCount } = await sb.from('finance_expense_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('claim_id', id);
    hasMissingReceipt = !attCount;
  }

  try {
    await emitFinanceMutationBackbone({
      actorUserId:   actorId,
      module:        'finance_expenses',
      entityType:    'expense_claim',
      entityId:      id,
      eventType:     'finance.expense.submitted',
      auditAction:   'expense.submitted',
      previousState: { status: 'draft' },
      newState:      { status: 'submitted' },
      severity:      'info',
      metadata:      { claimNo: existing.claimNo, totalAmount: existing.totalAmount, category: existing.category },
      ...(hasMissingReceipt ? {
        notification: {
          title:           'Missing receipt — action required',
          body:            `Expense claim ${existing.claimNo} is reimbursable but has no receipt attached.`,
          actionRoute:     `/finance/expenses/${id}`,
          recipientUserIds:[existing.claimantId],
          severity:        'warning' as const,
          type:            'finance.expense.receipt.missing',
        },
        ticket: {
          category:        'expense_receipt',
          priority:        'medium' as const,
          subject:         `Missing receipt for expense claim ${existing.claimNo}`,
          description:     `Claim "${existing.title}" (${existing.claimNo}) submitted without a receipt. Please upload the receipt to enable reimbursement.`,
          requesterUserId: actorId,
        },
      } : {}),
    });
  } catch (rollbackErr) {
    // Compensate: rollback to draft
    await sb.from('finance_expense_claims').update({ status: 'draft' }).eq('id', id);
    throw rollbackErr;
  }

  // Start approval workflow (separate compensating rollback if this fails)
  const ctx: ModuleWorkflowContext = {
    moduleKey:        'finance_expenses',
    workflowType:     'finance_expense_approval',
    triggerEvent:     'finance.expense.submitted',
    sourceRecordId:   id,
    sourceRecordRef:  existing.claimNo,
    requestedBy:      actorId,
    priority:         'normal',
    recordData:       { claimNo: existing.claimNo, title: existing.title, totalAmount: existing.totalAmount, category: existing.category },
  };
  try {
    const wf = await startWorkflowForRecord({ context: ctx, actor: { id: actorId } });
    if (wf?.id) { await sb.from('finance_expense_claims').update({ workflow_id: wf.id }).eq('id', id); }
  } catch (wfErr) {
    await sb.from('finance_expense_claims').update({ status: 'draft' }).eq('id', id);
    throw Object.assign(new Error('Workflow start failed — expense claim rolled back to draft: ' + String(wfErr)), { status: 500 });
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
    .update({ status: 'approved' })
    .eq('expense_claim_id', id);

  try {
    await emitFinanceMutationBackbone({
      actorUserId:   actorId,
      module:        'finance_expenses',
      entityType:    'expense_claim',
      entityId:      id,
      eventType:     existing.reimbursable ? 'finance.expense.approved.reimbursable' : 'finance.expense.approved',
      auditAction:   'expense.approved',
      previousState: { status: 'submitted' },
      newState:      { status: 'approved', approvedBy: actorId },
      severity:      'success',
      metadata:      { claimNo: existing.claimNo, totalAmount: existing.totalAmount, reimbursable: existing.reimbursable },
      ...(existing.reimbursable ? {
        notification: {
          title:       'Expense claim approved — reimbursement queued',
          body:        `Claim ${existing.claimNo} has been approved. A reimbursement handoff has been created.`,
          actionRoute: `/finance/expenses/${id}`,
          type:        'finance.expense.approved.reimbursable',
          severity:    'info' as const,
        },
      } : {}),
    });
  } catch (rollbackErr) {
    // Compensate: roll back approval
    await sb.from('finance_expense_claims').update({ status: 'submitted', approved_by: null }).eq('id', id);
    await sb.from('finance_cost_entries').update({ status: 'pending' }).eq('expense_claim_id', id);
    throw rollbackErr;
  }

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

  try {
    await emitFinanceMutationBackbone({
      actorUserId:   actorId,
      module:        'finance_expenses',
      entityType:    'expense_claim',
      entityId:      id,
      eventType:     'finance.expense.rejected',
      auditAction:   'expense.rejected',
      previousState: { status: 'submitted' },
      newState:      { status: 'rejected', rejectReason: reason.trim() },
      reason:        reason.trim(),
      severity:      'warning',
      metadata:      { claimNo: existing.claimNo, reason: reason.trim() },
      notification: {
        title:           'Expense claim rejected',
        body:            `Your claim ${existing.claimNo} was rejected: ${reason.trim()}`,
        actionRoute:     `/finance/expenses/${id}`,
        recipientUserIds:[existing.claimantId],
        type:            'finance.expense.rejected',
        severity:        'warning' as const,
      },
    });
  } catch (rollbackErr) {
    // Compensate: restore submitted status
    await sb.from('finance_expense_claims').update({ status: 'submitted', reject_reason: null }).eq('id', id);
    throw rollbackErr;
  }
  return row;
}

export async function markExpenseReimbursed(
  id: string,
  actorId: string,
  opts: MarkReimbursedFullInput = {},
): Promise<ExpenseClaimDto> {
  const existing = await getExpenseClaim(id);
  if (!existing) throw Object.assign(new Error('Expense claim not found.'), { status: 404 });
  if (existing.status !== 'approved') {
    throw Object.assign(new Error('Only approved expense claims can be marked reimbursed.'), { status: 422 });
  }
  const reimbursedAt = opts.reimbursedAt ?? new Date().toISOString();

  // Merge reimbursement details into metadata
  const reimbursementMeta = {
    paymentMethod:      opts.paymentMethod ?? null,
    reference:          opts.reference ?? null,
    paidAmount:         opts.paidAmount ?? existing.totalAmount,
    sourceDisbursement: opts.sourceDisbursement ?? null,
    notes:              opts.notes ?? null,
    reimbursedBy:       actorId,
    reimbursedAt,
  };
  const newMetadata = { ...existing.metadata, reimbursement: reimbursementMeta };

  const { data, error } = await sb.from('finance_expense_claims')
    .update({ status: 'reimbursed', reimbursed_at: reimbursedAt, metadata: newMetadata })
    .eq('id', id).select().single<DbClaimRow>();
  if (error) throw Object.assign(new Error('markExpenseReimbursed: ' + error.message), { status: 500 });
  const row = toDto(data);

  await sb.from('finance_cost_entries').update({ status: 'reimbursed' }).eq('expense_claim_id', id);

  try {
    await emitFinanceMutationBackbone({
      actorUserId:   actorId,
      module:        'finance_expenses',
      entityType:    'expense_claim',
      entityId:      id,
      eventType:     'finance.expense.reimbursed',
      auditAction:   'expense.reimbursed',
      previousState: { status: 'approved' },
      newState:      { status: 'reimbursed', ...reimbursementMeta },
      severity:      'success',
      metadata:      { claimNo: existing.claimNo, totalAmount: existing.totalAmount, ...reimbursementMeta },
      notification: {
        title:           'Expense claim reimbursed',
        body:            `Your expense claim ${existing.claimNo} has been reimbursed.` + (opts.reference ? ` Reference: ${opts.reference}.` : ''),
        actionRoute:     `/finance/expenses/${id}`,
        recipientUserIds:[existing.claimantId],
        type:            'finance.expense.reimbursed',
        severity:        'info' as const,
      },
    });
  } catch (rollbackErr) {
    // Compensate: restore approved status and original metadata
    await sb.from('finance_expense_claims').update({ status: 'approved', reimbursed_at: null, metadata: existing.metadata }).eq('id', id);
    await sb.from('finance_cost_entries').update({ status: 'approved' }).eq('expense_claim_id', id);
    throw rollbackErr;
  }
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

  try {
    await emitFinanceMutationBackbone({
      actorUserId:   actorId,
      module:        'finance_expenses',
      entityType:    'expense_claim',
      entityId:      id,
      eventType:     'finance.expense.cancelled',
      auditAction:   'expense.cancelled',
      previousState: { status: existing.status },
      newState:      { status: 'cancelled', cancelReason: reason.trim() },
      reason:        reason.trim(),
      severity:      'warning',
      metadata:      { claimNo: existing.claimNo, reason: reason.trim() },
    });
  } catch (rollbackErr) {
    // Compensate: restore original status
    await sb.from('finance_expense_claims').update({ status: existing.status, cancel_reason: null }).eq('id', id);
    throw rollbackErr;
  }
  return row;
}

// ============================================================================
// Reports
// ============================================================================

export type ExpenseReportType = 'expense_claim_summary' | 'expense_policy_exceptions' | 'reimbursement_summary' | 'missing_receipts';

export async function runExpenseReport(
  type: ExpenseReportType,
  opts: { claimantId?: string; status?: ExpenseStatus; category?: string; fiscalYear?: number } = {},
): Promise<ExpenseReportResult> {
  const generatedAt = new Date().toISOString();

  if (type === 'expense_claim_summary') {
    let q = sb.from('finance_expense_claims')
      .select('id, claim_no, claimant_id, title, expense_date, category, total_amount, currency, status, reimbursable, reimbursed_at, approved_by, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (opts.claimantId) q = q.eq('claimant_id', opts.claimantId);
    if (opts.status)     q = q.eq('status', opts.status);
    if (opts.category)   q = q.eq('category', opts.category);
    const { data, error } = await q;
    if (error) throw Object.assign(new Error('runExpenseReport: ' + error.message), { status: 500 });
    return {
      report: 'expense_claim_summary', generatedAt,
      rows: ((data ?? []) as Record<string, unknown>[]).map(r => ({
        claimNo:     r['claim_no'],
        claimantId:  r['claimant_id'],
        title:       r['title'],
        expenseDate: r['expense_date'],
        category:    r['category'],
        totalAmount: Number(r['total_amount']),
        currency:    r['currency'],
        status:      r['status'],
        reimbursable:r['reimbursable'],
        reimbursedAt:r['reimbursed_at'],
        createdAt:   r['created_at'],
      })),
    };
  }

  if (type === 'expense_policy_exceptions') {
    // Claims where total > category limit
    const { data, error } = await sb.from('finance_expense_claims')
      .select('id, claim_no, claimant_id, title, expense_date, category, total_amount, currency, status, reimbursable, receipt_path, created_at')
      .not('status', 'in', '("cancelled")')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw Object.assign(new Error('runExpenseReport policy_exceptions: ' + error.message), { status: 500 });
    const exceptions = (data ?? []).filter((r: Record<string, unknown>) => {
      const cat = r['category'] as string;
      const total = Number(r['total_amount']);
      const limit = CATEGORY_LIMITS[cat];
      const missingReceipt = r['reimbursable'] && !r['receipt_path'];
      return (limit !== undefined && total > limit) || missingReceipt;
    });
    return {
      report: 'expense_policy_exceptions', generatedAt,
      rows: exceptions.map((r: Record<string, unknown>) => {
        const cat = r['category'] as string;
        const total = Number(r['total_amount']);
        const limit = CATEGORY_LIMITS[cat];
        const reasons: string[] = [];
        if (limit !== undefined && total > limit) reasons.push(`Over ${cat} limit ($${limit})`);
        if (r['reimbursable'] && !r['receipt_path']) reasons.push('Missing receipt');
        return {
          claimNo:     r['claim_no'],
          claimantId:  r['claimant_id'],
          title:       r['title'],
          expenseDate: r['expense_date'],
          category:    cat,
          totalAmount: total,
          status:      r['status'],
          exceptionReasons: reasons.join('; '),
        };
      }),
    };
  }

  if (type === 'reimbursement_summary') {
    const { data, error } = await sb.from('finance_expense_claims')
      .select('id, claim_no, claimant_id, title, expense_date, category, total_amount, currency, reimbursed_at, metadata, approved_by')
      .eq('status', 'reimbursed')
      .order('reimbursed_at', { ascending: false })
      .limit(500);
    if (error) throw Object.assign(new Error('runExpenseReport reimbursement_summary: ' + error.message), { status: 500 });
    return {
      report: 'reimbursement_summary', generatedAt,
      rows: (data ?? []).map((r: Record<string, unknown>) => {
        const meta = (r['metadata'] as Record<string, unknown>) ?? {};
        const reimb = (meta['reimbursement'] as Record<string, unknown>) ?? {};
        return {
          claimNo:       r['claim_no'],
          claimantId:    r['claimant_id'],
          title:         r['title'],
          expenseDate:   r['expense_date'],
          category:      r['category'],
          totalAmount:   Number(r['total_amount']),
          currency:      r['currency'],
          reimbursedAt:  r['reimbursed_at'],
          paymentMethod: reimb['paymentMethod'] ?? null,
          reference:     reimb['reference'] ?? null,
          paidAmount:    reimb['paidAmount'] ?? Number(r['total_amount']),
        };
      }),
    };
  }

  if (type === 'missing_receipts') {
    const { data, error } = await sb.from('finance_expense_claims')
      .select('id, claim_no, claimant_id, title, expense_date, category, total_amount, currency, status, created_at')
      .eq('reimbursable', true)
      .is('receipt_path', null)
      .not('status', 'in', '("cancelled","rejected","reimbursed")')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw Object.assign(new Error('runExpenseReport missing_receipts: ' + error.message), { status: 500 });
    return {
      report: 'missing_receipts', generatedAt,
      rows: (data ?? []).map((r: Record<string, unknown>) => ({
        claimNo:    r['claim_no'],
        claimantId: r['claimant_id'],
        title:      r['title'],
        expenseDate:r['expense_date'],
        category:   r['category'],
        totalAmount:Number(r['total_amount']),
        currency:   r['currency'],
        status:     r['status'],
        createdAt:  r['created_at'],
      })),
    };
  }

  throw Object.assign(new Error(`Unknown report type: ${type as string}`), { status: 422 });
}

// ============================================================================
// Trend — monthly expense spend (last 12 months)
// ============================================================================

export async function getExpenseTrend(): Promise<ExpenseTrendPoint[]> {
  const now = new Date();
  const points: ExpenseTrendPoint[] = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = d.toISOString().slice(0, 10);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

    const { data, error } = await sb.from('finance_expense_claims')
      .select('total_amount')
      .gte('expense_date', start)
      .lte('expense_date', end)
      .not('status', 'in', '("cancelled","rejected")');
    if (error) continue;
    const amount = (data ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r['total_amount']), 0);
    points.push({ month: label, amount, count: (data ?? []).length });
  }

  return points;
}

// ============================================================================
// Legacy alias — kept for backwards compatibility with existing report routes
// ============================================================================

export async function listExpensesReport(opts: {
  claimantId?: string;
  status?: ExpenseStatus;
  category?: string;
} = {}): Promise<ExpenseReportRow[]> {
  const result = await runExpenseReport('expense_claim_summary', opts);
  return result.rows.map(r => ({
    id:          '',  // not returned by summary
    claimNo:     r['claimNo'] as string,
    claimantId:  r['claimantId'] as string,
    title:       r['title'] as string,
    expenseDate: r['expenseDate'] as string,
    category:    r['category'] as string,
    totalAmount: r['totalAmount'] as number,
    currency:    r['currency'] as string,
    status:      r['status'] as string,
    reimbursable:r['reimbursable'] as boolean,
    reimbursedAt:r['reimbursedAt'] as string | null,
    createdAt:   r['createdAt'] as string,
  }));
}
