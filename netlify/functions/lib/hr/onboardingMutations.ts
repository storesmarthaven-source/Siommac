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
import type { OnboardingAuditRow } from '../../../../types/hrOnboarding';

const err = (status: number, message: string): Error => Object.assign(new Error(message), { status });
const nowISO = (): string => new Date().toISOString();
const TERMINAL = ['completed', 'cancelled'];
const ACTIVE_BLOCKER = ['active', 'acknowledged', 'waiting_on_owner', 'escalated'];
const isOpenTask = (s: string): boolean => !['completed', 'skipped', 'cancelled'].includes(s);
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

interface CaseRow { id: string; status: string; employee_id: string | null; case_no: string; owner_id: string | null }
interface TaskRow { id: string; case_id: string; task_key: string; task_title: string; module_key: string | null; status: string; assigned_to: string | null; due_at: string | null }
interface BlockerRow { id: string; case_id: string; task_id: string | null; status: string; blocker_title: string }

async function loadCase(caseId: string): Promise<CaseRow> {
  const { data } = await sb.from('hr_onboarding_cases').select('id, status, employee_id, case_no, owner_id').eq('id', caseId).maybeSingle<CaseRow>();
  if (!data) throw err(404, 'Onboarding case not found.');
  return data;
}

async function mergeCaseMeta(caseId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await sb.from('hr_onboarding_cases').select('metadata').eq('id', caseId).maybeSingle<{ metadata: Record<string, unknown> | null }>();
  return { ...(data?.metadata ?? {}), ...patch };
}
async function mergeBlockerMeta(blockerId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await sb.from('hr_onboarding_blockers').select('metadata').eq('id', blockerId).maybeSingle<{ metadata: Record<string, unknown> | null }>();
  return { ...(data?.metadata ?? {}), ...patch };
}

/** Flip a live case between 'blocked' and 'in_progress' from open blocking tasks +
 *  active blockers. Leaves draft / open / paused / ready / terminal states alone. */
export async function recomputeCaseStatus(caseId: string): Promise<void> {
  const { data: kase } = await sb.from('hr_onboarding_cases').select('status').eq('id', caseId).maybeSingle<{ status: string }>();
  if (!kase || !['in_progress', 'blocked'].includes(kase.status)) return;
  const [{ data: tasks }, { data: blockers }] = await Promise.all([
    sb.from('hr_onboarding_tasks').select('status, is_blocking').eq('case_id', caseId),
    sb.from('hr_onboarding_blockers').select('status').eq('case_id', caseId),
  ]);
  const openBlocking = ((tasks ?? []) as { status: string; is_blocking: boolean | null }[]).some(t => !!t.is_blocking && isOpenTask(t.status));
  const activeBlocker = ((blockers ?? []) as { status: string }[]).some(b => ACTIVE_BLOCKER.includes(b.status));
  const next = openBlocking || activeBlocker ? 'blocked' : 'in_progress';
  if (next !== kase.status) await sb.from('hr_onboarding_cases').update({ status: next }).eq('id', caseId);
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
  const { data: tasks } = await sb.from('hr_onboarding_tasks').select('task_key, module_key, owner_role, status').eq('case_id', caseId);
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
  void emitAppEvent({ eventType: 'onboarding.task.added', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { taskKey, taskTitle: title, assignedTo: args.assignedTo ?? null } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId, action: 'hr.onboarding.task_added', newState: { taskKey, taskTitle: title, isBlocking: !!args.isBlocking } });
  if (args.isBlocking) await recomputeCaseStatus(kase.id);
  return { taskId: task.id, taskKey: task.task_key };
}

export async function blockOnboardingTask(actorId: string, args: { taskId: string; reason?: string | null; severity?: string }): Promise<{ taskId: string; status: string }> {
  const { data: task } = await sb.from('hr_onboarding_tasks').select('id, case_id, task_key, task_title, module_key, status, assigned_to, due_at').eq('id', args.taskId).maybeSingle<TaskRow>();
  if (!task) throw err(404, 'Onboarding task not found.');
  if (!isOpenTask(task.status)) throw err(400, `Task already ${task.status}.`);
  const { error } = await sb.from('hr_onboarding_tasks').update({ status: 'blocked', blocked_reason: args.reason ?? null }).eq('id', task.id);
  if (error) throw err(500, error.message);
  // One active blocker per task — create only if none is open.
  const { data: existing } = await sb.from('hr_onboarding_blockers').select('id').eq('task_id', task.id).in('status', ACTIVE_BLOCKER).maybeSingle<{ id: string }>();
  if (!existing) {
    const { error: bErr } = await sb.from('hr_onboarding_blockers').insert({
      case_id: task.case_id, task_id: task.id, blocker_key: task.task_key, blocker_title: task.task_title,
      blocking_module: task.module_key ?? 'hr', severity: args.severity ?? 'high', status: 'active', owner_id: task.assigned_to ?? null, due_at: task.due_at ?? null,
    });
    if (bErr) throw err(500, bErr.message);
  }
  void emitAppEvent({ eventType: 'onboarding.task.blocked', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: task.case_id, actorUserId: actorId, severity: 'warning', payload: { taskKey: task.task_key, reason: args.reason ?? null } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: task.case_id, actorId, action: 'hr.onboarding.task_blocked', newState: { taskKey: task.task_key, reason: args.reason ?? null } });
  await recomputeCaseStatus(task.case_id);
  return { taskId: task.id, status: 'blocked' };
}

