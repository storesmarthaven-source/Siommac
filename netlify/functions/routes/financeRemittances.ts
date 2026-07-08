// routes/financeRemittances.ts — Finance: Statutory Remittances & Filing (F1)
// Mounted at /api/finance in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.
//
// New permission keys enforced here (orchestrator catalogues + grants):
//   finance.remittances.mark_filed — required for mark-filed (was: approve)

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
  listAllRemittanceLines,
  listRemittanceAudit,
  listRemittancesReport,
  getRemittanceSummaryReport,
  getRemittanceLinesReport,
  getAuthorityFilingStatusReport,
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

const FILING_METHOD_VALUES = ['online_portal', 'in_person', 'courier', 'eft', 'other'] as const;

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
    search:       z.string().max(100).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRemittances(v.data as {
      payrollRunId?: string;
      authority?: RemittanceAuthority;
      status?: RemittanceStatus;
      periodYear?: number;
      periodMonth?: number;
      search?: string;
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

// POST /api/finance/remittances/lines/list-all
// Lists lines across all remittances (filtered); used by the Aurora Lines tab.
router.post('/remittances/lines/list-all', async c => {
  await requirePermission(c, 'finance.remittances.view');
  const v = zv(c, z.object({
    authority:   z.enum(AUTHORITY_VALUES).optional(),
    periodYear:  z.number().int().optional(),
    periodMonth: z.number().int().min(1).max(12).optional(),
    limit:       z.number().int().min(1).max(2000).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listAllRemittanceLines(v.data as {
      authority?: RemittanceAuthority;
      periodYear?: number;
      periodMonth?: number;
      limit?: number;
    });
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
// Mark Filed (paid → filed) — NEW granular permission: finance.remittances.mark_filed
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/mark-filed
router.post('/remittances/mark-filed', async c => {
  const actor = await requirePermission(c, 'finance.remittances.mark_filed');
  const v = zv(c, z.object({
    id:                 z.string().uuid(),
    filedDate:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    authorityReference: z.string().max(200).optional(),
    filingMethod:       z.enum(FILING_METHOD_VALUES).optional(),
    receiptReference:   z.string().max(200).optional(),
    filedNotes:         z.string().max(2000).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await markRemittanceFiled(v.data.id, actor.id, {
      filedDate:          v.data.filedDate,
      authorityReference: v.data.authorityReference,
      filingMethod:       v.data.filingMethod,
      receiptReference:   v.data.receiptReference,
      filedNotes:         v.data.filedNotes,
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
// Reports — three types + legacy list (§5)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/finance/remittances/reports/list  (legacy; returns RemittanceReportRow[])
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

// POST /api/finance/remittances/audit/list  (drawer audit tab)
router.post('/remittances/audit/list', async c => {
  await requirePermission(c, 'finance.remittances.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRemittanceAudit(v.data.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

// POST /api/finance/remittances/reports/run  (Aurora; returns ReportResult)
router.post('/remittances/reports/run', async c => {
  await requirePermission(c, 'finance.remittances.reports.view');
  const v = zv(c, z.object({
    report:     z.enum(['remittance_summary', 'remittance_lines', 'authority_filing_status']),
    periodYear: z.number().int().optional(),
    authority:  z.enum(AUTHORITY_VALUES).optional(),
    status:     z.enum(STATUS_VALUES).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const { report, periodYear, authority, status } = v.data;
    const opts = {
      periodYear,
      authority: authority as RemittanceAuthority | undefined,
      status:    status as RemittanceStatus | undefined,
    };
    let data;
    if (report === 'remittance_summary')       data = await getRemittanceSummaryReport(opts);
    else if (report === 'remittance_lines')    data = await getRemittanceLinesReport({ periodYear, authority: authority as RemittanceAuthority | undefined });
    else                                        data = await getAuthorityFilingStatusReport({ periodYear });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
});

export default router;
