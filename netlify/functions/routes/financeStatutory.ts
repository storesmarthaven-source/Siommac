// routes/financeStatutory.ts — Finance: Statutory Configuration + Pay Components
// Mounted at /api/finance in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listStatutoryVersions,
  getStatutoryVersion,
  createStatutoryVersion,
  updateStatutoryVersion,
  submitStatutoryVersion,
  approveStatutoryVersion,
  rejectStatutoryVersion,
  activateStatutoryVersion,
  retireStatutoryVersion,
  listNisClasses,
  upsertNisClasses,
  listStatutoryReport,
  deleteNisClass,
  importNisClasses,
  getRateVersionDetail,
  getApprovalTimeline,
  runStatutoryReport,
  type UpsertNisClassInput,
  type NisClassImportRow,
} from '../lib/finance/statutoryConfig';
import {
  listPayComponents,
  createPayComponent,
  updatePayComponent,
  retirePayComponent,
  listPayComponentChangeRequests,
  approvePayComponentChangeRequest,
  rejectPayComponentChangeRequest,
} from '../lib/finance/payrollComponents';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();

/** Extract body.args (apiPost/authPost envelope convention). */
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

/** Standard error handler for route catch blocks. */
function err(c: ReturnType<typeof router.post> extends unknown ? never : unknown, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return (c as { json: (v: unknown, s: number) => Response }).json(
    { success: false, message: er.message ?? 'Internal error' },
    (er.status ?? 500) as 200,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Statutory Versions
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/statutory/versions/list
router.post('/statutory/versions/list', async c => {
  await requirePermission(c, 'finance.statutory.view');
  const v = zv(c, z.object({
    jurisdiction: z.string().optional(),
    status: z.string().optional(),
    activeOnly: z.boolean().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listStatutoryVersions(v.data);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/versions/get
router.post('/statutory/versions/get', async c => {
  await requirePermission(c, 'finance.statutory.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getStatutoryVersion(v.data.id);
    if (!data) return c.json({ success: false, message: 'Statutory version not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/versions/create
router.post('/statutory/versions/create', async c => {
  const actor = await requirePermission(c, 'finance.statutory.manage');
  const v = zv(c, z.object({
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    label: z.string().min(1).max(200),
    jurisdiction: z.enum(['TT']).optional(),
    currency: z.enum(['TTD']).optional(),
    payePersonalAllowance: z.number().nonnegative(),
    payeBand1Ceiling: z.number().nonnegative(),
    payeBand1Rate: z.number().min(0).max(1),
    payeBand2Rate: z.number().min(0).max(1),
    hsMonthlyThreshold: z.number().nonnegative(),
    hsWeeklyHigh: z.number().nonnegative(),
    hsWeeklyLow: z.number().nonnegative(),
    nisMonthyCeiling: z.number().nonnegative().nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await createStatutoryVersion({ ...v.data, actorId: actor.id });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/versions/update
router.post('/statutory/versions/update', async c => {
  const actor = await requirePermission(c, 'finance.statutory.manage');
  const v = zv(c, z.object({
    id: z.string().uuid(),
    label: z.string().min(1).max(200).optional(),
    payePersonalAllowance: z.number().nonnegative().optional(),
    payeBand1Ceiling: z.number().nonnegative().optional(),
    payeBand1Rate: z.number().min(0).max(1).optional(),
    payeBand2Rate: z.number().min(0).max(1).optional(),
    hsMonthlyThreshold: z.number().nonnegative().optional(),
    hsWeeklyHigh: z.number().nonnegative().optional(),
    hsWeeklyLow: z.number().nonnegative().optional(),
    nisMonthyCeiling: z.number().nonnegative().nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await updateStatutoryVersion({ ...v.data, actorId: actor.id });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/versions/submit
router.post('/statutory/versions/submit', async c => {
  const actor = await requirePermission(c, 'finance.statutory.manage');
  const v = zv(c, z.object({ id: z.string().uuid(), idempotencyKey: z.string().min(1).max(200) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await submitStatutoryVersion(v.data.id, actor.id, v.data.idempotencyKey);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/versions/approve
router.post('/statutory/versions/approve', async c => {
  const actor = await requirePermission(c, 'finance.statutory.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await approveStatutoryVersion(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/versions/reject
router.post('/statutory/versions/reject', async c => {
  const actor = await requirePermission(c, 'finance.statutory.approve');
  const v = zv(c, z.object({ id: z.string().uuid(), reason: z.string().trim().min(1, 'A reason is required to reject a rate version.').max(500) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await rejectStatutoryVersion(v.data.id, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/versions/activate
router.post('/statutory/versions/activate', async c => {
  const actor = await requirePermission(c, 'finance.statutory.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await activateStatutoryVersion(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/versions/retire
router.post('/statutory/versions/retire', async c => {
  const actor = await requirePermission(c, 'finance.statutory.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await retireStatutoryVersion(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NIS Classes
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/statutory/nis-classes/list
router.post('/statutory/nis-classes/list', async c => {
  await requirePermission(c, 'finance.statutory.view');
  const v = zv(c, z.object({ statutoryVersionId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listNisClasses(v.data.statutoryVersionId);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/nis-classes/upsert
router.post('/statutory/nis-classes/upsert', async c => {
  const actor = await requirePermission(c, 'finance.statutory.manage');
  const v = zv(c, z.object({
    statutoryVersionId: z.string().uuid(),
    classes: z.array(z.object({
      classNo: z.number().int().positive(),
      weeklyMin: z.number().nonnegative(),
      weeklyMax: z.number().nonnegative().nullable().optional(),
      assumedAverageWeekly: z.number().nonnegative().nullable().optional(),
      employeeWeekly: z.number().nonnegative(),
      employerWeekly: z.number().nonnegative(),
      classZWeekly: z.number().nonnegative().nullable().optional(),
    })).min(1),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await upsertNisClasses(
      v.data.statutoryVersionId,
      v.data.classes as UpsertNisClassInput[],
      actor.id,
    );
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/nis-classes/delete
// Guarded by new key: finance.statutory.nis_class.delete
router.post('/statutory/nis-classes/delete', async c => {
  const actor = await requirePermission(c, 'finance.statutory.nis_class.delete');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    await deleteNisClass(v.data.id, actor.id);
    return c.json({ success: true, data: { id: v.data.id } });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/nis-classes/import
// Guarded by new key: finance.statutory.nis_class.import
router.post('/statutory/nis-classes/import', async c => {
  const actor = await requirePermission(c, 'finance.statutory.nis_class.import');
  const v = zv(c, z.object({
    statutoryVersionId: z.string().uuid(),
    rows: z.array(z.object({
      classNo: z.number().int().positive(),
      weeklyMin: z.number().nonnegative(),
      weeklyMax: z.number().nonnegative().nullable().optional(),
      assumedAverageWeekly: z.number().nonnegative().nullable().optional(),
      employeeWeekly: z.number().nonnegative(),
      employerWeekly: z.number().nonnegative(),
      classZWeekly: z.number().nonnegative().nullable().optional(),
    })).min(1),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await importNisClasses(
      v.data.statutoryVersionId,
      v.data.rows as NisClassImportRow[],
      actor.id,
    );
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/versions/detail
router.post('/statutory/versions/detail', async c => {
  await requirePermission(c, 'finance.statutory.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getRateVersionDetail(v.data.id);
    if (!data) return c.json({ success: false, message: 'Statutory version not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/versions/approval-timeline
router.post('/statutory/versions/approval-timeline', async c => {
  await requirePermission(c, 'finance.statutory.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getApprovalTimeline(v.data.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/statutory/reports/run
router.post('/statutory/reports/run', async c => {
  await requirePermission(c, 'finance.statutory.reports.view');
  const v = zv(c, z.object({
    report: z.enum(['statutory_version_summary', 'nis_class_summary', 'pay_component_map', 'statutory_approval_history']),
    jurisdiction: z.string().optional(),
    versionId: z.string().uuid().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await runStatutoryReport(v.data.report, { jurisdiction: v.data.jurisdiction, versionId: v.data.versionId });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Statutory Reports (minimal Phase-1 list; full reports in later phase)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/statutory/reports/list
router.post('/statutory/reports/list', async c => {
  await requirePermission(c, 'finance.statutory.reports.view');
  const v = zv(c, z.object({ jurisdiction: z.string().optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listStatutoryReport(v.data);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pay Components
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/payroll/components/list
router.post('/payroll/components/list', async c => {
  await requirePermission(c, 'finance.payroll.components.view');
  const v = zv(c, z.object({
    activeOnly: z.boolean().optional(),
    kind: z.enum(['earning', 'deduction']).optional(),
    isStatutory: z.boolean().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listPayComponents(v.data);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/payroll/components/create
router.post('/payroll/components/create', async c => {
  const actor = await requirePermission(c, 'finance.payroll.components.manage');
  const v = zv(c, z.object({
    code: z.string().min(1).max(20).regex(/^[A-Za-z0-9_]+$/, 'Code must be alphanumeric/underscore'),
    name: z.string().min(1).max(200),
    kind: z.enum(['earning', 'deduction']),
    isStatutory: z.boolean().optional(),
    isTaxable: z.boolean().optional(),
    reducesChargeable: z.boolean().optional(),
    glAccountCode: z.string().max(50).nullable().optional(),
    costAllocationRequired: z.boolean().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await createPayComponent({ ...v.data, actorId: actor.id });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/payroll/components/update
router.post('/payroll/components/update', async c => {
  const actor = await requirePermission(c, 'finance.payroll.components.manage');
  const v = zv(c, z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    isStatutory: z.boolean().optional(),
    isTaxable: z.boolean().optional(),
    reducesChargeable: z.boolean().optional(),
    glAccountCode: z.string().max(50).nullable().optional(),
    costAllocationRequired: z.boolean().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await updatePayComponent({ ...v.data, actorId: actor.id });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/payroll/components/retire
router.post('/payroll/components/retire', async c => {
  const actor = await requirePermission(c, 'finance.payroll.components.manage');
  const v = zv(c, z.object({ id: z.string().uuid(), idempotencyKey: z.string().min(1).max(200).optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await retirePayComponent(v.data.id, actor.id, v.data.idempotencyKey);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// ── Pay Component Change Requests ──────────────────────────────────────────────

// POST /api/finance/payroll/components/change-requests/list
router.post('/payroll/components/change-requests/list', async c => {
  await requirePermission(c, 'finance.payroll.components.view');
  const v = zv(c, z.object({
    status: z.enum(['pending_approval', 'approved', 'rejected']).optional(),
    componentId: z.string().uuid().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listPayComponentChangeRequests(v.data);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/payroll/components/change-requests/approve
router.post('/payroll/components/change-requests/approve', async c => {
  const actor = await requirePermission(c, 'finance.payroll.components.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await approvePayComponentChangeRequest(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/payroll/components/change-requests/reject
router.post('/payroll/components/change-requests/reject', async c => {
  const actor = await requirePermission(c, 'finance.payroll.components.approve');
  const v = zv(c, z.object({
    id: z.string().uuid(),
    reason: z.string().max(500).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await rejectPayComponentChangeRequest(v.data.id, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

export default router;
