// routes/financePayroll.ts — Finance: Payroll Runs (Phase 3 — all stages)
// Mounted at /api/finance in api.ts.
// All routes POST-only, JWT-gated via requirePermission. Envelope: body.args ?? {}.
//
// Stage 2 routes: list, get, create, lock-inputs, calculate
//                 + run-lines/list, inputs/list, warnings/list
// Stage 3 routes: submit, lock, reopen, export
//                 + payslips/{my,get,generate,signed-url}
//                 + exports/list
//                 + reports/*

import { Hono } from 'hono';
import { requirePermission, userCan } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listPayrollRuns,
  getPayrollRun,
  createPayrollRun,
  lockInputs,
  calculateRun,
  submitRun,
  approveRun,
  rejectRun,
  lockRun,
  reopenRun,
  listRunInputs,
  listRunLines,
  listRunWarnings,
  listRunAuditLog,
  resolveRunWarning,
  getEmployeePopulationPreview,
  downloadRunExport,
  notifyPayslipEmployees,
} from '../lib/finance/payrollRuns';
import {
  generatePayslips,
  getMyPayslips,
  getPayslip,
  signedPayslipUrl,
  listPayslipsForRun,
  renderPayslip,
  renderRunPayslips,
} from '../lib/finance/payrollPayslips';
import {
  deliverPayslip,
  deliverRunPayslips,
  listRunDeliveries,
} from '../lib/finance/payrollPayslipDelivery';
import {
  previewRunGl,
  postRunGl,
  reverseRunGl,
  getRunGlJournal,
} from '../lib/finance/payrollGl';
import {
  listPayGroups,
  createPayGroup,
  getPayGroup,
  assignEmployee,
  listGroupMembers,
} from '../lib/finance/payGroups';
import { exportRun, listRunExports } from '../lib/finance/payrollExports';
import { runPayrollReport } from '../lib/finance/payrollReports';
import type { ExportFormat } from '../lib/finance/payrollExports';
import type { PayrollReportKey } from '../lib/finance/payrollReports';
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
    payFrequency:   z.enum(['monthly', 'weekly', 'fortnightly', 'semi_monthly', 'bi_weekly']).optional(),
    weeksInPeriod:  z.number().positive().optional(),
    payGroup:       z.string().min(1).max(100).optional(),
    payGroupId:     z.string().uuid().optional(),   // when set, the group drives frequency + population
    payDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cutOffDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

