// routes/hrStatutoryProfile.ts — HR: Employee Statutory Profile (NIS Continuity)
// Mounted at /api/hr in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.
//
// Routes:
//   POST /api/hr/employee-statutory/get      — get profile for an employee
//   POST /api/hr/employee-statutory/capture  — create or update NIS profile data (HR)
//   POST /api/hr/employee-statutory/submit   — submit profile for Finance verification

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  getStatutoryProfileByEmployee,
  captureStatutoryProfile,
  submitStatutoryProfile,
} from '../lib/hr/statutoryProfileMutations';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

/** Extract body.args (apiPost/authPost envelope convention). */
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

// ── GET: load the statutory profile for an employee ───────────────────────────
// POST /api/hr/employee-statutory/get
router.post('/employee-statutory/get', async c => {
  await requirePermission(c, 'hr.employee.statutory.view');
  const v = zv(c, z.object({
    employeeId:   z.string(),
    jurisdiction: z.string().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getStatutoryProfileByEmployee(v.data.employeeId, v.data.jurisdiction);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

// ── CAPTURE: HR creates or updates NIS profile data ───────────────────────────
// POST /api/hr/employee-statutory/capture
router.post('/employee-statutory/capture', async c => {
  const actor = await requirePermission(c, 'hr.employee.statutory.capture');
  const v = zv(c, z.object({
    employeeId:                   z.string(),
    jurisdiction:                 z.string().optional(),
    currency:                     z.string().optional(),
    nisNumber:                    z.string().nullable().optional(),
    nisApplicable:                z.boolean().optional(),
    previousEmployerName:         z.string().nullable().optional(),
    previousEmployerEndDate:      z.string().nullable().optional(),
    openingYtdInsurableEarnings:  z.number().nonnegative().optional(),
    openingYtdNisEmployee:        z.number().nonnegative().optional(),
    openingYtdNisEmployer:        z.number().nonnegative().optional(),
    openingBalanceAsOf:           z.string().nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await captureStatutoryProfile({ ...v.data, actorId: actor.id });
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

// ── SUBMIT: HR submits the profile for Finance verification ───────────────────
// POST /api/hr/employee-statutory/submit
router.post('/employee-statutory/submit', async c => {
  const actor = await requirePermission(c, 'hr.employee.statutory.capture');
  const v = zv(c, z.object({ id: z.string().uuid(), idempotencyKey: z.string().min(1).max(200) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await submitStatutoryProfile(v.data.id, actor.id, v.data.idempotencyKey);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

export default router;
