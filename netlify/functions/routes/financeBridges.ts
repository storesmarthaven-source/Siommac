// routes/financeBridges.ts — Finance Wave 2B cross-module bridge endpoints
// Mounted at /api/finance in api.ts. POST-only, JWT-gated via requirePermission.
// Envelope: body.args ?? {}.
//
// Routes:
//   POST /finance/bridges/create-disbursement   — payroll run → disbursement (idempotent)
//   POST /finance/bridges/create-remittance     — payroll run → remittance   (idempotent)
//   POST /finance/bridges/create-reimbursement  — expense claim → payroll handoff (idempotent)
//
// Idempotency:
//   create-disbursement  — unique(payroll_run_id) on finance_disbursements
//   create-remittance    — unique(payroll_run_id, authority) on finance_remittances
//   create-reimbursement — unique(expense_claim_id) on finance_reimbursement_handoffs
//   Each returns { data: { ..., reusedExisting: bool } }
//
// Permission model (reuse-first per §0.3.6):
//   create-disbursement  → finance.disbursement.manage   (existing)
//   create-remittance    → finance.remittances.manage    (existing)
//   create-reimbursement → finance.expenses.handoff.create_reimbursement (NEW — reported)
//
// NEW key enforced here (not yet in PERMISSION_KEYS — orchestrator to catalogue):
//   finance.expenses.handoff.create_reimbursement

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  createDisbursementFromRun,
  createRemittanceFromRun,
  createReimbursementHandoff,
} from '../lib/finance/bridges';
import type { HonoVariables } from '../../../types/api';
import type { RemittanceAuthority } from '../lib/finance/remittances';

const router = new Hono<{ Variables: HonoVariables }>();

const b = (c: { get: (k: string) => unknown }) =>
  (c.get('body') as Record<string, unknown>).args ?? {};

function fail(c: { json: (o: unknown, s?: number) => Response }, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json(
    { success: false, message: er.message ?? 'Internal error' },
    (er.status ?? 500) as 200,
  );
}

// ── POST /finance/bridges/create-disbursement ─────────────────────────────────
// Create a draft disbursement from an approved payroll run, or return the
// existing one (idempotent). Returns { disbursement, reusedExisting }.
router.post('/bridges/create-disbursement', async c => {
  const v = zv(c, z.object({
    payrollRunId: z.string().uuid(),
    metadata:     z.record(z.string(), z.unknown()).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  const user = await requirePermission(c, 'finance.disbursement.manage');
  try {
    const result = await createDisbursementFromRun(v.data.payrollRunId, user.id, v.data.metadata);
    return c.json({
      success: true,
      data: {
        disbursement:  result.disbursement,
        reusedExisting: !result.created,
      },
    });
  } catch (e) { return fail(c, e); }
});

// ── POST /finance/bridges/create-remittance ───────────────────────────────────
// Create a draft remittance for a (payroll run, authority) pair, or return the
// existing one (idempotent). Returns { remittance, reusedExisting }.
router.post('/bridges/create-remittance', async c => {
  const v = zv(c, z.object({
    payrollRunId: z.string().uuid(),
    authority:    z.enum(['paye_bir', 'nis_nibtt', 'health_surcharge']),
    dueDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    metadata:     z.record(z.string(), z.unknown()).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  const user = await requirePermission(c, 'finance.remittances.manage');
  try {
    const result = await createRemittanceFromRun(
      v.data.payrollRunId,
      v.data.authority as RemittanceAuthority,
      user.id,
      v.data.dueDate ?? null,
      v.data.metadata,
    );
    return c.json({
      success: true,
      data: {
        remittance:    result.remittance,
        reusedExisting: !result.created,
      },
    });
  } catch (e) { return fail(c, e); }
});

// ── POST /finance/bridges/create-reimbursement ────────────────────────────────
// Create a cross-module handoff from an approved expense claim to Payroll for
// reimbursement processing (idempotent — one handoff per claim).
// Returns { bridgeId, handoffId, reusedExisting }.
router.post('/bridges/create-reimbursement', async c => {
  const v = zv(c, z.object({
    expenseClaimId: z.string().uuid(),
    payrollRunId:   z.string().uuid().optional().nullable(),
  }), b(c));
  if (!v.ok) return v.response;
  const user = await requirePermission(c, 'finance.expenses.handoff.create_reimbursement');
  try {
    const result = await createReimbursementHandoff(
      v.data.expenseClaimId,
      user.id,
      v.data.payrollRunId ?? null,
    );
    return c.json({
      success: true,
      data: {
        bridgeId:      result.bridgeId,
        handoffId:     result.handoffId,
        reusedExisting: !result.created,
      },
    });
  } catch (e) { return fail(c, e); }
});

export default router;
