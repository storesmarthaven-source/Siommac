// routes/financePickers.ts — Finance picker list endpoints
// Mounted at /api/finance. POST-only, JWT-gated. Envelope: body.args ?? {}.
// All endpoints gate on finance.ap.view (minimum read access to Finance AP).

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listGlAccounts,
  listCostCentres,
  listTaxCodes,
  listPaymentTerms,
  listVendorsForPicker,
} from '../lib/finance/pickers';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const b = (c: { get: (k: string) => unknown }) => (c.get('body') as Record<string, unknown>).args ?? {};

const fail = (c: { json: (o: unknown, s?: number) => Response }, e: unknown) => {
  const er = e as { status?: number; message?: string };
  return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
};

// ── GL Accounts ───────────────────────────────────────────────────────────────
router.post('/pickers/gl-accounts', async c => {
  await requirePermission(c, 'finance.ap.view');
  const v = zv(c, z.object({ search: z.string().max(100).optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listGlAccounts(v.data.search);
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// ── Cost Centres ─────────────────────────────────────────────────────────────
router.post('/pickers/cost-centres', async c => {
  await requirePermission(c, 'finance.ap.view');
  const v = zv(c, z.object({ search: z.string().max(100).optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listCostCentres(v.data.search);
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// ── Tax Codes ─────────────────────────────────────────────────────────────────
router.post('/pickers/tax-codes', async c => {
  await requirePermission(c, 'finance.ap.view');
  const v = zv(c, z.object({}), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listTaxCodes();
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// ── Payment Terms ────────────────────────────────────────────────────────────
router.post('/pickers/payment-terms', async c => {
  await requirePermission(c, 'finance.ap.view');
  const v = zv(c, z.object({}), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listPaymentTerms();
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

// ── Vendor Picker (lightweight search — full vendor list uses /ap/vendors/list) ──
router.post('/pickers/vendors', async c => {
  await requirePermission(c, 'finance.ap.view');
  const v = zv(c, z.object({ search: z.string().max(100).optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listVendorsForPicker(v.data.search);
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

export default router;
