// routes/hrOnboarding.ts — HR Employee Master onboarding (v36 §10).
//
// Start an onboarding case from a package → instantiates tasks (by owning role) +
// cross-module handoff intents; complete/reassign tasks; cancel; get. Backend-only
// (service-role); gated by hr.onboarding.*. Handoff DELIVERY to HSE/Training/Payroll
// is recorded as 'pending' (those receivers are a later phase) — NOT faked.

import { Hono, type Context } from 'hono';
import { sb }         from '../lib/db';
import { requirePermission, requireUser, userCan } from '../lib/auth';
import { emitAppEvent } from '../lib/appEvents';
import { z, zv }      from '../lib/validate';
import { writeHrAudit } from '../lib/hr/employeeCore';
import { startOnboardingCase } from '../lib/hr/onboardingCore';
import { loadPackagePlan, listPackageSummaries } from '../lib/hr/onboardingPackageService';
import { getOnboardingDashboardStats, listOnboardingCases, listOnboardingTasks, listOnboardingHandoffs, listOnboardingBlockers } from '../lib/hr/onboardingQueries';
import { addOnboardingTask, blockOnboardingTask, unblockOnboardingTask, completeOnboardingCase, pauseOnboardingCase, resumeOnboardingCase, reassignOnboardingOwner, markOnboardingReady, resolveOnboardingBlocker, escalateOnboardingBlocker, waiveOnboardingBlocker, listOnboardingAudit } from '../lib/hr/onboardingMutations';
import { listActionTemplates, createActionTemplate, updateActionTemplate, retireActionTemplate, listCaseActions, addCaseAction, updateCaseAction, completeCaseAction, cancelCaseAction, type ActionTemplateInput, type AddCaseActionInput } from '../lib/hr/onboardingCustomActions';
import { provisionAccount, acceptAccountInvite } from '../lib/hr/accountProvisioning';
import type { OnboardingCaseListArgs, OnboardingDashboardStatsArgs, OnboardingTaskListArgs, OnboardingHandoffListArgs, OnboardingBlockerListArgs } from '../../../types/hrOnboarding';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const body = (c: { get: (k: string) => unknown }) => (c.get('body') as Record<string, unknown>).args ?? {};

// ── 1. preview-package ────────────────────────────────────────────────────────
router.post('/onboarding/preview-package', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, z.object({ packageKey: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  const plan = await loadPackagePlan(v.data.packageKey);
  if (!plan) return c.json({ success: false, message: 'Unknown or retired package.' }, 404 as 200);
  return c.json({ success: true, data: {
    package: plan.key, label: plan.label,
    tasks: plan.tasks.map(t => ({ taskKey: t.taskKey, taskTitle: t.taskTitle, ownerRole: t.ownerRole, moduleKey: t.moduleKey })),
    handoffs: plan.handoffs.map(h => ({ targetModule: h.targetModule, handoffType: h.handoffType })),
    taskCount: plan.tasks.length,
  } });
});

// ── 1b. packages/list (wizard picker + package manager) ──────────────────────────
router.post('/onboarding/packages/list', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, z.object({ includeRetired: z.boolean().optional() }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listPackageSummaries(v.data.includeRetired ?? false) }); }
  catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed to list packages.' }, (er.status ?? 500) as 200); }
});

