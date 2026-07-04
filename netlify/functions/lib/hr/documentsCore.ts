/**
 * netlify/functions/lib/hr/documentsCore.ts
 *
 * Shared constants and helpers for HR employee document handling.
 * Extracted from routes/hr.ts so both the existing routes and the new
 * Documents lib import from ONE place — never duplicated.
 *
 * Import in routes/hr.ts:
 *   import { HR_DOC_BUCKET, RESTRICTED_TIERS, filterVisibleDocs } from '../lib/hr/documentsCore';
 * Then remove the local const declarations.
 */

// The private Supabase Storage bucket that holds HR employee documents.
// Never public — all access goes through getSignedUrl / createAttachmentUploadUrl.
export const HR_DOC_BUCKET = 'hr-employee-documents';

// Max HR document size. AUTHORITATIVE enforcement is the bucket `file_size_limit`
// (migration 20260804000000) which Storage enforces on the object PUT. This constant
// mirrors it for a fast, friendly early rejection on commit and in the client warning.
export const HR_DOC_MAX_BYTES = 15_728_640; // 15 MB

// Confidentiality tiers that require hr.employee_documents.sensitive_view.
export const RESTRICTED_TIERS = new Set(['restricted_hr', 'legal', 'medical']);

export type ExpiryState = 'valid' | 'expiring' | 'expired' | 'none';

/**
 * Compute the expiry state for a document's expiry_date.
 * expiringWithinDays defaults to 30 (e.g. "expiring soon").
 */
export function computeExpiryState(
  expiryDate: string | null | undefined,
  today: string = new Date().toISOString().slice(0, 10),
  expiringWithinDays = 30,
): ExpiryState {
  if (!expiryDate) return 'none';
  if (expiryDate < today) return 'expired';
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + expiringWithinDays);
  const thresholdISO = threshold.toISOString().slice(0, 10);
  return expiryDate <= thresholdISO ? 'expiring' : 'valid';
}

/**
 * Filter a list of document rows to only those visible to the calling user.
 * canSeeSensitive must be pre-computed via:
 *   const canSeeSensitive = await userCan(actor, 'hr.employee_documents.sensitive_view');
 */
export function filterVisibleDocs<T extends { confidentiality: string }>(
  rows: T[],
  canSeeSensitive: boolean,
): T[] {
  if (canSeeSensitive) return rows;
  return rows.filter(d => !RESTRICTED_TIERS.has(d.confidentiality));
}

/** Human-readable document status. */
export function humanizeDocStatus(status: string): string {
  const map: Record<string, string> = {
    uploaded: 'Pending Review',
    verified: 'Verified',
    rejected: 'Rejected',
    archived: 'Archived',
  };
  return map[status] ?? status;
}
