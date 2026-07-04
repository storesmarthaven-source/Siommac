// routes/financeRemittances.ts — Finance: Statutory Remittances & Filing (F1)
// Mounted at /api/finance in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listRemittances,
  getRemittance,
  computeRemittanceFromRun,
  createRemittance,
  submitRemittance,
  approveRemittance,
  markRemittancePaid,
  markRemittanceFiled,
  cancelRemittance,
  listRemittanceLines,
  listRemittancesReport,
  type RemittanceAuthority,
  type RemittanceStatus,
} from '../lib/finance/remittances';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

/** Extract body.args (apiPost/authPost envelope convention). */
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

const AUTHORITY_VALUES = ['paye_bir', 'nis_nibtt', 'health_surcharge'] as const;
const STATUS_VALUES    = ['draft', 'submitted', 'approved', 'paid', 'filed', 'cancelled'] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// List
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/list
router.post('/remittances/list', async c => {
  await requirePermission(c, 'finance.remittances.view');
  const v = zv(c, z.object({
    payrollRunId: z.string().uuid().optional(),
    authority:    z.enum(AUTHORITY_VALUES).optional(),
    status:       z.enum(STATUS_VALUES).optional(),
    periodYear:   z.number().int().optional(),
    periodMonth:  z.number().int().min(1).max(12).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRemittances(v.data as {
      payrollRunId?: string;
      authority?: RemittanceAuthority;
      status?: RemittanceStatus;
      periodYear?: number;
      periodMonth?: number;
    });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Get single + lines
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/get
router.post('/remittances/get', async c => {
  await requirePermission(c, 'finance.remittances.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getRemittance(v.data.id);
    if (!data) return c.json({ success: false, message: 'Remittance not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/remittances/lines/list
router.post('/remittances/lines/list', async c => {
  await requirePermission(c, 'finance.remittances.view');
  const v = zv(c, z.object({ remittanceId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRemittanceLines(v.data.remittanceId);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Compute (preview totals from a payroll run before creating)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/compute
router.post('/remittances/compute', async c => {
  await requirePermission(c, 'finance.remittances.view');
  const v = zv(c, z.object({
    payrollRunId: z.string().uuid(),
    authority:    z.enum(AUTHORITY_VALUES),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await computeRemittanceFromRun(v.data.payrollRunId, v.data.authority);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Create
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/create
router.post('/remittances/create', async c => {
  const actor = await requirePermission(c, 'finance.remittances.manage');
  const v = zv(c, z.object({
    payrollRunId: z.string().uuid(),
    authority:    z.enum(AUTHORITY_VALUES),
    dueDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    metadata:     z.record(z.string(), z.unknown()).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await createRemittance({
      payrollRunId: v.data.payrollRunId,
      authority:    v.data.authority,
      dueDate:      v.data.dueDate ?? undefined,
      metadata:     v.data.metadata,
      actorId:      actor.id,
    });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Submit (draft → submitted, starts approval workflow)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/submit
router.post('/remittances/submit', async c => {
  const actor = await requirePermission(c, 'finance.remittances.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await submitRemittance(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Approve (submitted → approved; SoD: creator ≠ approver)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/approve
router.post('/remittances/approve', async c => {
  const actor = await requirePermission(c, 'finance.remittances.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await approveRemittance(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mark Paid (approved → paid)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/mark-paid
router.post('/remittances/mark-paid', async c => {
  const actor = await requirePermission(c, 'finance.remittances.approve');
  const v = zv(c, z.object({
    id:                 z.string().uuid(),
    paidDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    authorityReference: z.string().max(200).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await markRemittancePaid(v.data.id, actor.id, {
      paidDate:           v.data.paidDate,
      authorityReference: v.data.authorityReference,
    });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mark Filed (paid → filed)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/mark-filed
router.post('/remittances/mark-filed', async c => {
  const actor = await requirePermission(c, 'finance.remittances.approve');
  const v = zv(c, z.object({
    id:                 z.string().uuid(),
    filedDate:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    authorityReference: z.string().max(200).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await markRemittanceFiled(v.data.id, actor.id, {
      filedDate:          v.data.filedDate,
      authorityReference: v.data.authorityReference,
    });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cancel (draft/submitted → cancelled)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/cancel
router.post('/remittances/cancel', async c => {
  const actor = await requirePermission(c, 'finance.remittances.manage');
  const v = zv(c, z.object({
    id:     z.string().uuid(),
    reason: z.string().trim().min(1, 'A reason is required to cancel a remittance.').max(500),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await cancelRemittance(v.data.id, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reports
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/reports/list
router.post('/remittances/reports/list', async c => {
  await requirePermission(c, 'finance.remittances.reports.view');
  const v = zv(c, z.object({
    periodYear: z.number().int().optional(),
    authority:  z.enum(AUTHORITY_VALUES).optional(),
    status:     z.enum(STATUS_VALUES).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRemittancesReport(v.data as {
      periodYear?: number;
      authority?: RemittanceAuthority;
      status?: RemittanceStatus;
    });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/remittances/reports/run
// Alias for reports/list — reserved for future extended reports with filter/export.
router.post('/remittances/reports/run', async c => {
  await requirePermission(c, 'finance.remittances.reports.view');
  const v = zv(c, z.object({
    periodYear: z.number().int().optional(),
    authority:  z.enum(AUTHORITY_VALUES).optional(),
    status:     z.enum(STATUS_VALUES).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRemittancesReport(v.data as {
      periodYear?: number;
      authority?: RemittanceAuthority;
      status?: RemittanceStatus;
    });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

export default router;
