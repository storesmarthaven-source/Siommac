// lib/hr/onboardingMutations.ts — HR Onboarding management-module WRITES (Phase 3).
//
// Case/task/blocker state transitions for the management module: add task, block /
// unblock a task, complete / pause / resume a case, reassign owner, mark ready, and
// resolve / escalate / waive blockers. Each follows the in-file precedent for status
// transitions (direct row update with the DB error CHECKED + an app_event + an HR
// audit row) — NOT runModuleMutation, which is for idempotent creates (forcing a
// status update through it would be ceremony). writeHrAudit THROWS on failure, so a
// failed audit fails the mutation (no swallow). Backend-only (service-role).

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { resolveSettingValue } from '../settings/resolveSetting';
import { taskCategory } from './onboardingTaskCategory';
import type { OnboardingAuditRow, OnboardingHandoffStatus, OnboardingHandoffActionResult } from '../../../../types/hrOnboarding';

const err = (status: number, message: string): Error => Object.assign(new Error(message), { status });
const nowISO = (): string => new Date().toISOString();
const TERMINAL = ['completed', 'cancelled'];
const ACTIVE_BLOCKER = ['active', 'acknowledged', 'waiting_on_owner', 'escalated'];
const isOpenTask = (s: string): boolean => !['completed', 'skipped', 'cancelled'].includes(s);
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const humanizeModule = (s: string): string => s.replace(/[_.]+/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

interface CaseRow { id: string; status: string; employee_id: string | null; case_no: string; owner_id: string | null }
interface TaskRow { id: string; case_id: string; task_key: string; task_title: string; module_key: string | null; status: string; assigned_to: string | null; due_at: string | null }
interface BlockerRow { id: string; case_id: string; task_id: string | null; status: string; blocker_title: string }

async function loadCase(caseId: string): Promise<CaseRow> {
  const { data, error } = await sb.from('hr_onboarding_cases').select('id, status, employee_id, case_no, owner_id').eq('id', caseId).maybeSingle<CaseRow>();
  if (error) throw err(500, error.message);
  if (!data) throw err(404, 'Onboarding case not found.');
  return data;
}

async function mergeCaseMeta(caseId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await sb.from('hr_onboarding_cases').select('metadata').eq('id', caseId).maybeSingle<{ metadata: Record<string, unknown> | null }>();
  if (error) throw err(500, error.message);
  return { ...(data?.metadata ?? {}), ...patch };
}
async function mergeBlockerMeta(blockerId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await sb.from('hr_onboarding_blockers').select('metadata').eq('id', blockerId).maybeSingle<{ metadata: Record<string, unknown> | null }>();
  if (error) throw err(500, error.message);
  return { ...(data?.metadata ?? {}), ...patch };
}

/** Flip a live case between 'blocked' and 'in_progress' from open blocking tasks +
 *  active blockers. Leaves draft / open / paused / ready / terminal states alone. */
export async function recomputeCaseStatus(caseId: string): Promise<void> {
  const { data: kase, error: caseError } = await sb.from('hr_onboarding_cases').select('status').eq('id', caseId).maybeSingle<{ status: string }>();
  if (caseError) throw err(500, caseError.message);
  if (!kase || !['in_progress', 'blocked'].includes(kase.status)) return;
  const [{ data: tasks, error: taskError }, { data: blockers, error: blockerError }] = await Promise.all([
    sb.from('hr_onboarding_tasks').select('status, is_blocking').eq('case_id', caseId),
    sb.from('hr_onboarding_blockers').select('status').eq('case_id', caseId),
  ]);
  if (taskError || blockerError) throw err(500, taskError?.message ?? blockerError?.message ?? 'Could not recompute onboarding status.');
  const openBlocking = ((tasks ?? []) as { status: string; is_blocking: boolean | null }[]).some(t => !!t.is_blocking && isOpenTask(t.status));
  const activeBlocker = ((blockers ?? []) as { status: string }[]).some(b => ACTIVE_BLOCKER.includes(b.status));
  const next = openBlocking || activeBlocker ? 'blocked' : 'in_progress';
  if (next !== kase.status) {
    const { error: updateError } = await sb.from('hr_onboarding_cases').update({ status: next }).eq('id', caseId);
    if (updateError) throw err(500, updateError.message);
  }
}

// ── activation gates (settings-driven; off until the catalog is synced/set) ──────
const GATE_KEYS: { cat: string; key: string }[] = [
  { cat: 'documents', key: 'hr_onboarding.block_activation_until_documents_complete' },
  { cat: 'training',  key: 'hr_onboarding.block_activation_until_training_complete' },
  { cat: 'hse',       key: 'hr_onboarding.block_activation_until_hse_complete' },
  { cat: 'payroll',   key: 'hr_onboarding.block_activation_until_payroll_complete' },
];

/** Category names whose activation gate is ON and which still have open tasks. */
async function activationGateFailures(caseId: string): Promise<string[]> {
  const { data: tasks, error } = await sb.from('hr_onboarding_tasks').select('task_key, module_key, owner_role, status').eq('case_id', caseId);
  if (error) throw err(500, error.message);
  const rows = (tasks ?? []) as { task_key: string; module_key: string | null; owner_role: string | null; status: string }[];
  const fails: string[] = [];
  for (const g of GATE_KEYS) {
    const on = await resolveSettingValue<unknown>(sb, g.key, { moduleKey: 'hr_onboarding' }, false);
    if (on !== true && on !== 'true') continue;
    if (rows.some(t => taskCategory(t) === g.cat && isOpenTask(t.status))) fails.push(g.cat);
  }
  return fails;
}

// ── tasks ────────────────────────────────────────────────────────────────────────
export interface AddTaskArgs { caseId: string; taskTitle: string; ownerRole?: string | null; moduleKey?: string | null; assignedTo?: string | null; dueAt?: string | null; isBlocking?: boolean; requiresEvidence?: boolean; priority?: string | null; taskKey?: string | null }
export async function addOnboardingTask(actorId: string, args: AddTaskArgs): Promise<{ taskId: string; taskKey: string }> {
  const kase = await loadCase(args.caseId);
  if (TERMINAL.includes(kase.status)) throw err(400, `Case already ${kase.status}.`);
  const title = (args.taskTitle ?? '').trim();
  if (!title) throw err(400, 'Task title is required.');
  const taskKey = (args.taskKey ?? '').trim() || slug(title) || 'custom_task';
  const { data: task, error } = await sb.from('hr_onboarding_tasks').insert({
    case_id: kase.id, task_key: taskKey, task_title: title,
    owner_role: args.ownerRole ?? null, module_key: args.moduleKey ?? null, assigned_to: args.assignedTo ?? null,
    status: 'pending', due_at: args.dueAt ?? null, is_blocking: !!args.isBlocking, requires_evidence: !!args.requiresEvidence, priority: args.priority ?? null,
  }).select('id, task_key').single<{ id: string; task_key: string }>();
  if (error) throw err(500, error.message);
  await emitAppEvent({ eventType: 'onboarding.task.added', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { taskKey, taskTitle: title, assignedTo: args.assignedTo ?? null } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId, action: 'hr.onboarding.task_added', newState: { taskKey, taskTitle: title, isBlocking: !!args.isBlocking } });
  if (args.isBlocking) await recomputeCaseStatus(kase.id);
  return { taskId: task.id, taskKey: task.task_key };
}

export async function blockOnboardingTask(actorId: string, args: { taskId: string; reason?: string | null; severity?: string }): Promise<{ taskId: string; status: string }> {
  const { data: task, error: taskError } = await sb.from('hr_onboarding_tasks').select('id, case_id, task_key, task_title, module_key, status, assigned_to, due_at').eq('id', args.taskId).maybeSingle<TaskRow>();
  if (taskError) throw err(500, taskError.message);
  if (!task) throw err(404, 'Onboarding task not found.');
  if (!isOpenTask(task.status)) throw err(400, `Task already ${task.status}.`);
  const { error } = await sb.from('hr_onboarding_tasks').update({ status: 'blocked', blocked_reason: args.reason ?? null }).eq('id', task.id);
  if (error) throw err(500, error.message);
  // One active blocker per task — create only if none is open.
  const { data: existing, error: existingError } = await sb.from('hr_onboarding_blockers').select('id').eq('task_id', task.id).in('status', ACTIVE_BLOCKER).maybeSingle<{ id: string }>();
  if (existingError) throw err(500, existingError.message);
  if (!existing) {
    const { error: bErr } = await sb.from('hr_onboarding_blockers').insert({
      case_id: task.case_id, task_id: task.id, blocker_key: task.task_key, blocker_title: task.task_title,
      blocking_module: task.module_key ?? 'hr', severity: args.severity ?? 'high', status: 'active', owner_id: task.assigned_to ?? null, due_at: task.due_at ?? null,
    });
    if (bErr) throw err(500, bErr.message);
  }
  await emitAppEvent({ eventType: 'onboarding.task.blocked', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: task.case_id, actorUserId: actorId, severity: 'warning', payload: { taskKey: task.task_key, reason: args.reason ?? null } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: task.case_id, actorId, action: 'hr.onboarding.task_blocked', newState: { taskKey: task.task_key, reason: args.reason ?? null } });
  await recomputeCaseStatus(task.case_id);
  return { taskId: task.id, status: 'blocked' };
}

export async function unblockOnboardingTask(actorId: string, args: { taskId: string; reason?: string | null }): Promise<{ taskId: string; status: string }> {
  const { data: task, error: taskError } = await sb.from('hr_onboarding_tasks').select('id, case_id, task_key, task_title, module_key, status, assigned_to, due_at').eq('id', args.taskId).maybeSingle<TaskRow>();
  if (taskError) throw err(500, taskError.message);
  if (!task) throw err(404, 'Onboarding task not found.');
  if (task.status !== 'blocked') throw err(400, 'Task is not blocked.');
  const { error } = await sb.from('hr_onboarding_tasks').update({ status: 'pending', blocked_reason: null }).eq('id', task.id);
  if (error) throw err(500, error.message);
  const { error: blockerError } = await sb.from('hr_onboarding_blockers').update({ status: 'resolved', resolved_by: actorId, resolved_at: nowISO() }).eq('task_id', task.id).in('status', ACTIVE_BLOCKER);
  if (blockerError) throw err(500, blockerError.message);
  await emitAppEvent({ eventType: 'onboarding.task.unblocked', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: task.case_id, actorUserId: actorId, severity: 'info', payload: { taskKey: task.task_key, reason: args.reason ?? null } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: task.case_id, actorId, action: 'hr.onboarding.task_unblocked', newState: { taskKey: task.task_key, reason: args.reason ?? null } });
  await recomputeCaseStatus(task.case_id);
  return { taskId: task.id, status: 'pending' };
}

// ── task notes / evidence (append-only, in task metadata; each append audited) ────
async function loadTaskWithMeta(taskId: string): Promise<TaskRow & { metadata: Record<string, unknown> }> {
  const { data: task, error } = await sb.from('hr_onboarding_tasks')
    .select('id, case_id, task_key, task_title, module_key, status, assigned_to, due_at, metadata')
    .eq('id', taskId).maybeSingle<TaskRow & { metadata: Record<string, unknown> | null }>();
  if (error) throw err(500, error.message);
  if (!task) throw err(404, 'Onboarding task not found.');
  return { ...task, metadata: (task.metadata && typeof task.metadata === 'object' ? task.metadata : {}) };
}
const metaArr = (meta: Record<string, unknown>, key: string): unknown[] => (Array.isArray(meta[key]) ? meta[key] as unknown[] : []);

export async function addOnboardingTaskNote(actorId: string, args: { taskId: string; note: string }): Promise<{ taskId: string; noteId: string }> {
  const note = (args.note ?? '').trim();
  if (!note) throw err(400, 'A note is required.');
  const task = await loadTaskWithMeta(args.taskId);
  const entry = { id: crypto.randomUUID(), note, byId: actorId, byName: null, at: nowISO() };
  const metadata = { ...task.metadata, notes: [...metaArr(task.metadata, 'notes'), entry] };
  const { error } = await sb.from('hr_onboarding_tasks').update({ metadata }).eq('id', task.id);
  if (error) throw err(500, error.message);
  await emitAppEvent({ eventType: 'onboarding.task.note_added', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: task.case_id, actorUserId: actorId, severity: 'info', payload: { taskKey: task.task_key, note } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: task.case_id, actorId, action: 'hr.onboarding.task_note_added', newState: { taskKey: task.task_key, note } });
  return { taskId: task.id, noteId: entry.id };
}

/**
 * Evidence is written to hr_onboarding_task_evidence — NOT to task metadata.
 *
 * The metadata.evidence array is no longer written by any path. It is left in place on
 * existing rows because the migration copied those entries into the table and destroying
 * the source would make that copy unverifiable; nothing reads it any more.
 */
export async function attachOnboardingTaskEvidence(
  actorId: string,
  args: { taskId: string; fileName: string; filePath: string; mimeType?: string | null; fileSize?: number | null },
): Promise<{ taskId: string; evidenceId: string }> {
  const task = await loadTaskWithMeta(args.taskId);
  if (!isOpenTask(task.status)) throw err(400, `Task already ${task.status}.`);

  // Version is per task: the next submission supersedes the latest previous one, so a
  // re-upload after a return is recorded as a new version rather than overwriting history.
  const { data: prior, error: priorErr } = await sb.from('hr_onboarding_task_evidence')
    .select('id, version').eq('task_id', task.id).order('version', { ascending: false }).limit(1);
  if (priorErr) throw err(500, priorErr.message);
  const previous = (prior ?? [])[0] as { id: string; version: number } | undefined;

  const { data: row, error } = await sb.from('hr_onboarding_task_evidence').insert({
    task_id: task.id, case_id: task.case_id,
    file_name: args.fileName, file_path: args.filePath,
    mime_type: args.mimeType ?? null, file_size: args.fileSize ?? null,
    submitted_by: actorId, submitted_at: nowISO(),
    review_status: 'pending_review',
    version: (previous?.version ?? 0) + 1,
    supersedes_id: previous?.id ?? null,
  }).select('id').single<{ id: string }>();
  if (error) throw err(500, error.message);

  await emitAppEvent({ eventType: 'onboarding.task.evidence_attached', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: task.case_id, actorUserId: actorId, severity: 'info', payload: { taskKey: task.task_key, fileName: args.fileName } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: task.case_id, actorId, action: 'hr.onboarding.task_evidence_attached', newState: { taskKey: task.task_key, fileName: args.fileName, filePath: args.filePath } });
  return { taskId: task.id, evidenceId: row.id };
}

/**
 * Approve or return a single evidence submission.
 *
 * Deliberately NOT a reviewer-routing framework: there is no reviewer assignment, no
 * approval chain and no escalation. The actor holds hr.onboarding.task.manage, the decision
 * is recorded on the row, and the task's completion gate re-reads the result.
 */
export async function reviewOnboardingTaskEvidence(
  actorId: string,
  args: { evidenceId: string; decision: 'approved' | 'returned'; note?: string | null },
): Promise<{ evidenceId: string; taskId: string; reviewStatus: string }> {
  const note = (args.note ?? '').trim();
  // Enforced here as well as by the DB constraint so the caller gets a 400 with a usable
  // message instead of a 500 from a constraint violation.
  if (args.decision === 'returned' && !note) throw err(400, 'A reason is required when returning evidence.');

  const { data: ev, error: readErr } = await sb.from('hr_onboarding_task_evidence')
    .select('id, task_id, case_id, file_name, review_status')
    .eq('id', args.evidenceId)
    .maybeSingle<{ id: string; task_id: string; case_id: string; file_name: string | null; review_status: string }>();
  if (readErr) throw err(500, readErr.message);
  if (!ev) throw err(404, 'Evidence submission not found.');
  if (ev.review_status !== 'pending_review') throw err(400, `This submission was already ${ev.review_status}.`);

  // Guarded on the prior state, so two concurrent reviewers cannot both record a decision:
  // the second update matches zero rows and is reported rather than silently winning.
  const { data: updated, error } = await sb.from('hr_onboarding_task_evidence')
    .update({
      review_status: args.decision, reviewed_by: actorId, reviewed_at: nowISO(),
      review_note: note || null,
    })
    .eq('id', ev.id).eq('review_status', 'pending_review')
    .select('id').maybeSingle<{ id: string }>();
  if (error) throw err(500, error.message);
  if (!updated) throw err(409, 'This submission was reviewed by someone else. Reload and try again.');

  const { data: task } = await sb.from('hr_onboarding_tasks')
    .select('assigned_to, task_key, task_title').eq('id', ev.task_id)
    .maybeSingle<{ assigned_to: string | null; task_key: string; task_title: string }>();
  const label = ev.file_name ?? 'Evidence';

  // Returned evidence needs the submitter to act, so it notifies the assignee through the
  // same explicitRecipients path every other onboarding notification uses. An approval
  // needs no notification: the row simply leaves the reviewer's queue.
  const returned = args.decision === 'returned';
  await emitAppEvent({
    eventType: returned ? 'onboarding.task.evidence_returned' : 'onboarding.task.evidence_approved',
    sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: ev.case_id,
    actorUserId: actorId, severity: returned ? 'warning' : 'info',
    payload: { taskId: ev.task_id, taskKey: task?.task_key ?? null, evidenceId: ev.id, fileName: ev.file_name, decision: args.decision, note: note || null },
    ...(returned && task?.assigned_to
      ? {
        explicitRecipients: [{ userId: task.assigned_to, reason: 'assignee' }],
        notification: {
          title: 'Onboarding evidence returned',
          body: `${label} for “${task.task_title}” was returned: ${note}`,
          actionRoute: `hr/onboarding/${ev.case_id}`,
          type: 'onboarding_evidence_returned',
          actionRequired: true,
        },
      }
      : {}),
  });
  await writeHrAudit({
    submoduleKey: 'onboarding', recordId: ev.case_id, actorId,
    action: returned ? 'hr.onboarding.task_evidence_returned' : 'hr.onboarding.task_evidence_approved',
    previousState: { reviewStatus: 'pending_review' },
    newState: { reviewStatus: args.decision, evidenceId: ev.id, fileName: ev.file_name },
    reason: note || null,
  });

  // The decision can change whether a gated task may complete, which can change case
  // readiness — recomputed here so the queue and the case agree immediately.
  await recomputeCaseStatus(ev.case_id);

  return { evidenceId: ev.id, taskId: ev.task_id, reviewStatus: args.decision };
}

/** True when the settings gate hr_onboarding.task_completion_requires_evidence is ON,
 *  this task requires evidence, and no APPROVED submission exists — completion must be
 *  rejected. Gate defaults OFF so existing flows are unchanged until an admin sets it.
 *
 *  Now that evidence carries a review decision, "attached" is no longer sufficient: an
 *  unreviewed or returned document is not evidence of anything. */
export async function taskEvidenceMissing(taskId: string): Promise<boolean> {
  const gate = await resolveSettingValue<unknown>(sb, 'hr_onboarding.task_completion_requires_evidence', { moduleKey: 'hr_onboarding' }, false);
  if (gate !== true && gate !== 'true') return false;
  const { data: task, error: taskError } = await sb.from('hr_onboarding_tasks').select('requires_evidence').eq('id', taskId).maybeSingle<{ requires_evidence: boolean | null }>();
  if (taskError) throw err(500, taskError.message);
  if (!task?.requires_evidence) return false;
  const { count, error } = await sb.from('hr_onboarding_task_evidence')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', taskId).eq('review_status', 'approved');
  // Fail CLOSED: if the check itself fails we cannot prove evidence exists, so completion
  // is blocked rather than allowed through on an error.
  if (error) throw err(500, error.message);
  return (count ?? 0) === 0;
}

// ── case lifecycle ─────────────────────────────────────────────────────────────--
export async function completeOnboardingCase(actorId: string, args: { caseId: string }): Promise<{ caseId: string; status: string }> {
  const kase = await loadCase(args.caseId);
  if (TERMINAL.includes(kase.status)) throw err(400, `Case already ${kase.status}.`);
  const { count, error: countError } = await sb.from('hr_onboarding_tasks').select('id', { count: 'exact', head: true })
    .eq('case_id', kase.id).not('status', 'in', '("completed","skipped","cancelled")');
  if (countError) throw err(500, countError.message);
  if ((count ?? 0) > 0) throw err(400, `Cannot complete: ${count} open task(s) remain. Complete, skip, or cancel them first.`);
  const { error } = await sb.from('hr_onboarding_cases').update({ status: 'completed', completed_at: nowISO() }).eq('id', kase.id);
  if (error) throw err(500, error.message);
  await emitAppEvent({ eventType: 'onboarding.completed', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { caseNo: kase.case_no, employeeId: kase.employee_id, manual: true } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId, action: 'hr.onboarding.completed', newState: { caseNo: kase.case_no, manual: true } });
  return { caseId: kase.id, status: 'completed' };
}

export async function pauseOnboardingCase(actorId: string, args: { caseId: string; reason?: string | null }): Promise<{ caseId: string; status: string }> {
  const kase = await loadCase(args.caseId);
  if (TERMINAL.includes(kase.status)) throw err(400, `Case already ${kase.status}.`);
  if (kase.status === 'paused') throw err(400, 'Case is already paused.');
  const metadata = await mergeCaseMeta(kase.id, { pauseReason: args.reason ?? null });
  const { error } = await sb.from('hr_onboarding_cases').update({ status: 'paused', paused_at: nowISO(), metadata }).eq('id', kase.id);
  if (error) throw err(500, error.message);
  await emitAppEvent({ eventType: 'onboarding.case.paused', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'warning', payload: { caseNo: kase.case_no, reason: args.reason ?? null } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId, action: 'hr.onboarding.paused', previousState: { status: kase.status }, reason: args.reason ?? null });
  return { caseId: kase.id, status: 'paused' };
}

export async function resumeOnboardingCase(actorId: string, args: { caseId: string }): Promise<{ caseId: string; status: string }> {
  const kase = await loadCase(args.caseId);
  if (kase.status !== 'paused') throw err(400, 'Only a paused case can be resumed.');
  const [{ data: tasks }, { data: blockers }] = await Promise.all([
    sb.from('hr_onboarding_tasks').select('status, is_blocking').eq('case_id', kase.id),
    sb.from('hr_onboarding_blockers').select('status').eq('case_id', kase.id),
  ]);
  const blocked = ((tasks ?? []) as { status: string; is_blocking: boolean | null }[]).some(t => !!t.is_blocking && isOpenTask(t.status))
    || ((blockers ?? []) as { status: string }[]).some(b => ACTIVE_BLOCKER.includes(b.status));
  const next = blocked ? 'blocked' : 'in_progress';
  const { error } = await sb.from('hr_onboarding_cases').update({ status: next, paused_at: null }).eq('id', kase.id);
  if (error) throw err(500, error.message);
  await emitAppEvent({ eventType: 'onboarding.case.resumed', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { caseNo: kase.case_no, status: next } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId, action: 'hr.onboarding.resumed', newState: { status: next } });
  return { caseId: kase.id, status: next };
}

export async function reassignOnboardingOwner(actorId: string, args: { caseId: string; ownerId: string | null }): Promise<{ caseId: string; ownerId: string | null }> {
  const kase = await loadCase(args.caseId);
  if (args.ownerId) {
    const { data: owner, error: ownerError } = await sb.from('app_users').select('id').eq('id', args.ownerId).maybeSingle<{ id: string }>();
    if (ownerError) throw err(500, ownerError.message);
    if (!owner) throw err(404, 'New owner not found.');
  }
  const { error } = await sb.from('hr_onboarding_cases').update({ owner_id: args.ownerId }).eq('id', kase.id);
  if (error) throw err(500, error.message);
  await emitAppEvent({ eventType: 'onboarding.case.owner_changed', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { previousOwnerId: kase.owner_id, ownerId: args.ownerId } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId, action: 'hr.onboarding.owner_changed', previousState: { ownerId: kase.owner_id }, newState: { ownerId: args.ownerId } });
  return { caseId: kase.id, ownerId: args.ownerId };
}

export async function markOnboardingReady(actorId: string, args: { caseId: string }): Promise<{ caseId: string; status: string }> {
  const kase = await loadCase(args.caseId);
  if (TERMINAL.includes(kase.status)) throw err(400, `Case already ${kase.status}.`);
  const [{ data: tasks, error: taskError }, { data: blockers, error: blockerError }] = await Promise.all([
    sb.from('hr_onboarding_tasks').select('status, is_blocking').eq('case_id', kase.id),
    sb.from('hr_onboarding_blockers').select('status').eq('case_id', kase.id),
  ]);
  if (taskError || blockerError) throw err(500, taskError?.message ?? blockerError?.message ?? 'Could not verify activation readiness.');
  const stillBlocked = ((tasks ?? []) as { status: string; is_blocking: boolean | null }[]).some(t => !!t.is_blocking && isOpenTask(t.status))
    || ((blockers ?? []) as { status: string }[]).some(b => ACTIVE_BLOCKER.includes(b.status));
  if (stillBlocked) throw err(400, 'Resolve all blocking tasks and active blockers before marking ready for activation.');
  const gateFails = await activationGateFailures(kase.id);
  if (gateFails.length) throw err(400, `Activation gates not met — incomplete: ${gateFails.join(', ')}.`);
  const { error } = await sb.from('hr_onboarding_cases').update({ status: 'ready_for_activation' }).eq('id', kase.id);
  if (error) throw err(500, error.message);
  await emitAppEvent({ eventType: 'onboarding.case.ready_for_activation', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { caseNo: kase.case_no } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId, action: 'hr.onboarding.ready_for_activation', previousState: { status: kase.status } });
  return { caseId: kase.id, status: 'ready_for_activation' };
}

// ── blockers ─────────────────────────────────────────────────────────────────────
async function loadBlocker(blockerId: string): Promise<BlockerRow> {
  const { data, error } = await sb.from('hr_onboarding_blockers').select('id, case_id, task_id, status, blocker_title').eq('id', blockerId).maybeSingle<BlockerRow>();
  if (error) throw err(500, error.message);
  if (!data) throw err(404, 'Blocker not found.');
  return data;
}
async function unblockLinkedTask(taskId: string | null): Promise<void> {
  if (!taskId) return;
  const { error } = await sb.from('hr_onboarding_tasks').update({ status: 'pending', blocked_reason: null }).eq('id', taskId).eq('status', 'blocked');
  if (error) throw err(500, error.message);
}

export async function resolveOnboardingBlocker(actorId: string, args: { blockerId: string; note?: string | null }): Promise<{ blockerId: string; status: string }> {
  const b = await loadBlocker(args.blockerId);
  if (['resolved', 'waived'].includes(b.status)) throw err(400, `Blocker already ${b.status}.`);
  const metadata = await mergeBlockerMeta(b.id, { resolveNote: args.note ?? null });
  const { error } = await sb.from('hr_onboarding_blockers').update({ status: 'resolved', resolved_by: actorId, resolved_at: nowISO(), metadata }).eq('id', b.id);
  if (error) throw err(500, error.message);
  await unblockLinkedTask(b.task_id);
  await emitAppEvent({ eventType: 'onboarding.blocker.resolved', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: b.case_id, actorUserId: actorId, severity: 'info', payload: { blockerTitle: b.blocker_title, note: args.note ?? null } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: b.case_id, actorId, action: 'hr.onboarding.blocker_resolved', newState: { blockerTitle: b.blocker_title }, reason: args.note ?? null });
  await recomputeCaseStatus(b.case_id);
  return { blockerId: b.id, status: 'resolved' };
}

export async function escalateOnboardingBlocker(actorId: string, args: { blockerId: string; note?: string | null; newOwnerId?: string | null }): Promise<{ blockerId: string; status: string }> {
  const b = await loadBlocker(args.blockerId);
  if (['resolved', 'waived'].includes(b.status)) throw err(400, `Blocker already ${b.status}.`);
  const metadata = await mergeBlockerMeta(b.id, { escalateNote: args.note ?? null });
  const patch: Record<string, unknown> = { status: 'escalated', metadata };
  if (args.newOwnerId !== undefined) patch['owner_id'] = args.newOwnerId;
  const { error } = await sb.from('hr_onboarding_blockers').update(patch).eq('id', b.id);
  if (error) throw err(500, error.message);
  await emitAppEvent({ eventType: 'onboarding.blocker.escalated', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: b.case_id, actorUserId: actorId, severity: 'warning', payload: { blockerTitle: b.blocker_title, newOwnerId: args.newOwnerId ?? null } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: b.case_id, actorId, action: 'hr.onboarding.blocker_escalated', newState: { blockerTitle: b.blocker_title, newOwnerId: args.newOwnerId ?? null }, reason: args.note ?? null });
  return { blockerId: b.id, status: 'escalated' };
}

/** Nudge the blocker's owner — sends a real in-app notification (app_event with an
 *  explicit recipient) to whoever owns the blocker, so the Blocked board's "Notify
 *  Owner" isn't a dead button. Requires an owner; the message is optional. */
export async function notifyOnboardingBlockerOwner(
  actorId: string, args: { blockerId: string; message?: string | null },
): Promise<{ blockerId: string; notifiedOwnerId: string; notifiedAt: string }> {
  const { data: b, error } = await sb.from('hr_onboarding_blockers')
    .select('id, case_id, status, blocker_title, blocking_module, owner_id')
    .eq('id', args.blockerId).maybeSingle<{ id: string; case_id: string; status: string; blocker_title: string; blocking_module: string; owner_id: string | null }>();
  if (error) throw err(500, error.message);
  if (!b) throw err(404, 'Blocker not found.');
  if (!ACTIVE_BLOCKER.includes(b.status)) throw err(400, `Blocker is ${b.status} — nothing to notify.`);
  if (!b.owner_id) throw err(400, 'This blocker has no owner to notify. Assign an owner first (escalate).');

  const at = nowISO();
  const message = (args.message ?? '').trim() || `Action needed on onboarding blocker: ${b.blocker_title} (${humanizeModule(b.blocking_module)}).`;
  await emitAppEvent({
    eventType: 'onboarding.blocker.owner_notified', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: b.case_id,
    actorUserId: actorId, severity: 'warning',
    payload: { blockerId: b.id, blockerTitle: b.blocker_title, blockingModule: b.blocking_module, ownerId: b.owner_id, message },
    explicitRecipients: [{ userId: b.owner_id, reason: 'owner' }],
    notification: { title: 'Onboarding blocker needs attention', body: message, actionRoute: `hr/onboarding/${b.case_id}`, type: 'onboarding_blocker_reminder', actionRequired: true },
  });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: b.case_id, actorId, action: 'hr.onboarding.blocker_owner_notified', newState: { blockerTitle: b.blocker_title, ownerId: b.owner_id }, reason: args.message ?? null });
  return { blockerId: b.id, notifiedOwnerId: b.owner_id, notifiedAt: at };
}

