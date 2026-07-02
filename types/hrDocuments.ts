/**
 * types/hrDocuments.ts
 *
 * Shared camelCase DTO shapes for the HR Documents module.
 * Imported by both:
 *   - netlify/functions/lib/hr/documents*.ts (backend service)
 *   - src/api/hr/documents.ts (frontend hooks)
 *
 * Never redeclare per-side. All fields camelCase.
 */

export type ExpiryState = 'valid' | 'expiring' | 'expired' | 'none';
export type ComplianceState = 'present_verified' | 'present_unverified' | 'expired' | 'missing';

// ── Core document row (extends the per-employee HrDocument with cross-employee fields) ──

export interface HrDocumentRow {
  id: string;
  employeeId: string;
  documentType: string;
  title: string;
  filePath: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  confidentiality: 'internal' | 'confidential' | 'restricted_hr' | 'legal' | 'medical';
  status: 'uploaded' | 'verified' | 'rejected' | 'archived';
  expiryDate: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectedReason: string | null;
  archivedAt: string | null;
  metadata: Record<string, unknown>;
  // Enriched fields (cross-employee list)
  expiryState: ExpiryState;
  employeeName: string | null;
  departmentName: string | null;
}

// ── Filters for the cross-employee register ──────────────────────────────────

export interface DocumentFilters {
  q?: string;
  employeeId?: string;
  departmentId?: string;
  documentType?: string;
  status?: string;
  confidentiality?: string;
  expiryState?: ExpiryState;
  expiringWithinDays?: number;
  page?: number;
  pageSize?: number;
}

// ── Stats ────────────────────────────────────────────────────────────────────

export interface DocumentsStats {
  total: number;
  uploaded: number;       // pending verification
  verified: number;
  expiringSoon: number;   // within 30 days
  expired: number;
  missingRequired: number;
}

// ── Requirements policy ───────────────────────────────────────────────────────

export interface DocumentRequirement {
  id: string;
  documentType: string;
  label: string;
  appliesToScope: 'all' | 'role' | 'employment_type' | 'department';
  appliesToValue: string | null;
  requiresExpiry: boolean;
  reminderDays: number[];
  minConfidentiality: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface CreateRequirementArgs {
  documentType: string;
  label: string;
  appliesToScope: 'all' | 'role' | 'employment_type' | 'department';
  appliesToValue?: string | null;
  requiresExpiry?: boolean;
  reminderDays?: number[];
  minConfidentiality?: string | null;
}

export interface UpdateRequirementArgs {
  requirementId: string;
  label?: string;
  requiresExpiry?: boolean;
  reminderDays?: number[];
  minConfidentiality?: string | null;
}

// ── Compliance ────────────────────────────────────────────────────────────────

export interface EmployeeComplianceRow {
  employeeId: string;
  employeeName: string | null;
  requirementId: string;
  requiredType: string;
  label: string;
  state: ComplianceState;
  documentId: string | null;
  expiryDate: string | null;
}

export interface ComplianceOverviewRow {
  employeeId: string;
  employeeName: string | null;
  departmentName: string | null;
  missingCount: number;
  expiredCount: number;
  totalRequired: number;
}

// ── Expiry sweep ─────────────────────────────────────────────────────────────

export interface ExpirySweepResult {
  scanned: number;
  remindersSent: number;
}
