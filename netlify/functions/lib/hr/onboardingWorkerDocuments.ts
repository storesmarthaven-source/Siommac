// lib/hr/onboardingWorkerDocuments.ts — the governed worker document upload/commit flow.
//
// Two commands, both bound to the AUTHENTICATED ACTOR. Neither accepts an employee id, so
// neither can be aimed at another worker.
//
//   1. issueWorkerDocumentUploadUrl — validates the request is the actor's own, on their
//      active case, and in an uploadable state; then issues a short-lived signed URL whose
//      path is derived server-side from actor + request. The client never chooses the path.
//   2. commitWorkerDocument — re-validates everything, verifies the object actually exists
//      in storage, creates the hr_employee_documents record, links it to the request and
//      moves the request to `uploaded`, then emits event + audit + reviewer notification.
//
// WHY THE PATH IS DERIVED, NOT ACCEPTED
// A client-supplied path is a forgery vector: it could point at another worker's object and
// have it committed against this worker's request. The prefix is rebuilt from the actor and
// request at commit time and the submitted path must match it exactly.
//
// This deliberately does NOT reuse the cross-employee HR upload permission — being able to
// upload your own onboarding document is not authority over anyone else's documents.

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import { HR_DOC_BUCKET } from './documentsCore';

const err = (status: number, message: string): Error => Object.assign(new Error(message), { status });

/**
 * Deliberately narrow, and matched to the approved worker mockup's accept list
 * (PDF, PNG, JPG). WebP was allowed here while the UI never offered it — client and server
 * now agree on exactly one set.
 */
const ALLOWED_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
export const WORKER_DOC_MAX_BYTES = 10 * 1024 * 1024;   // 10 MB
// Reuse the canonical HR document bucket constant — a literal here drifted from it
// and every signed-URL call failed with "The related resource does not exist".
const BUCKET = HR_DOC_BUCKET;

/** Only these states may receive a new upload. */
const UPLOADABLE = new Set(['pending', 'rejected']);
/** A settled request must never be overwritten by a worker. */
const TERMINAL = new Set(['waived', 'verified', 'use_existing']);

interface RequestRow {
  id: string; case_id: string; employee_id: string; status: string;
  document_type: string; label: string; requires_expiry: boolean;
}

/** The storage prefix for one actor + request. Derived, never supplied. */
export function workerDocPrefix(actorId: string, requestId: string): string {
  const safeActor = actorId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `onboarding/${safeActor}/${requestId}/`;
}

/**
 * Load the request and prove it belongs to this actor's ACTIVE case. Every failure is a
 * distinct, honest status: not-found, not-yours, wrong-case, wrong-state.
 */
async function loadOwnRequest(actorId: string, requestId: string): Promise<RequestRow> {
  const read = await sb.from('hr_onboarding_document_requests')
    .select('id, case_id, employee_id, status, document_type, label, requires_expiry')
    .eq('id', requestId).maybeSingle<RequestRow>();
  if (read.error) throw err(500, read.error.message);
  const request = read.data;
  if (!request) throw err(404, 'Document request not found.');

  // Ownership is checked against the ROW, not against anything the caller sent.
  if (request.employee_id !== actorId) throw err(403, 'This document request does not belong to you.');

  const caseRead = await sb.from('hr_onboarding_cases')
    .select('id, status, employee_id').eq('id', request.case_id).maybeSingle<{ id: string; status: string; employee_id: string }>();
  if (caseRead.error) throw err(500, caseRead.error.message);
  if (!caseRead.data) throw err(404, 'The onboarding case for this request no longer exists.');
  if (caseRead.data.employee_id !== actorId) throw err(403, 'This document request does not belong to you.');
  if (['cancelled', 'completed'].includes(caseRead.data.status)) {
    throw err(409, 'This onboarding case is closed — documents can no longer be submitted.');
  }
  return request;
}

function assertUploadable(request: RequestRow): void {
  if (TERMINAL.has(request.status)) {
    throw err(409, `This document is already ${request.status.replace('_', ' ')} and cannot be replaced.`);
  }
  if (!UPLOADABLE.has(request.status)) {
    throw err(409, `This document cannot be uploaded while it is ${request.status}.`);
  }
}