export async function waiveOnboardingBlocker(actorId: string, args: { blockerId: string; reason: string }): Promise<{ blockerId: string; status: string }> {
  const reason = (args.reason ?? '').trim();
  if (!reason) throw err(400, 'A waiver reason is required.');
  const allowWaiver = await resolveSettingValue<unknown>(sb, 'hr_onboarding.allow_blocker_waiver', { moduleKey: 'hr_onboarding' }, true);
  if (allowWaiver === false || allowWaiver === 'false') throw err(403, 'Blocker waivers are disabled in settings.');
  const b = await loadBlocker(args.blockerId);
  if (['resolved', 'waived'].includes(b.status)) throw err(400, `Blocker already ${b.status}.`);
  // NOTE: when settings exist (Phase 7), hr.onboarding.blocker_waiver_requires_workflow
  // will route this through a workflow approval before the waiver takes effect.
  const { error } = await sb.from('hr_onboarding_blockers').update({ status: 'waived', waiver_reason: reason, resolved_by: actorId, resolved_at: nowISO() }).eq('id', b.id);
  if (error) throw err(500, error.message);
  await unblockLinkedTask(b.task_id);
  await emitAppEvent({ eventType: 'onboarding.blocker.waived', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: b.case_id, actorUserId: actorId, severity: 'warning', payload: { blockerTitle: b.blocker_title, reason } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: b.case_id, actorId, action: 'hr.onboarding.blocker_waived', newState: { blockerTitle: b.blocker_title }, reason });
  await recomputeCaseStatus(b.case_id);
  return { blockerId: b.id, status: 'waived' };
}

