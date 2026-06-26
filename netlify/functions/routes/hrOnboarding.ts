// routes/hrOnboarding.ts — HR Employee Master onboarding (v36 §10).
//
// Start an onboarding case from a package → instantiates tasks (by owning role) +
// cross-module handoff intents; complete/reassign tasks; cancel; get. Backend-only
// (service-role); gated by hr.onboarding.*. Handoff DELIVERY to HSE/Training/Payroll
// is recorded as 'pending' (those receivers are a later phase) — NOT faked.

import { Hono }       from 'hono';
import { sb }         from '../lib/db';
import { requirePermission, requireUser, userCan } from '../lib/auth';
import { emitAppEvent } from '../lib/appEvents';
import { z, zv }      from '../lib/validate';
import { writeHrAudit } from '../lib/hr/employeeCore';
import { startOnboardingCase } from '../lib/hr/onboardingCore';
import { ONBOARDING_PACKAGES, ONBOARDING_PACKAGE_KEYS } from '../lib/hr/onboardingPackages';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const body = (c: { get: (k: string) => unknown }) => (c.get('body') as Record<string, unknown>).args ?? {};

// ── 1. preview-package ────────────────────────────────────────────────────────
router.post('/onboarding/preview-package', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, z.object({ packageKey: z.enum(ONBOARDING_PACKAGE_KEYS) }), body(c));
  if (!v.ok) return v.response;
  const pkg = ONBOARDING_PACKAGES[v.data.packageKey];
  if (!pkg) return c.json({ success: false, message: 'Unknown package.' }, 404 as 200);
  return c.json({ success: true, data: { package: pkg.key, label: pkg.label, tasks: pkg.tasks, handoffs: pkg.handoffs, taskCount: pkg.tasks.length } });
});