export async function unblockOnboardingTask(actorId: string, args: { taskId: string; reason?: string | null }): Promise<{ taskId: string; status: string }> {
  const { data: task } = await sb.from('hr_onboarding_tasks').select('id, case_id, task_key, task_title, module_key, status, assigned_to, due_at').eq('id', args.taskId).maybeSingle<TaskRow>();
  if (!task) throw err(404, 'Onboarding task not found.');
  if (task.status !== 'blocked') throw err(400, 'Task is not blocked.');
  const { error } = await sb.from('hr_onboarding_tasks').update({ status: 'pending', blocked_reason: null }).eq('id', task.id);
  if (error) throw err(500, error.message);
  await sb.from('hr_onboarding_blockers').update({ status: 'resolved', resolved_by: actorId, resolved_at: nowISO() }).eq('task_id', task.id).in('status', ACTIVE_BLOCKER);
  void emitAppEvent({ eventType: 'onboarding.task.unblocked', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: task.case_id, actorUserId: actorId, severity: 'info', payload: { taskKey: task.task_key, reason: args.reason ?? null } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: task.case_id, actorId, action: 'hr.onboarding.task_unblocked', newState: { taskKey: task.task_key, reason: args.reason ?? null } });
  await recomputeCaseStatus(task.case_id);
  return { taskId: task.id, status: 'pending' };
}

// ── case lifecycle ─────────────────────────────────────────────────────────────--
export async function completeOnboardingCase(actorId: string, args: { caseId: string }): Promise<{ caseId: string; status: string }> {
  const kase = await loadCase(args.caseId);
  if (TERMINAL.includes(kase.status)) throw err(400, `Case already ${kase.status}.`);
  const { count } = await sb.from('hr_onboarding_tasks').select('id', { count: 'exact', head: true })
    .eq('case_id', kase.id).not('status', 'in', '("completed","skipped","cancelled")');
  if ((count ?? 0) > 0) throw err(400, `Cannot complete: ${count} open task(s) remain. Complete, skip, or cancel them first.`);
  const { error } = await sb.from('hr_onboarding_cases').update({ status: 'completed', completed_at: nowISO() }).eq('id', kase.id);
  if (error) throw err(500, error.message);
  void emitAppEvent({ eventType: 'onboarding.completed', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { caseNo: kase.case_no, employeeId: kase.employee_id, manual: true } });
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
  void emitAppEvent({ eventType: 'onboarding.case.paused', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'warning', payload: { caseNo: kase.case_no, reason: args.reason ?? null } });
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
  void emitAppEvent({ eventType: 'onboarding.case.resumed', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { caseNo: kase.case_no, status: next } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId, action: 'hr.onboarding.resumed', newState: { status: next } });
  return { caseId: kase.id, status: next };
}

export async function reassignOnboardingOwner(actorId: string, args: { caseId: string; ownerId: string | null }): Promise<{ caseId: string; ownerId: string | null }> {
  const kase = await loadCase(args.caseId);
  if (args.ownerId) {
    const { data: owner } = await sb.from('app_users').select('id').eq('id', args.ownerId).maybeSingle<{ id: string }>();
    if (!owner) throw err(404, 'New owner not found.');
  }
  const { error } = await sb.from('hr_onboarding_cases').update({ owner_id: args.ownerId }).eq('id', kase.id);
  if (error) throw err(500, error.message);
  void emitAppEvent({ eventType: 'onboarding.case.owner_changed', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { previousOwnerId: kase.owner_id, ownerId: args.ownerId } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId, action: 'hr.onboarding.owner_changed', previousState: { ownerId: kase.owner_id }, newState: { ownerId: args.ownerId } });
  return { caseId: kase.id, ownerId: args.ownerId };
}