export async function issueWorkerDocumentUploadUrl(
  actorId: string,
  args: { requestId: string; fileName: string; mimeType: string; fileSize: number },
): Promise<{ uploadUrl: string; token: string; path: string; maxBytes: number }> {
  const request = await loadOwnRequest(actorId, args.requestId);
  assertUploadable(request);

  const ext = ALLOWED_MIME[args.mimeType.toLowerCase()];
  if (!ext) throw err(400, 'Unsupported file type. Allowed: PDF, PNG, JPG.');
  if (!Number.isFinite(args.fileSize) || args.fileSize <= 0) throw err(400, 'A file size is required.');
  if (args.fileSize > WORKER_DOC_MAX_BYTES) throw err(400, 'That file is larger than the 10 MB limit.');

  // The stored name is sanitised and the prefix is ours. A caller cannot escape their own
  // folder with `../` or by supplying a path — only the leaf name is taken from them.
  // Strip any extension the client sent before appending the one we derived from the
  // validated MIME type — otherwise "id.pdf" was stored as "id.pdf.pdf".
  const stem = args.fileName.replace(/\.[a-zA-Z0-9]{1,8}$/, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
  const path = `${workerDocPrefix(actorId, request.id)}${Date.now()}_${stem || 'document'}.${ext}`;

  const signed = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (signed.error) throw err(500, `Could not start the upload: ${signed.error.message}`);

  return { uploadUrl: signed.data.signedUrl, token: signed.data.token, path, maxBytes: WORKER_DOC_MAX_BYTES };
}

export async function commitWorkerDocument(
  actorId: string,
  args: { requestId: string; path: string; fileName: string; mimeType: string; fileSize: number; expiryDate?: string | null },
): Promise<{ requestId: string; documentId: string; status: 'uploaded' }> {
  const request = await loadOwnRequest(actorId, args.requestId);
  assertUploadable(request);

  const ext = ALLOWED_MIME[args.mimeType.toLowerCase()];
  if (!ext) throw err(400, 'Unsupported file type.');
  if (args.fileSize > WORKER_DOC_MAX_BYTES) throw err(400, 'That file is larger than the 10 MB limit.');

  // The path must be one WE issued for THIS actor and THIS request. Without this a worker
  // could commit another worker's object against their own request.
  const prefix = workerDocPrefix(actorId, request.id);
  if (!args.path.startsWith(prefix) || args.path.includes('..')) {
    throw err(400, 'That upload path was not issued for this request.');
  }

  if (request.requires_expiry && !args.expiryDate) {
    throw err(400, 'This document requires an expiry date.');
  }

  // Prove the object actually exists — a commit without an upload would otherwise record a
  // document that cannot be opened.
  const list = await sb.storage.from(BUCKET).list(prefix.replace(/\/$/, ''), { limit: 100 });
  if (list.error) throw err(500, `Could not verify the uploaded file: ${list.error.message}`);
  const leaf = args.path.slice(prefix.length);
  if (!(list.data ?? []).some(o => o.name === leaf)) {
    throw err(409, 'No uploaded file was found for this request. Upload the file, then submit again.');
  }

  const documentInsert = await sb.from('hr_employee_documents').insert({
    employee_id: actorId, document_type: request.document_type, title: request.label,
    file_path: args.path, file_name: args.fileName, mime_type: args.mimeType, file_size: args.fileSize,
    confidentiality: 'restricted_hr', status: 'uploaded', expiry_date: args.expiryDate ?? null,
    uploaded_by: actorId,
    metadata: { source: 'onboarding_worker_upload', onboardingRequestId: request.id, caseId: request.case_id },
  }).select('id').single<{ id: string }>();
  if (documentInsert.error) throw err(500, documentInsert.error.message);

  // Guarded on the uploadable states so a concurrent submit (or a replay of this call)
  // cannot move an already-settled request. If it matches nothing we roll the document
  // back rather than leaving an orphan attached to nothing.
  const updated = await sb.from('hr_onboarding_document_requests')
    .update({ status: 'uploaded', document_id: documentInsert.data.id, rejection_reason: null, updated_at: new Date().toISOString() })
    .eq('id', request.id).in('status', [...UPLOADABLE])
    .select('id').maybeSingle<{ id: string }>();
  if (updated.error || !updated.data) {
    await sb.from('hr_employee_documents').delete().eq('id', documentInsert.data.id);
    throw err(updated.error ? 500 : 409, updated.error?.message ?? 'This request was updated by someone else. Reload and try again.');
  }

  await emitAppEvent({
    eventType: 'onboarding.document.submitted', sourceModule: 'hr', sourceEntityType: 'onboarding_case',
    sourceEntityId: request.case_id, actorUserId: actorId, severity: 'info',
    payload: { requestId: request.id, documentId: documentInsert.data.id, documentType: request.document_type, label: request.label },
    // HR is told there is something to review; the worker cannot review their own document.
    notification: {
      title: 'Onboarding document submitted',
      body: `${request.label} was submitted for review.`,
      actionRoute: `hr/onboarding/${request.case_id}`,
      type: 'onboarding_document_submitted',
      actionRequired: true,
    },
  });
  await writeHrAudit({
    submoduleKey: 'onboarding', recordId: request.case_id, actorId,
    action: 'hr.onboarding.document_submitted',
    previousState: { status: request.status },
    newState: { status: 'uploaded', requestId: request.id, documentId: documentInsert.data.id, label: request.label },
  });

  return { requestId: request.id, documentId: documentInsert.data.id, status: 'uploaded' };
}
