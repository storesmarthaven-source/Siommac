// routes/financeExpenses.ts -- Finance: Expense Claims (F4)
// Mounted at /api/finance in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listExpenseClaims,
  getExpenseClaim,
  listExpenseCostEntries,
  createExpenseClaim,
  submitExpenseClaim,
  approveExpenseClaim,
  rejectExpenseClaim,
  markExpenseReimbursed,
  cancelExpenseClaim,
  getReceiptUploadUrl,
  commitReceipt,
  listExpensesReport,
  type ExpenseStatus,
} from '../lib/finance/expenses';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

/** Extract body.args (apiPost/authPost envelope convention). */
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

const STATUS_VALUES   = ['draft', 'submitted', 'approved', 'rejected', 'reimbursed', 'cancelled'] as const;
const CATEGORY_VALUES = ['travel', 'accommodation', 'meals', 'equipment', 'supplies', 'professional_fees', 'utilities', 'other'] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// List
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/expenses/list
router.post('/expenses/list', async c => {
  await requirePermission(c, 'finance.expenses.view');
  const v = zv(c, z.object({
    claimantId: z.string().optional(),
    status:     z.enum(STATUS_VALUES).optional(),
    category:   z.enum(CATEGORY_VALUES).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listExpenseClaims(v.data as {
      claimantId?: string;
      status?: ExpenseStatus;
      category?: string;
    });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Get single + allocation lines
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/expenses/get
router.post('/expenses/get', async c => {
  await requirePermission(c, 'finance.expenses.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getExpenseClaim(v.data.id);
    if (!data) return c.json({ success: false, message: 'Expense claim not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/expenses/lines/list
router.post('/expenses/lines/list', async c => {
  await requirePermission(c, 'finance.expenses.view');
  const v = zv(c, z.object({ claimId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listExpenseCostEntries(v.data.claimId);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Create
// ═══════════════════════════════════════════════════════════════════════════════

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
    allocationLines: z.array(z.object({
      costCenterId: z.string().uuid(),
      amount:       z.number().positive(),
      description:  z.string().max(300).optional(),
    })).min(1, 'At least one allocation line is required.'),
    metadata:        z.record(z.string(), z.unknown()).optional(),
  }), b(c));
  if (!v.ok) return v.response;
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
      allocationLines: v.data.allocationLines,
      metadata:        v.data.metadata,
      actorId:         actor.id,
    });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Submit (draft → submitted, starts approval workflow)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/expenses/submit
router.post('/expenses/submit', async c => {
  const actor = await requirePermission(c, 'finance.expenses.submit');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await submitExpenseClaim(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Approve (submitted → approved; SoD: claimant ≠ approver)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/expenses/approve
router.post('/expenses/approve', async c => {
  const actor = await requirePermission(c, 'finance.expenses.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await approveExpenseClaim(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reject (submitted → rejected; reason required)
// ═══════════════════════════════════════════════════════════════════════════════

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
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mark Reimbursed (approved → reimbursed)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/expenses/mark-reimbursed
router.post('/expenses/mark-reimbursed', async c => {
  const actor = await requirePermission(c, 'finance.expenses.approve');
  const v = zv(c, z.object({
    id:           z.string().uuid(),
    reimbursedAt: z.string().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await markExpenseReimbursed(v.data.id, actor.id, { reimbursedAt: v.data.reimbursedAt });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cancel (draft/submitted → cancelled; reason required)
// ═══════════════════════════════════════════════════════════════════════════════

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
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Receipt upload
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/expenses/receipt-upload-url
router.post('/expenses/receipt-upload-url', async c => {
  await requirePermission(c, 'finance.expenses.manage');
  const v = zv(c, z.object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getReceiptUploadUrl(v.data.fileName, v.data.mimeType);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/expenses/receipt-commit
router.post('/expenses/receipt-commit', async c => {
  const actor = await requirePermission(c, 'finance.expenses.manage');
  const v = zv(c, z.object({
    claimId: z.string().uuid(),
    path:    z.string().min(1),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await commitReceipt(v.data.claimId, v.data.path, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reports
// ═══════════════════════════════════════════════════════════════════════════════

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
    const data = await listExpensesReport(v.data as {
      claimantId?: string;
      status?: ExpenseStatus;
      category?: string;
    });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/expenses/reports/run
// Alias for reports/list -- reserved for future extended reports with filter/export.
router.post('/expenses/reports/run', async c => {
  await requirePermission(c, 'finance.expenses.reports.view');
  const v = zv(c, z.object({
    claimantId: z.string().optional(),
    status:     z.enum(STATUS_VALUES).optional(),
    category:   z.enum(CATEGORY_VALUES).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listExpensesReport(v.data as {
      claimantId?: string;
      status?: ExpenseStatus;
      category?: string;
    });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

export default router;