// ── 2. start ──────────────────────────────────────────────────────────────────
router.post('/onboarding/start', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.start');
  const v = zv(c, z.object({
    employeeId: z.string().min(1),
    packageKey: z.string().min(1),
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

// ════════════════════════════════════════════════════════════════════════════════
// Management-module READ endpoints (Phase 2) — all gated by hr.onboarding.view.
// Computation lives in lib/hr/onboardingQueries.ts. The case-detail Timeline tab
// REUSES the generic POST /api/orchestration/timeline/get (module 'hr', recordType
// 'onboarding_case') — no duplicate timeline endpoint here.
// ════════════════════════════════════════════════════════════════════════════════
const StrArr = z.array(z.string()).optional();
const DueEnum = z.enum(['all', 'overdue', 'due_today', 'due_this_week']).optional();

const DashSchema = z.object({ departmentIds: StrArr, siteIds: StrArr, ownerIds: StrArr, packageKeys: StrArr });
const CaseListSchema = z.object({
  query: z.string().optional(),
  statuses: StrArr, packageKeys: StrArr, ownerIds: StrArr, departmentIds: StrArr, siteIds: StrArr, workerTypes: StrArr, reasons: StrArr,
  dueState: DueEnum,
  blockingState: z.enum(['all', 'blocked', 'not_blocked']).optional(),
  readinessState: z.enum(['all', 'ready', 'not_ready']).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(200).optional(),
  sort: z.object({ field: z.enum(['case_no', 'due_at', 'started_at', 'status', 'progress']), direction: z.enum(['asc', 'desc']) }).optional(),
});
const TaskListSchema = z.object({
  caseId: z.string().uuid().optional(), statuses: StrArr, ownerRoles: StrArr, moduleKeys: StrArr,
  assignedTo: z.string().optional(), blockingOnly: z.boolean().optional(), dueState: DueEnum, query: z.string().optional(),
});
const HandoffListSchema = z.object({ caseId: z.string().uuid().optional(), targetModules: StrArr, statuses: StrArr });
const BlockerListSchema = z.object({ caseId: z.string().uuid().optional(), blockingModules: StrArr, statuses: StrArr, severities: StrArr });

// ── 7. dashboard-stats (Overview KPIs) ──────────────────────────────────────────
router.post('/onboarding/dashboard-stats', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, DashSchema, body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await getOnboardingDashboardStats(v.data as OnboardingDashboardStatsArgs) }); }
  catch (e) { const err = e as { status?: number; message?: string }; return c.json({ success: false, message: err.message ?? 'Failed to load stats.' }, (err.status ?? 500) as 200); }
});

// ── 8. list (Cases tab) ─────────────────────────────────────────────────────────
router.post('/onboarding/list', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, CaseListSchema, body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listOnboardingCases(v.data as OnboardingCaseListArgs) }); }
  catch (e) { const err = e as { status?: number; message?: string }; return c.json({ success: false, message: err.message ?? 'Failed to list cases.' }, (err.status ?? 500) as 200); }
});

// ── 9. tasks/list (Tasks tab) ────────────────────────────────────────────────────
router.post('/onboarding/tasks/list', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, TaskListSchema, body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listOnboardingTasks(v.data as OnboardingTaskListArgs) }); }
  catch (e) { const err = e as { status?: number; message?: string }; return c.json({ success: false, message: err.message ?? 'Failed to list tasks.' }, (err.status ?? 500) as 200); }
});

// ── 10. handoffs/list (Handoffs tab) ─────────────────────────────────────────────
router.post('/onboarding/handoffs/list', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, HandoffListSchema, body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listOnboardingHandoffs(v.data as OnboardingHandoffListArgs) }); }
  catch (e) { const err = e as { status?: number; message?: string }; return c.json({ success: false, message: err.message ?? 'Failed to list handoffs.' }, (err.status ?? 500) as 200); }
});

// ── 11. blockers/list (Blocked tab) ──────────────────────────────────────────────
router.post('/onboarding/blockers/list', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, BlockerListSchema, body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listOnboardingBlockers(v.data as OnboardingBlockerListArgs) }); }
  catch (e) { const err = e as { status?: number; message?: string }; return c.json({ success: false, message: err.message ?? 'Failed to list blockers.' }, (err.status ?? 500) as 200); }
});

// ════════════════════════════════════════════════════════════════════════════════
// Management-module WRITE endpoints (Phase 3). Logic in lib/hr/onboardingMutations.ts
// (service functions throw { status, message }); routes just gate + validate + map.
// ════════════════════════════════════════════════════════════════════════════════
async function mutate<T>(c: Context, fn: () => Promise<T>): Promise<Response> {
  try { return c.json({ success: true, data: await fn() }); }
  catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Request failed.' }, (er.status ?? 500) as 200); }
}
const Sev = z.enum(['low', 'medium', 'high', 'critical']);

// ── 12. task/add (one-off task on a case) ────────────────────────────────────────
router.post('/onboarding/task/add', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({
    caseId: z.string().uuid(), taskTitle: z.string().min(1).max(200),
    ownerRole: z.string().max(40).nullable().optional(), moduleKey: z.string().max(40).nullable().optional(),
    assignedTo: z.string().nullable().optional(), dueAt: z.string().nullable().optional(),
    isBlocking: z.boolean().optional(), requiresEvidence: z.boolean().optional(),
    priority: z.string().max(30).nullable().optional(), taskKey: z.string().max(60).nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => addOnboardingTask(actor.id, v.data));
});

