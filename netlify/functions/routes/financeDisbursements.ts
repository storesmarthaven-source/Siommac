// routes/financeDisbursements.ts -- Finance: Payroll Bank Disbursements (F2)
// Mounted at /api/finance in api.ts. POST-only, JWT-gated. Envelope: body.args ?? {}.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listDisbursements, getDisbursement, computeFromRun,
  createDisbursement, submitDisbursement, approveDisbursement,
  generateBankFile, markDisbursementPaid, cancelDisbursement,
  listDisbursementLines, listDisbursementLinesDetail, listDisbursementsReport,
  getBankFileSignedUrl, getDisbursementKpis,
  listDisbursementAuditLog, listFinanceAuditLog,
  listBankFileStatusReport, listBankAccountReadinessReport,
  type DisbursementStatus,
} from '../lib/finance/disbursements';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};
const STATUS_VALUES = ['draft','submitted','approved','file_generated','paid','cancelled'] as const;

router.post('/disbursements/list', async c => {
  await requirePermission(c, 'finance.disbursement.view');
  const v = zv(c, z.object({
    payrollRunId: z.string().uuid().optional(),
    status: z.enum(STATUS_VALUES).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listDisbursements(v.data as { payrollRunId?: string; status?: DisbursementStatus });
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/get', async c => {
  await requirePermission(c, 'finance.disbursement.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getDisbursement(v.data.id);
    if (!data) return c.json({ success: false, message: 'Disbursement not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/lines/list', async c => {
  await requirePermission(c, 'finance.disbursement.view');
  const v = zv(c, z.object({ disbursementId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listDisbursementLines(v.data.disbursementId);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/compute', async c => {
  await requirePermission(c, 'finance.disbursement.view');
  const v = zv(c, z.object({ payrollRunId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await computeFromRun(v.data.payrollRunId);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/create', async c => {
  const actor = await requirePermission(c, 'finance.disbursement.manage');
  const v = zv(c, z.object({
    payrollRunId: z.string().uuid(),
    currency:     z.string().length(3).optional(),
    metadata:     z.record(z.string(), z.unknown()).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await createDisbursement({
      payrollRunId: v.data.payrollRunId,
      actorId:      actor.id,
      currency:     v.data.currency,
      metadata:     v.data.metadata,
    });
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/submit', async c => {
  const actor = await requirePermission(c, 'finance.disbursement.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await submitDisbursement(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/approve', async c => {
  const actor = await requirePermission(c, 'finance.disbursement.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await approveDisbursement(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/generate-file', async c => {
  const actor = await requirePermission(c, 'finance.disbursement.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const { filePath, disbursement } = await generateBankFile(v.data.id, actor.id);
    return c.json({ success: true, data: { ...disbursement, filePath } });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/mark-paid', async c => {
  const actor = await requirePermission(c, 'finance.disbursement.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await markDisbursementPaid(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/cancel', async c => {
  const actor = await requirePermission(c, 'finance.disbursement.manage');
  const v = zv(c, z.object({
    id: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await cancelDisbursement(v.data.id, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/lines/list-detail', async c => {
  await requirePermission(c, 'finance.disbursement.view');
  const v = zv(c, z.object({ disbursementId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listDisbursementLinesDetail(v.data.disbursementId);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/bank-file/signed-url', async c => {
  const actor = await requirePermission(c, 'finance.disbursements.bankFile.download');
  const v = zv(c, z.object({ disbursementId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getBankFileSignedUrl(v.data.disbursementId, actor.id);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/kpis', async c => {
  await requirePermission(c, 'finance.disbursement.view');
  try {
    const data = await getDisbursementKpis();
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/reports/list', async c => {
  await requirePermission(c, 'finance.disbursement.view');
  const v = zv(c, z.object({
    status: z.enum(STATUS_VALUES).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listDisbursementsReport(v.data as { status?: DisbursementStatus });
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/audit-log', async c => {
  await requirePermission(c, 'finance.disbursement.view');
  const v = zv(c, z.object({ disbursementId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listDisbursementAuditLog(v.data.disbursementId);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

// General finance audit log — used by BankAccountsTab and any other finance sub-tab needing audit trail.
router.post('/disbursements/finance-audit-log', async c => {
  await requirePermission(c, 'finance.disbursement.view');
  const v = zv(c, z.object({
    submoduleKey: z.string().min(1).max(64),
    recordId:     z.string().uuid(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listFinanceAuditLog(v.data.submoduleKey, v.data.recordId);
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/reports/bank-file-status', async c => {
  await requirePermission(c, 'finance.disbursement.view');
  try {
    const data = await listBankFileStatusReport();
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

router.post('/disbursements/reports/bank-account-readiness', async c => {
  await requirePermission(c, 'finance.disbursement.view');
  try {
    const data = await listBankAccountReadinessReport();
    return c.json({ success: true, data });
  } catch (e) {
    const er = e as { status?: number; message?: string };
    return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
  }
});

export default router;
