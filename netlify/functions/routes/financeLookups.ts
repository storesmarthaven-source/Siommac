/**
 * Shared Finance lookup endpoints for surviving payroll, remittance,
 * disbursement, and expense workflows. Each endpoint applies its own
 * least-privilege permission gate.
 */

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  resolveEmployees,
  listEmployeesForPicker,
  listApprovedPayrollRuns,
  listAuthorities,
} from '../lib/finance/lookups';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

/** Extract body.args (apiPost envelope convention). */
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

/** Standard error responder. */
function fail(c: { json: (o: unknown, s?: number) => Response }, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json(
    { success: false, message: er.message ?? 'Internal error' },
    (er.status ?? 500) as 200,
  );
}

// ── POST /finance/lookups/resolve-employees ────────────────────────────────────
// Bulk-resolve up to 200 employee IDs (TEXT) to display info.
// Returns an array of EmployeeResolved; the FE converts to Map<id, ...>.
router.post('/lookups/resolve-employees', async c => {
  await requirePermission(c, 'finance.overview.view');
  const v = zv(c, z.object({
    ids: z.array(z.string().max(128)).max(200),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const map  = await resolveEmployees(v.data.ids);
    const data = [...map.values()];
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// ── POST /finance/lookups/employees ──────────────────────────────────────────
// Employee autocomplete for picker comboboxes (bank-account form, expense allocation, etc.).
router.post('/lookups/employees', async c => {
  await requirePermission(c, 'finance.overview.view');
  const v = zv(c, z.object({
    search: z.string().max(100).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listEmployeesForPicker(v.data.search);
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// ── POST /finance/lookups/approved-payroll-runs ───────────────────────────────
// Approved/locked/exported payroll runs — used by Remittances + Disbursements
// create wizards as the "run picker" (replaces free-text UUID input).
router.post('/lookups/approved-payroll-runs', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    search: z.string().max(100).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listApprovedPayrollRuns(v.data.search);
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// ── POST /finance/lookups/authorities ────────────────────────────────────────
// Static remittance authority list (PAYE-BIR, NIS-NIBTT, Health Surcharge).
// No body params needed.
router.post('/lookups/authorities', async c => {
  await requirePermission(c, 'finance.remittances.view');
  try {
    const data = listAuthorities();
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

export default router;
