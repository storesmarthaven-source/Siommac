// routes/financeOverview.ts -- Finance: Overview dashboard
// Mounted at /api/finance in api.ts. POST-only, JWT-gated via requirePermission.
// Body envelope: body.args ?? {} (apiPost/authPost convention).

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  getFinanceOverview,
  exportFinanceOverview,
  getFinanceKpiDrilldown,
  getApprovalsQueueV2,
  approveFinanceQueueItem,
  rejectFinanceQueueItem,
  getSpendBudgetSeries,
  type ExportType,
  type KpiType,
  type QueueItemType,
  type ApprovalsQueueFilters,
  type SpendBudgetPeriod,
} from '../lib/finance/overview';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

const b = (c: { get: (k: string) => unknown }): Record<string, unknown> =>
  ((c.get('body') as Record<string, unknown>).args as Record<string, unknown>) ?? {};

const fail = (c: { json: (o: unknown, s?: number) => Response }, e: unknown): Response => {
  const er = e as { status?: number; message?: string };
  return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
};

// POST /api/finance/overview/summary
router.post('/overview/summary', async c => {
  await requirePermission(c, 'finance.overview.view');
  try {
    const data = await getFinanceOverview();
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// POST /api/finance/overview/export  (Chunk 9)
router.post('/overview/export', async c => {
  const actor = await requirePermission(c, 'finance.overview.export');
  const v = zv(c, z.object({
    type: z.enum(['dashboard', 'approvals', 'spend-budget', 'cost-centre', 'all']).optional().default('all'),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await exportFinanceOverview(v.data.type as ExportType, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// POST /api/finance/overview/kpi-drilldown  (Chunk 10)
router.post('/overview/kpi-drilldown', async c => {
  const actor = await requirePermission(c, 'finance.overview.kpi.drill');
  const v = zv(c, z.object({
    kpiType: z.enum(['spend', 'pending-approvals', 'budget-variance', 'cash-out']),
    period: z.string().max(20).optional().default('mtd'),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getFinanceKpiDrilldown(v.data.kpiType as KpiType, v.data.period, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// POST /api/finance/overview/approvals/list  (Chunk 11)
router.post('/overview/approvals/list', async c => {
  const actor = await requirePermission(c, 'finance.overview.approvals.inline');
  const v = zv(c, z.object({
    type: z.enum(['Bill', 'Expense', 'Remittance', 'Disbursement']).optional(),
    minAgeDays: z.number().int().min(0).optional(),
    minAmount: z.number().nonnegative().optional(),
    priority: z.enum(['high', 'normal']).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getApprovalsQueueV2(v.data as ApprovalsQueueFilters, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// POST /api/finance/overview/approvals/act  (Chunk 11)
router.post('/overview/approvals/act', async c => {
  const actor = await requirePermission(c, 'finance.overview.approvals.inline');
  const v = zv(c, z.object({
    id: z.string().uuid(),
    type: z.enum(['Bill', 'Expense', 'Remittance', 'Disbursement']),
    action: z.enum(['approve', 'reject']),
    reason: z.string().max(1000).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    let data: { ref: string; status: string };
    if (v.data.action === 'approve') {
      data = await approveFinanceQueueItem(v.data.id, v.data.type as QueueItemType, actor.id);
    } else {
      if (!v.data.reason?.trim()) {
        return c.json({ success: false, message: 'A reason is required to reject.' }, 422 as 200);
      }
      data = await rejectFinanceQueueItem(v.data.id, v.data.type as QueueItemType, v.data.reason.trim(), actor.id);
    }
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// POST /api/finance/overview/spend-budget-series  (Chunk 13-chart)
router.post('/overview/spend-budget-series', async c => {
  await requirePermission(c, 'finance.overview.view');
  const v = zv(c, z.object({
    period: z.enum(['MTD', 'Monthly', 'Quarterly']).optional().default('Monthly'),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getSpendBudgetSeries(v.data.period as SpendBudgetPeriod);
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

export default router;