// ── 2. start ──────────────────────────────────────────────────────────────────
router.post('/onboarding/start', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.start');
  const v = zv(c, z.object({
    employeeId: z.string().min(1),
    packageKey: z.enum(ONBOARDING_PACKAGE_KEYS),
    ownerId:    z.string().nullable().optional(),
    dueAt:      z.string().nullable().optional(),
    reason:          z.string().max(60).nullable().optional(),
    priority:        z.string().max(30).nullable().optional(),
    targetStartDate: z.string().max(20).nullable().optional(),
    launchMode:      z.string().max(30).nullable().optional(),
    caseOwner:       z.string().max(80).nullable().optional(),
    workerType:      z.string().max(30).nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;

  try {
    const r = await startOnboardingCase(actor.id, v.data);
    return c.json({ success: true, data: { caseId: r.caseId, caseNo: r.caseNo, status: 'in_progress', taskCount: r.taskCount, handoffCount: r.handoffCount } });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return c.json({ success: false, message: err.message ?? 'Onboarding start failed.' }, (err.status ?? 500) as 200);
  }
});

// ── 3. task/complete ──────────────────────────────────────────────────────────
router.post('/onboarding/task/complete', async c => {
  const actor = await requireUser(c);
  const v = zv(c, z.object({ taskId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;

  const { data: task } = await sb.from('hr_onboarding_tasks').select('id, case_id, assigned_to, status, task_key').eq('id', v.data.taskId).maybeSingle<{ id: string; case_id: string; assigned_to: string | null; status: string; task_key: string }>();
  if (!task) return c.json({ success: false, message: 'Onboarding task not found.' }, 404 as 200);
  // The assigned user may complete their own task; otherwise the manage permission is required.
  if (task.assigned_to !== actor.id && !(await userCan(actor, 'hr.onboarding.task.manage'))) {
    return c.json({ success: false, message: 'You are not assigned this task and lack the manage permission.' }, 403 as 200);
  }
  if (['completed', 'skipped'].includes(task.status)) return c.json({ success: false, message: `Task already ${task.status}.` }, 400 as 200);

  await sb.from('hr_onboarding_tasks').update({ status: 'completed', completed_by: actor.id, completed_at: new Date().toISOString() }).eq('id', task.id);

  // Auto-complete the case when no open (non-completed/skipped) tasks remain.
  const { count: openCount } = await sb.from('hr_onboarding_tasks').select('id', { count: 'exact', head: true })
    .eq('case_id', task.case_id).not('status', 'in', '("completed","skipped")');
  let caseCompleted = false;
  if ((openCount ?? 0) === 0) {
    await sb.from('hr_onboarding_cases').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', task.case_id);
    caseCompleted = true;
    const { data: kase } = await sb.from('hr_onboarding_cases').select('employee_id, case_no').eq('id', task.case_id).maybeSingle<{ employee_id: string | null; case_no: string }>();
    void emitAppEvent({ eventType: 'onboarding.completed', sourceModule: 'hr', sourceEntityType: 'onboarding_case',
      sourceEntityId: task.case_id, actorUserId: actor.id, severity: 'info', payload: { employeeId: kase?.employee_id, caseNo: kase?.case_no } });
  }
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: task.case_id, actorId: actor.id, action: 'hr.onboarding.task_completed', newState: { taskKey: task.task_key, caseCompleted } });
  return c.json({ success: true, data: { taskId: task.id, status: 'completed', caseCompleted } });
});

// ── 4. task/reassign ──────────────────────────────────────────────────────────
router.post('/onboarding/task/reassign', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.task.manage');
  const v = zv(c, z.object({ taskId: z.string().uuid(), assignedTo: z.string().nullable() }), body(c));
  if (!v.ok) return v.response;
  const { data: task } = await sb.from('hr_onboarding_tasks').select('id, case_id, task_key').eq('id', v.data.taskId).maybeSingle<{ id: string; case_id: string; task_key: string }>();
  if (!task) return c.json({ success: false, message: 'Onboarding task not found.' }, 404 as 200);
  const { error } = await sb.from('hr_onboarding_tasks').update({ assigned_to: v.data.assignedTo }).eq('id', task.id);
  if (error) return c.json({ success: false, message: error.message }, 500 as 200);
  void emitAppEvent({ eventType: 'onboarding.task.assigned', sourceModule: 'hr', sourceEntityType: 'onboarding_case',
    sourceEntityId: task.case_id, actorUserId: actor.id, severity: 'info', payload: { taskKey: task.task_key, assignedTo: v.data.assignedTo } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: task.case_id, actorId: actor.id, action: 'hr.onboarding.task_reassigned', newState: { taskKey: task.task_key, assignedTo: v.data.assignedTo } });
  return c.json({ success: true, data: { taskId: task.id, assignedTo: v.data.assignedTo } });
});

// ── 5. cancel ─────────────────────────────────────────────────────────────────
router.post('/onboarding/cancel', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.cancel');
  const v = zv(c, z.object({ caseId: z.string().uuid(), reason: z.string().max(500).optional() }), body(c));
  if (!v.ok) return v.response;
  const { data: kase } = await sb.from('hr_onboarding_cases').select('id, status, employee_id').eq('id', v.data.caseId).maybeSingle<{ id: string; status: string; employee_id: string | null }>();
  if (!kase) return c.json({ success: false, message: 'Onboarding case not found.' }, 404 as 200);
  if (['completed', 'cancelled'].includes(kase.status)) return c.json({ success: false, message: `Case already ${kase.status}.` }, 400 as 200);

  await sb.from('hr_onboarding_cases').update({ status: 'cancelled', metadata: { cancelReason: v.data.reason ?? null } }).eq('id', kase.id);
  await sb.from('hr_onboarding_handoffs').update({ status: 'cancelled' }).eq('case_id', kase.id).eq('status', 'pending');
  void emitAppEvent({ eventType: 'onboarding.cancelled', sourceModule: 'hr', sourceEntityType: 'onboarding_case',
    sourceEntityId: kase.id, actorUserId: actor.id, severity: 'warning', payload: { employeeId: kase.employee_id, reason: v.data.reason ?? null } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId: actor.id, action: 'hr.onboarding.cancelled', reason: v.data.reason ?? null });
  return c.json({ success: true, data: { caseId: kase.id, status: 'cancelled' } });
});

// ── 6. get ────────────────────────────────────────────────────────────────────
router.post('/onboarding/get', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, z.object({ caseId: z.string().uuid().optional(), employeeId: z.string().optional() }), body(c));
  if (!v.ok) return v.response;
  if (!v.data.caseId && !v.data.employeeId) return c.json({ success: false, message: 'caseId or employeeId is required.' }, 400 as 200);

  const { data: kase } = v.data.caseId
    ? await sb.from('hr_onboarding_cases').select('*').eq('id', v.data.caseId).maybeSingle<Record<string, unknown>>()
    : await sb.from('hr_onboarding_cases').select('*').eq('employee_id', v.data.employeeId!).order('started_at', { ascending: false }).limit(1).maybeSingle<Record<string, unknown>>();
  if (!kase) return c.json({ success: false, message: 'Onboarding case not found.' }, 404 as 200);

  const [{ data: tasks }, { data: handoffs }] = await Promise.all([
    sb.from('hr_onboarding_tasks').select('*').eq('case_id', kase['id'] as string).order('created_at'),
    sb.from('hr_onboarding_handoffs').select('*').eq('case_id', kase['id'] as string),
  ]);
  return c.json({ success: true, data: { case: kase, tasks: tasks ?? [], handoffs: handoffs ?? [] } });
});

export default router;
