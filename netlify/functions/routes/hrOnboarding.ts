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
import {
  loadPackagePlan, listPackageSummaries, getPackageDetail, createPackage, updatePackage, setPackageStatus,
  createTaskTemplate, updateTaskTemplate, deleteTaskTemplate, createHandoffTemplate, updateHandoffTemplate, deleteHandoffTemplate,
} from '../lib/hr/onboardingPackageService';
import { getOnboardingDashboardStats, listOnboardingCases, listOnboardingTasks, listOnboardingHandoffs, listOnboardingBlockers, listRecentOnboardingActivity, getOnboardingTaskDetail } from '../lib/hr/onboardingQueries';
import { getOnboardingIntakePreview } from '../lib/hr/onboardingIntake';
import { addOnboardingTask, blockOnboardingTask, unblockOnboardingTask, completeOnboardingCase, pauseOnboardingCase, resumeOnboardingCase, reassignOnboardingOwner, markOnboardingReady, resolveOnboardingBlocker, escalateOnboardingBlocker, waiveOnboardingBlocker, notifyOnboardingBlockerOwner, listOnboardingAudit, addOnboardingTaskNote, attachOnboardingTaskEvidence, taskEvidenceMissing, retryOnboardingHandoff, acceptOnboardingHandoff, completeOnboardingHandoff, cancelOnboardingHandoff } from '../lib/hr/onboardingMutations';
import { createAttachmentUploadUrl } from '../lib/upload';
import { listActionTemplates, createActionTemplate, updateActionTemplate, retireActionTemplate, listCaseActions, addCaseAction, updateCaseAction, completeCaseAction, cancelCaseAction, type ActionTemplateInput, type AddCaseActionInput } from '../lib/hr/onboardingCustomActions';
import { provisionAccount, acceptAccountInvite } from '../lib/hr/accountProvisioning';
import { previewOnboardingCommunication, listOnboardingCommunications, sendOnboardingCommunication, resendOnboardingCommunication } from '../lib/hr/onboardingCommunications';
import { listOnboardingReports, runOnboardingReport, exportOnboardingReport } from '../lib/hr/onboardingReports';
import type { RunOnboardingReportArgs } from '../../../types/hrOnboarding';
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

