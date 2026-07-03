// routes/financePayroll.ts — Finance: Payroll Runs (Phase 3 Stage 2)
// Mounted at /api/finance in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.
//
// Stage 2 routes: list, get, create, lock-inputs, calculate
//                 + run-lines/list, inputs/list, warnings/list
// Stage 3 (submit, approve, lock, payslips, export) is NOT here yet.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listPayrollRuns,
  getPayrollRun,
  createPayrollRun,
  lockInputs,
  calculateRun,
  listRunInputs,
  listRunLines,
  listRunWarnings,
} from '../lib/finance/payrollRuns';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

/** Extract body.args (apiPost/authPost envelope convention). */
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

/** Standard route error handler. */
function routeErr(c: { json: (v: unknown, s: number) => Response }, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json(
    { success: false, message: er.message ?? 'Internal error' },
    (er.status ?? 500) as 200,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Payroll Runs
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/runs/list
// view_all → all runs; view_own → only relevant to self (future payslip scope)
router.post('/payroll/runs/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    status: z.string().optional(),
    limit:  z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listPayrollRuns(v.data);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/get
router.post('/payroll/runs/get', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayrollRun(v.data.id);
    if (!data) return c.json({ success: false, message: 'Payroll run not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/create
router.post('/payroll/runs/create', async c => {
  const actor = await requirePermission(c, 'finance.payroll.run.manage');
  const v = zv(c, z.object({
    periodMonth:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    payFrequency:   z.enum(['monthly', 'bi_weekly', 'weekly']).optional(),
    weeksInPeriod:  z.number().positive().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await createPayrollRun({ ...v.data, actorId: actor.id });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/lock-inputs
router.post('/payroll/runs/lock-inputs', async c => {
  const actor = await requirePermission(c, 'finance.payroll.run.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await lockInputs(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/calculate
router.post('/payroll/runs/calculate', async c => {
  const actor = await requirePermission(c, 'finance.payroll.run.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await calculateRun(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Run Inputs (locked snapshot)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/inputs/list
router.post('/payroll/inputs/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRunInputs(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Run Lines (calculated results)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/run-lines/list
router.post('/payroll/run-lines/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRunLines(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Run Warnings (NIS + input exceptions)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/warnings/list
router.post('/payroll/warnings/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRunWarnings(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

export default router;
