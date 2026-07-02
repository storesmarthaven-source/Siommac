// routes/hrOffboarding.ts — HR Offboarding (the exit bookend).
//
// Start an offboarding case from the standard exit plan → tasks + cross-module
// handoff intents; complete tasks; pause/resume/cancel/complete; reassign owner;
// mark ready-for-exit; FINALIZE (terminate employee + IT access-removal handoff).
// POST-only; gated by hr.offboarding.*; envelope {success,data}; body.args.

import { Hono, type Context } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv }             from '../lib/validate';
import { startOffboardingCase } from '../lib/hr/offboardingCore';
import { listOffboardingCases, getOffboardingCase, getOffboardingDashboardStats } from '../lib/hr/offboardingQueries';
import {
  completeOffboardingTask, pauseOffboardingCase, resumeOffboardingCase, markReadyForExit,
  cancelOffboardingCase, completeOffboardingCase, reassignOffboardingOwner, finalizeOffboarding,
} from '../lib/hr/offboardingMutations';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const body = (c: Context<{ Variables: HonoVariables }>) => (c.get('body') as Record<string, unknown>).args ?? {};
function fail(c: Context<{ Variables: HonoVariables }>, e: unknown): Response {
  const er = e as { status?: number; message?: string };
  return c.json({ success: false, message: er.message ?? 'Request failed.' }, (er.status ?? 500) as 200);
}
const REASONS = ['resignation', 'termination', 'redundancy', 'end_of_contract', 'retirement'] as const;

router.post('/offboarding/start', async c => {
  const actor = await requirePermission(c, 'hr.offboarding.start');
  const v = zv(c, z.object({
    employeeId: z.string().min(1), reason: z.enum(REASONS), ownerId: z.string().nullable().optional(),
    lastWorkingDay: z.string().nullable().optional(), noticePeriodDays: z.number().int().nullable().optional(),
    packageKey: z.string().nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await startOffboardingCase(actor.id, v.data) }); }
  catch (e) { return fail(c, e); }
});

router.post('/offboarding/list', async c => {
  await requirePermission(c, 'hr.offboarding.view');
  const v = zv(c, z.object({ status: z.string().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listOffboardingCases(v.data) }); }
  catch (e) { return fail(c, e); }
});

router.post('/offboarding/get', async c => {
  await requirePermission(c, 'hr.offboarding.view');
  const v = zv(c, z.object({ caseId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try {
    const detail = await getOffboardingCase(v.data.caseId);
    if (!detail) return c.json({ success: false, message: 'Offboarding case not found.' }, 404 as 200);
    return c.json({ success: true, data: detail });
  } catch (e) { return fail(c, e); }
});

router.post('/offboarding/dashboard-stats', async c => {
  await requirePermission(c, 'hr.offboarding.view');
  try { return c.json({ success: true, data: await getOffboardingDashboardStats() }); }
  catch (e) { return fail(c, e); }
});

router.post('/offboarding/task/complete', async c => {
  const actor = await requirePermission(c, 'hr.offboarding.task.manage');
  const v = zv(c, z.object({ taskId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await completeOffboardingTask(actor.id, v.data) }); }
  catch (e) { return fail(c, e); }
});

router.post('/offboarding/pause', async c => {
  const actor = await requirePermission(c, 'hr.offboarding.case.manage');
  const v = zv(c, z.object({ caseId: z.string().uuid(), reason: z.string().max(500).nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await pauseOffboardingCase(actor.id, v.data) }); }
  catch (e) { return fail(c, e); }
});

router.post('/offboarding/resume', async c => {
  const actor = await requirePermission(c, 'hr.offboarding.case.manage');
  const v = zv(c, z.object({ caseId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await resumeOffboardingCase(actor.id, v.data) }); }
  catch (e) { return fail(c, e); }
});

router.post('/offboarding/mark-ready', async c => {
  const actor = await requirePermission(c, 'hr.offboarding.case.manage');
  const v = zv(c, z.object({ caseId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await markReadyForExit(actor.id, v.data) }); }
  catch (e) { return fail(c, e); }
});

router.post('/offboarding/reassign-owner', async c => {
  const actor = await requirePermission(c, 'hr.offboarding.case.manage');
  const v = zv(c, z.object({ caseId: z.string().uuid(), ownerId: z.string().nullable() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await reassignOffboardingOwner(actor.id, v.data) }); }
  catch (e) { return fail(c, e); }
});

router.post('/offboarding/complete', async c => {
  const actor = await requirePermission(c, 'hr.offboarding.complete');
  const v = zv(c, z.object({ caseId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await completeOffboardingCase(actor.id, v.data) }); }
  catch (e) { return fail(c, e); }
});

router.post('/offboarding/cancel', async c => {
  const actor = await requirePermission(c, 'hr.offboarding.cancel');
  const v = zv(c, z.object({ caseId: z.string().uuid(), reason: z.string().max(500).nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await cancelOffboardingCase(actor.id, v.data) }); }
  catch (e) { return fail(c, e); }
});

router.post('/offboarding/finalize', async c => {
  const actor = await requirePermission(c, 'hr.offboarding.finalize');
  const v = zv(c, z.object({ caseId: z.string().uuid(), exitDate: z.string().nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await finalizeOffboarding(actor.id, v.data) }); }
  catch (e) { return fail(c, e); }
});

export default router;