// ── 1a. intake-preview (Start Onboarding wizard: verification + documents + duplicate + task/handoff preview) ──
router.post('/onboarding/intake-preview', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, z.object({ employeeId: z.string().min(1), packageKey: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await getOnboardingIntakePreview(v.data) }); }
  catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed to load intake preview.' }, (er.status ?? 500) as 200); }
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
    includeActionTemplateIds: z.array(z.string().uuid()).nullable().optional(),
    documentSelections: z.array(z.object({
      requirementId: z.string().min(1),
      action: z.enum(['use_existing', 'uploaded', 'request_from_worker', 'waive', 'none']),
      existingDocumentId: z.string().uuid().nullable().optional(),
      uploadedFilePath: z.string().nullable().optional(),
      waiverReason: z.string().max(500).nullable().optional(),
    })).nullable().optional(),
    scheduledLaunchAt: z.string().nullable().optional(),
    // Case-type-specific intake fields (contractor/temporary) — persisted on case metadata.
    // Bounded record of primitive values to keep the payload honest (no nested blobs).
    workerTypeDetails: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).nullable().optional(),
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
  // Evidence gate (settings-driven, default off): a requires_evidence task cannot be
  // completed without at least one attached evidence file when the gate is on.
  if (await taskEvidenceMissing(task.id)) {
    return c.json({ success: false, message: 'This task requires evidence — attach it before completing (per settings).' }, 400 as 200);
  }

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
  const v = zv(c, z.object({ caseId: z.string().uuid(), reason: z.string().trim().min(1, 'A reason is required to cancel an onboarding case.').max(500) }), body(c));
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
  statuses: StrArr, packageKeys: StrArr, ownerIds: StrArr, employeeIds: StrArr, caseIds: StrArr,
  departmentIds: StrArr, siteIds: StrArr, workerTypes: StrArr, reasons: StrArr,
  dueState: DueEnum,
  blockingState: z.enum(['all', 'blocked', 'not_blocked']).optional(),
  readinessState: z.enum(['all', 'ready', 'not_ready']).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(200).optional(),
  sort: z.object({ field: z.enum(['case_no', 'due_at', 'started_at', 'status', 'progress']), direction: z.enum(['asc', 'desc']) }).optional(),
});
const TaskListSchema = z.object({
  caseId: z.string().uuid().optional(), statuses: StrArr, ownerRoles: StrArr, moduleKeys: StrArr, packageKeys: StrArr,
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

// ── 11b. task/get (Tasks Workspace drawer) ───────────────────────────────────────
router.post('/onboarding/task/get', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, z.object({ taskId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => getOnboardingTaskDetail(v.data.taskId));
});

// ── 11c-e. task notes + evidence — the assignee may act on their own task; anyone
// else needs task.manage (same access rule as task/complete).
const TASK_EVIDENCE_BUCKET = 'hr-employee-documents';   // reuse the HR docs bucket (per-file rows stay on the task)
async function requireTaskActor(c: Context, taskId: string): Promise<{ actorId: string } | Response> {
  const actor = await requireUser(c);
  const { data: task } = await sb.from('hr_onboarding_tasks').select('id, assigned_to').eq('id', taskId).maybeSingle<{ id: string; assigned_to: string | null }>();
  if (!task) return c.json({ success: false, message: 'Onboarding task not found.' }, 404 as 200);
  if (task.assigned_to !== actor.id && !(await userCan(actor, 'hr.onboarding.task.manage'))) {
    return c.json({ success: false, message: 'You are not assigned this task and lack the manage permission.' }, 403 as 200);
  }
  return { actorId: actor.id };
}

router.post('/onboarding/task/add-note', async c => {
  const v = zv(c, z.object({ taskId: z.string().uuid(), note: z.string().min(1).max(2000) }), body(c));
  if (!v.ok) return v.response;
  const gate = await requireTaskActor(c, v.data.taskId);
  if (gate instanceof Response) return gate;
  return mutate(c, () => addOnboardingTaskNote(gate.actorId, v.data));
});

router.post('/onboarding/task/evidence-upload-url', async c => {
  const v = zv(c, z.object({ taskId: z.string().uuid(), fileName: z.string().min(1), mimeType: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  const gate = await requireTaskActor(c, v.data.taskId);
  if (gate instanceof Response) return gate;
  try {
    const { uploadUrl, token, path } = await createAttachmentUploadUrl(TASK_EVIDENCE_BUCKET, `onboarding-evidence/${v.data.fileName}`, v.data.mimeType);
    return c.json({ success: true, uploadUrl, token, path, bucket: TASK_EVIDENCE_BUCKET });
  } catch (e) { return c.json({ success: false, message: e instanceof Error ? e.message : 'Upload URL failed' }, 400 as 200); }
});

router.post('/onboarding/task/attach-evidence', async c => {
  const v = zv(c, z.object({
    taskId: z.string().uuid(), fileName: z.string().min(1).max(200), filePath: z.string().min(1),
    mimeType: z.string().nullable().optional(), fileSize: z.number().int().nullable().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  const gate = await requireTaskActor(c, v.data.taskId);
  if (gate instanceof Response) return gate;
  return mutate(c, () => attachOnboardingTaskEvidence(gate.actorId, v.data));
});

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
  const v = zv(c, z.object({ taskId: z.string().uuid(), reason: z.string().trim().min(1, 'A reason is required to block a task.').max(500), severity: Sev.optional() }), body(c));
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
  const v = zv(c, z.object({ blockerId: z.string().uuid(), note: z.string().trim().min(1, 'A resolution note is required.').max(500) }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => resolveOnboardingBlocker(actor.id, v.data));
});

// ── 21. blocker/escalate ─────────────────────────────────────────────────────────
router.post('/onboarding/blocker/escalate', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ blockerId: z.string().uuid(), note: z.string().trim().min(1, 'An escalation reason is required.').max(500), newOwnerId: z.string().nullable().optional() }), body(c));
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

// ── 22a. blocker/notify-owner (Blocked board) ────────────────────────────────────
router.post('/onboarding/blocker/notify-owner', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ blockerId: z.string().uuid(), message: z.string().max(500).nullable().optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => notifyOnboardingBlockerOwner(actor.id, v.data));
});

// ── 22b. handoff lifecycle (cross-case control center) ────────────────────────────
// Gated by hr.onboarding.case.manage — the same tier as blocker/task-management
// actions; no separate handoff-specific permission (per the Phase-3 plan).
const HandoffAction = z.object({ handoffId: z.string().uuid(), reason: z.string().max(500).nullable().optional() });
router.post('/onboarding/handoff/retry', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, HandoffAction, body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => retryOnboardingHandoff(actor.id, v.data));
});
router.post('/onboarding/handoff/accept', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, HandoffAction, body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => acceptOnboardingHandoff(actor.id, v.data));
});
router.post('/onboarding/handoff/complete', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, HandoffAction, body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => completeOnboardingHandoff(actor.id, v.data));
});
router.post('/onboarding/handoff/cancel', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, HandoffAction, body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => cancelOnboardingHandoff(actor.id, v.data));
});

