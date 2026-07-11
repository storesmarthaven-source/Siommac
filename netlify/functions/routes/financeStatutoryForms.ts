// routes/financeStatutoryForms.ts -- Finance: Payroll statutory forms (Wave 7)
// Mounted at /api/finance. POST-only, JWT-gated. Envelope: body.args ?? {}.
// Employer profile + generated-form list/download. TD4/NI generate routes are
// appended here in 7a/7b.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import { getEmployerProfile, upsertEmployerProfile } from '../lib/finance/employerProfile';
import {
  listStatutoryForms, getStatutoryFormSignedUrl,
  type StatutoryFormType,
} from '../lib/finance/statutoryForms';
import { generateTd4ForEmployee, generateTd4Year } from '../lib/finance/td4Forms';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};
const FORM_TYPES = ['td4', 'td4_summary', 'ni184', 'ni187'] as const;

// ── Employer profile ──────────────────────────────────────────────────────────

router.post('/statutory-forms/employer-profile/get', async c => {
  await requirePermission(c, 'finance.payroll.statutory_forms.view');
  try {
    const data = await getEmployerProfile();
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/statutory-forms/employer-profile/update', async c => {
  const actor = await requirePermission(c, 'finance.payroll.statutory_forms.generate');
  const v = zv(c, z.object({
    legalName:         z.string().trim().min(1).max(200).optional(),
    tradingName:       z.string().trim().max(200).nullable().optional(),
    birFileNumber:     z.string().trim().max(40).nullable().optional(),
    nisEmployerNumber: z.string().trim().max(40).nullable().optional(),
    addressLine1:      z.string().trim().max(200).nullable().optional(),
    addressLine2:      z.string().trim().max(200).nullable().optional(),
    city:              z.string().trim().max(120).nullable().optional(),
    country:           z.string().trim().max(120).optional(),
    phone:             z.string().trim().max(40).nullable().optional(),
    email:             z.string().trim().max(160).nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await upsertEmployerProfile({ ...v.data, actorId: actor.id });
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

// ── Generated forms: list + download ───────────────────────────────────────────

router.post('/statutory-forms/list', async c => {
  await requirePermission(c, 'finance.payroll.statutory_forms.view');
  const v = zv(c, z.object({
    formType:   z.enum(FORM_TYPES).optional(),
    taxYear:    z.number().int().optional(),
    employeeId: z.string().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listStatutoryForms(v.data as { formType?: StatutoryFormType; taxYear?: number; employeeId?: string });
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

// ── TD4 generation (year-end BIR certificates) ─────────────────────────────────

router.post('/statutory-forms/td4/generate', async c => {
  const actor = await requirePermission(c, 'finance.payroll.statutory_forms.generate');
  const v = zv(c, z.object({ employeeId: z.string().min(1), taxYear: z.number().int().min(2000).max(2100) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await generateTd4ForEmployee(v.data.employeeId, v.data.taxYear, actor.id);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/statutory-forms/td4/generate-year', async c => {
  const actor = await requirePermission(c, 'finance.payroll.statutory_forms.generate');
  const v = zv(c, z.object({ taxYear: z.number().int().min(2000).max(2100) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await generateTd4Year(v.data.taxYear, actor.id);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/statutory-forms/signed-url', async c => {
  const actor = await requirePermission(c, 'finance.payroll.statutory_forms.view');
  const v = zv(c, z.object({ id: z.string().uuid(), which: z.enum(['pdf', 'data']).optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getStatutoryFormSignedUrl(v.data.id, actor.id, v.data.which ?? 'pdf');
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

export default router;
