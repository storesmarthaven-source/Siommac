// routes/hrOvertime.ts — HR Overtime (submit / approve / reject / cancel)
// Mounted at /api/hr in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listOvertimeEntries,
  getOvertimeEntry,
  listOvertimeReport,
} from '../lib/hr/overtimeQueries';
import {
  submitOvertimeEntry,
  approveOvertimeEntry,
  rejectOvertimeEntry,
  cancelOvertimeEntry,
} from '../lib/hr/overtimeMutations';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

/** Extract body.args (apiPost/authPost envelope convention). */
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

// ═══════════════════════════════════════════════════════════════════════════════
// Overtime Entries
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/hr/overtime/list
router.post('/overtime/list', async c => {
  const actor = await requirePermission(c, 'hr.overtime.view');
  const v = zv(c, z.object({
    employeeId: z.string().optional(),
    status: z.string().optional(),
    workDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    workDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    payrollRunId: z.string().uuid().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    // Managers/HR can filter; employees without manage see own only via submit scope.
    const data = await listOvertimeEntries(v.data);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/hr/overtime/get
router.post('/overtime/get', async c => {
  await requirePermission(c, 'hr.overtime.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getOvertimeEntry(v.data.id);
    if (!data) return c.json({ success: false, message: 'Overtime entry not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/hr/overtime/submit
// Self-scope enforced: employee can only submit their own OT.
router.post('/overtime/submit', async c => {
  const actor = await requirePermission(c, 'hr.overtime.submit');
  const v = zv(c, z.object({
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hours: z.number().positive(),
    multiplier: z.number().positive().optional(),
    reason: z.string().max(500).nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    // Employee always submits for themselves — employeeId == actor.id
    const data = await submitOvertimeEntry({ ...v.data, employeeId: actor.id, actorId: actor.id });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/hr/overtime/approve
router.post('/overtime/approve', async c => {
  const actor = await requirePermission(c, 'hr.overtime.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await approveOvertimeEntry(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/hr/overtime/reject
router.post('/overtime/reject', async c => {
  const actor = await requirePermission(c, 'hr.overtime.approve');
  const v = zv(c, z.object({ id: z.string().uuid(), reason: z.string().trim().min(1, 'A reason is required to reject overtime.').max(500) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await rejectOvertimeEntry(v.data.id, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/hr/overtime/cancel
// Employees can cancel own; HR/manager can cancel any (within scope).
router.post('/overtime/cancel', async c => {
  const actor = await requirePermission(c, 'hr.overtime.submit');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await cancelOvertimeEntry(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Reports
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/hr/overtime/reports/list
router.post('/overtime/reports/list', async c => {
  await requirePermission(c, 'hr.overtime.reports.view');
  const v = zv(c, z.object({
    employeeId: z.string().optional(),
    status: z.string().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listOvertimeReport(v.data);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

export default router;
