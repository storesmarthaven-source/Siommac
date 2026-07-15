// routes/financeExpenses.ts — Finance: Expense Claims (F4) — Wave 2B Aurora deepening
// Mounted at /api/finance in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.

import { Hono } from 'hono';
import { requirePermission, userCan } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listExpenseClaims,
  getExpenseClaim,
  getExpenseClaimDetail,
  listExpenseCostEntries,
  createExpenseClaim,
  submitExpenseClaim,
  approveExpenseClaim,
  rejectExpenseClaim,
  markExpenseReimbursed,
  cancelExpenseClaim,
  getReceiptUploadUrl,
  commitReceipt,
  runExpensePolicyCheck,
  runExpenseReport,
  getExpenseTrend,
  listExpensesReport,
  listExpenseAuditLog,
  addExpenseComment,
  getExpenseKpis,
  type ExpenseStatus,
  type ExpenseReportType,
} from '../lib/finance/expenses';
import { createReimbursementHandoff } from '../lib/finance/bridges';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

/** Extract body.args (apiPost/authPost envelope convention). */
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

const STATUS_VALUES   = ['draft', 'submitted', 'approved', 'rejected', 'reimbursed', 'cancelled'] as const;
const CATEGORY_VALUES = ['travel', 'accommodation', 'meals', 'equipment', 'supplies', 'professional_fees', 'utilities', 'other'] as const;
const REPORT_TYPES    = ['expense_claim_summary', 'expense_policy_exceptions', 'reimbursement_summary', 'missing_receipts'] as const;

function handleErr(c: { json: (o: unknown, s?: number) => Response }, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
}

// ── List ──────────────────────────────────────────────────────────────────────

