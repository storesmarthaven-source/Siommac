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
import { rpcHttpError }        from '../workflow/service';
import { selectWorkflowBinding } from '../workflow/bindingResolver';
import { notifyUsersByRole }   from '../finance/financeEvents';
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

  // ATOMIC (finding #3, Shape B): an approvable request WITH an active approval binding
  // creates the request (in_review) + starts the approval workflow + links workflow_id +
  // business event + hr_audit_log in ONE transaction via workflow_create_and_start_tx
  // (hr_requests branch), with client-key idempotency. Replaces the create-then-start
  // strand (record via runModuleMutation, then a separate startWorkflowForRecord +
  // status/link) — the only path that started a workflow. Non-approvable requests, and
  // approvable ones with no binding, keep the plain create-only path below (no strand).
  if (typeDef.requiresApproval) {
    const binding = await selectWorkflowBinding(sb, {
      moduleKey: 'hr_requests', workflowType: 'hr_request_approval',
      triggerEvent: 'hr.request.submitted', sourceRecordId: '', requestedBy: actorId, recordData: {},
    });
    if (binding) {
      const requestKey = args.idempotencyKey?.trim();
      if (!requestKey) throw Object.assign(new Error('An idempotency key is required to submit an approvable request.'), { status: 400 });
      const { data, error } = await sb.rpc('workflow_create_and_start_tx', {
        p_source_table: 'hr_requests', p_actor_id: actorId, p_binding_id: binding.id, p_request_key: requestKey,
        p_business: {
          employeeId: resolvedEmployeeId, requestType: args.requestType, title: args.title,
          details, priority: args.priority ?? 'normal',
        },
      });
      if (error) throw rpcHttpError(error as { code?: string | null; message: string });
      const rpc = (data ?? {}) as { recordId?: string; ref?: string; workflowId?: string };
      // First step routes to the hr_manager role — notify them post-commit so approval is actioned.
      void notifyUsersByRole('hr_manager', {
        type: 'hr.request.submitted',
        title: `Request ${rpc.ref ?? ''} awaiting your approval`.trim(),
        body: `A ${args.requestType} request has been submitted for approval.`,
        module: 'hr', severity: 'warning', sourceType: 'hr_request',
        sourceId: rpc.recordId ?? '', actionRequired: true,
        dedupeKey: `hr.request.submitted.${rpc.recordId}`,
      });
      return { requestId: rpc.recordId ?? '', requestNo: rpc.ref ?? '', workflowId: rpc.workflowId ?? null };
    }
    // No approval binding configured → fall through to the plain create (approval opt-in).
  }

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

  // This path is create-only (non-approvable, or approvable with no binding): the request
  // stays 'submitted' with no workflow. The atomic approvable+binding path returned above.
  return { requestId: result.entityId, requestNo: result.record.requestNo, workflowId: null };
}