// ── handoffs (cross-case control center — retry / accept / complete / cancel) ─────
// The full lifecycle FSM. Includes 'delivered' (an intent a receiver auto-fulfils,
// distinct from a human 'completed'); a delivered handoff can still be marked complete
// or cancelled but never re-opened. Terminal states have no outgoing edges.
const HANDOFF_TRANSITIONS: Record<string, OnboardingHandoffStatus[]> = {
  pending:   ['sent', 'accepted', 'cancelled', 'failed'],
  sent:      ['accepted', 'delivered', 'failed', 'cancelled'],
  accepted:  ['delivered', 'completed', 'blocked', 'cancelled'],
  delivered: ['completed', 'cancelled'],
  blocked:   ['accepted', 'completed', 'cancelled'],
  failed:    ['pending', 'cancelled'],
  completed: [],
  cancelled: [],
};

interface HandoffRow { id: string; case_id: string; status: string; target_module: string; handoff_type: string | null }
async function loadHandoff(handoffId: string): Promise<HandoffRow> {
  const { data, error } = await sb.from('hr_onboarding_handoffs').select('id, case_id, status, target_module, handoff_type').eq('id', handoffId).maybeSingle<HandoffRow>();
  if (error) throw err(500, error.message);
  if (!data) throw err(404, 'Onboarding handoff not found.');
  return data;
}

