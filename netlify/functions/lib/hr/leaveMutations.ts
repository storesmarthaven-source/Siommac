// lib/hr/leaveMutations.ts — HR Leave management mutations
//
// update (before approval), approve, reject, cancel — thin wrappers that
// add permission-level validation on top of the core functions.

import { sb }               from '../db';
import { writeHrAudit }     from './employeeCore';
import { applyApprovedLeave, rejectLeaveRequest, cancelLeaveRequest, setLeaveRequestStatus } from './leaveCore';
import type { UpdateLeaveRequestArgs, ApproveLeaveArgs, RejectLeaveArgs, CancelLeaveRequestArgs } from '../../../../types/hrLeave';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

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
    .select('status').eq('id', args.requestId).maybeSingle();
  if (!req) throw err(404, 'Leave request not found.');
  if ((req as Record<string, unknown>).status !== 'pending_approval') throw err(400, 'Only pending requests can be approved.');
  await applyApprovedLeave(args.requestId, actorId);
  if (args.reviewNotes) {
    await sb.from('hr_leave_requests').update({ review_notes: args.reviewNotes }).eq('id', args.requestId);
  }
}

export async function rejectLeave(actorId: string, args: RejectLeaveArgs): Promise<void> {
  await rejectLeaveRequest(args.requestId, actorId, args.reviewNotes);
}

export async function cancelLeave(actorId: string, args: CancelLeaveRequestArgs): Promise<void> {
  await cancelLeaveRequest(actorId, args.requestId, args.reason);
}
