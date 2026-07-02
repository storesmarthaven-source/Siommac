/**
 * types/hrRequests.ts
 *
 * Shared BE+FE types for the HR Requests (Request Center) sub-module.
 * Both the backend lib and the frontend API hooks import from here.
 * Catalogue const mirrors offboardingCore.ts STANDARD_EXIT_TASKS pattern.
 */

// ── Request-type catalogue ────────────────────────────────────────────────────

export interface HrRequestTypeDef {
  /** Unique catalogue key (used as request_type on the DB row). */
  key: string;
  /** Short label shown in type selectors. */
  label: string;
  /** One-line description shown in the form. */
  description: string;
  /** When true a workflow (hr_request_approval) is started on submit. */
  requiresApproval: boolean;
  /** When true the fulfillment form asks for an artifact/document reference. */
  producesArtifact: boolean;
}

export const REQUEST_TYPE_CATALOGUE: HrRequestTypeDef[] = [
  {
    key: 'employment_letter',
    label: 'Employment Letter',
    description: 'Request a formal employment verification or confirmation letter.',
    requiresApproval: true,
    producesArtifact: true,
  },
  {
    key: 'document_copy',
    label: 'Document Copy',
    description: 'Request a copy of an HR document (contract, payslip, etc.).',
    requiresApproval: true,
    producesArtifact: true,
  },
  {
    key: 'profile_correction',
    label: 'Profile Correction',
    description: 'Report an error in your HR profile (name, date of birth, contact, etc.).',
    requiresApproval: false,
    producesArtifact: false,
  },
  {
    key: 'general_inquiry',
    label: 'General Inquiry',
    description: 'Ask HR a question or raise a general HR matter.',
    requiresApproval: false,
    producesArtifact: false,
  },
  {
    key: 'reference_letter',
    label: 'Reference Letter',
    description: 'Request a reference or recommendation letter from HR.',
    requiresApproval: true,
    producesArtifact: true,
  },
  {
    key: 'salary_certificate',
    label: 'Salary Certificate',
    description: 'Request a formal certificate confirming your salary details.',
    requiresApproval: true,
    producesArtifact: true,
  },
];

/** Quick lookup: catalogue entry by key. Returns undefined for unknown keys. */
export function getRequestTypeDef(key: string): HrRequestTypeDef | undefined {
  return REQUEST_TYPE_CATALOGUE.find(t => t.key === key);
}

// ── Status + priority enums ───────────────────────────────────────────────────

export type HrRequestStatus =
  | 'draft' | 'submitted' | 'in_review' | 'returned'
  | 'approved' | 'rejected' | 'fulfilled' | 'cancelled';

export type HrRequestPriority = 'low' | 'normal' | 'high';

// ── DB row DTO (camelCase, matches what the backend SELECT returns) ────────────

export interface HrRequestRow {
  id: string;
  requestNo: string;
  employeeId: string;
  employeeName?: string | null;
  requestType: string;
  requestTypeLabel?: string | null;
  title: string;
  details: Record<string, unknown>;
  status: HrRequestStatus;
  priority: HrRequestPriority;
  workflowId?: string | null;
  requestedBy: string;
  requestedByName?: string | null;
  decidedBy?: string | null;
  decidedByName?: string | null;
  fulfilledBy?: string | null;
  fulfilledByName?: string | null;
  decisionComment?: string | null;
  resolution: Record<string, unknown>;
  requestedAt: string;
  decidedAt?: string | null;
  fulfilledAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

// ── Route arg types ───────────────────────────────────────────────────────────

export interface SubmitRequestArgs {
  /** Catalogue key from REQUEST_TYPE_CATALOGUE. */
  requestType: string;
  title: string;
  details?: Record<string, unknown>;
  priority?: HrRequestPriority;
  /** HR-only: submit on behalf of another employee (requires hr.requests.manage). */
  employeeId?: string;
}

export interface DecideRequestArgs {
  requestId: string;
  decision: 'approved' | 'rejected' | 'returned';
  comment?: string;
  /** Present when the request has a workflow_id (passed to decideTask). */
  taskId?: string;
}

export interface FulfillRequestArgs {
  requestId: string;
  /** Notes or artifact reference (stored in hr_requests.resolution). */
  note?: string;
  artifactRef?: string;
}

export interface CancelRequestArgs {
  requestId: string;
  reason?: string;
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface SubmitRequestResult {
  requestId: string;
  requestNo: string;
  workflowId: string | null;
}