/** One transition, shared by all four handoff actions. Validates the FSM edge, stamps
 *  the right timestamp/failure_reason columns, events + audits, and recomputes the case
 *  (a blocked/failed handoff can gate the case; clearing it can unblock). */
async function transitionHandoff(
  actorId: string, handoffId: string, to: OnboardingHandoffStatus,
  opts: { reason?: string | null; eventType: string; action: string; severity: 'info' | 'warning' } = {} as never,
): Promise<OnboardingHandoffActionResult> {
  const h = await loadHandoff(handoffId);
  const allowed = HANDOFF_TRANSITIONS[h.status] ?? [];
  if (!allowed.includes(to)) throw err(400, `Cannot move a ${h.status} handoff to ${to}.`);
  const at = nowISO();
  const patch: Record<string, unknown> = { status: to, last_event_at: at };
  if (to === 'accepted')  patch['accepted_at'] = at;
  if (to === 'completed') patch['completed_at'] = at;
  if (to === 'failed')    patch['failure_reason'] = opts.reason ?? null;
  if (to === 'pending')   patch['failure_reason'] = null;   // retry clears the prior failure
  const { error } = await sb.from('hr_onboarding_handoffs').update(patch).eq('id', h.id);
  if (error) throw err(500, error.message);
  await emitAppEvent({ eventType: opts.eventType, sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: h.case_id, actorUserId: actorId, severity: opts.severity, payload: { handoffId: h.id, targetModule: h.target_module, handoffType: h.handoff_type, from: h.status, to, reason: opts.reason ?? null } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: h.case_id, actorId, action: opts.action, previousState: { status: h.status }, newState: { status: to }, reason: opts.reason ?? null });
  await recomputeCaseStatus(h.case_id);
  return { handoffId: h.id, caseId: h.case_id, status: to, lastEventAt: at };
}

