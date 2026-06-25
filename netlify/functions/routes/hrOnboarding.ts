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
import { nextRef }    from '../lib/refGenerator';
import { z, zv }      from '../lib/validate';
import { runModuleMutation } from '../lib/moduleServiceAdapter';
import { writeHrAudit } from '../lib/hr/employeeCore';
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
  }), body(c));
  if (!v.ok) return v.response;

  const pkg = ONBOARDING_PACKAGES[v.data.packageKey]!;
  const { data: emp } = await sb.from('app_users').select('id, supervisor_id, contractor_flag').eq('id', v.data.employeeId).maybeSingle<{ id: string; supervisor_id: string | null; contractor_flag: boolean | null }>();
  if (!emp) return c.json({ success: false, message: 'Employee not found.' }, 404 as 200);
  const ownerId = v.data.ownerId ?? actor.id;

  const result = await runModuleMutation<{ id: string; caseNo: string; taskCount: number; handoffCount: number }>({
    context: { actorUserId: actor.id },
    options: {
      module: 'hr', operation: 'create', entityType: 'onboarding_case',
      idempotencyKey: `hr.onboarding.start:${v.data.employeeId}:${v.data.packageKey}`,
      eventType: 'onboarding.started', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.caseNo }),
      buildEventPayload: (r) => ({ employeeId: v.data.employeeId, packageKey: v.data.packageKey, taskCount: r.taskCount, handoffCount: r.handoffCount }),
    },
    writeRecord: async () => {
      const caseNo = await nextRef('ONB');
      const { data: kase, error: cErr } = await sb.from('hr_onboarding_cases').insert({
        case_no: caseNo, employee_id: emp.id, worker_type: emp.contractor_flag ? 'contractor' : 'employee',
        package_key: pkg.key, status: 'in_progress', owner_id: ownerId, due_at: v.data.dueAt ?? null, started_by: actor.id,
      }).select('id, case_no').single<{ id: string; case_no: string }>();
      if (cErr) throw Object.assign(new Error(cErr.message), { status: 500 });

      const taskRows = pkg.tasks.map(t => ({
        case_id: kase.id, task_key: t.taskKey, task_title: t.taskTitle, owner_role: t.ownerRole, module_key: t.moduleKey,
        // Resolve the assignee where it's unambiguous: HR → case owner, Supervisor → the
        // employee's supervisor. IT/HSE/Training/Payroll are assigned later (reassign).
        assigned_to: t.ownerRole === 'hr' ? ownerId : t.ownerRole === 'supervisor' ? emp.supervisor_id : null,
        status: 'pending',
      }));
      const { error: tErr } = await sb.from('hr_onboarding_tasks').insert(taskRows);
      if (tErr) { await sb.from('hr_onboarding_cases').delete().eq('id', kase.id); throw Object.assign(new Error(tErr.message), { status: 500 }); }

      if (pkg.handoffs.length) {
        const { error: hErr } = await sb.from('hr_onboarding_handoffs').insert(
          pkg.handoffs.map(h => ({ case_id: kase.id, target_module: h.targetModule, handoff_type: h.handoffType, status: 'pending', payload: { employeeId: emp.id, caseNo } })),
        );
        if (hErr) { await sb.from('hr_onboarding_cases').delete().eq('id', kase.id); throw Object.assign(new Error(hErr.message), { status: 500 }); }
      }

      await writeHrAudit({ employeeId: emp.id, submoduleKey: 'onboarding', recordId: kase.id, actorId: actor.id,
        action: 'hr.onboarding.started', newState: { caseNo, packageKey: pkg.key, taskCount: taskRows.length } });
      return { id: kase.id, caseNo: kase.case_no, taskCount: taskRows.length, handoffCount: pkg.handoffs.length };
    },
  });

  // Handoff intents recorded above; surface the domain event for each (delivery is a later phase).
  for (const h of pkg.handoffs) {
    void emitAppEvent({ eventType: 'onboarding.handoff.created', sourceModule: 'hr', sourceEntityType: 'onboarding_case',
      sourceEntityId: result.entityId, actorUserId: actor.id, severity: 'info', payload: { targetModule: h.targetModule, handoffType: h.handoffType } });
  }

  return c.json({ success: true, data: { caseId: result.entityId, caseNo: result.entityRef, status: 'in_progress', taskCount: result.record.taskCount, handoffCount: result.record.handoffCount } });
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
