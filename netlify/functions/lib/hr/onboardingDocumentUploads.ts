/**
 * netlify/functions/lib/hr/onboardingDocumentUploads.ts
 *
 * Validation for the `upload_now` document disposition in the Start Onboarding wizard.
 *
 * HR may attach a record during intake through the governed Employee Master commit flow
 * (`hr/employees/documents/upload-url` → PUT → `hr/employees/documents/commit`) and then
 * point a requirement at the committed document id. The id arrives from the CLIENT, so
 * nothing about it is trusted: this module re-derives every fact from the database.
 *
 * ONE validator, called by BOTH the launch preflight and the launch itself, so the two can
 * never disagree about whether an upload satisfies a requirement — the same class of split
 * that made `use_existing` unreachable in the first place.
 */
import { sb } from '../db';

export type UploadedDocumentVerdict =
  /** The document is verified evidence — the requirement is satisfied. */
  | { ok: true; status: 'verified'; documentId: string }
  /** Committed but not yet reviewed. Blocking requirements must not launch on this. */
  | { ok: true; status: 'pending'; documentId: string }
  | { ok: false; message: string };

/** Statuses a freshly committed or verified document may hold. Anything else (rejected,
 *  archived) is not evidence and must not satisfy or link to a requirement. */
const USABLE_STATUSES = new Set(['pending', 'uploaded', 'verified']);

interface DocRow {
  id: string;
  employee_id: string;
  document_type: string;
  status: string;
  file_path: string | null;
  uploaded_by: string | null;
}

/**
 * Re-validate an `upload_now` selection against the database.
 *
 * Rejects, in order: an unknown id, another employee's document (ownership), a document of
 * the wrong type for the requirement, one that never went through the governed commit flow,
 * and one whose stored path is not inside this employee's issued folder (a forged path that
 * predates the commit-side gate).
 */
export async function validateUploadedDocument(
  employeeId: string,
  requiredType: string,
  requirementLabel: string,
  documentId: string | null | undefined,
): Promise<UploadedDocumentVerdict> {
  if (!documentId) return { ok: false, message: `Attach a file for ${requirementLabel} before launching.` };

  const { data, error } = await sb.from('hr_employee_documents')
    .select('id, employee_id, document_type, status, file_path, uploaded_by')
    .eq('id', documentId)
    .maybeSingle<DocRow>();
  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: `The uploaded ${requirementLabel} document no longer exists.` };

  // Ownership — the single most important check: an id from another employee's record must
  // never satisfy this employee's requirement.
  if (data.employee_id !== employeeId) {
    return { ok: false, message: `The uploaded ${requirementLabel} document does not belong to this employee.` };
  }
  if (data.document_type !== requiredType) {
    return { ok: false, message: `The uploaded document is not a valid ${requirementLabel} record.` };
  }
  // Provenance: only the governed commit endpoint writes this table, and it always stamps
  // the actor and a stored path. A row missing either did not come through that flow.
  if (!data.uploaded_by || !data.file_path) {
    return { ok: false, message: `The uploaded ${requirementLabel} document was not created through the document upload flow.` };
  }
  if (!data.file_path.startsWith(`${employeeId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80)}/`)) {
    return { ok: false, message: `The uploaded ${requirementLabel} document has an invalid storage path.` };
  }
  if (!USABLE_STATUSES.has(data.status)) {
    return { ok: false, message: `The uploaded ${requirementLabel} document is ${data.status} and cannot be used.` };
  }

  return data.status === 'verified'
    ? { ok: true, status: 'verified', documentId: data.id }
    : { ok: true, status: 'pending', documentId: data.id };
}