/** Failed → pending: re-queue a failed handoff for delivery. */
export const retryOnboardingHandoff = (actorId: string, a: { handoffId: string; reason?: string | null }): Promise<OnboardingHandoffActionResult> =>
  transitionHandoff(actorId, a.handoffId, 'pending', { reason: a.reason, eventType: 'onboarding.handoff.retried', action: 'hr.onboarding.handoff_retried', severity: 'info' });

/** pending/sent → accepted: the target module acknowledged the handoff. */
export const acceptOnboardingHandoff = (actorId: string, a: { handoffId: string; reason?: string | null }): Promise<OnboardingHandoffActionResult> =>
  transitionHandoff(actorId, a.handoffId, 'accepted', { reason: a.reason, eventType: 'onboarding.handoff.accepted', action: 'hr.onboarding.handoff_accepted', severity: 'info' });

/** → completed: the target module finished the work. */
export const completeOnboardingHandoff = (actorId: string, a: { handoffId: string; reason?: string | null }): Promise<OnboardingHandoffActionResult> =>
  transitionHandoff(actorId, a.handoffId, 'completed', { reason: a.reason, eventType: 'onboarding.handoff.completed', action: 'hr.onboarding.handoff_completed', severity: 'info' });

/** → cancelled: abandon the handoff (any non-terminal state). */
export const cancelOnboardingHandoff = (actorId: string, a: { handoffId: string; reason?: string | null }): Promise<OnboardingHandoffActionResult> =>
  transitionHandoff(actorId, a.handoffId, 'cancelled', { reason: a.reason, eventType: 'onboarding.handoff.cancelled', action: 'hr.onboarding.handoff_cancelled', severity: 'warning' });