// ── 13. task/block ───────────────────────────────────────────────────────────────
router.post('/onboarding/task/block', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.task.manage');
  const v = zv(c, z.object({ taskId: z.string().uuid(), reason: z.string().max(500).nullable().optional(), severity: Sev.optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => blockOnboardingTask(actor.id, v.data));
});

// ── 14. task/unblock ─────────────────────────────────────────────────────────────
router.post('/onboarding/task/unblock', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.task.manage');
  const v = zv(c, z.object({ taskId: z.string().uuid(), reason: z.string().max(500).nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => unblockOnboardingTask(actor.id, v.data));
});

// ── 15. complete (case) ──────────────────────────────────────────────────────────
router.post('/onboarding/complete', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.complete');
  const v = zv(c, z.object({ caseId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => completeOnboardingCase(actor.id, v.data));
});

// ── 16. pause ────────────────────────────────────────────────────────────────────
router.post('/onboarding/pause', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ caseId: z.string().uuid(), reason: z.string().max(500).nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => pauseOnboardingCase(actor.id, v.data));
});

// ── 17. resume ───────────────────────────────────────────────────────────────────
router.post('/onboarding/resume', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ caseId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => resumeOnboardingCase(actor.id, v.data));
});

// ── 18. reassign-owner ───────────────────────────────────────────────────────────
router.post('/onboarding/reassign-owner', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ caseId: z.string().uuid(), ownerId: z.string().nullable() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => reassignOnboardingOwner(actor.id, v.data));
});

// ── 19. ready-for-activation ─────────────────────────────────────────────────────
router.post('/onboarding/ready', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ caseId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => markOnboardingReady(actor.id, v.data));
});

// ── 20. blocker/resolve ──────────────────────────────────────────────────────────
router.post('/onboarding/blocker/resolve', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ blockerId: z.string().uuid(), note: z.string().max(500).nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => resolveOnboardingBlocker(actor.id, v.data));
});

// ── 21. blocker/escalate ─────────────────────────────────────────────────────────
router.post('/onboarding/blocker/escalate', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ blockerId: z.string().uuid(), note: z.string().max(500).nullable().optional(), newOwnerId: z.string().nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => escalateOnboardingBlocker(actor.id, v.data));
});

// ── 22. blocker/waive (reason REQUIRED; audited) ─────────────────────────────────
router.post('/onboarding/blocker/waive', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ blockerId: z.string().uuid(), reason: z.string().min(1).max(500) }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => waiveOnboardingBlocker(actor.id, v.data));
});