export async function markOnboardingReady(actorId: string, args: { caseId: string }): Promise<{ caseId: string; status: string }> {
  const kase = await loadCase(args.caseId);
  if (TERMINAL.includes(kase.status)) throw err(400, `Case already ${kase.status}.`);
  const [{ data: tasks }, { data: blockers }] = await Promise.all([
    sb.from('hr_onboarding_tasks').select('status, is_blocking').eq('case_id', kase.id),
    sb.from('hr_onboarding_blockers').select('status').eq('case_id', kase.id),
  ]);
  const stillBlocked = ((tasks ?? []) as { status: string; is_blocking: boolean | null }[]).some(t => !!t.is_blocking && isOpenTask(t.status))
    || ((blockers ?? []) as { status: string }[]).some(b => ACTIVE_BLOCKER.includes(b.status));
  if (stillBlocked) throw err(400, 'Resolve all blocking tasks and active blockers before marking ready for activation.');
  const gateFails = await activationGateFailures(kase.id);
  if (gateFails.length) throw err(400, `Activation gates not met — incomplete: ${gateFails.join(', ')}.`);
  const { error } = await sb.from('hr_onboarding_cases').update({ status: 'ready_for_activation' }).eq('id', kase.id);
  if (error) throw err(500, error.message);
  void emitAppEvent({ eventType: 'onboarding.case.ready_for_activation', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: kase.id, actorUserId: actorId, severity: 'info', payload: { caseNo: kase.case_no } });
  await writeHrAudit({ employeeId: kase.employee_id, submoduleKey: 'onboarding', recordId: kase.id, actorId, action: 'hr.onboarding.ready_for_activation', previousState: { status: kase.status } });
  return { caseId: kase.id, status: 'ready_for_activation' };
}

// ── blockers ─────────────────────────────────────────────────────────────────────
async function loadBlocker(blockerId: string): Promise<BlockerRow> {
  const { data } = await sb.from('hr_onboarding_blockers').select('id, case_id, task_id, status, blocker_title').eq('id', blockerId).maybeSingle<BlockerRow>();
  if (!data) throw err(404, 'Blocker not found.');
  return data;
}
async function unblockLinkedTask(taskId: string | null): Promise<void> {
  if (!taskId) return;
  await sb.from('hr_onboarding_tasks').update({ status: 'pending', blocked_reason: null }).eq('id', taskId).eq('status', 'blocked');
}

export async function resolveOnboardingBlocker(actorId: string, args: { blockerId: string; note?: string | null }): Promise<{ blockerId: string; status: string }> {
  const b = await loadBlocker(args.blockerId);
  if (['resolved', 'waived'].includes(b.status)) throw err(400, `Blocker already ${b.status}.`);
  const metadata = await mergeBlockerMeta(b.id, { resolveNote: args.note ?? null });
  const { error } = await sb.from('hr_onboarding_blockers').update({ status: 'resolved', resolved_by: actorId, resolved_at: nowISO(), metadata }).eq('id', b.id);
  if (error) throw err(500, error.message);
  await unblockLinkedTask(b.task_id);
  void emitAppEvent({ eventType: 'onboarding.blocker.resolved', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: b.case_id, actorUserId: actorId, severity: 'info', payload: { blockerTitle: b.blocker_title, note: args.note ?? null } });
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
  void emitAppEvent({ eventType: 'onboarding.blocker.escalated', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: b.case_id, actorUserId: actorId, severity: 'warning', payload: { blockerTitle: b.blocker_title, newOwnerId: args.newOwnerId ?? null } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: b.case_id, actorId, action: 'hr.onboarding.blocker_escalated', newState: { blockerTitle: b.blocker_title, newOwnerId: args.newOwnerId ?? null }, reason: args.note ?? null });
  return { blockerId: b.id, status: 'escalated' };
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
  void emitAppEvent({ eventType: 'onboarding.blocker.waived', sourceModule: 'hr', sourceEntityType: 'onboarding_case', sourceEntityId: b.case_id, actorUserId: actorId, severity: 'warning', payload: { blockerTitle: b.blocker_title, reason } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: b.case_id, actorId, action: 'hr.onboarding.blocker_waived', newState: { blockerTitle: b.blocker_title }, reason });
  await recomputeCaseStatus(b.case_id);
  return { blockerId: b.id, status: 'waived' };
}

// ── case audit (Audit tab) ─────────────────────────────────────────────────────--
export async function listOnboardingAudit(caseId: string): Promise<OnboardingAuditRow[]> {
  const { data } = await sb.from('hr_audit_log')
    .select('id, actor_id, action, previous_state, new_state, reason, created_at')
    .eq('record_id', caseId).eq('submodule_key', 'onboarding')
    .order('created_at', { ascending: false }).limit(500);
  const rows = (data ?? []) as { id: string; actor_id: string | null; action: string; previous_state: unknown; new_state: unknown; reason: string | null; created_at: string }[];
  const actorIds = [...new Set(rows.map(r => r.actor_id).filter((x): x is string => !!x))];
  const names: Record<string, string | null> = actorIds.length
    ? Object.fromEntries((((await sb.from('app_users').select('id, full_name').in('id', actorIds)).data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name]))
    : {};
  return rows.map(r => ({
    id: r.id, action: r.action, actorId: r.actor_id ?? null, actorName: r.actor_id ? names[r.actor_id] ?? null : null,
    reason: r.reason ?? null, previousState: r.previous_state ?? null, newState: r.new_state ?? null, createdAt: r.created_at,
  }));
}
