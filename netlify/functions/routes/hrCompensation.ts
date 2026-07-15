// routes/hrCompensation.ts — HR Compensation (pay items)
// Mounted at /api/hr in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listPayItems,
  getPayItem,
  listPayItemsReport,
} from '../lib/hr/compensationQueries';
import {
  createPayItem,
  submitPayItem,
  approvePayItem,
  rejectPayItem,
  retirePayItem,
} from '../lib/hr/compensationMutations';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

/** Extract body.args (apiPost/authPost envelope convention). */
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

// ═══════════════════════════════════════════════════════════════════════════════
// Pay Items
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/hr/compensation/pay-items/list
router.post('/compensation/pay-items/list', async c => {
  await requirePermission(c, 'hr.compensation.view');
  const v = zv(c, z.object({
    employeeId: z.string().optional(),
    status: z.string().optional(),
    activeOnly: z.boolean().optional(),
    componentId: z.string().uuid().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listPayItems(v.data);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/hr/compensation/pay-items/get
router.post('/compensation/pay-items/get', async c => {
  await requirePermission(c, 'hr.compensation.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayItem(v.data.id);
    if (!data) return c.json({ success: false, message: 'Pay item not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/hr/compensation/pay-items/create
router.post('/compensation/pay-items/create', async c => {
  const actor = await requirePermission(c, 'hr.compensation.manage');
  const v = zv(c, z.object({
    employeeId: z.string().min(1),
    componentId: z.string().uuid(),
    amount: z.number().nonnegative().nullable().optional(),
    percent: z.number().min(0).max(100).nullable().optional(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await createPayItem({ ...v.data, actorId: actor.id });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/hr/compensation/pay-items/submit
router.post('/compensation/pay-items/submit', async c => {
  const actor = await requirePermission(c, 'hr.compensation.manage');
  const v = zv(c, z.object({ id: z.string().uuid(), idempotencyKey: z.string().min(1).max(200) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await submitPayItem(v.data.id, actor.id, v.data.idempotencyKey);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/hr/compensation/pay-items/approve
router.post('/compensation/pay-items/approve', async c => {
  const actor = await requirePermission(c, 'hr.compensation.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await approvePayItem(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/hr/compensation/pay-items/reject
router.post('/compensation/pay-items/reject', async c => {
  const actor = await requirePermission(c, 'hr.compensation.approve');
  const v = zv(c, z.object({ id: z.string().uuid(), reason: z.string().trim().min(1, 'A reason is required to reject a pay item.').max(500) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await rejectPayItem(v.data.id, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/hr/compensation/pay-items/retire
router.post('/compensation/pay-items/retire', async c => {
  const actor = await requirePermission(c, 'hr.compensation.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await retirePayItem(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reports
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/hr/compensation/reports/list
router.post('/compensation/reports/list', async c => {
  await requirePermission(c, 'hr.compensation.reports.view');
  const v = zv(c, z.object({
    employeeId: z.string().optional(),
    status: z.string().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listPayItemsReport(v.data);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

export default router;
