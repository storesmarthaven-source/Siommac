// lib/hr/leaveMutations.ts — HR Leave management mutations
//
// update (before approval), approve, reject, cancel.
//
// Leave approval is WORKFLOW-NATIVE (central engine, binding hr_leave/
// hr_leave_approval): a submitted request starts a workflow with a `manager`
// approval task. So approve/reject decide that task through the engine
// (decideTask) — the registered hr_leave adapter (hrAdapters.ts) drives the
// source status + balance ledger via onWorkflowCompleted/Rejected. Cancel closes
// the running workflow (cancelWorkflow) so no task/instance is left dangling.
// When no workflow is bound (binding absent / start failed → request has no
// workflow_id), the decisions fall back to the direct core functions.

import { sb }               from '../db';
import { writeHrAudit }     from './employeeCore';
import { applyApprovedLeave, rejectLeaveRequest, cancelLeaveRequest } from './leaveCore';
import { decideTask, cancelWorkflow } from '../workflow/service';
import type { UpdateLeaveRequestArgs, ApproveLeaveArgs, RejectLeaveArgs, CancelLeaveRequestArgs } from '../../../../types/hrLeave';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

/**
 * Decide the single open approval task of a leave request's workflow. The leave
 * workflow is a single manager-approval step, so there is exactly one open task;
 * resolving it server-side keeps the approve/reject API request-centric (the FE
 * approves a leave request, not a task). The hr_leave adapter applies the source
 * mutation on the engine's completion / rejection callbacks.
 */
async function decideOpenLeaveTask(
  workflowId: string, actorId: string,
  decision: 'approved' | 'rejected', comment?: string,
): Promise<void> {
  const { data: task, error } = await sb.from('workflow_tasks')
    .select('id')
    .eq('workflow_id', workflowId)
    .in('status', ['pending', 'open', 'in_progress'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw err(500, `Failed to resolve approval task: ${error.message}`);
  if (!task) throw err(409, 'No open approval task for this leave request.');
  await decideTask({ workflowId, taskId: (task as { id: string }).id, actor: { id: actorId }, decision, comment });
}

export async function updateLeaveRequest(actorId: string, args: UpdateLeaveRequestArgs): Promise<void> {
  const { data: req } = await sb.from('hr_leave_requests')
    .select('employee_id, status').eq('id', args.requestId).maybeSingle();
  if (!req) throw err(404, 'Leave request not found.');
  const r = req as Record<string, unknown>;
  if (r.employee_id !== actorId) throw err(403, 'You can only update your own leave requests.');
  if (r.status !== 'pending_approval') throw err(400, 'Only pending requests can be updated.');

  const patch: Record<string, unknown> = {};
  if (args.reason    !== undefined) patch.reason    = args.reason;
  if (args.fromDate  !== undefined) patch.from_date = args.fromDate;
  if (args.toDate    !== undefined) patch.to_date   = args.toDate;
  if (args.days      !== undefined) patch.days      = args.days;
  if (args.hours     !== undefined) patch.hours     = args.hours;

  const { error } = await sb.from('hr_leave_requests').update(patch).eq('id', args.requestId);
  if (error) throw err(500, `Failed to update leave request: ${error.message}`);

  await writeHrAudit({ employeeId: r.employee_id as string, submoduleKey: 'leave', recordId: args.requestId, actorId, action: 'hr.leave.updated', newState: patch });
}

export async function approveLeaveRequest(actorId: string, args: ApproveLeaveArgs): Promise<void> {
  const { data: req } = await sb.from('hr_leave_requests')
    .select('status, workflow_id').eq('id', args.requestId).maybeSingle();
  if (!req) throw err(404, 'Leave request not found.');
  const r = req as { status: string; workflow_id: string | null };
  if (r.status !== 'pending_approval') throw err(400, 'Only pending requests can be approved.');

  if (r.workflow_id) {
    // Workflow-native: the engine decides the manager task; onWorkflowCompleted →
    // applyApprovedLeave applies the deduction + releases the reserve + sets approved.
    await decideOpenLeaveTask(r.workflow_id, actorId, 'approved', args.reviewNotes ?? undefined);
  } else {
    // No workflow bound (binding absent / start failed) — direct approve.
    await applyApprovedLeave(args.requestId, actorId);
  }

  // Persist the reviewer's note on the request for display/reporting parity
  // (the canonical decision record lives in workflow_decisions).
  if (args.reviewNotes) {
    await sb.from('hr_leave_requests').update({ review_notes: args.reviewNotes }).eq('id', args.requestId);
  }
}

export async function rejectLeave(actorId: string, args: RejectLeaveArgs): Promise<void> {
  const { data: req } = await sb.from('hr_leave_requests')
    .select('status, workflow_id').eq('id', args.requestId).maybeSingle();
  if (!req) throw err(404, 'Leave request not found.');
  const r = req as { status: string; workflow_id: string | null };
  if (r.status !== 'pending_approval') throw err(400, 'Only pending requests can be rejected.');

  if (r.workflow_id) {
    // Workflow-native: the engine rejects the manager task; onWorkflowRejected →
    // rejectLeaveRequest releases the reserve + sets rejected + emits event/audit.
    await decideOpenLeaveTask(r.workflow_id, actorId, 'rejected', args.reviewNotes);
  } else {
    await rejectLeaveRequest(args.requestId, actorId, args.reviewNotes);
  }
}

export async function cancelLeave(actorId: string, args: CancelLeaveRequestArgs): Promise<void> {
  const { data: req } = await sb.from('hr_leave_requests')
    .select('status, workflow_id').eq('id', args.requestId).maybeSingle();
  if (!req) throw err(404, 'Leave request not found.');
  const r = req as { status: string; workflow_id: string | null };
  if (!['pending_approval', 'approved'].includes(r.status)) {
    throw err(400, `Cannot cancel a leave request in status '${r.status}'.`);
  }

  if (r.workflow_id) {
    // If the approval workflow is still running, cancel it through the engine so the
    // pending task + instance are closed (no dangling). The hr_leave adapter
    // (onWorkflowCancelled) releases the reserve + sets the request cancelled.
    const { data: wf } = await sb.from('workflow_instances')
      .select('status').eq('id', r.workflow_id).maybeSingle();
    if (wf && (wf as { status: string }).status === 'in_progress') {
      await cancelWorkflow({ workflowId: r.workflow_id, actor: { id: actorId }, reason: args.reason ?? '' });
      return;
    }
  }
  // Approved (workflow already terminal) or no workflow bound — cancel directly.
  await cancelLeaveRequest(actorId, args.requestId, args.reason);
}