// ── 22c. case communications (Case Detail Communications widget) ─────────────────
const CommType = z.enum(['employee_welcome', 'supervisor_notification', 'owner_reminder', 'escalation_notice', 'manual_message']);
router.post('/onboarding/communications/list', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, z.object({ caseId: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => listOnboardingCommunications(v.data.caseId));
});
router.post('/onboarding/communications/preview', async c => {
  await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ caseId: z.string().uuid(), communicationType: CommType, subject: nstr, body: nstr, recipientUserId: nstr }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => previewOnboardingCommunication(v.data));
});
router.post('/onboarding/communications/send', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ caseId: z.string().uuid(), communicationType: CommType, subject: nstr, body: nstr, recipientUserId: nstr, channel: z.enum(['email', 'in_app', 'sms', 'manual']).optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => sendOnboardingCommunication(actor.id, v.data));
});
router.post('/onboarding/communications/resend', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.case.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => resendOnboardingCommunication(actor.id, v.data));
});

// ── 22d. reports (Reports workspace) ─────────────────────────────────────────────
const ReportKey = z.enum(['cycle_time', 'blocked_cases', 'task_owner_performance', 'handoff_completion', 'package_effectiveness', 'activation_readiness', 'overdue_tasks', 'contractor_onboarding', 'safety_critical_onboarding']);
const RunReportSchema = z.object({
  reportKey: ReportKey, dateFrom: z.string().nullable().optional(), dateTo: z.string().nullable().optional(),
  departmentIds: StrArr, siteIds: StrArr, packageKeys: StrArr, ownerIds: StrArr, workerTypes: StrArr, status: StrArr,
  groupBy: z.enum(['day', 'week', 'month', 'department', 'package', 'owner']).optional(),
  page: z.number().int().positive().optional(), pageSize: z.number().int().positive().max(1000).optional(),
});
router.post('/onboarding/reports/list', async c => {
  await requirePermission(c, 'hr.onboarding.reports.view');
  return c.json({ success: true, data: listOnboardingReports() });
});
router.post('/onboarding/reports/run', async c => {
  await requirePermission(c, 'hr.onboarding.reports.view');
  const v = zv(c, RunReportSchema, body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => runOnboardingReport(v.data as RunOnboardingReportArgs));
});
router.post('/onboarding/reports/export', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.reports.export');
  const v = zv(c, RunReportSchema, body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => exportOnboardingReport(actor.id, v.data as RunOnboardingReportArgs));
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
  const v = zv(c, z.object({ id: z.string().uuid(), reason: z.string().trim().min(1, 'A reason is required to cancel a custom action.').max(500) }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => cancelCaseAction(actor.id, v.data));
});

// ════════════════════════════════════════════════════════════════════════════════
// Package Manager. Package/template configuration is oversight-tier (org-wide
// policy) — every mutation here is gated by hr.onboarding.packages.manage, NOT the
// case-execution keys above. Reads stay on the existing hr.onboarding.view.
// ════════════════════════════════════════════════════════════════════════════════

// ── 33. packages/get (Package Detail page) ───────────────────────────────────────
router.post('/onboarding/packages/get', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, z.object({ packageKey: z.string().min(1) }), body(c));
  if (!v.ok) return v.response;
  const detail = await getPackageDetail(v.data.packageKey);
  if (!detail) return c.json({ success: false, message: 'Onboarding package not found.' }, 404 as 200);
  return c.json({ success: true, data: detail });
});

