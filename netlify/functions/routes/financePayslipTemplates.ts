// routes/financePayslipTemplates.ts -- Finance: Payslip Studio layout templates (Phase 1)
// Mounted at /api/finance. POST-only, JWT-gated. Envelope: body.args ?? {}.
// Six ops backing the studio's ApiTemplateStore: list / get / create / update /
// set-default / delete (soft-delete). The response DTO (data) is EXACTLY the
// studio's StoredTemplate so ApiTemplateStore is a drop-in for LocalTemplateStore.
// Presentation only -- these routes never touch pay figures.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listTemplates, getTemplate, createTemplate, updateTemplate,
  setDefaultTemplate, archiveTemplate, getEditorState, saveEditorState,
} from '../lib/finance/payslipTemplates';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

const P = '/payroll/payslip-templates';
const zDesign = z.record(z.string(), z.unknown());

function fail(c: { json: (b: unknown, s?: number) => Response }, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
}

// ── Read ────────────────────────────────────────────────────────────────────

router.post(`${P}/list`, async c => {
  await requirePermission(c, 'finance.payroll.templates.view');
  try {
    return c.json({ success: true, data: await listTemplates() });
  } catch (e) { return fail(c, e); }
});

router.post(`${P}/get`, async c => {
  await requirePermission(c, 'finance.payroll.templates.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    return c.json({ success: true, data: await getTemplate(v.data.id) });
  } catch (e) { return fail(c, e); }
});

// ── Mutations (manage) ──────────────────────────────────────────────────────

router.post(`${P}/create`, async c => {
  const actor = await requirePermission(c, 'finance.payroll.templates.manage');
  const v = zv(c, z.object({
    name:   z.string().trim().min(1).max(120),
    design: zDesign,
  }), b(c));
  if (!v.ok) return v.response;
  try {
    return c.json({ success: true, data: await createTemplate(v.data, actor.id) });
  } catch (e) { return fail(c, e); }
});

router.post(`${P}/update`, async c => {
  const actor = await requirePermission(c, 'finance.payroll.templates.manage');
  const v = zv(c, z.object({
    id:     z.string().uuid(),
    name:   z.string().trim().min(1).max(120).optional(),
    design: zDesign.optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    return c.json({ success: true, data: await updateTemplate(v.data, actor.id) });
  } catch (e) { return fail(c, e); }
});

router.post(`${P}/set-default`, async c => {
  const actor = await requirePermission(c, 'finance.payroll.templates.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    return c.json({ success: true, data: await setDefaultTemplate(v.data.id, actor.id) });
  } catch (e) { return fail(c, e); }
});

router.post(`${P}/delete`, async c => {
  const actor = await requirePermission(c, 'finance.payroll.templates.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    return c.json({ success: true, data: await archiveTemplate(v.data.id, actor.id) });
  } catch (e) { return fail(c, e); }
});

// ── Per-user editor state (autosave draft + open-ref) — always scoped to actor ──

router.post(`${P}/editor-state/get`, async c => {
  const actor = await requirePermission(c, 'finance.payroll.templates.manage');
  try {
    return c.json({ success: true, data: await getEditorState(actor.id) });
  } catch (e) { return fail(c, e); }
});

const zOpenRef = z.object({ id: z.string().min(1), name: z.string() });

router.post(`${P}/editor-state/save`, async c => {
  const actor = await requirePermission(c, 'finance.payroll.templates.manage');
  const v = zv(c, z.object({
    draftDesign: zDesign.nullable().optional(),
    openRef:     zOpenRef.nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    return c.json({ success: true, data: await saveEditorState(actor.id, v.data) });
  } catch (e) { return fail(c, e); }
});

export default router;
