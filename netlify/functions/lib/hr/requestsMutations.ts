// lib/hr/requestsMutations.ts — HR Requests: decide / fulfill / cancel mutations.
//
// Each mutation: updates hr_requests → emits app_event → writes hr_audit_log.
// Decisions on workflow-backed requests route through decideTask (single authority).
// Non-workflow requests (no workflow_id) have their status set directly by HR.
// THROWS on failure (status property used by the route layer).

import { sb }            from '../db';
import { emitAppEvent }  from '../appEvents';
import { writeHrAudit }  from './employeeCore';
import { decideTask }    from '../workflow/service';
import { getRequest }    from './requestsQueries';
import type { DecideRequestArgs, FulfillRequestArgs, CancelRequestArgs } from '../../../../types/hrRequests';

const TERMINAL_STATUSES = new Set(['approved', 'rejected', 'fulfilled', 'cancelled']);

// ── decide ────────────────────────────────────────────────────────────────────

/**
 * Approve / reject / return a request.
 * - Workflow-backed: delegates to decideTask (the engine drives the source status
 *   via the hrRequestsAdapter registered in hrAdapters.ts).
 * - Non-workflow (plain triage): sets status directly.
 */
export async function decideRequest(actorId: string, args: DecideRequestArgs): Promise<{ requestId: string; status: string }> {
  const req = await getRequest(args.requestId);
  if (!req) throw Object.assign(new Error('Request not found.'), { status: 404 });
  if (TERMINAL_STATUSES.has(req.status)) {
    throw Object.assign(new Error(`Cannot decide a request in status '${req.status}'.`), { status: 422 });
  }

  const decisionMap: Record<string, string> = {
    approved: 'approved',
    rejected: 'rejected',
    returned: 'returned',
  };
  const newStatus = decisionMap[args.decision];
  if (!newStatus) throw Object.assign(new Error(`Invalid decision: ${args.decision}`), { status: 400 });

  if (req.workflowId) {
    // Route through the central engine — adapter (hrAdapters.ts) will call back
    // to set the source record status (onWorkflowCompleted / Returned / Rejected).
    if (!args.taskId) throw Object.assign(new Error('taskId is required to decide a workflow-backed request.'), { status: 400 });
    await decideTask({
      workflowId: req.workflowId,
      taskId: args.taskId,
      actor: { id: actorId },
      decision: args.decision as 'approved' | 'rejected' | 'returned',
      comment: args.comment,
    });
    // The adapter will update hr_requests.status; no direct update needed here.
  } else {
    // Non-workflow triage: set status directly.
    const now = new Date().toISOString();
    const { error } = await sb.from('hr_requests').update({
      status: newStatus,
      decided_by: actorId,
      decided_at: now,
      decision_comment: args.comment ?? null,
    }).eq('id', req.id);
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
  }

  void emitAppEvent({
    eventType: 'hr.request.decided',
    sourceModule: 'hr',
    sourceEntityType: 'hr_request',
    sourceEntityId: req.requestNo,
    actorUserId: actorId,
    severity: 'info',
    payload: { requestId: req.id, requestNo: req.requestNo, decision: args.decision, requestType: req.requestType },
  });

  await writeHrAudit({
    employeeId: req.employeeId,
    submoduleKey: 'requests',
    recordId: req.id,
    actorId,
    action: `hr.request.${args.decision}`,
    previousState: { status: req.status },
    newState: { status: newStatus, comment: args.comment ?? null },
  });

  return { requestId: req.id, status: newStatus };
}

// ── fulfill ───────────────────────────────────────────────────────────────────

/**
 * Mark an approved request fulfilled — HR has delivered the output (artifact/note).
 * profile_correction fulfillments should create an hr_employee_change_request via
 * the existing audited path; this route records the fulfillment intent only.
 */
export async function fulfillRequest(actorId: string, args: FulfillRequestArgs): Promise<{ requestId: string; status: string }> {
  const req = await getRequest(args.requestId);
  if (!req) throw Object.assign(new Error('Request not found.'), { status: 404 });

  // Can only fulfill approved requests (or submitted/in_review for non-approval types).
  const fulfillableStatuses = new Set(['approved', 'submitted', 'in_review']);
  if (!fulfillableStatuses.has(req.status)) {
    throw Object.assign(new Error(`Cannot fulfill a request in status '${req.status}'.`), { status: 422 });
  }

  const resolution: Record<string, unknown> = {
    ...(args.note       ? { note: args.note }               : {}),
    ...(args.artifactRef ? { artifactRef: args.artifactRef } : {}),
    fulfilledAt: new Date().toISOString(),
  };
  const now = new Date().toISOString();

  const { error } = await sb.from('hr_requests').update({
    status: 'fulfilled',
    fulfilled_by: actorId,
    fulfilled_at: now,
    resolution,
  }).eq('id', req.id);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  void emitAppEvent({
    eventType: 'hr.request.fulfilled',
    sourceModule: 'hr',
    sourceEntityType: 'hr_request',
    sourceEntityId: req.requestNo,
    actorUserId: actorId,
    severity: 'success',
    payload: { requestId: req.id, requestNo: req.requestNo, requestType: req.requestType, employeeId: req.employeeId },
  });

  await writeHrAudit({
    employeeId: req.employeeId,
    submoduleKey: 'requests',
    recordId: req.id,
    actorId,
    action: 'hr.request.fulfilled',
    previousState: { status: req.status },
    newState: { status: 'fulfilled', resolution },
  });

  return { requestId: req.id, status: 'fulfilled' };
}

// ── cancel ────────────────────────────────────────────────────────────────────

/**
 * Cancel a request. The requester can cancel their own non-terminal requests;
 * HR (manage) can cancel any. The route layer enforces who can cancel which.
 */
export async function cancelRequest(actorId: string, args: CancelRequestArgs): Promise<{ requestId: string; status: string }> {
  const req = await getRequest(args.requestId);
  if (!req) throw Object.assign(new Error('Request not found.'), { status: 404 });
  if (TERMINAL_STATUSES.has(req.status)) {
    throw Object.assign(new Error(`Cannot cancel a request in status '${req.status}'.`), { status: 422 });
  }

  const now = new Date().toISOString();
  const { error } = await sb.from('hr_requests').update({
    status: 'cancelled',
    decision_comment: args.reason ?? null,
    decided_by: actorId,
    decided_at: now,
  }).eq('id', req.id);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  void emitAppEvent({
    eventType: 'hr.request.cancelled',
    sourceModule: 'hr',
    sourceEntityType: 'hr_request',
    sourceEntityId: req.requestNo,
    actorUserId: actorId,
    severity: 'info',
    payload: { requestId: req.id, requestNo: req.requestNo, reason: args.reason ?? null, requestType: req.requestType },
  });

  await writeHrAudit({
    employeeId: req.employeeId,
    submoduleKey: 'requests',
    recordId: req.id,
    actorId,
    action: 'hr.request.cancelled',
    previousState: { status: req.status },
    newState: { status: 'cancelled', reason: args.reason ?? null },
  });

  return { requestId: req.id, status: 'cancelled' };
}