// POST /api/finance/expenses/list
router.post('/expenses/list', async c => {
  await requirePermission(c, 'finance.expenses.view');
  const v = zv(c, z.object({
    claimantId: z.string().optional(),
    status:     z.enum(STATUS_VALUES).optional(),
    category:   z.enum(CATEGORY_VALUES).optional(),
    search:     z.string().optional(),
    page:       z.number().int().min(0).optional(),
    pageSize:   z.number().int().min(1).max(100).optional(),
    sortField:  z.enum(['created_at', 'expense_date', 'total_amount', 'status', 'claim_no']).optional(),
    sortDir:    z.enum(['asc', 'desc']).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const result = await listExpenseClaims({
      claimantId: v.data.claimantId,
      status:     v.data.status as ExpenseStatus | undefined,
      category:   v.data.category,
      search:     v.data.search,
      page:       v.data.page,
      pageSize:   v.data.pageSize,
      sortField:  v.data.sortField,
      sortDir:    v.data.sortDir,
    });
    return c.json({ success: true, data: result.data, total: result.total });
  } catch (e) { return handleErr(c, e); }
});

// ── Get single + detail + allocation lines ────────────────────────────────────

// POST /api/finance/expenses/get
router.post('/expenses/get', async c => {
  await requirePermission(c, 'finance.expenses.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getExpenseClaim(v.data.id);
    if (!data) return c.json({ success: false, message: 'Expense claim not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// POST /api/finance/expenses/detail
router.post('/expenses/detail', async c => {
  await requirePermission(c, 'finance.expenses.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getExpenseClaimDetail(v.data.id);
    if (!data) return c.json({ success: false, message: 'Expense claim not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// POST /api/finance/expenses/lines/list
router.post('/expenses/lines/list', async c => {
  await requirePermission(c, 'finance.expenses.view');
  const v = zv(c, z.object({ claimId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listExpenseCostEntries(v.data.claimId);
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── Create ────────────────────────────────────────────────────────────────────

// POST /api/finance/expenses/create
router.post('/expenses/create', async c => {
  const actor = await requirePermission(c, 'finance.expenses.submit');
  const v = zv(c, z.object({
    claimantId:      z.string().min(1),
    title:           z.string().min(1).max(200),
    expenseDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    category:        z.enum(CATEGORY_VALUES),
    totalAmount:     z.number().positive(),
    currency:        z.string().length(3).optional(),
    receiptPath:     z.string().nullable().optional(),
    reimbursable:    z.boolean().optional(),
    notes:           z.string().max(1000).optional(),
    purpose:         z.string().max(500).optional(),
    departmentId:    z.string().max(100).optional(),
    allocationLines: z.array(z.object({
      costCenterId:    z.string().uuid(),
      amount:          z.number().positive(),
      description:     z.string().max(300).optional(),
      expenseDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      category:        z.enum(CATEGORY_VALUES).optional(),
      project:         z.string().max(200).optional(),
      taxAmount:       z.number().min(0).optional(),
      merchant:        z.string().max(200).optional(),
      receiptRequired: z.boolean().optional(),
    })).min(1, 'At least one allocation line is required.'),
    metadata:        z.record(z.string(), z.unknown()).optional(),
  }), b(c));
  if (!v.ok) return v.response;

  // Self-scope: without manage, you may only submit for yourself.
  if (v.data.claimantId !== actor.id) {
    const canManage = await userCan(actor, 'finance.expenses.manage');
    if (!canManage) return c.json({ success: false, message: 'You may only submit expense claims for yourself.' }, 403 as 200);
  }

  try {
    const data = await createExpenseClaim({
      claimantId:      v.data.claimantId,
      title:           v.data.title,
      expenseDate:     v.data.expenseDate,
      category:        v.data.category,
      totalAmount:     v.data.totalAmount,
      currency:        v.data.currency,
      receiptPath:     v.data.receiptPath ?? null,
      reimbursable:    v.data.reimbursable,
      notes:           v.data.notes,
      purpose:         v.data.purpose,
      departmentId:    v.data.departmentId,
      allocationLines: v.data.allocationLines,
      metadata:        v.data.metadata,
      actorId:         actor.id,
    });
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── Policy check ──────────────────────────────────────────────────────────────

// POST /api/finance/expenses/policy-check
router.post('/expenses/policy-check', async c => {
  const actor = await requirePermission(c, 'finance.expenses.submit');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const claim = await getExpenseClaim(v.data.id);
    if (!claim) return c.json({ success: false, message: 'Expense claim not found.' }, 404 as 200);
    // Self-scope: without manage, only the claimant can check their own claim.
    if (claim.claimantId !== actor.id) {
      const canManage = await userCan(actor, 'finance.expenses.manage');
      if (!canManage) return c.json({ success: false, message: 'You may only check your own expense claims.' }, 403 as 200);
    }
    const data = await runExpensePolicyCheck(v.data.id);
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── Submit (draft → submitted, starts approval workflow) ──────────────────────

// POST /api/finance/expenses/submit
router.post('/expenses/submit', async c => {
  const actor = await requirePermission(c, 'finance.expenses.submit');
  const v = zv(c, z.object({ id: z.string().uuid(), idempotencyKey: z.string().min(1).max(200) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await submitExpenseClaim(v.data.id, actor.id, v.data.idempotencyKey);
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── Approve (submitted → approved; SoD: claimant ≠ approver) ─────────────────

// POST /api/finance/expenses/approve
router.post('/expenses/approve', async c => {
  const actor = await requirePermission(c, 'finance.expenses.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    // approveExpenseClaim now atomically creates the reimbursement handoff internally
    // with a compensating rollback on failure — no best-effort .catch() needed here.
    const data = await approveExpenseClaim(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── Reject (submitted → rejected; reason required) ────────────────────────────

// POST /api/finance/expenses/reject
router.post('/expenses/reject', async c => {
  const actor = await requirePermission(c, 'finance.expenses.approve');
  const v = zv(c, z.object({
    id:     z.string().uuid(),
    reason: z.string().trim().min(1, 'A reason is required to reject an expense claim.').max(500),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await rejectExpenseClaim(v.data.id, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── Mark Reimbursed (approved → reimbursed; full payment details) ─────────────

// POST /api/finance/expenses/mark-reimbursed
router.post('/expenses/mark-reimbursed', async c => {
  const actor = await requirePermission(c, 'finance.expenses.approve');
  const v = zv(c, z.object({
    id:                z.string().uuid(),
    reimbursedAt:      z.string().optional(),
    paymentMethod:     z.enum(['eft', 'cheque', 'cash', 'wire', 'other']).optional(),
    reference:         z.string().max(100).optional(),
    paidAmount:        z.number().positive().optional(),
    sourceDisbursement:z.string().uuid().optional(),
    notes:             z.string().max(500).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await markExpenseReimbursed(v.data.id, actor.id, {
      reimbursedAt:      v.data.reimbursedAt,
      paymentMethod:     v.data.paymentMethod,
      reference:         v.data.reference,
      paidAmount:        v.data.paidAmount,
      sourceDisbursement:v.data.sourceDisbursement,
      notes:             v.data.notes,
    });
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── Cancel (draft/submitted → cancelled; reason required) ─────────────────────

// POST /api/finance/expenses/cancel
router.post('/expenses/cancel', async c => {
  const actor = await requirePermission(c, 'finance.expenses.manage');
  const v = zv(c, z.object({
    id:     z.string().uuid(),
    reason: z.string().trim().min(1, 'A reason is required to cancel an expense claim.').max(500),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await cancelExpenseClaim(v.data.id, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── Receipt upload ────────────────────────────────────────────────────────────

// POST /api/finance/expenses/receipt-upload-url
router.post('/expenses/receipt-upload-url', async c => {
  await requirePermission(c, 'finance.expenses.receipt.upload');
  const v = zv(c, z.object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getReceiptUploadUrl(v.data.fileName, v.data.mimeType);
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// POST /api/finance/expenses/receipt-commit
router.post('/expenses/receipt-commit', async c => {
  const actor = await requirePermission(c, 'finance.expenses.receipt.upload');
  const v = zv(c, z.object({
    claimId: z.string().uuid(),
    path:    z.string().min(1),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await commitReceipt(v.data.claimId, v.data.path, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── Reimbursement handoff (idempotent manual trigger) ─────────────────────────

// POST /api/finance/expenses/handoff/reimbursement
router.post('/expenses/handoff/reimbursement', async c => {
  const actor = await requirePermission(c, 'finance.expenses.handoff.create_reimbursement');
  const v = zv(c, z.object({
    claimId:      z.string().uuid(),
    payrollRunId: z.string().uuid().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const claim = await getExpenseClaim(v.data.claimId);
    if (!claim) return c.json({ success: false, message: 'Expense claim not found.' }, 404 as 200);
    if (claim.status !== 'approved') {
      return c.json({ success: false, message: 'Reimbursement handoff can only be created for approved claims.' }, 422 as 200);
    }
    if (!claim.reimbursable) {
      return c.json({ success: false, message: 'Claim is not marked as reimbursable.' }, 422 as 200);
    }
    const data = await createReimbursementHandoff(v.data.claimId, actor.id, v.data.payrollRunId);
    return c.json({ success: true, data: { bridgeId: data.bridgeId, handoffId: data.handoffId, reusedExisting: !data.created } });
  } catch (e) { return handleErr(c, e); }
});

// ── Comment ───────────────────────────────────────────────────────────────────

// POST /api/finance/expenses/comment
router.post('/expenses/comment', async c => {
  const actor = await requirePermission(c, 'finance.expenses.submit');
  const v = zv(c, z.object({
    claimId: z.string().uuid(),
    body:    z.string().trim().min(1, 'Comment body is required.').max(2000),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    await addExpenseComment(v.data.claimId, actor.id, v.data.body);
    return c.json({ success: true, data: null });
  } catch (e) { return handleErr(c, e); }
});

// ── Audit log ─────────────────────────────────────────────────────────────────

// POST /api/finance/expenses/audit-log
router.post('/expenses/audit-log', async c => {
  await requirePermission(c, 'finance.expenses.view');
  const v = zv(c, z.object({ claimId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listExpenseAuditLog(v.data.claimId);
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── KPIs ──────────────────────────────────────────────────────────────────────

// POST /api/finance/expenses/kpis
router.post('/expenses/kpis', async c => {
  await requirePermission(c, 'finance.expenses.view');
  try {
    const data = await getExpenseKpis();
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── CSV export ────────────────────────────────────────────────────────────────

// POST /api/finance/expenses/export-csv
// Returns a CSV of the current expense claims list (same filters as /list).
router.post('/expenses/export-csv', async c => {
  await requirePermission(c, 'finance.expenses.reports.view');
  const v = zv(c, z.object({
    claimantId: z.string().optional(),
    status:     z.enum(STATUS_VALUES).optional(),
    category:   z.enum(CATEGORY_VALUES).optional(),
    search:     z.string().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const result = await listExpenseClaims({
      claimantId: v.data.claimantId,
      status:     v.data.status as ExpenseStatus | undefined,
      category:   v.data.category,
      search:     v.data.search,
      pageSize:   10_000, // large export cap
    });
    const header = ['claim_no', 'title', 'claimant_id', 'category', 'expense_date', 'total_amount', 'currency', 'status', 'reimbursable', 'reimbursed_at', 'created_at'];
    const rows = result.data.map(r => [
      r.claimNo, r.title, r.claimantId, r.category, r.expenseDate,
      r.totalAmount, r.currency, r.status,
      r.reimbursable ? 'Yes' : 'No',
      r.reimbursedAt ?? '', r.createdAt,
    ].map(v => (typeof v === 'string' && v.includes(',')) ? `"${v.replace(/"/g, '""')}"` : String(v ?? '')));
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    return new Response(csv, {
      status: 200,
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="expense-claims.csv"' },
    });
  } catch (e) { return handleErr(c, e); }
});

// ── Trend ─────────────────────────────────────────────────────────────────────

// POST /api/finance/expenses/trend
router.post('/expenses/trend', async c => {
  await requirePermission(c, 'finance.expenses.view');
  try {
    const data = await getExpenseTrend();
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// ── Reports ───────────────────────────────────────────────────────────────────

// POST /api/finance/expenses/reports/list
router.post('/expenses/reports/list', async c => {
  await requirePermission(c, 'finance.expenses.reports.view');
  const v = zv(c, z.object({
    claimantId: z.string().optional(),
    status:     z.enum(STATUS_VALUES).optional(),
    category:   z.enum(CATEGORY_VALUES).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listExpensesReport(v.data as { claimantId?: string; status?: ExpenseStatus; category?: string });
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

// POST /api/finance/expenses/reports/run
// Full report runner — supports report type + optional filters
router.post('/expenses/reports/run', async c => {
  await requirePermission(c, 'finance.expenses.reports.view');
  const v = zv(c, z.object({
    report:     z.enum(REPORT_TYPES).optional(),
    // legacy alias for backwards compat
    claimantId: z.string().optional(),
    status:     z.enum(STATUS_VALUES).optional(),
    category:   z.enum(CATEGORY_VALUES).optional(),
    fiscalYear: z.number().int().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const reportType: ExpenseReportType = v.data.report ?? 'expense_claim_summary';
    const data = await runExpenseReport(reportType, {
      claimantId: v.data.claimantId,
      status:     v.data.status as ExpenseStatus | undefined,
      category:   v.data.category,
      fiscalYear: v.data.fiscalYear,
    });
    return c.json({ success: true, data });
  } catch (e) { return handleErr(c, e); }
});

export default router;
