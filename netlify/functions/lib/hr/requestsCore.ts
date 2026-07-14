// lib/hr/requestsCore.ts — HR Requests: submit (core create path).
//
// Reuses: runModuleMutation → record + event + idempotency atomically.
//         nextRef('REQ') for the request_no.
//         writeHrAudit → mandatory §2 audit side-effect.
//         startWorkflowForRecord → central engine (for approvable types).
//
// Self-scope invariant: employee_id is always the caller's id unless the actor
// has hr.requests.manage (HR submits on behalf). Enforced at the route layer;
// this function trusts the already-resolved employeeId.

import { createHash }           from 'node:crypto';
import { sb }                  from '../db';
import { nextRef }             from '../refGenerator';
import { runModuleMutation }   from '../moduleServiceAdapter';
import { writeHrAudit }        from './employeeCore';
import { startWorkflowForRecord } from '../workflow/service';
import {
  REQUEST_TYPE_CATALOGUE, getRequestTypeDef,
} from '../../../../types/hrRequests';
import type { SubmitRequestArgs, SubmitRequestResult } from '../../../../types/hrRequests';

export { REQUEST_TYPE_CATALOGUE, getRequestTypeDef };

/**
 * Submit an HR request. Idempotent on (actorId, requestType, title) within a
 * short window — the key includes a content hash so retries don't duplicate.
 * THROWS on failure (status property used by the route layer).
 */
export async function submitRequest(
  actorId: string,
  resolvedEmployeeId: string,
  args: SubmitRequestArgs,
): Promise<SubmitRequestResult> {
  const typeDef = getRequestTypeDef(args.requestType);
  if (!typeDef) throw Object.assign(new Error(`Unknown request type: ${args.requestType}`), { status: 400 });

  const details = args.details ?? {};
  // Content-addressable idempotency key — same employee + type + title ≈ same intent.
  // SHA-256 avoids the prefix-collision risk of a base64-truncated raw-JSON hash: two
  // titles that share a long common prefix (e.g. "Employment letter for visa X" vs "...Y")
  // would produce the same 32-char base64 key. SHA-256 distributes the full content.
  const hash = createHash('sha256')
    .update(JSON.stringify({ e: resolvedEmployeeId, t: args.requestType, ti: args.title }))
    .digest('hex').slice(0, 32);
  const idempotencyKey = `hr.request:${resolvedEmployeeId}:${args.requestType}:${hash}`;

  const result = await runModuleMutation<{ id: string; requestNo: string }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr',
      operation: 'submit',
      entityType: 'hr_request',
      idempotencyKey,
      eventType: 'hr.request.submitted',
      eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.requestNo }),
      buildEventPayload: (r) => ({
        requestNo: r.requestNo,
        employeeId: resolvedEmployeeId,
        requestType: args.requestType,
        title: args.title,
      }),
    },
    writeRecord: async () => {
      const requestNo = await nextRef('REQ');
      const { data: req, error: rErr } = await sb.from('hr_requests').insert({
        request_no: requestNo,
        employee_id: resolvedEmployeeId,
        request_type: args.requestType,
        title: args.title,
        details: details,
        status: 'submitted',
        priority: args.priority ?? 'normal',
        requested_by: actorId,
      }).select('id, request_no').single<{ id: string; request_no: string }>();
      if (rErr) throw Object.assign(new Error(rErr.message), { status: 500 });

      await writeHrAudit({
        employeeId: resolvedEmployeeId,
        submoduleKey: 'requests',
        recordId: req.id,
        actorId,
        action: 'hr.request.submitted',
        newState: { requestNo, requestType: args.requestType, title: args.title },
      });

      return { id: req.id, requestNo: req.request_no };
    },
  });

  const requestId = result.entityId;
  let workflowId: string | null = null;

  // Start a workflow only for approvable types — non-approvable types stay as plain triage items.
  if (typeDef.requiresApproval) {
    try {
      const { data: req } = await sb.from('hr_requests').select('id, request_no').eq('id', requestId).maybeSingle<{ id: string; request_no: string }>();
      if (req) {
        const wf = await startWorkflowForRecord({
          context: {
            moduleKey: 'hr_requests',
            workflowType: 'hr_request_approval',
            triggerEvent: 'hr.request.submitted',
            sourceRecordId: req.id,
            sourceRecordRef: req.request_no,
            requestedBy: actorId,
            departmentId: null,
            siteId: null,
            priority: args.priority === 'high' ? 'high' : 'normal',
            recordData: { requestType: args.requestType, title: args.title, employeeId: resolvedEmployeeId },
          },
          actor: { id: actorId },
        });
        if (wf) {
          workflowId = wf.id;
          const { error: wfErr } = await sb.from('hr_requests').update({
            workflow_id: wf.id,
            status: 'in_review',
          }).eq('id', requestId);
          if (wfErr) {
            // workflow_id update failure is serious — log but don't swallow silently;
            // the workflow was created, the request exists: log and surface the error.
            console.error('[hr.requests] Failed to store workflow_id on request:', wfErr);
            throw Object.assign(new Error(`Failed to link workflow to request: ${wfErr.message}`), { status: 500 });
          }
        }
      }
    } catch (e: unknown) {
      // If we already threw above (wfErr), re-throw. Otherwise: no binding = null path.
      const err = e as { status?: number; message?: string };
      if (err.status === 500) throw e;
      // No binding found → stays submitted (no workflow).
    }
  }

  return { requestId, requestNo: result.record.requestNo, workflowId };
}
