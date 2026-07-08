// routes/financeBudgets.ts -- Finance: Budgeting & Budget-vs-Actual (F5)
// Mounted at /api/finance in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listBudgets,
  getBudgetLine,
  upsertBudgetLine,
  deleteBudgetLine,
  bulkUpsertBudgetLines,
  copyLastYearBudget,
  getBudgetLineActuals,
  listCostEntriesForYear,
  getBudgetVarianceReport,
  listBudgetReports,
  runBudgetReport,
  getBudgetLineApprovals,
  getBudgetLineAuditLog,
  type UpsertBudgetLineInput,
  type BulkBudgetLineInput,
  type CopyLastYearInput,
} from '../lib/finance/budgets';
import {
  getBudgetAttachmentUploadUrl,
  commitBudgetAttachment,
  listBudgetAttachments,
  deleteBudgetAttachment,
  getFinanceAttachmentSignedUrl,
} from '../lib/finance/attachments';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

// ============================================================================
// Budget Lines — read
// ============================================================================

// POST /api/finance/budgets/list
router.post('/budgets/list', async c => {
  await requirePermission(c, 'finance.budgets.view');
  const v = zv(c, z.object({
    costCenterId: z.string().uuid().optional(),
    fiscalYear: z.number().int().min(2000).max(2100).optional(),
    category: z.string().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listBudgets(v.data);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/budgets/get
router.post('/budgets/get', async c => {
  await requirePermission(c, 'finance.budgets.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getBudgetLine(v.data.id);
    if (!data) return c.json({ success: false, message: 'Budget line not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ============================================================================
// Budget Lines — mutations
// ============================================================================

// POST /api/finance/budgets/upsert
router.post('/budgets/upsert', async c => {
  const actor = await requirePermission(c, 'finance.budgets.manage');
  const v = zv(c, z.object({
    costCenterId: z.string().uuid(),
    fiscalYear: z.number().int().min(2000).max(2100),
    category: z.string().min(1).max(100),
    label: z.string().max(200).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    budgeted: z.number().nonnegative(),
    currency: z.enum(['TTD']).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await upsertBudgetLine({ ...v.data, actorId: actor.id } as UpsertBudgetLineInput);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/budgets/delete
router.post('/budgets/delete', async c => {
  const actor = await requirePermission(c, 'finance.budgets.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    await deleteBudgetLine(v.data.id, actor.id);
    return c.json({ success: true, data: { id: v.data.id } });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/budgets/bulk-upsert
// Requires: finance.budgets.bulk_upsert (new granular key — orchestrator must catalogue + grant)
router.post('/budgets/bulk-upsert', async c => {
  const actor = await requirePermission(c, 'finance.budgets.bulk_upsert');
  const BulkLineSchema = z.object({
    costCenterId: z.string().uuid(),
    fiscalYear:   z.number().int().min(2000).max(2100),
    category:     z.string().min(1).max(100),
    label:        z.string().max(200).nullable().optional(),
    notes:        z.string().max(2000).nullable().optional(),
    budgeted:     z.number().nonnegative(),
    currency:     z.enum(['TTD']).optional(),
    /** Fiscal period within the year — e.g. 'Q1', 'Jan', 'H1'. */
    period:       z.string().max(20).nullable().optional(),
    /** Budget owner user ID (app_users.id TEXT). */
    ownerId:      z.string().max(100).nullable().optional(),
  });
  const v = zv(c, z.object({
    lines: z.array(BulkLineSchema).min(1).max(200),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await bulkUpsertBudgetLines(v.data.lines as BulkBudgetLineInput[], actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/budgets/copy-last-year
// Requires: finance.budgets.copy_last_year (new granular key — orchestrator must catalogue + grant)
router.post('/budgets/copy-last-year', async c => {
  const actor = await requirePermission(c, 'finance.budgets.copy_last_year');
  const v = zv(c, z.object({
    sourceFiscalYear: z.number().int().min(2000).max(2100),
    targetFiscalYear: z.number().int().min(2000).max(2100),
    costCenterId:     z.string().uuid().nullable().optional(),
    category:         z.string().max(100).nullable().optional(),
    adjustmentPct:    z.number().min(-99).max(200).optional(),
    roundingRule:     z.enum(['none', 'hundred', 'thousand']).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await copyLastYearBudget({ ...v.data, actorId: actor.id } as CopyLastYearInput);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ============================================================================
// Variance
// ============================================================================

// POST /api/finance/budgets/variance
router.post('/budgets/variance', async c => {
  await requirePermission(c, 'finance.budgets.view');
  const v = zv(c, z.object({
    fiscalYear: z.number().int().min(2000).max(2100),
    costCenterId: z.string().uuid().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getBudgetVarianceReport(v.data.fiscalYear, v.data.costCenterId);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ============================================================================
// Actuals
// ============================================================================

// POST /api/finance/budgets/line-actuals
// Returns cost entry breakdown for the drawer's Actuals Composition tab.
router.post('/budgets/line-actuals', async c => {
  await requirePermission(c, 'finance.budgets.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getBudgetLineActuals(v.data.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/budgets/actuals
// Returns all cost entries for the page-level Actuals tab.
router.post('/budgets/actuals', async c => {
  await requirePermission(c, 'finance.budgets.view');
  const v = zv(c, z.object({
    fiscalYear:   z.number().int().min(2000).max(2100),
    costCenterId: z.string().uuid().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listCostEntriesForYear(v.data.fiscalYear, v.data.costCenterId);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ============================================================================
// Reports
// ============================================================================

// POST /api/finance/budgets/reports/list
router.post('/budgets/reports/list', async c => {
  await requirePermission(c, 'finance.budgets.reports.view');
  try {
    const data = listBudgetReports();
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/budgets/reports/run
router.post('/budgets/reports/run', async c => {
  await requirePermission(c, 'finance.budgets.reports.view');
  const v = zv(c, z.object({
    reportKey:    z.string().min(1),
    fiscalYear:   z.number().int().min(2000).max(2100).optional(),
    costCenterId: z.string().uuid().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await runBudgetReport(v.data.reportKey, { fiscalYear: v.data.fiscalYear, costCenterId: v.data.costCenterId });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ============================================================================
// Approvals (workflow tasks for a budget line)
// ============================================================================

// POST /api/finance/budgets/approvals
router.post('/budgets/approvals', async c => {
  await requirePermission(c, 'finance.budgets.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getBudgetLineApprovals(v.data.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ============================================================================
// Audit log for a budget line
// ============================================================================

// POST /api/finance/budgets/audit-log
router.post('/budgets/audit-log', async c => {
  await requirePermission(c, 'finance.budgets.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getBudgetLineAuditLog(v.data.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ============================================================================
// Budget-line attachments (budget_support docs — §6)
// Requires: finance.budgets.view (list/signed-url), finance.budgets.attachments.upload,
//           finance.budgets.attachments.delete
// ============================================================================

// POST /api/finance/budgets/attachments/upload-url
router.post('/budgets/attachments/upload-url', async c => {
  const actor = await requirePermission(c, 'finance.budgets.attachments.upload');
  const v = zv(c, z.object({
    budgetLineId: z.string().uuid(),
    fileName:     z.string().min(1).max(255),
    mimeType:     z.string().min(1).max(120),
  }), b(c));
  if (!v.ok) return v.response;
  void actor;
  try {
    const data = await getBudgetAttachmentUploadUrl(v.data.fileName, v.data.mimeType);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/budgets/attachments/complete
router.post('/budgets/attachments/complete', async c => {
  const actor = await requirePermission(c, 'finance.budgets.attachments.upload');
  const v = zv(c, z.object({
    budgetLineId: z.string().uuid(),
    fileName:     z.string().min(1).max(255),
    storagePath:  z.string().min(1),
    mimeType:     z.string().max(120).nullable().optional(),
    fileSize:     z.number().int().positive().nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await commitBudgetAttachment(
      v.data.budgetLineId,
      { fileName: v.data.fileName, storagePath: v.data.storagePath, mimeType: v.data.mimeType, fileSize: v.data.fileSize },
      actor.id,
    );
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/budgets/attachments/list
router.post('/budgets/attachments/list', async c => {
  await requirePermission(c, 'finance.budgets.view');
  const v = zv(c, z.object({ budgetLineId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listBudgetAttachments(v.data.budgetLineId);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/budgets/attachments/signed-url
router.post('/budgets/attachments/signed-url', async c => {
  await requirePermission(c, 'finance.budgets.view');
  const v = zv(c, z.object({ storagePath: z.string().min(1) }), b(c));
  if (!v.ok) return v.response;
  try {
    const signedUrl = await getFinanceAttachmentSignedUrl(v.data.storagePath);
    return c.json({ success: true, data: { signedUrl } });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/budgets/attachments/delete
router.post('/budgets/attachments/delete', async c => {
  const actor = await requirePermission(c, 'finance.budgets.attachments.delete');
  const v = zv(c, z.object({
    id:           z.string().uuid(),
    budgetLineId: z.string().uuid(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    await deleteBudgetAttachment(v.data.id, v.data.budgetLineId, actor.id);
    return c.json({ success: true, data: { id: v.data.id } });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

export default router;
