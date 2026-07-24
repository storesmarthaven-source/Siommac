/**
 * netlify/functions/routes/hrCrew.ts
 *
 * Crew Payroll — POST-only HR crew endpoints (mount at /api/hr/crew in api.ts).
 * §14.6: hr/crew/assignments/{list,create,update,end}. Movements (record/correct) are
 * added by CP5 in this same router. Every route: requirePermission → validate body.args
 * → call lib → c.json envelope. Gated by finance.payroll.crew.* permissions (§14.8).
 *
 * Mount line for api.ts:
 *   import hrCrewRouter from './routes/hrCrew';
 *   app.route('/api/hr/crew', hrCrewRouter);
 */

import { Hono, type Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { requirePermission } from '../lib/auth';
import { z, zv }            from '../lib/validate';
import {
  extractPayrollErrorCode, PAYROLL_ERROR_FALLBACK_CODE,
  type PayrollApiErrorEnvelope,
} from '../../../types/payrollErrors';
import {
  listCrewAssignments, createCrewAssignment, updateCrewAssignment, endCrewAssignment,
} from '../lib/hr/crewAssignments';
import {
  listCrewMovements, recordCrewMovement, correctCrewMovement,
} from '../lib/hr/crewMovements';
import type { HonoVariables } from '../../../types/api';

const MOVEMENT_TYPES = ['embark', 'disembark', 'transfer', 'mobilize', 'demobilize'] as const;

const router = new Hono<{ Variables: HonoVariables }>();
type HCtx = Context<{ Variables: HonoVariables }>;
const body = (c: HCtx) => (c.get('body') as Record<string, unknown>).args ?? {};
// P0-5 typed error envelope (shared payroll contract — crew endpoints are
// finance.payroll.crew.* gated): stable dotted domain code + correlationId,
// legacy top-level message preserved. Crew libs already throw `crew.<code>: …`.
function routeErr(c: HCtx, e: unknown): Response {
  const er = e as { status?: number; message?: string; code?: string; details?: Record<string, unknown> };
  const status = er.status ?? 500;
  const message = er.message ?? 'Request failed.';
  const correlationId = randomUUID();
  const code = er.code ?? extractPayrollErrorCode(message) ?? PAYROLL_ERROR_FALLBACK_CODE;
  console.error(`[hr-crew] ${correlationId} ${status} ${code}: ${message}`);
  const envelope: PayrollApiErrorEnvelope = {
    success: false,
    message,
    error: {
      code,
      message,
      correlationId,
      retryable: status >= 500,
      ...(er.details ? { details: er.details } : {}),
    },
  };
  return c.json(envelope, status as 200);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nzStr = (max: number) => z.string().max(max).nullable().optional();
const uuidN = z.string().uuid().nullable().optional();

// ── Crew assignments (CP4) ──────────────────────────────────────────────────────

// POST /api/hr/crew/assignments/list
router.post('/assignments/list', async c => {
  await requirePermission(c, 'finance.payroll.crew.evidence.view');
  const v = zv(c, z.object({
    employeeId: z.string().optional(),
    payGroupId: z.string().uuid().optional(),
    assetId:    z.string().uuid().optional(),
    status:     z.enum(['draft', 'active', 'ended', 'cancelled']).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listCrewAssignments(v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/crew/assignments/create
router.post('/assignments/create', async c => {
  const actor = await requirePermission(c, 'finance.payroll.crew.assignments.manage');
  const v = zv(c, z.object({
    employeeId:            z.string().min(1),
    payGroupId:            z.string().uuid(),
    policyAssignmentId:    uuidN,
    role:                  nzStr(120),
    clientId:              uuidN,
    contractId:            uuidN,
    assetId:               uuidN,
    workOrderId:           uuidN,
    costCenter:            nzStr(60),
    contractRateReference: nzStr(200),
    effectiveFrom:         z.string().regex(DATE),
    effectiveTo:           z.string().regex(DATE).nullable().optional(),
    status:                z.enum(['draft', 'active']).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await createCrewAssignment(actor.id, v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/crew/assignments/update
router.post('/assignments/update', async c => {
  const actor = await requirePermission(c, 'finance.payroll.crew.assignments.manage');
  const v = zv(c, z.object({
    id:                    z.string().uuid(),
    role:                  nzStr(120),
    clientId:              uuidN,
    contractId:            uuidN,
    assetId:               uuidN,
    workOrderId:           uuidN,
    costCenter:            nzStr(60),
    contractRateReference: nzStr(200),
    effectiveFrom:         z.string().regex(DATE).optional(),
    effectiveTo:           z.string().regex(DATE).nullable().optional(),
    status:                z.enum(['draft', 'active', 'ended', 'cancelled']).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await updateCrewAssignment(actor.id, v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/crew/assignments/end
router.post('/assignments/end', async c => {
  const actor = await requirePermission(c, 'finance.payroll.crew.assignments.manage');
  const v = zv(c, z.object({
    id:          z.string().uuid(),
    effectiveTo: z.string().regex(DATE),
    reason:      z.string().max(500).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await endCrewAssignment(actor.id, v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// ── Crew movements (CP5) ────────────────────────────────────────────────────────

// POST /api/hr/crew/movements/list
router.post('/movements/list', async c => {
  await requirePermission(c, 'finance.payroll.crew.evidence.view');
  const v = zv(c, z.object({
    employeeId:      z.string().optional(),
    assetId:         z.string().uuid().optional(),
    movementType:    z.enum(MOVEMENT_TYPES).optional(),
    correctionsOnly: z.boolean().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listCrewMovements(v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/crew/movements/record  (idempotent by sourceSystem+sourceReference)
router.post('/movements/record', async c => {
  const actor = await requirePermission(c, 'finance.payroll.crew.movements.record');
  const v = zv(c, z.object({
    employeeId:          z.string().min(1),
    movementType:        z.enum(MOVEMENT_TYPES),
    occurredAt:          z.string().min(1),
    operationalTimezone: z.string().max(60).optional(),
    assetId:             uuidN,
    sourceSystem:        z.string().max(60).optional(),
    sourceReference:     z.string().min(1).max(200),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await recordCrewMovement(actor.id, v.data) }); }
  catch (e) { return routeErr(c, e); }
});

// POST /api/hr/crew/movements/correct  (new record; never overwrites the original)
router.post('/movements/correct', async c => {
  const actor = await requirePermission(c, 'finance.payroll.crew.movements.correct');
  const v = zv(c, z.object({
    correctsMovementId:  z.string().uuid(),
    reason:              z.string().min(1).max(500),
    movementType:        z.enum(MOVEMENT_TYPES).optional(),
    occurredAt:          z.string().min(1).optional(),
    operationalTimezone: z.string().max(60).optional(),
    assetId:             uuidN,
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await correctCrewMovement(actor.id, v.data) }); }
  catch (e) { return routeErr(c, e); }
});

export default router;
