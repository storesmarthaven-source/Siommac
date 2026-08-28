import { sb } from '../db';
import type { OnboardingDocumentLaunchSelection } from '../../../../types/hrOnboarding';

interface DocumentRequirementProjection {
  requirementId: string;
  documentType: string;
  label: string;
}

export interface UploadedDocumentProjection {
  id: string;
  employeeId: string;
  documentType: string;
  status: string;
}

export interface UploadedDocumentValidation {
  byRequirementId: Map<string, UploadedDocumentProjection>;
  issues: string[];
}

/**
 * Proves that every `upload_now` selection names a real, usable employee document
 * for the selected worker and requirement. The browser-provided document id is
 * never accepted as evidence by itself.
 */
export async function validateUploadedDocumentSelections(
  employeeId: string,
  selections: OnboardingDocumentLaunchSelection[] | null | undefined,
  requirements: DocumentRequirementProjection[],
): Promise<UploadedDocumentValidation> {
  const uploadSelections = (selections ?? []).filter(selection => selection.action === 'upload_now');
  if (uploadSelections.length === 0) return { byRequirementId: new Map(), issues: [] };

  const issues: string[] = [];
  const requirementById = new Map(requirements.map(requirement => [requirement.requirementId, requirement]));
  const selectedIds = uploadSelections
    .map(selection => selection.uploadedDocumentId?.trim() ?? '')
    .filter(Boolean);

  const duplicateRequirementIds = uploadSelections
    .map(selection => selection.requirementId)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateRequirementIds.length > 0) issues.push('Choose only one document action per requirement.');
  if (new Set(selectedIds).size !== selectedIds.length) issues.push('A single upload cannot satisfy multiple document requirements.');

  const rowsById = new Map<string, UploadedDocumentProjection>();
  if (selectedIds.length > 0) {
    const { data, error } = await sb.from('hr_employee_documents')
      .select('id, employee_id, document_type, status')
      .in('id', [...new Set(selectedIds)]);
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    for (const row of data as { id: string; employee_id: string; document_type: string; status: string }[]) {
      rowsById.set(row.id, {
        id: row.id,
        employeeId: row.employee_id,
        documentType: row.document_type,
        status: row.status,
      });
    }
  }

  const byRequirementId = new Map<string, UploadedDocumentProjection>();
  for (const selection of uploadSelections) {
    const requirement = requirementById.get(selection.requirementId);
    if (!requirement) {
      issues.push('A document requirement is no longer active. Refresh the intake preview.');
      continue;
    }
    const documentId = selection.uploadedDocumentId?.trim();
    if (!documentId) {
      issues.push(`Upload ${requirement.label} before launch.`);
      continue;
    }
    const document = rowsById.get(documentId);
    if (document?.employeeId !== employeeId || document.documentType !== requirement.documentType) {
      issues.push(`The selected upload for ${requirement.label} is not valid for this worker.`);
      continue;
    }
    if (document.status === 'archived' || document.status === 'rejected') {
      issues.push(`The selected upload for ${requirement.label} is no longer usable.`);
      continue;
    }
    byRequirementId.set(requirement.requirementId, document);
  }

  return { byRequirementId, issues: [...new Set(issues)] };
}
