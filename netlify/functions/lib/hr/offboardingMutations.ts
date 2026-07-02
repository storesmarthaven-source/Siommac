// lib/hr/offboardingMutations.ts — offboarding lifecycle mutations.
//
// task complete · pause/resume/cancel · reassign owner · mark ready-for-exit ·
// FINALIZE (terminate the employee → login disabled, + ensure the IT access-removal
// handoff). Every mutation: direct sb write → emitAppEvent (void) → writeHrAudit
// (awaited; throws). FINALIZE reuses the exact employee status-change + auth-sync
// pattern from routes/hr.ts (status → terminated, app_users.status → inactive).

import { sb }           from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import type {
  CompleteOffboardingTaskArgs, CaseIdArg, PauseCaseArgs, CancelCaseArgs,
  ReassignOwnerArgs, FinalizeOffboardingArgs, FinalizeOffboardingResult,
} from '../../../../types/hrOffboarding';

function httpError(status: number, message: string): Error & { status: number } { return Object.assign(new Error(message), { status }); }
function nowISO(): string { return new Date().toISOString(); }

interface CaseRow { id: string; employee_id: string | null; status: string; case_no: string }
async function loadCase(caseId: string): Promise<CaseRow> {
  const { data } = await sb.from('hr_offboarding_cases').select('id, employee_id, status, case_no').eq('id', caseId).maybeSingle<CaseRow>();
  if (!data) throw httpError(404, 'Offboarding case not found.');
  return data;
}

export async function completeOffboardingTask(actorId: string, args: CompleteOffboardingTaskArgs): Promise<{ taskId: string; status: string }> {
  const { data: task } = await sb.from('hr_offboarding_tasks').select('id, case_id, task_title, status').eq('id', args.taskId).maybeSingle<{ id: string; case_id: string; task_title: string; status: string }>();
  if (!task) throw httpError(404, 'Task not found.');
  const { error } = await sb.from('hr_offboarding_tasks').update({ status: 'completed', completed_by: actorId, completed_at: nowISO() }).eq('id', args.taskId);
  if (error) throw httpError(500, error.message);
  void emitAppEvent({ eventType: 'offboarding.task.completed', sourceModule: 'hr', sourceEntityType: 'offboarding_case', sourceEntityId: task.case_id, actorUserId: actorId, severity: 'info', payload: { taskId: task.id, taskTitle: task.task_title } });
  await writeHrAudit({ submoduleKey: 'offboarding', recordId: task.case_id, actorId, action: 'hr.offboarding.task_completed', newState: { taskId: task.id } });
  return { taskId: args.taskId, status: 'completed' };
}

async function setCaseStatus(actorId: string, caseId: string, status: string, patch: Record<string, unknown>, action: string, reason?: string | null): Promise<{ caseId: string; status: string }> {
  const current = await loadCase(caseId);
  const { error } = await sb.from('hr_offboarding_cases').update({ status, ...patch }).eq('id', caseId);
  if (error) throw httpError(500, error.message);
  void emitAppEvent({ eventType: `offboarding.${status}`, sourceModule: 'hr', sourceEntityType: 'offboarding_case', sourceEntityId: caseId, actorUserId: actorId, severity: status === 'cancelled' ? 'warning' : 'info', payload: { caseNo: current.case_no } });
  await writeHrAudit({ employeeId: current.employee_id, submoduleKey: 'offboarding', recordId: caseId, actorId, action, previousState: { status: current.status }, newState: { status }, reason: reason ?? null });
  return { caseId, status };
}

export async function pauseOffboardingCase(actorId: string, args: PauseCaseArgs): Promise<{ caseId: string; status: string }> {
  return setCaseStatus(actorId, args.caseId, 'paused', { paused_at: nowISO() }, 'hr.offboarding.paused', args.reason);
}
export async function resumeOffboardingCase(actorId: string, args: CaseIdArg): Promise<{ caseId: string; status: string }> {
  return setCaseStatus(actorId, args.caseId, 'in_progress', { paused_at: null }, 'hr.offboarding.resumed');
}
export async function markReadyForExit(actorId: string, args: CaseIdArg): Promise<{ caseId: string; status: string }> {
  return setCaseStatus(actorId, args.caseId, 'ready_for_exit', { ready_at: nowISO() }, 'hr.offboarding.ready_for_exit');
}
export async function cancelOffboardingCase(actorId: string, args: CancelCaseArgs): Promise<{ caseId: string; status: string }> {
  return setCaseStatus(actorId, args.caseId, 'cancelled', { cancelled_by: actorId, cancelled_at: nowISO() }, 'hr.offboarding.cancelled', args.reason);
}
export async function completeOffboardingCase(actorId: string, args: CaseIdArg): Promise<{ caseId: string; status: string }> {
  return setCaseStatus(actorId, args.caseId, 'completed', { completed_at: nowISO() }, 'hr.offboarding.completed');
}

