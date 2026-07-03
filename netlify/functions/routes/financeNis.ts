// routes/financeNis.ts — Finance: NIS Profile Verification
// Mounted at /api/finance in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.
//
// Routes:
//   POST /api/finance/payroll/nis/list    — list NIS profiles (Finance view)
//   POST /api/finance/payroll/nis/get     — get a single NIS profile by id
//   POST /api/finance/payroll/nis/verify  — Finance Manager verifies a profile
//   POST /api/finance/payroll/nis/reject  — Finance Manager rejects a profile

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listNisProfiles,
  getStatutoryProfileById,
  verifyNisProfile,
  rejectNisProfile,
} from '../lib/finance/nisProfileVerification';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

/** Extract body.args (apiPost/authPost envelope convention). */
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

// ── LIST: Finance views NIS profiles ──────────────────────────────────────────
// POST /api/finance/payroll/nis/list
router.post('/payroll/nis/list', async c => {
  await requirePermission(c, 'finance.payroll.nis.view');
  const v = zv(c, z.object({
    jurisdiction: z.string().optional(),
    nisStatus:    z.string().optional(),
    employeeId:   z.string().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listNisProfiles(v.data);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

// ── GET: Finance views a single NIS profile ───────────────────────────────────
// POST /api/finance/payroll/nis/get
router.post('/payroll/nis/get', async c => {
  await requirePermission(c, 'finance.payroll.nis.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getStatutoryProfileById(v.data.id);
    if (!data) return c.json({ success: false, message: 'Statutory profile not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

// ── VERIFY: Finance Manager verifies a NIS profile ────────────────────────────
// POST /api/finance/payroll/nis/verify
// Only finance.payroll.nis.verify holders can set nis_status='verified'.
router.post('/payroll/nis/verify', async c => {
  const actor = await requirePermission(c, 'finance.payroll.nis.verify');
  const v = zv(c, z.object({
    id:               z.string().uuid(),
    verificationNote: z.string().nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await verifyNisProfile({
      id:               v.data.id,
      actorId:          actor.id,
      verificationNote: v.data.verificationNote,
    });
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

// ── REJECT: Finance Manager rejects a NIS profile ────────────────────────────
// POST /api/finance/payroll/nis/reject
router.post('/payroll/nis/reject', async c => {
  const actor = await requirePermission(c, 'finance.payroll.nis.verify');
  const v = zv(c, z.object({
    id:     z.string().uuid(),
    reason: z.string().min(1),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await rejectNisProfile({
      id:      v.data.id,
      actorId: actor.id,
      reason:  v.data.reason,
    });
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

export default router;
