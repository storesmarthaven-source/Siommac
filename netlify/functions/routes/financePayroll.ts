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
  getPayrollRun,
  getRunPolicyEvidence,
  createPayrollRun,
  lockInputs,
  calculateRun,
  submitRun,
  decideRunApproval,
  lockRun,
  reopenRun,
  listRunInputs,
  listRunLines,
  listRunWarnings,
  listRunAuditLog,
  getEmployeePopulationPreview,
  getPopulationReconciliation,
  getInputSourceReadiness,
  downloadRunExport,
  notifyPayslipEmployees,
  setRunTemplate,
} from '../lib/finance/payrollRuns';
import {
  commandPayrollFinding,
  getPayrollFinding,
  listPayrollFindings,
} from '../lib/finance/payroll/findings';
import {
  getPayrollWorkQueue,
  getPayrollFindingDetail,
  commentPayrollFinding,
} from '../lib/finance/payroll/findingsWorkQueue';
import {
  compareCalculationVersions,
  getCalculationAttempt,
  getCalculationVersion,
  listCalculationAttempts,
  listCalculationVersions,
} from '../lib/finance/payroll/execution';
import {
  certifyPayrollRun,
  confirmPayrollFunding,
  getPayrollReleaseCertificate,
  getPayrollReleasePreflight,
  releasePayrollRun,
} from '../lib/finance/payroll/releases';
import { getPayrollRunWorkspace } from '../lib/finance/payroll/workspace';
import { getPayrollControlCenter } from '../lib/finance/payroll/controlCenter';
import { listPayrollRunsRegister } from '../lib/finance/payroll/runRegister';
import { listPayslipBatches } from '../lib/finance/payroll/payslipBatches';
import {
  listRunViews,
  createRunView,
  updateRunView,
  deleteRunView,
} from '../lib/finance/payroll/runViews';
import { getPayrollRunCalendar } from '../lib/finance/payroll/runCalendar';
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
  listReasonCodes,
} from '../lib/finance/payGroups';
import {
  addOverride,
  addOverridesBulk,
  removeOverride,
  listOverrides,
  BULK_OVERRIDE_MAX,
} from '../lib/finance/payrollOverrides';
import { computeBackPay, addBackPay } from '../lib/finance/backPay';
import {
  listOvertimeRules,
  createOvertimeRule,
  setOvertimeRuleActive,
} from '../lib/finance/overtimeRules';
import {
  listLoans,
  getLoan,
  createLoan,
  submitLoan,
  settleLoan,
  cancelLoan,
} from '../lib/finance/loans';
import { exportRun, listRunExports } from '../lib/finance/payrollExports';
import {
  computeInteractiveReport,
  buildReportCatalog,
  computeReportSummary,
  listReportHistory,
  logReportPreview,
  enqueueReportJob,
  isFormatEnabled,
  getReportJobStatus,
  resolveReportDownload,
} from '../lib/finance/payroll/payrollReportCatalog';
// Retained legacy engine fn for the Run Workspace population panel's per-employee
// net-variance column (NOT part of the F-12 Reports Center public contract).
import { reportVariation } from '../lib/finance/payrollReports';
import { processReportGenerationQueue } from '../lib/finance/payroll/reportGenerationWorker';
import { processReportPurgeQueue, reconcileOrphanUploadAttempts } from '../lib/finance/payroll/reportPurgeWorker';
import {
  reportParamsSchema,
  isFormatAllowed,
  deriveReportRequirements,
  fileIdempotencyKey,
  PAYROLL_REPORT_KEYS,
} from '../../../types/payrollReports';
import type { ReportFormat, InteractiveReportParams } from '../../../types/payrollReports';
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
    er.status ?? 500,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Payroll Runs
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/runs/list
// §15.2 keyset register — replaces the old status/limit/offset basic list.
// Permission: finance.payroll.view_all. Returns PayrollRunListResult.
router.post('/payroll/runs/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const v = zv(c, z.object({
    cursor:      z.string().max(2000).optional(),
    limit:       z.number().int().min(1).max(100).optional(),
    search:      z.string().trim().max(200).optional(),
    states:      z.array(z.enum([
      'draft','input_locked','calculation_failed','calculated',
      'pending_approval','returned','approved','locked','released','exported','cancelled',
    ])).optional(),
    runTypes:    z.array(z.enum(['scheduled','off_cycle','correction','final_pay'])).optional(),
    payGroupIds: z.array(z.uuid()).max(50).optional(),
    periodFrom:  z.string().regex(DATE, 'periodFrom must be YYYY-MM-DD').optional(),
    periodTo:    z.string().regex(DATE, 'periodTo must be YYYY-MM-DD').optional(),
    sort:        z.enum(['pay_date_desc','pay_date_asc','updated_desc']).optional(),
    tab:         z.enum(['all','in_progress','approval','attention','released']).optional(),
  }).refine(d => !d.periodFrom || !d.periodTo || d.periodFrom <= d.periodTo, {
    message: 'periodFrom must not be after periodTo',
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listPayrollRunsRegister(v.data);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/payslip-batches/list
// §15.5 Payslip Batches register (F-10). A batch = a locked run's payslip set (no batch entity);
// counts aggregate finance_payslips + finance_payslip_deliveries. Permission: finance.payroll.view_all.
router.post('/payroll/payslip-batches/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const v = zv(c, z.object({
    limit:       z.number().int().min(1).max(100).optional(),
    offset:      z.number().int().min(0).optional(),
    tab:         z.enum(['all','active','attention','scheduled','completed']).optional(),
    search:      z.string().trim().max(200).optional(),
    periodFrom:  z.string().regex(DATE, 'periodFrom must be YYYY-MM-DD').optional(),
    periodTo:    z.string().regex(DATE, 'periodTo must be YYYY-MM-DD').optional(),
    payGroupIds: z.array(z.uuid()).max(50).optional(),
  }).refine(d => !d.periodFrom || !d.periodTo || d.periodFrom <= d.periodTo, {
    message: 'periodFrom must not be after periodTo',
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listPayslipBatches(v.data);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/control-center/get
// Payroll Command Center projection (approved contract §4). Pure read; the SQL function aggregates
// the complete dataset server-side. Fails as a unit (no partial dashboard). Malformed/mismatched
// register cursor → 422 (surfaced via the service's decodeCursor).
router.post('/payroll/control-center/get', async c => {
  const actor = await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    window: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
      .refine(w => w.from <= w.to, { message: 'window.from must be on or before window.to' })
      .refine(w => (Date.parse(w.to) - Date.parse(w.from)) <= 366 * 86_400_000, {
        message: 'window may not exceed 366 days',
      }),
    payGroupIds: z.array(z.uuid()).max(25).optional(),
    register: z.object({
      tab:    z.enum(['all', 'attention', 'approval', 'ready', 'released']).optional(),
      search: z.string().trim().max(100).optional(),
      cursor: z.string().max(1000).optional(),
      limit:  z.number().int().min(1).max(25).optional(),
    }).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const [canManageRun, canApprove, canConfirmFunding, canRelease, canExport] = await Promise.all([
      userCan(actor, 'finance.payroll.run.manage'),
      userCan(actor, 'finance.payroll.approve'),
      userCan(actor, 'finance.payroll.funding.approve'),
      userCan(actor, 'finance.payroll.release'),
      userCan(actor, 'finance.payroll.export'),
    ]);
    const search = v.data.register?.search?.length ? v.data.register.search : null;
    const data = await getPayrollControlCenter({
      actorId:     actor.id,
      actorRole:   actor.role,
      window:      v.data.window,
      payGroupIds: [...new Set(v.data.payGroupIds ?? [])],
      register: {
        tab:    v.data.register?.tab ?? 'all',
        search,
        cursor: v.data.register?.cursor ?? null,
        limit:  v.data.register?.limit ?? 10,
      },
      capabilities: {
        canCreateRun: canManageRun,
        canManageRun,
        canApprove,
        canConfirmFunding,
        canRelease,
        canExport,
      },
    });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/get
router.post('/payroll/runs/get', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ id: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayrollRun(v.data.id);
    if (!data) return c.json({ success: false, message: 'Payroll run not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/policy-evidence  (F-02 API-PPR-005, §6d)
// Read the pinned pay-policy manifest + immutable lock evidence (source conflicts,
// excluded employees) and — for a working_days run — the resolved calendar block
// with per-employee working_days numerators. Defaults to the run's current input
// snapshot; an explicit inputSnapshotId is validated to belong to the run.
router.post('/payroll/runs/policy-evidence', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    runId:           z.uuid(),
    inputSnapshotId: z.uuid().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getRunPolicyEvidence(v.data.runId, v.data.inputSnapshotId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/create
router.post('/payroll/runs/create', async c => {
  const actor = await requirePermission(c, 'finance.payroll.run.manage');
  const v = zv(c, z.object({
    idempotencyKey: z.string().trim().min(1).max(200),
    runType:        z.enum(['scheduled', 'off_cycle', 'correction', 'final_pay']),
    periodStart:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sequenceNo:     z.number().int().positive().optional(),
    sourceRunId:    z.uuid().optional(),
    payFrequency:   z.enum(['monthly', 'weekly', 'fortnightly', 'semi_monthly']).optional(),
    weeksInPeriod:  z.number().positive().optional(),
    payGroupId:     z.uuid().optional(),
    payDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cutOffDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // Slice 1 run metadata
    reasonCode:          z.string().trim().min(1).max(64).optional(),
    payrollOwnerId:      z.string().trim().min(1).max(64).optional(),
    otCutoffAt:          z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).optional(),
    approvalDeadlineAt:  z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).optional(),
    fundingDate:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    releaseWindow:       z.string().trim().min(1).max(120).optional(),
    internalDescription: z.string().trim().max(2000).optional(),
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
  const v = zv(c, z.object({
    id: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await lockInputs(
      v.data.id,
      actor.id,
      v.data.idempotencyKey,
    );
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/calculate
router.post('/payroll/runs/calculate', async c => {
  const actor = await requirePermission(c, 'finance.payroll.run.manage');
  const v = zv(c, z.object({
    id: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await calculateRun(v.data.id, actor.id, v.data.idempotencyKey);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Run Inputs (locked snapshot)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/inputs/list
router.post('/payroll/inputs/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRunAuditLog(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — Run lifecycle: submit, lock, reopen, export
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/runs/certify
// Freezes the processor's evidence against the current calculation version.
router.post('/payroll/runs/certify', async c => {
  const actor = await requirePermission(c, 'finance.payroll.certify');
  const v = zv(c, z.object({
    runId: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
    attestations: z.object({
      populationReconciled: z.literal(true),
      inputsReviewed: z.literal(true),
      statutoryReviewed: z.literal(true),
      variancesReviewed: z.literal(true),
      paymentReadinessReviewed: z.literal(true),
      glReadinessReviewed: z.literal(true),
    }),
    note: z.string().trim().max(2000).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await certifyPayrollRun({
      ...v.data,
      actorId: actor.id,
    });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/submit
// Submits a calculated run for approval via the central workflow engine.
// Permission: finance.payroll.run.manage (finance_staff or finance_manager).
router.post('/payroll/runs/submit', async c => {
  const actor = await requirePermission(c, 'finance.payroll.run.manage');
  const v = zv(c, z.object({ id: z.uuid(), idempotencyKey: z.string().min(1).max(200) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await submitRun(v.data.id, actor.id, v.data.idempotencyKey);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/approve
// Approves a pending_approval run by DECIDING its open workflow task — the central
// workflow engine is the single approval authority (the adapter transitions the run).
// SoD enforced (actor ≠ preparer) + engine assignment rule (actor must be the assignee).
// Permission: finance.payroll.approve (finance_manager / admin only).
router.post('/payroll/runs/approve', async c => {
  const actor = await requirePermission(c, 'finance.payroll.approve');
  const v = zv(c, z.object({ id: z.uuid(), comment: z.string().max(2000).optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await decideRunApproval({ runId: v.data.id, actor: { id: actor.id, role: actor.role }, decision: 'approved', comment: v.data.comment });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/reject
// Rejects a pending_approval run by deciding its open workflow task; the adapter
// returns the run to 'returned' for the preparer to revise + resubmit.
// A mandatory reason is required; the engine notifies the submitter.
// Permission: finance.payroll.approve (same authority as approve).
router.post('/payroll/runs/reject', async c => {
  const actor = await requirePermission(c, 'finance.payroll.approve');
  const v = zv(c, z.object({
    id:     z.uuid(),
    reason: z.string().min(1, 'Reason is required').max(500),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await decideRunApproval({ runId: v.data.id, actor: { id: actor.id, role: actor.role }, decision: 'rejected', comment: v.data.reason });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/lock
// Locks an approved run so that payslips can be generated.
// Permission: finance.payroll.lock (finance_manager / admin only — SoD).
router.post('/payroll/runs/lock', async c => {
  const actor = await requirePermission(c, 'finance.payroll.lock');
  const v = zv(c, z.object({
    id: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await lockRun(v.data.id, actor.id, v.data.idempotencyKey);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/releases/preflight
// Returns authoritative release blockers for the current locked run version.
router.post('/payroll/releases/preflight', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayrollReleasePreflight(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/releases/confirm-funding
// Records immutable funding evidence. The confirmer must also perform release.
router.post('/payroll/releases/confirm-funding', async c => {
  const actor = await requirePermission(c, 'finance.payroll.funding.approve');
  const v = zv(c, z.object({
    runId: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
    confirmedAmount: z.number().nonnegative(),
    confirmationReference: z.string().trim().min(1).max(200),
    accountReference: z.string().trim().min(1).max(100).optional(),
    note: z.string().trim().max(2000).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await confirmPayrollFunding({
      ...v.data,
      actorId: actor.id,
    });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/releases/release
// Atomically creates the release certificate and downstream payment/remittance drafts.
router.post('/payroll/releases/release', async c => {
  const actor = await requirePermission(c, 'finance.payroll.release');
  const v = zv(c, z.object({
    runId: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await releasePayrollRun({
      ...v.data,
      actorId: actor.id,
    });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/releases/get-certificate
router.post('/payroll/releases/get-certificate', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayrollReleaseCertificate(v.data.runId);
    if (!data) {
      return c.json(
        { success: false, message: 'Payroll release certificate not found.' },
        404 as 200,
      );
    }
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
    id: z.uuid(),
    reason: z.string().trim().min(1, 'Reason is required'),
    idempotencyKey: z.string().trim().min(1).max(200),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await reopenRun(v.data.id, actor.id, v.data.reason, v.data.idempotencyKey);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/set-template
// Assign (or clear) the Payslip Studio template a run will use for rendering.
// templateId null clears the override and reverts to the active default template.
// Permission: finance.payroll.run.manage.
router.post('/payroll/runs/set-template', async c => {
  const actor = await requirePermission(c, 'finance.payroll.run.manage');
  const v = zv(c, z.object({
    runId:      z.uuid(),
    templateId: z.uuid().nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await setRunTemplate(v.data.runId, v.data.templateId ?? null, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/export
// Exports a released run as an immutable artifact. Re-export adds a new version.
// Permission: finance.payroll.export.
router.post('/payroll/runs/export', async c => {
  const actor = await requirePermission(c, 'finance.payroll.export');
  const v = zv(c, z.object({
    id: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
    format: z.enum(['csv', 'json']).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await exportRun(
      v.data.id,
      actor.id,
      v.data.idempotencyKey,
      v.data.format ?? 'csv',
    );
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Exports list
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/exports/list
router.post('/payroll/exports/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ payslipId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ payslipId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listRunDeliveries(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ── Overtime rules (Wave 4b) ─────────────────────────────────────────────────

// POST /api/finance/payroll/overtime-rules/list  — Finance.
router.post('/payroll/overtime-rules/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  try {
    const data = await listOvertimeRules();
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/overtime-rules/create  — Permission: overtime.rules.manage.
router.post('/payroll/overtime-rules/create', async c => {
  const actor = await requirePermission(c, 'finance.payroll.overtime.rules.manage');
  const v = zv(c, z.object({
    code: z.string().min(1).max(20),
    eventType: z.enum(['regular_overtime', 'public_holiday', 'rest_day', 'callout', 'night_shift']),
    multiplier: z.number().positive(),
    minimumHours: z.number().positive().nullable().optional(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await createOvertimeRule(v.data, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/overtime-rules/set-active
router.post('/payroll/overtime-rules/set-active', async c => {
  const actor = await requirePermission(c, 'finance.payroll.overtime.rules.manage');
  const v = zv(c, z.object({ id: z.uuid(), active: z.boolean() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await setOvertimeRuleActive(v.data.id, v.data.active, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ── Employee loans & salary advances (Wave 5) ────────────────────────────────

// POST /api/finance/payroll/loans/list  — Finance.
router.post('/payroll/loans/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ employeeId: z.string().optional(), status: z.string().optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listLoans(v.data);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/loans/get
router.post('/payroll/loans/get', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ id: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getLoan(v.data.id);
    if (!data) return c.json({ success: false, message: 'Loan not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/loans/create  — draft. Permission: loans.manage.
router.post('/payroll/loans/create', async c => {
  const actor = await requirePermission(c, 'finance.payroll.loans.manage');
  const v = zv(c, z.object({
    employeeId:        z.string().min(1),
    loanType:          z.enum(['loan', 'advance']),
    principal:         z.number().positive(),
    interestAmount:    z.number().nonnegative().optional(),
    installmentAmount: z.number().positive(),
    startPeriod:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    reason:            z.string().max(500).nullable().optional(),
    notes:             z.string().max(1000).nullable().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await createLoan(v.data, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/loans/submit  — draft/rejected → pending_approval (workflow).
router.post('/payroll/loans/submit', async c => {
  const actor = await requirePermission(c, 'finance.payroll.loans.manage');
  const v = zv(c, z.object({ id: z.uuid(), idempotencyKey: z.string().min(1).max(200) }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await submitLoan(v.data.id, actor.id, v.data.idempotencyKey);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/loans/settle  — early settlement (active → settled).
router.post('/payroll/loans/settle', async c => {
  const actor = await requirePermission(c, 'finance.payroll.loans.manage');
  const v = zv(c, z.object({ id: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await settleLoan(v.data.id, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/loans/cancel
router.post('/payroll/loans/cancel', async c => {
  const actor = await requirePermission(c, 'finance.payroll.loans.manage');
  const v = zv(c, z.object({ id: z.uuid(), reason: z.string().max(500).optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await cancelLoan(v.data.id, actor.id, v.data.reason);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ── Worksheet overrides (Wave 4a) ────────────────────────────────────────────

// POST /api/finance/payroll/overrides/add  — add a per-employee run override.
// Permission: finance.payroll.worksheet.override.
router.post('/payroll/overrides/add', async c => {
  const actor = await requirePermission(c, 'finance.payroll.worksheet.override');
  const v = zv(c, z.object({
    runId: z.uuid(),
    employeeId: z.string().min(1),
    label: z.string().min(1).max(80),
    amount: z.number().positive(),
    kind: z.enum(['earning', 'deduction']),
    isTaxable: z.boolean().optional(),
    reducesChargeable: z.boolean().optional(),
    reason: z.string().min(1).max(500),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await addOverride(v.data, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/back-pay/preview  — recompute the retro delta (read-only).
// Permission: finance.payroll.worksheet.override.
router.post('/payroll/back-pay/preview', async c => {
  await requirePermission(c, 'finance.payroll.worksheet.override');
  const v = zv(c, z.object({
    currentRunId: z.uuid(),
    employeeId: z.string().min(1),
    fromPeriodMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    correctedPeriodBase: z.number().positive(),
    // When the salary correction became effective (YYYY-MM-DD).
    // Defaults to fromPeriodMonth when omitted (backward-compatible).
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await computeBackPay(v.data);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/back-pay/add  — add the retro delta as a taxable earning.
// Permission: finance.payroll.worksheet.override.
router.post('/payroll/back-pay/add', async c => {
  const actor = await requirePermission(c, 'finance.payroll.worksheet.override');
  const v = zv(c, z.object({
    currentRunId: z.uuid(),
    employeeId: z.string().min(1),
    fromPeriodMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    correctedPeriodBase: z.number().positive(),
    reason: z.string().min(1).max(500),
    // When the salary correction became effective (YYYY-MM-DD).
    // Defaults to fromPeriodMonth when omitted (backward-compatible).
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await addBackPay(v.data, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/overrides/add-bulk  — mass-edit: one adjustment → many employees.
// Permission: finance.payroll.worksheet.override.
router.post('/payroll/overrides/add-bulk', async c => {
  const actor = await requirePermission(c, 'finance.payroll.worksheet.override');
  const v = zv(c, z.object({
    runId: z.uuid(),
    employeeIds: z.array(z.string().min(1)).min(1).max(BULK_OVERRIDE_MAX),
    label: z.string().min(1).max(80),
    amount: z.number().positive(),
    kind: z.enum(['earning', 'deduction']),
    isTaxable: z.boolean().optional(),
    reducesChargeable: z.boolean().optional(),
    reason: z.string().min(1).max(500),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await addOverridesBulk(v.data, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/overrides/remove
router.post('/payroll/overrides/remove', async c => {
  const actor = await requirePermission(c, 'finance.payroll.worksheet.override');
  const v = zv(c, z.object({ overrideId: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await removeOverride(v.data.overrideId, actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/overrides/list  — Finance.
router.post('/payroll/overrides/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listOverrides(v.data.runId);
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

// POST /api/finance/payroll/reason-codes/list — Finance (New Run wizard, Slice 1).
router.post('/payroll/reason-codes/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runType: z.enum(['scheduled', 'off_cycle', 'correction', 'final_pay']).optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listReasonCodes(v.data.runType);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/pay-groups/get
router.post('/payroll/pay-groups/get', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ id: z.uuid() }), b(c));
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
    payGroupId: z.uuid(),
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
  const v = zv(c, z.object({ payGroupId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({
    runId: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await postRunGl(
      v.data.runId,
      actor.id,
      v.data.idempotencyKey,
    );
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/gl/reverse
// Reverse the run's posted journal (creates a mirror reversing journal) with a reason.
// Permission: finance.payroll.gl.post.
router.post('/payroll/gl/reverse', async c => {
  const actor = await requirePermission(c, 'finance.payroll.gl.post');
  const v = zv(c, z.object({
    runId: z.uuid(),
    reason: z.string().min(1),
    idempotencyKey: z.string().trim().min(1).max(200),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await reverseRunGl(
      v.data.runId,
      actor.id,
      v.data.reason,
      v.data.idempotencyKey,
    );
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/gl/get
// Fetch the posted journal (header + lines) for a run, or null if unposted.
router.post('/payroll/gl/get', async c => {
  await requirePermission(c, 'finance.payroll.gl.preview');
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ id: z.uuid() }), b(c));
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
  const v = zv(c, z.object({ id: z.uuid() }), b(c));
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
// Payroll Reports Center (F-12) routes are defined together near the end of this
// file (reports/catalog, reports/summary, reports/run, reports/history/list). The
// legacy reports/run + reports/list contract was removed at the F-12 cutover.

// POST /api/finance/payroll/runs/variation — per-employee net variance vs the
// prior run, for the Run Workspace population panel. Reuses the retained
// reportVariation engine fn; this is workspace data, not a Reports Center report.
router.post('/payroll/runs/variation', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await reportVariation(v.data.runId);
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
router.post('/payroll/findings/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    runId: z.uuid(),
    calculationVersionId: z.uuid().optional(),
    state: z.enum(['open', 'in_progress', 'resolved', 'waived']).optional(),
    severity: z.enum(['info', 'warning', 'blocker']).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listPayrollFindings(v.data);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

router.post('/payroll/runs/workspace', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ id: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayrollRunWorkspace(v.data.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

router.post('/payroll/calculations/attempts/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    runId: z.uuid(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listCalculationAttempts(v.data);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

router.post('/payroll/calculations/attempts/get', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ id: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getCalculationAttempt(v.data.id);
    if (!data) {
      return c.json({ success: false, message: 'Payroll calculation attempt not found.' }, 404 as 200);
    }
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

router.post('/payroll/calculations/versions/list', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ runId: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listCalculationVersions(v.data.runId);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

router.post('/payroll/calculations/versions/get', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ id: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getCalculationVersion(v.data.id);
    if (!data) {
      return c.json({ success: false, message: 'Payroll calculation version not found.' }, 404 as 200);
    }
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

router.post('/payroll/calculations/compare', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    fromVersionId: z.uuid(),
    toVersionId: z.uuid(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await compareCalculationVersions(
      v.data.fromVersionId,
      v.data.toVersionId,
    );
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

router.post('/payroll/findings/get', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ id: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayrollFinding(v.data.id);
    if (!data) {
      return c.json({ success: false, message: 'Payroll finding not found.' }, 404 as 200);
    }
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

router.post('/payroll/findings/assign', async c => {
  const actor = await requirePermission(c, 'finance.payroll.finding.assign');
  const v = zv(c, z.object({
    id: z.uuid(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(200),
    assigneeId: z.string().min(1).max(200),
    note: z.string().trim().max(1000).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await commandPayrollFinding({
      findingId: v.data.id,
      actorId: actor.id,
      expectedVersion: v.data.expectedVersion,
      command: 'assign',
      idempotencyKey: v.data.idempotencyKey,
      assigneeId: v.data.assigneeId,
      note: v.data.note,
    });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

router.post('/payroll/findings/resolve', async c => {
  const actor = await requirePermission(c, 'finance.payroll.finding.resolve');
  const v = zv(c, z.object({
    id: z.uuid(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(200),
    note: z.string().trim().min(1).max(2000),
    evidence: z.record(z.string(), z.unknown()),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await commandPayrollFinding({
      findingId: v.data.id,
      actorId: actor.id,
      expectedVersion: v.data.expectedVersion,
      command: 'resolve',
      idempotencyKey: v.data.idempotencyKey,
      note: v.data.note,
      evidence: v.data.evidence,
    });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

router.post('/payroll/findings/waive', async c => {
  const actor = await requirePermission(c, 'finance.payroll.finding.waive');
  const v = zv(c, z.object({
    id: z.uuid(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(2000),
    expiresAt: z.iso.datetime().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await commandPayrollFinding({
      findingId: v.data.id,
      actorId: actor.id,
      expectedVersion: v.data.expectedVersion,
      command: 'waive',
      idempotencyKey: v.data.idempotencyKey,
      note: v.data.reason,
      waiverExpiresAt: v.data.expiresAt,
    });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

router.post('/payroll/findings/reopen', async c => {
  const actor = await requirePermission(c, 'finance.payroll.finding.reopen');
  const v = zv(c, z.object({
    id: z.uuid(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(2000),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await commandPayrollFinding({
      findingId: v.data.id,
      actorId: actor.id,
      expectedVersion: v.data.expectedVersion,
      command: 'reopen',
      idempotencyKey: v.data.idempotencyKey,
      note: v.data.reason,
    });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Exceptions & Approvals work-queue (spec §15.3)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/findings/work-queue — combined findings + approval-task
// stream (strict DB keyset union). Read-only; view_all.
router.post('/payroll/findings/work-queue', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    cursor:        z.string().max(200).optional(),
    limit:         z.number().int().min(1).max(100).default(25),
    tab:           z.enum(['all', 'approvals', 'blockers', 'warnings', 'resolved']).optional(),
    kinds:         z.array(z.enum(['approval', 'blocker', 'warning'])).optional(),
    severities:    z.array(z.enum(['critical', 'high', 'medium', 'low'])).optional(),
    states:        z.array(z.enum(['open', 'in_progress', 'resolved', 'waived'])).optional(),
    runIds:        z.array(z.uuid()).optional(),
    ownerId:       z.string().max(200).optional(),
    search:        z.string().trim().max(200).optional(),
    selectedId:    z.string().max(220).optional(),
    activityCursor: z.string().max(200).optional(),
    activityLimit: z.number().int().min(1).max(100).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayrollWorkQueue(v.data);
    // Hydrate the optional selected detail — findings only; approval "task:" rows
    // deep-link to the workflow decision path and carry no finding detail here.
    if (v.data.selectedId && !v.data.selectedId.startsWith('task:')) {
      data.selected = await getPayrollFindingDetail(v.data.selectedId, {
        cursor: v.data.activityCursor,
        limit: v.data.activityLimit,
      });
    }
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/findings/detail — one finding + its activity feed.
// NEW route (does not change the existing findings/get contract). view_all.
router.post('/payroll/findings/detail', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    findingId:     z.uuid(),
    activityCursor: z.string().max(200).optional(),
    activityLimit: z.number().int().min(1).max(100).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayrollFindingDetail(v.data.findingId, {
      cursor: v.data.activityCursor,
      limit: v.data.activityLimit,
    });
    if (!data) return c.json({ success: false, message: 'Payroll finding not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/findings/escalate — reassign/escalate ownership (v1: no
// severity change). Reuses finance.payroll.finding.assign (DEC-EXC-007).
router.post('/payroll/findings/escalate', async c => {
  const actor = await requirePermission(c, 'finance.payroll.finding.assign');
  const v = zv(c, z.object({
    findingId:       z.uuid(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey:  z.string().trim().min(1).max(200),
    assigneeId:      z.string().min(1).max(200),
    note:            z.string().trim().max(1000).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await commandPayrollFinding({
      findingId: v.data.findingId,
      actorId: actor.id,
      expectedVersion: v.data.expectedVersion,
      command: 'escalate',
      idempotencyKey: v.data.idempotencyKey,
      assigneeId: v.data.assigneeId,
      note: v.data.note,
    });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/findings/comment — append-only annotation (no state
// change, allowed on submitted runs). view_all (DEC-EXC-007).
router.post('/payroll/findings/comment', async c => {
  const actor = await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    findingId:       z.uuid(),
    idempotencyKey:  z.string().trim().min(1).max(200),
    body:            z.string().trim().min(1).max(4000),
    expectedVersion: z.number().int().positive().optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await commentPayrollFinding({
      findingId: v.data.findingId,
      actorId: actor.id,
      idempotencyKey: v.data.idempotencyKey,
      body: v.data.body,
    });
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

// POST /api/finance/payroll/runs/population-reconciliation
// Pay-group-scoped, read-only reconciliation for wizard step 5: per-rule
// population breakdown + department distribution + diff vs the last released run.
router.post('/payroll/runs/population-reconciliation', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const v = zv(c, z.object({
    payGroupId:  z.uuid(),
    periodStart: z.string().regex(DATE, 'periodStart must be YYYY-MM-DD'),
    periodEnd:   z.string().regex(DATE, 'periodEnd must be YYYY-MM-DD'),
  }).refine(d => d.periodStart <= d.periodEnd, {
    message: 'periodStart must not be after periodEnd', path: ['periodEnd'],
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPopulationReconciliation(v.data.payGroupId, v.data.periodStart, v.data.periodEnd);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/runs/input-readiness
// Pay-group-scoped, read-only pre-lock readiness across the six input sources
// (base comp, overtime, timesheets, leave, loans, one-time adjustments).
router.post('/payroll/runs/input-readiness', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const v = zv(c, z.object({
    payGroupId:  z.uuid(),
    periodStart: z.string().regex(DATE, 'periodStart must be YYYY-MM-DD'),
    periodEnd:   z.string().regex(DATE, 'periodEnd must be YYYY-MM-DD'),
  }).refine(d => d.periodStart <= d.periodEnd, {
    message: 'periodStart must not be after periodEnd', path: ['periodEnd'],
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getInputSourceReadiness(v.data.payGroupId, v.data.periodStart, v.data.periodEnd);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Export download
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/exports/download
// Return the immutable artifact and atomically record the download.
router.post('/payroll/exports/download', async c => {
  const actor = await requirePermission(c, 'finance.payroll.export');
  const v = zv(c, z.object({
    exportId: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await downloadRunExport(
      v.data.exportId,
      actor.id,
      v.data.idempotencyKey,
    );
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Payroll Run — Saved Views (§15.2)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/run-views/list
// Returns the caller's personal views + all team-scope views.
router.post('/payroll/run-views/list', async c => {
  const actor = await requirePermission(c, 'finance.payroll.view_all');
  try {
    const data = await listRunViews(actor.id);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/run-views/create
// Personal scope: any view_all holder. Team scope: also requires run_views.manage_team.
router.post('/payroll/run-views/create', async c => {
  const actor = await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    name:    z.string().trim().min(1).max(80),
    scope:   z.enum(['personal', 'team']),
    filters: z.record(z.string(), z.unknown()).optional().default({}),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const canManageTeam = await userCan(actor, 'finance.payroll.run_views.manage_team');
    const data = await createRunView(v.data, actor.id, canManageTeam);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/run-views/update
// Owner, or team-manage for team views.
router.post('/payroll/run-views/update', async c => {
  const actor = await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({
    id:      z.uuid(),
    name:    z.string().trim().min(1).max(80).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const canManageTeam = await userCan(actor, 'finance.payroll.run_views.manage_team');
    const data = await updateRunView(v.data, actor.id, canManageTeam);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/run-views/delete
// Owner, or team-manage for team views.
router.post('/payroll/run-views/delete', async c => {
  const actor = await requirePermission(c, 'finance.payroll.view_all');
  const v = zv(c, z.object({ id: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const canManageTeam = await userCan(actor, 'finance.payroll.run_views.manage_team');
    await deleteRunView(v.data.id, actor.id, canManageTeam);
    return c.json({ success: true });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Payroll Run Calendar (§15.2)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/finance/payroll/runs/calendar
// Derives scheduled instances from pay-group schedules; links existing runs.
// Window capped at 186 days (400 if wider).
router.post('/payroll/runs/calendar', async c => {
  await requirePermission(c, 'finance.payroll.view_all');
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const v = zv(c, z.object({
    from:        z.string().regex(DATE, 'from must be YYYY-MM-DD'),
    to:          z.string().regex(DATE, 'to must be YYYY-MM-DD'),
    payGroupIds: z.array(z.uuid()).max(50).optional(),
  }).refine(d => d.from <= d.to, { message: 'from must not be after to' }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getPayrollRunCalendar(v.data);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Payroll Reports Center (F-12, Phase A) — server-owned 9-key catalog
// ─────────────────────────────────────────────────────────────────────────────
// Permissions reused: finance.payroll.reports.view (base) + .reports.export +
// .view_all (additive, server-derived per report/format). Slice 2 ships preview;
// file exports (worker + status/download) arrive in Slice 3.

const reportCaller = (actor: Parameters<typeof userCan>[0]) =>
  Promise.all([
    userCan(actor, 'finance.payroll.view_all'),
    userCan(actor, 'finance.payroll.reports.export'),
  ]).then(([canViewAll, canExport]) => ({ canViewAll, canExport }));

// POST /api/finance/payroll/reports/catalog — runnable reports for this caller.
router.post('/payroll/reports/catalog', async c => {
  const actor = await requirePermission(c, 'finance.payroll.reports.view');
  try {
    const reports = buildReportCatalog(await reportCaller(actor));
    return c.json({ success: true, data: { reports } });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/reports/summary — 5 KPI tiles (redacted per §4A).
router.post('/payroll/reports/summary', async c => {
  const actor = await requirePermission(c, 'finance.payroll.reports.view');
  try {
    const data = await computeReportSummary(await reportCaller(actor));
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/reports/run — preview (inline compute) OR enqueue a
// file export (xlsx/csv/pdf). The audit-package ZIP stays gated (Slice 4 / jszip).
router.post('/payroll/reports/run', async c => {
  const actor = await requirePermission(c, 'finance.payroll.reports.view');
  const body = b(c) as Record<string, unknown>;

  const parsed = reportParamsSchema.safeParse(body['params']);
  if (!parsed.success) {
    return c.json({ success: false, error: 'invalid_params', detail: parsed.error.issues }, 400);
  }
  const params = parsed.data;
  const format = body['format'];
  // Frozen format matrix (§5A) — reject before any effect (no job/event/audit/storage).
  if (typeof format !== 'string' || !isFormatAllowed(params.report, format as ReportFormat)) {
    return c.json({ success: false, error: 'invalid_format' }, 400);
  }
  const fmt = format as ReportFormat;
  if (!isFormatEnabled(fmt)) {
    return c.json({ success: false, error: 'file_export_unavailable', message: 'This export format is not yet available.' }, 400);
  }

  // Server-derived additive gates (§5C) — the client never supplies requires_*.
  const reqs = deriveReportRequirements(params.report, fmt);
  if (reqs.requiresViewAll && !(await userCan(actor, 'finance.payroll.view_all'))) {
    return c.json({ success: false, error: 'forbidden' }, 403);
  }
  if (reqs.requiresExport && !(await userCan(actor, 'finance.payroll.reports.export'))) {
    return c.json({ success: false, error: 'forbidden' }, 403);
  }

  try {
    if (fmt === 'preview') {
      if (body['idempotencyKey'] !== undefined) {
        return c.json({ success: false, error: 'invalid_params', message: 'idempotencyKey is not allowed for a preview.' }, 400);
      }
      const data = await computeInteractiveReport(params as InteractiveReportParams);
      await logReportPreview(actor.id, params as InteractiveReportParams, data.scopeId);
      return c.json({ success: true, data });
    }
    // File export — a non-blank idempotency key is required (8..128).
    const keyParse = fileIdempotencyKey.safeParse(body['idempotencyKey']);
    if (!keyParse.success) {
      return c.json({ success: false, error: 'invalid_params', message: 'A non-blank idempotencyKey (8..128 chars) is required for a file export.' }, 400);
    }
    const data = await enqueueReportJob({ actorId: actor.id, params, format: fmt, idempotencyKey: keyParse.data });
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/reports/history/list — artifact register (keyset).
// Rows are filtered by every additive requirement the caller lacks (§5C).
router.post('/payroll/reports/history/list', async c => {
  const actor = await requirePermission(c, 'finance.payroll.reports.view');
  const v = zv(c, z.object({
    cursor:    z.string().max(500).optional(),
    limit:     z.number().int().min(1).max(100).optional(),
    reportKey: z.enum(PAYROLL_REPORT_KEYS).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await listReportHistory(await reportCaller(actor), v.data);
    return c.json({ success: true, data });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/reports/status — read-only job status (state union).
// Returns a job only to (owner OR reports.export reviewer) holding every stored
// requirement; any other case is 404 (no existence leak).
router.post('/payroll/reports/status', async c => {
  const actor = await requirePermission(c, 'finance.payroll.reports.view');
  const v = zv(c, z.object({ jobId: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const { canViewAll, canExport } = await reportCaller(actor);
    const status = await getReportJobStatus({ jobId: v.data.jobId, actorId: actor.id, canViewAll, canExport });
    if (!status) return c.json({ success: false, error: 'not_found' }, 404);
    return c.json({ success: true, data: status });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/reports/artifacts/download — fresh 120-second signed
// URL for a committed artifact. Enforces the additive gates after the lookup
// (403), denies purging/purged/retention-expired artifacts (410), writes the
// download audit, and never caches the URL (re-issued per action). §6A.
router.post('/payroll/reports/artifacts/download', async c => {
  const actor = await requirePermission(c, 'finance.payroll.reports.view');
  const v = zv(c, z.object({ artifactId: z.uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const { canViewAll, canExport } = await reportCaller(actor);
    const out = await resolveReportDownload({ artifactId: v.data.artifactId, actorId: actor.id, canViewAll, canExport });
    if (!out.ok) {
      const error = out.status === 404 ? 'not_found' : out.status === 410 ? 'gone' : 'forbidden';
      return c.json({ success: false, error }, out.status);
    }
    return c.json({ success: true, data: { url: out.url, expiresAt: out.expiresAt } });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/reports/generation/run — manual flush of the report
// generation queue (the same processor the scheduled worker runs). Gated to
// reports.maintain (system operators only) — a plain exporter must NOT drive the
// global worker; useful for ops + drives the worker in E2E.
router.post('/payroll/reports/generation/run', async c => {
  await requirePermission(c, 'finance.payroll.reports.maintain');
  const v = zv(c, z.object({ limit: z.number().int().min(1).max(50).optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const summary = await processReportGenerationQueue('manual', v.data.limit ?? 10);
    return c.json({ success: true, data: summary });
  } catch (e) { return routeErr(c, e); }
});

// POST /api/finance/payroll/reports/purge/run — manual flush of the retention
// purge saga + orphan-attempt reconciler (the same processors the scheduled purge
// worker runs). Gated to reports.maintain (system operators only) — retention
// cleanup is not an exporter capability; useful for ops + drives the worker in E2E.
router.post('/payroll/reports/purge/run', async c => {
  await requirePermission(c, 'finance.payroll.reports.maintain');
  const v = zv(c, z.object({ limit: z.number().int().min(1).max(100).optional() }), b(c));
  if (!v.ok) return v.response;
  try {
    const purge = await processReportPurgeQueue('manual', v.data.limit ?? 20);
    const reconcile = await reconcileOrphanUploadAttempts('manual', v.data.limit ?? 50);
    return c.json({ success: true, data: { purge, reconcile } });
  } catch (e) { return routeErr(c, e); }
});

export default router;
