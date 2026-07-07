/**
 * netlify/functions/lib/hr/onboardingDocumentRequests.ts
 *
 * Creates case-specific document request rows at launch time, one per required
 * document for the employee. The wizard's documentSelections drive the initial
 * status — 'use_existing' / 'uploaded' selections mark the row satisfied
 * immediately; the rest start as 'pending' (= request from worker).
 *
 * Called from startOnboardingCase's writeRecord closure. Failures propagate so
 * the caller can compensate (delete the case row).
 */

import { sb } from '../db';
import type { OnboardingDocumentLaunchSelection } from '../../../../types/hrOnboarding';
import type { EmployeeComplianceRow } from './documentsCompliance';
import type { DocumentRequirement } from './documentsRequirements';

export interface CreateDocumentRequestsArgs {
  caseId: string;
  employeeId: string;
  actorId: string;
  compliance: EmployeeComplianceRow[];
  requirements: DocumentRequirement[];
  documentSelections?: OnboardingDocumentLaunchSelection[] | null;
}

export interface DocumentRequestResult {
  documentRequestCount: number;
}

/** Resolve status for a single requirement given the wizard's selection for it. */
function resolveStatus(
  requirementId: string,
  selections: Map<string, OnboardingDocumentLaunchSelection>,
  complianceState: string,
): string {
  const sel = selections.get(requirementId);
  if (!sel) {
    // No explicit selection: if already collected, treat as use_existing; else pending
    if (complianceState === 'present_verified' || complianceState === 'present_unverified') {
      return 'use_existing';
    }
    return 'pending';
  }
  switch (sel.action) {
    case 'use_existing':       return 'use_existing';
    case 'uploaded':           return 'uploaded';
    case 'waive':              return 'waived';
    case 'request_from_worker':
    case 'none':
    default:                   return 'pending';
  }
}

export async function createOnboardingDocumentRequests(
  args: CreateDocumentRequestsArgs,
): Promise<DocumentRequestResult> {
  const { caseId, employeeId, actorId, compliance, requirements, documentSelections } = args;

  if (!compliance.length) return { documentRequestCount: 0 };

  const selMap = new Map<string, OnboardingDocumentLaunchSelection>(
    (documentSelections ?? []).map(s => [s.requirementId, s]),
  );
  const reqById = new Map(requirements.map(r => [r.id, r]));

  const rows = compliance.map(comp => {
    const req = reqById.get(comp.requirementId);
    const sel = selMap.get(comp.requirementId);
    const status = resolveStatus(comp.requirementId, selMap, comp.state);

    // Resolve which document ID to link (explicit selection wins over existing)
    let documentId: string | null = null;
    if (sel?.action === 'use_existing' && sel.existingDocumentId) {
      documentId = sel.existingDocumentId;
    } else if (status === 'use_existing' && comp.documentId) {
      documentId = comp.documentId;
    }

    return {
      case_id:          caseId,
      requirement_id:   comp.requirementId ?? null,
      employee_id:      employeeId,
      document_type:    comp.requiredType,
      label:            comp.label,
      status,
      document_id:      documentId,
      waiver_reason:    sel?.action === 'waive' ? (sel.waiverReason ?? null) : null,
      waived_by:        sel?.action === 'waive' ? actorId : null,
      waived_at:        sel?.action === 'waive' ? new Date().toISOString() : null,
      is_required:      true,
      blocks_onboarding: req?.blocksOnboarding ?? false,
      can_waive:         req?.canWaive ?? false,
      requires_expiry:   req?.requiresExpiry ?? false,
      created_by:       actorId,
    };
  });

  const { error } = await sb.from('hr_onboarding_document_requests').insert(rows);
  if (error) throw Object.assign(new Error(`Document requests insert failed: ${error.message}`), { status: 500 });

  return { documentRequestCount: rows.length };
}