// ── 23. audit (case Audit tab) ───────────────────────────────────────────────────
router.post('/onboarding/audit', async c => {
  await requirePermission(c, 'hr.onboarding.audit.view');
  const v = zv(c, z.object({ caseId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => listOnboardingAudit(v.data.caseId));
});

// ════════════════════════════════════════════════════════════════════════════════
// Custom Onboarding Actions (Phase 5). Templates live on a package; case actions are
// instantiated into the normal lifecycle (lib/hr/onboardingCustomActions.ts).
// ════════════════════════════════════════════════════════════════════════════════
const ActionType = z.enum(['custom_task', 'custom_handoff', 'custom_document_request', 'custom_training_request', 'custom_approval', 'custom_notification', 'custom_checklist_item', 'custom_external_action']);
const OwnerType = z.enum(['role', 'employee', 'department', 'system', 'external']);
const Priority = z.enum(['low', 'normal', 'high', 'critical']);
const nstr = z.string().nullable().optional();
const nuuid = z.string().uuid().nullable().optional();

// ── 24. actions/templates/list ───────────────────────────────────────────────────
router.post('/onboarding/actions/templates/list', async c => {
  await requirePermission(c, 'hr.onboarding.custom_actions.view');
  const v = zv(c, z.object({ packageKey: z.string().min(1), includeInactive: z.boolean().optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => listActionTemplates(v.data.packageKey, v.data.includeInactive ?? false));
});

// ── 25. actions/templates/create ─────────────────────────────────────────────────
router.post('/onboarding/actions/templates/create', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.custom_actions.create');
  const v = zv(c, z.object({
    packageKey: z.string().min(1), actionName: z.string().min(1).max(200), actionType: ActionType,
    description: nstr, instructions: nstr, ownerType: OwnerType.optional(), ownerRole: nstr, ownerEmployeeId: nstr, ownerDepartmentId: nuuid,
    dueOffsetDays: z.number().int().optional(), priority: Priority.optional(), isRequired: z.boolean().optional(), blocksOnboarding: z.boolean().optional(), requiresEvidence: z.boolean().optional(),
    documentTypeId: nuuid, trainingRequirementId: nuuid, workflowTemplateId: nuuid, notificationTemplateId: nuuid,
    externalSystemKey: nstr, externalActionUrl: nstr, displayOrder: z.number().int().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => createActionTemplate(actor.id, v.data as ActionTemplateInput));
});

// ── 26. actions/templates/update ─────────────────────────────────────────────────
router.post('/onboarding/actions/templates/update', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.custom_actions.update');
  const v = zv(c, z.object({
    id: z.string().uuid(), actionName: z.string().min(1).max(200).optional(), actionType: ActionType.optional(),
    description: nstr, instructions: nstr, ownerType: OwnerType.optional(), ownerRole: nstr, ownerEmployeeId: nstr, ownerDepartmentId: nuuid,
    dueOffsetDays: z.number().int().nullable().optional(), priority: Priority.optional(), isRequired: z.boolean().optional(), blocksOnboarding: z.boolean().optional(), requiresEvidence: z.boolean().optional(),
    documentTypeId: nuuid, trainingRequirementId: nuuid, workflowTemplateId: nuuid, notificationTemplateId: nuuid,
    externalSystemKey: nstr, externalActionUrl: nstr, displayOrder: z.number().int().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => updateActionTemplate(actor.id, v.data as Partial<ActionTemplateInput> & { id: string }));
});

// ── 27. actions/templates/retire ─────────────────────────────────────────────────
router.post('/onboarding/actions/templates/retire', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.custom_actions.retire');
  const v = zv(c, z.object({ id: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => retireActionTemplate(actor.id, v.data));
});

// ── 28. actions/case/list ────────────────────────────────────────────────────────
router.post('/onboarding/actions/case/list', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, z.object({ caseId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => listCaseActions(v.data.caseId));
});

// ── 29. actions/case/add (instantiate into the lifecycle) ─────────────────────────
router.post('/onboarding/actions/case/add', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.custom_actions.case_add');
  const v = zv(c, z.object({
    caseId: z.string().uuid(), sourceTemplateId: nuuid,
    actionName: z.string().min(1).max(200).optional(), actionType: ActionType.optional(), description: nstr, instructions: nstr,
    ownerType: OwnerType.optional(), ownerRole: nstr, ownerEmployeeId: nstr,
    dueDate: nstr, priority: Priority.optional(), blocksOnboarding: z.boolean().optional(), requiresEvidence: z.boolean().optional(),
    documentTypeId: nstr, trainingRequirementId: nstr, workflowTemplateId: nstr, notificationTemplateId: nstr,
    externalSystemKey: nstr, externalActionUrl: nstr,
  }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => addCaseAction(actor.id, v.data as AddCaseActionInput));
});

// ── 30. actions/case/update ──────────────────────────────────────────────────────
router.post('/onboarding/actions/case/update', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.custom_actions.case_update');
  const v = zv(c, z.object({ id: z.string().uuid(), status: z.enum(['open', 'in_progress', 'completed', 'cancelled', 'blocked']).optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => updateCaseAction(actor.id, v.data));
});

// ── 31. actions/case/complete ────────────────────────────────────────────────────
router.post('/onboarding/actions/case/complete', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.custom_actions.case_complete');
  const v = zv(c, z.object({ id: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => completeCaseAction(actor.id, v.data));
});

// ── 32. actions/case/cancel ──────────────────────────────────────────────────────
router.post('/onboarding/actions/case/cancel', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.custom_actions.case_cancel');
  const v = zv(c, z.object({ id: z.string().uuid(), reason: z.string().max(500).nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => cancelCaseAction(actor.id, v.data));
});

// ════════════════════════════════════════════════════════════════════════════════
// Account / Work-Email provisioning (Phase 6). provision-account creates the login +
// work email + invite; accept-invite is PUBLIC (the invitee isn't logged in yet) and
// sets their own password via the single-use emailed token.
// ════════════════════════════════════════════════════════════════════════════════
router.post('/onboarding/provision-account', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.provision_account');
  const v = zv(c, z.object({ employeeId: z.string().min(1), sendInvite: z.boolean().optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => provisionAccount(actor.id, v.data));
});

router.post('/onboarding/accept-invite', async c => {
  // PUBLIC — no requireUser/requirePermission. Auth is the single-use invite token.
  const v = zv(c, z.object({ token: z.string().min(1), password: z.string().min(8).max(200) }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => acceptAccountInvite(v.data));
});

export default router;