// POST /api/finance/payroll/runs/audit/list
// Returns hr_audit_log entries for a specific payroll run (drawer Audit tab).
// Permission: finance.payroll.view_all
router.post('/payroll/runs/audit/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRunAuditLog(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — Run lifecycle: submit, lock, reopen, export
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/runs/submit
// Submits a calculated run for approval via the central workflow engine.
// Permission: finance.payroll.run.manage (finance_staff or finance_manager).
router.post('/payroll/runs/submit', async c => {
  const actor = await requirePermission(c, 'finance.payroll.run.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await submitRun(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/approve
// Approves a pending_approval run.  SoD enforced: actor must differ from run.createdBy.
// Permission: finance.payroll.approve (finance_manager / admin only).
router.post('/payroll/runs/approve', async c => {
  const actor = await requirePermission(c, 'finance.payroll.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    await approveRun(v.data.id, actor.id);
    const data = await getPayrollRun(v.data.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/reject
// Rejects a pending_approval run, returning it to 'calculated' so the preparer can revise.
// A mandatory reason is required and the submitter is notified.
// Permission: finance.payroll.approve (same authority as approve — SoD mirrors approve path).
router.post('/payroll/runs/reject', async c => {
  const actor = await requirePermission(c, 'finance.payroll.approve');
  const v = zv(c, z.object({
    id:     z.string().uuid(),
    reason: z.string().min(1, 'Reason is required').max(500),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await rejectRun(v.data.id, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/lock
// Locks an approved run so that payslips can be generated.
// Permission: finance.payroll.lock (finance_manager / admin only — SoD).
router.post('/payroll/runs/lock', async c => {
  const actor = await requirePermission(c, 'finance.payroll.lock');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await lockRun(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/reopen
// Reopens a locked run back to draft with a mandatory reason.
// Guard: run must NOT be exported.
// Permission: finance.payroll.lock (same authority level as lock).
router.post('/payroll/runs/reopen', async c => {
  const actor = await requirePermission(c, 'finance.payroll.lock');
  const v = zv(c, z.object({
    id:     z.string().uuid(),
    reason: z.string().min(1, 'Reason is required'),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await reopenRun(v.data.id, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/export
// Exports a locked run as an artifact. Re-export adds a new version.
// Permission: finance.payroll.export.
router.post('/payroll/runs/export', async c => {
  const actor = await requirePermission(c, 'finance.payroll.export');
  const v = zv(c, z.object({
    id:     z.string().uuid(),
    format: z.enum(['csv', 'json', 'xlsx', 'pdf']).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await exportRun(v.data.id, actor.id, (v.data.format ?? 'csv') as ExportFormat);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Exports list
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/exports/list
router.post('/payroll/exports/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRunExports(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Payslips
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/payslips/notify
// Send in-app payslip-ready notifications to all employees with payslips in a locked run.
// Idempotent (uses per-payslip dedupe keys).
// Permission: finance.payroll.run.manage.
router.post('/payroll/payslips/notify', async c => {
  const actor = await requirePermission(c, 'finance.payroll.run.manage');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await notifyPayslipEmployees(v.data.runId, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/payslips/generate
// Generate payslips for all employees in a locked run.
// Finance-only: requires view_all.
router.post('/payroll/payslips/generate', async c => {
  const actor = await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await generatePayslips(v.data.runId, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/payslips/render-run
// Generate (idempotent) + render PDF payslips for every employee in a locked run, upload to
// the private payslips bucket, and stamp file_path. Row-level failure isolation.
// Permission: finance.payroll.payslips.generate (write).
router.post('/payroll/payslips/render-run', async c => {
  const actor = await requirePermission(c, 'finance.payroll.payslips.generate');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await renderRunPayslips(v.data.runId, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/payslips/render
// Re-render a single payslip PDF (e.g. retry after a failure).
// Permission: finance.payroll.payslips.generate (write).
router.post('/payroll/payslips/render', async c => {
  const actor = await requirePermission(c, 'finance.payroll.payslips.generate');
  const v = zv(c, z.object({ payslipId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await renderPayslip(v.data.payslipId, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/payslips/deliver-run
// Email every RENDERED payslip in a run to its employee (password-protected PDF) + track.
// Permission: finance.payroll.payslips.distribute (sends personal data externally).
router.post('/payroll/payslips/deliver-run', async c => {
  const actor = await requirePermission(c, 'finance.payroll.payslips.distribute');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await deliverRunPayslips(v.data.runId, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/payslips/deliver
// Email a single rendered payslip (e.g. resend to one employee).
router.post('/payroll/payslips/deliver', async c => {
  const actor = await requirePermission(c, 'finance.payroll.payslips.distribute');
  const v = zv(c, z.object({ payslipId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await deliverPayslip(v.data.payslipId, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/payslips/deliveries/list
// Delivery history for a run — Finance only.
router.post('/payroll/payslips/deliveries/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRunDeliveries(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ── Pay groups (Wave 3b) ─────────────────────────────────────────────────────

// POST /api/finance/payroll/pay-groups/list  — Finance (used by the New Run wizard).
router.post('/payroll/pay-groups/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ activeOnly: z.boolean().optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listPayGroups({ activeOnly: v.data.activeOnly });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/pay-groups/get
router.post('/payroll/pay-groups/get', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayGroup(v.data.id);
    if (!data) return c.json({ success: false, message: 'Pay group not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/pay-groups/create  — Permission: paygroups.manage.
router.post('/payroll/pay-groups/create', async c => {
  const actor = await requirePermission(c, 'finance.payroll.paygroups.manage');
  const v = zv(c, z.object({
    code: z.string().min(1).max(20),
    name: z.string().min(1).max(120),
    frequency: z.enum(['weekly', 'fortnightly', 'semi_monthly', 'monthly']),
    defaultPayDay: z.number().int().optional(),
    defaultCutoffOffsetDays: z.number().int().optional(),
    statutoryCountry: z.string().max(4).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await createPayGroup(v.data, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/pay-groups/assign  — assign an employee to a group.
router.post('/payroll/pay-groups/assign', async c => {
  const actor = await requirePermission(c, 'finance.payroll.paygroups.manage');
  const v = zv(c, z.object({
    employeeId: z.string().min(1),
    payGroupId: z.string().uuid(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await assignEmployee(v.data, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/pay-groups/members  — assignments for a group.
router.post('/payroll/pay-groups/members', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ payGroupId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listGroupMembers(v.data.payGroupId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ── Payroll GL posting (Wave 2) ──────────────────────────────────────────────

// POST /api/finance/payroll/gl/preview
// Build the (unposted) double-entry journal for a run: lines, totals, balance,
// and any missing account mappings. Read-only. Permission: finance.payroll.gl.preview.
router.post('/payroll/gl/preview', async c => {
  await requirePermission(c, 'finance.payroll.gl.preview');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await previewRunGl(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/gl/post
// Post the run's balanced journal to the GL and link it on the run.
// Guards: run locked/exported, not already posted, all mappings present.
// Permission: finance.payroll.gl.post.
router.post('/payroll/gl/post', async c => {
  const actor = await requirePermission(c, 'finance.payroll.gl.post');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await postRunGl(v.data.runId, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/gl/reverse
// Reverse the run's posted journal (creates a mirror reversing journal) with a reason.
// Permission: finance.payroll.gl.post.
router.post('/payroll/gl/reverse', async c => {
  const actor = await requirePermission(c, 'finance.payroll.gl.post');
  const v = zv(c, z.object({ runId: z.string().uuid(), reason: z.string().min(1) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await reverseRunGl(v.data.runId, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/gl/get
// Fetch the posted journal (header + lines) for a run, or null if unposted.
router.post('/payroll/gl/get', async c => {
  await requirePermission(c, 'finance.payroll.gl.preview');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getRunGlJournal(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/payslips/list
// List all payslips for a run — Finance only.
router.post('/payroll/payslips/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listPayslipsForRun(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/payslips/my
// Employee self-service: returns only the caller's own payslips.
// Privacy: self-scope enforced server-side. Permission: finance.payroll.view_own.
router.post('/payroll/payslips/my', async c => {
  const actor = await requirePermission(c, 'finance.payroll.view_own');
  try {
    const data = await getMyPayslips(actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/payslips/get
// Get a single payslip. Employee self: self-scope enforced. Finance: no scope limit.
router.post('/payroll/payslips/get', async c => {
  const actor = await requirePermission(c, 'finance.payroll.view_own');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    // Non-finance callers (view_own only) are scoped to own payslips.
    // Finance (view_all) can retrieve any payslip.
    const hasViewAll = await userCan(actor, 'finance.payroll.view_all');
    const ownerFilter = hasViewAll ? undefined : actor.id;
    const data = await getPayslip(v.data.id, ownerFilter);
    if (!data) return c.json({ success: false, message: 'Payslip not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/payslips/signed-url
// Return a short-lived signed URL for downloading a payslip file.
// Ownership enforced for view_own callers; Finance (view_all) can generate for any.
// Download is audited.
router.post('/payroll/payslips/signed-url', async c => {
  const actor = await requirePermission(c, 'finance.payroll.view_own');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const hasViewAll = await userCan(actor, 'finance.payroll.view_all');
    const ownerFilter = hasViewAll ? null : actor.id;
    const data = await signedPayslipUrl(v.data.id, ownerFilter, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/reports/run
// Dispatch to any of the §18 report handlers.
// Permission: finance.payroll.reports.view
router.post('/payroll/reports/run', async c => {
  await requirePermission(c, 'finance.payroll.reports.view');
  const v = zv(c, z.object({
    report: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await runPayrollReport(v.data.report as PayrollReportKey, v.data.params ?? {});
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Warning: resolve
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/warnings/resolve
// Resolve a single run warning. Requires finance.payroll.run.manage.
// New action key (reported): finance.payroll.warning.resolve
// Interim enforcement uses finance.payroll.run.manage until key is catalogued.
router.post('/payroll/warnings/resolve', async c => {
  const actor = await requirePermission(c, 'finance.payroll.run.manage');
  const v = zv(c, z.object({
    warningId: z.string().uuid(),
    note:      z.string().max(500).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await resolveRunWarning(v.data.warningId, actor.id, v.data.note);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Employee Population Preview (wizard step 2)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/runs/population-preview
// Read-only estimate of how many active employees would be included in a run.
router.post('/payroll/runs/population-preview', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    periodMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getEmployeePopulationPreview(v.data.periodMonth);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Export download
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/exports/download
// Regenerate and return export content for browser download.
// New action key (reported): finance.payroll.export.download
// Interim enforcement uses finance.payroll.export until key is catalogued.
router.post('/payroll/exports/download', async c => {
  const actor = await requirePermission(c, 'finance.payroll.export');
  const v = zv(c, z.object({ exportId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await downloadRunExport(v.data.exportId, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/reports/list
// List available report keys (for the UI to build the report picker).
router.post('/payroll/reports/list', async c => {
  await requirePermission(c, 'finance.payroll.reports.view');
  const reports: { key: string; label: string; requiresRunId: boolean }[] = [
    { key: 'register',                  label: 'Payroll Run Register',           requiresRunId: false },
    { key: 'payslip_register',           label: 'Payslip Register',               requiresRunId: false },
    { key: 'net_pay_summary',            label: 'Net Pay Summary',                requiresRunId: true  },
    { key: 'employer_nis_summary',       label: 'Employer NIS Summary',           requiresRunId: true  },
    { key: 'nis_remittance',             label: 'NIS Remittance',                 requiresRunId: true  },
    { key: 'paye_summary',               label: 'PAYE Summary',                   requiresRunId: true  },
    { key: 'hs_summary',                 label: 'Health Surcharge Summary',       requiresRunId: true  },
    { key: 'cost_by_department',         label: 'Cost by Department',             requiresRunId: true  },
    { key: 'cost_by_cost_center',        label: 'Cost by Cost Center',            requiresRunId: true  },
    { key: 'export_audit',               label: 'Export Audit',                   requiresRunId: false },
    { key: 'nis_continuity',             label: 'NIS Continuity Register',        requiresRunId: true  },
    { key: 'missing_nis_number',         label: 'Missing NIS Number',             requiresRunId: true  },
    { key: 'unverified_nis',             label: 'Unverified NIS Profiles',        requiresRunId: false },
    { key: 'new_employee_nis_onboarding',label: 'New Employee NIS Onboarding',    requiresRunId: false },
    { key: 'nis_opening_balance',        label: 'NIS Opening Balance',            requiresRunId: false },
    { key: 'nis_exceptions',             label: 'Payroll NIS Exceptions',         requiresRunId: true  },
  ];
  return c.json({ success: true, data: reports });
});

export default router;