// ── 34. packages/create ──────────────────────────────────────────────────────────
router.post('/onboarding/packages/create', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.packages.manage');
  const v = zv(c, z.object({
    label: z.string().min(1).max(200), description: nstr, workerTypes: z.array(z.string()).optional(),
    defaultSlaDays: z.number().int().positive().optional(), defaultOwnerRole: nstr,
    appliesToDepartments: z.array(z.string()).optional(), appliesToSites: z.array(z.string()).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => createPackage(actor.id, v.data));
});

// ── 35. packages/update ──────────────────────────────────────────────────────────
router.post('/onboarding/packages/update', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.packages.manage');
  const v = zv(c, z.object({
    id: z.string().uuid(), label: z.string().min(1).max(200).optional(), description: nstr, workerTypes: z.array(z.string()).optional(),
    defaultSlaDays: z.number().int().positive().optional(), defaultOwnerRole: nstr,
    appliesToDepartments: z.array(z.string()).optional(), appliesToSites: z.array(z.string()).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => updatePackage(actor.id, v.data));
});

// ── 36. packages/set-status ───────────────────────────────────────────────────────
router.post('/onboarding/packages/set-status', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.packages.manage');
  const v = zv(c, z.object({ id: z.string().uuid(), status: z.enum(['draft', 'active', 'retired']) }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => setPackageStatus(actor.id, v.data));
});

// ── 37-39. task-templates/{create,update,delete} ─────────────────────────────────
router.post('/onboarding/packages/task-templates/create', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.packages.manage');
  const v = zv(c, z.object({
    packageId: z.string().uuid(), taskKey: z.string().min(1).max(60), taskTitle: z.string().min(1).max(200), ownerRole: z.string().min(1).max(40),
    moduleKey: nstr, isBlocking: z.boolean().optional(), requiresEvidence: z.boolean().optional(), dependencyKeys: z.array(z.string()).optional(), sortOrder: z.number().int().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => createTaskTemplate(actor.id, v.data));
});
router.post('/onboarding/packages/task-templates/update', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.packages.manage');
  const v = zv(c, z.object({
    id: z.string().uuid(), taskTitle: z.string().min(1).max(200).optional(), ownerRole: z.string().min(1).max(40).optional(),
    moduleKey: nstr, isBlocking: z.boolean().optional(), requiresEvidence: z.boolean().optional(), dependencyKeys: z.array(z.string()).optional(), sortOrder: z.number().int().optional(),
  }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => updateTaskTemplate(actor.id, v.data));
});
router.post('/onboarding/packages/task-templates/delete', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.packages.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => deleteTaskTemplate(actor.id, v.data));
});

// ── 40-42. handoff-templates/{create,update,delete} ──────────────────────────────
router.post('/onboarding/packages/handoff-templates/create', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.packages.manage');
  const v = zv(c, z.object({
    packageId: z.string().uuid(), handoffKey: z.string().min(1).max(60), targetModule: z.string().min(1).max(40), handoffType: z.string().min(1).max(60),
    isRequired: z.boolean().optional(), sortOrder: z.number().int().optional(), payloadTemplate: z.record(z.string(), z.unknown()).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => createHandoffTemplate(actor.id, v.data));
});
router.post('/onboarding/packages/handoff-templates/update', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.packages.manage');
  const v = zv(c, z.object({
    id: z.string().uuid(), targetModule: z.string().min(1).max(40).optional(), handoffType: z.string().min(1).max(60).optional(),
    isRequired: z.boolean().optional(), sortOrder: z.number().int().optional(), payloadTemplate: z.record(z.string(), z.unknown()).optional(),
  }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => updateHandoffTemplate(actor.id, v.data));
});
router.post('/onboarding/packages/handoff-templates/delete', async c => {
  const actor = await requirePermission(c, 'hr.onboarding.packages.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => deleteHandoffTemplate(actor.id, v.data));
});

// ── 43. activity/recent (Overview widget) ────────────────────────────────────────
router.post('/onboarding/activity/recent', async c => {
  await requirePermission(c, 'hr.onboarding.view');
  const v = zv(c, z.object({ limit: z.number().int().positive().max(50).optional() }), body(c));
  if (!v.ok) return v.response;
  return mutate(c, () => listRecentOnboardingActivity(v.data.limit ?? 15));
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