export async function reassignOffboardingOwner(actorId: string, args: ReassignOwnerArgs): Promise<{ caseId: string; ownerId: string | null }> {
  const current = await loadCase(args.caseId);
  const { error } = await sb.from('hr_offboarding_cases').update({ owner_id: args.ownerId }).eq('id', args.caseId);
  if (error) throw httpError(500, error.message);
  void emitAppEvent({ eventType: 'offboarding.owner.reassigned', sourceModule: 'hr', sourceEntityType: 'offboarding_case', sourceEntityId: args.caseId, actorUserId: actorId, severity: 'info', payload: { ownerId: args.ownerId } });
  await writeHrAudit({ employeeId: current.employee_id, submoduleKey: 'offboarding', recordId: args.caseId, actorId, action: 'hr.offboarding.owner_reassigned', newState: { ownerId: args.ownerId } });
  return { caseId: args.caseId, ownerId: args.ownerId };
}

/**
 * FINALIZE — the inverse of onboarding activation. Terminates the employee (status →
 * terminated, auth synced to inactive = login disabled) via the same path as
 * routes/hr.ts employees/status-change, ensures the IT access-removal handoff exists
 * (pending — no IT receiver yet; never faked), and completes the case.
 */
export async function finalizeOffboarding(actorId: string, args: FinalizeOffboardingArgs): Promise<FinalizeOffboardingResult> {
  const kase = await loadCase(args.caseId);
  if (kase.status === 'completed' || kase.status === 'cancelled') throw httpError(400, `Cannot finalize a ${kase.status} case.`);
  if (!kase.employee_id) throw httpError(400, 'Case has no linked employee to terminate.');
  const employeeId = kase.employee_id;

  // 1. Terminate the employee (status history + auth sync), mirroring the HR status-change path.
  const { data: emp } = await sb.from('app_users').select('status').eq('id', employeeId).maybeSingle<{ status: string }>();
  const previousStatus = emp?.status ?? 'active';
  await sb.from('hr_employee_status_history').insert({
    employee_id: employeeId, previous_status: previousStatus, new_status: 'terminated',
    reason: `Offboarding ${kase.case_no}`, effective_date: args.exitDate ?? nowISO().slice(0, 10), changed_by: actorId,
  });
  await sb.from('app_users').update({ status: 'inactive', updated_at: nowISO() }).eq('id', employeeId);
  void emitAppEvent({ eventType: 'hr.employee.status_changed', sourceModule: 'hr', sourceEntityType: 'employee', sourceEntityId: employeeId, actorUserId: actorId, severity: 'warning', payload: { from: previousStatus, to: 'terminated', via: 'offboarding' } });
  await writeHrAudit({ employeeId, submoduleKey: 'employees', recordId: employeeId, actorId, action: 'hr.employee.status_changed', previousState: { status: previousStatus }, newState: { status: 'terminated', authStatus: 'inactive' }, reason: `Offboarding ${kase.case_no}` });

  // 2. Ensure the IT access-removal handoff exists (pending). Created at start; guard here.
  let { data: itHandoff } = await sb.from('hr_offboarding_handoffs').select('id').eq('case_id', args.caseId).eq('handoff_key', 'it_access_removal').maybeSingle<{ id: string }>();
  if (!itHandoff) {
    const { data: created } = await sb.from('hr_offboarding_handoffs').insert({ case_id: args.caseId, handoff_key: 'it_access_removal', target_module: 'it', handoff_type: 'access_removal', status: 'pending', payload: { employeeId, caseNo: kase.case_no } }).select('id').single<{ id: string }>();
    itHandoff = created;
    void emitAppEvent({ eventType: 'offboarding.handoff.created', sourceModule: 'hr', sourceEntityType: 'offboarding_case', sourceEntityId: args.caseId, actorUserId: actorId, severity: 'info', payload: { targetModule: 'it', handoffType: 'access_removal' } });
  }

  // 3. Complete the case.
  await sb.from('hr_offboarding_cases').update({ status: 'completed', exit_date: args.exitDate ?? nowISO().slice(0, 10), completed_at: nowISO() }).eq('id', args.caseId);
  void emitAppEvent({ eventType: 'offboarding.finalized', sourceModule: 'hr', sourceEntityType: 'offboarding_case', sourceEntityId: args.caseId, actorUserId: actorId, severity: 'warning', payload: { caseNo: kase.case_no, employeeId } });
  await writeHrAudit({ employeeId, submoduleKey: 'offboarding', recordId: args.caseId, actorId, action: 'hr.offboarding.finalized', previousState: { status: kase.status }, newState: { status: 'completed', employeeStatus: 'terminated' } });

  return { caseId: args.caseId, status: 'completed', employeeStatus: 'terminated', itHandoffId: itHandoff?.id ?? '' };
}