// ── case audit (Audit tab) ─────────────────────────────────────────────────────--
export async function listOnboardingAudit(caseId: string): Promise<OnboardingAuditRow[]> {
  const { data, error } = await sb.from('hr_audit_log')
    .select('id, actor_id, action, previous_state, new_state, reason, created_at')
    .eq('record_id', caseId).eq('submodule_key', 'onboarding')
    .order('created_at', { ascending: false }).limit(500);
  if (error) throw err(500, error.message);
  const rows = (data ?? []) as { id: string; actor_id: string | null; action: string; previous_state: unknown; new_state: unknown; reason: string | null; created_at: string }[];
  const actorIds = [...new Set(rows.map(r => r.actor_id).filter((x): x is string => !!x))];
  const actorResult = actorIds.length ? await sb.from('app_users').select('id, full_name').in('id', actorIds) : { data: [], error: null };
  if (actorResult.error) throw err(500, actorResult.error.message);
  const names: Record<string, string | null> = Object.fromEntries(((actorResult.data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name]));
  return rows.map(r => ({
    id: r.id, action: r.action, actorId: r.actor_id ?? null, actorName: r.actor_id ? names[r.actor_id] ?? null : null,
    reason: r.reason ?? null, previousState: r.previous_state ?? null, newState: r.new_state ?? null, createdAt: r.created_at,
  }));
}
