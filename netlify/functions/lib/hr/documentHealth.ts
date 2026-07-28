/**
 * lib/hr/documentHealth.ts — per-employee document health.
 *
 * COMPLETES the existing requirements engine rather than forking it: requirement
 * scope resolution stays in `documentsCompliance.resolveRequiredTypesForEmployee`
 * (all / role / employment_type / department) and the requirement source stays
 * `documentsRequirements.listRequirements`. This module adds only what the
 * engine lacked — an expiry-window state, grouping, counts and percentages.
 *
 * Why a separate state union: `ComplianceState` is consumed by the Documents
 * module and its tests, and it has no "expiring" member. Widening it in place
 * would silently reclassify rows for those consumers, so the richer state is
 * additive and derived here.
 */

import { sb } from '../db';
import { filterVisibleDocs } from './documentsCore';
import { listRequirements } from './documentsRequirements';
import { resolveRequiredTypesForEmployee } from './documentsCompliance';
import type { DocumentRequirement } from './documentsRequirements';

/** A document is "expiring" inside this window. Matches the attention aggregation. */
export const DOCUMENT_EXPIRY_SOON_DAYS = 30;

/**
 * Health state for one expected document.
 *
 * `missing` and `expired` are compliance failures; `expiring` is a warning;
 * `verified` and `current` are healthy; `unverified` is provided-but-unreviewed.
 */
export type DocumentHealthState =
  | 'verified' | 'current' | 'expiring' | 'expired' | 'unverified' | 'missing';

export interface DocumentHealthItem {
  /** Null when the requirement has no document at all. */
  documentId: string | null;
  /** Null for a held document that satisfies no active requirement. */
  requirementId: string | null;
  documentType: string;
  title: string;
  state: DocumentHealthState;
  expiryDate: string | null;
  /** Supporting line under the title, e.g. "Expires 03 Jun 2025". */
  detail: string;
  /** True when this row exists because a requirement expects it. */
  required: boolean;
}

export interface DocumentHealthGroup {
  key: string;
  label: string;
  currentCount: number;
  expiringCount: number;
  missingCount: number;
  items: DocumentHealthItem[];
}

export interface DocumentHealthSummary {
  /** Documents actually held (non-archived, visible to this actor). */
  totalDocuments: number;
  /** Requirements that apply to this employee. */
  requiredCount: number;
  verifiedCount: number;
  expiringCount: number;
  missingCount: number;
  /** Percentages are of `requiredCount`, and are 0 when nothing is required. */
  verifiedPercent: number;
  expiringPercent: number;
  missingPercent: number;
  categoryCount: number;
  groups: DocumentHealthGroup[];
}

export interface HealthDocRow {
  id: string;
  employee_id: string;
  document_type: string;
  title: string;
  status: string;
  expiry_date: string | null;
  confidentiality: string;
  verified_at?: string | null;
  uploaded_at?: string | null;
}

const DAY_MS = 86_400_000;

function daysUntil(today: string, target: string): number {
  const a = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${target.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / DAY_MS);
}

/** Group key for a document type: the segment before the first underscore. */
export function categoryOf(documentType: string): { key: string; label: string } {
  const key = documentType.includes('_') ? (documentType.split('_')[0] ?? documentType) : documentType;
  const label = key.replace(/[-_]/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
  return { key, label };
}

/**
 * Classify one expected document.
 *
 * Order matters: absence beats everything, then hard expiry, then the expiry
 * window, then verification state. A requirement that demands an expiry date but
 * has a document without one is `unverified`, not `current` — the same rule the
 * compliance engine already applies.
 */
export function classifyDocumentHealth(
  doc: HealthDocRow | undefined,
  requiresExpiry: boolean,
  today: string,
  soonDays = DOCUMENT_EXPIRY_SOON_DAYS,
): DocumentHealthState {
  if (!doc || doc.status === 'archived') return 'missing';
  if (doc.status === 'rejected') return 'missing';
  if (doc.expiry_date) {
    const days = daysUntil(today, doc.expiry_date);
    if (!Number.isNaN(days)) {
      if (days < 0) return 'expired';
      if (days <= soonDays) return 'expiring';
    }
  }
  if (requiresExpiry && !doc.expiry_date) return 'unverified';
  if (doc.status === 'verified') return 'verified';
  return 'unverified';
}

function detailFor(state: DocumentHealthState, doc: HealthDocRow | undefined): string {
  if (!doc) return 'Not provided';
  switch (state) {
    case 'expired':    return doc.expiry_date ? `Expired ${doc.expiry_date}` : 'Expired';
    case 'expiring':   return doc.expiry_date ? `Expires ${doc.expiry_date}` : 'Expiring';
    case 'verified':   return doc.verified_at ? `Verified ${doc.verified_at.slice(0, 10)}` : 'Verified';
    case 'unverified': return doc.uploaded_at ? `Uploaded ${doc.uploaded_at.slice(0, 10)}` : 'Awaiting verification';
    case 'missing':    return 'Not provided';
    default:           return doc.uploaded_at ? `On file ${doc.uploaded_at.slice(0, 10)}` : 'On file';
  }
}

const HEALTHY = new Set<DocumentHealthState>(['verified', 'current']);

/**
 * Build the health model from already-read rows.
 *
 * Pure, so the counting and percentage rules are unit-testable without a database.
 */
export function buildDocumentHealth(
  requirements: DocumentRequirement[],
  documents: HealthDocRow[],
  today: string,
  soonDays = DOCUMENT_EXPIRY_SOON_DAYS,
): DocumentHealthSummary {
  const live = documents.filter(d => d.status !== 'archived');

  // Best document per type: prefer verified, then most recently uploaded.
  const byType = new Map<string, HealthDocRow>();
  for (const d of live) {
    const held = byType.get(d.document_type);
    if (!held) { byType.set(d.document_type, d); continue; }
    if (d.status === 'verified' && held.status !== 'verified') { byType.set(d.document_type, d); continue; }
    if (d.status === held.status && (d.uploaded_at ?? '') > (held.uploaded_at ?? '')) byType.set(d.document_type, d);
  }

  const items: DocumentHealthItem[] = [];

  // One row per applicable requirement — including the ones with no document,
  // which is exactly how "missing" becomes visible.
  for (const req of requirements) {
    const doc = byType.get(req.documentType);
    const state = classifyDocumentHealth(doc, req.requiresExpiry, today, soonDays);
    items.push({
      documentId: doc?.id ?? null,
      requirementId: req.id,
      documentType: req.documentType,
      title: doc?.title ?? req.label,
      state,
      expiryDate: doc?.expiry_date ?? null,
      detail: detailFor(state, doc),
      required: true,
    });
  }

  // Documents the employee holds that no active requirement expects still belong
  // in the tree — omitting them would misrepresent the record.
  const requiredTypes = new Set(requirements.map(r => r.documentType));
  for (const d of live) {
    if (requiredTypes.has(d.document_type)) continue;
    const state = classifyDocumentHealth(d, false, today, soonDays);
    items.push({
      documentId: d.id,
      requirementId: null,
      documentType: d.document_type,
      title: d.title,
      state,
      expiryDate: d.expiry_date,
      detail: detailFor(state, d),
      required: false,
    });
  }

  const groupMap = new Map<string, DocumentHealthGroup>();
  for (const item of items) {
    const { key, label } = categoryOf(item.documentType);
    let group = groupMap.get(key);
    if (!group) {
      group = { key, label, currentCount: 0, expiringCount: 0, missingCount: 0, items: [] };
      groupMap.set(key, group);
    }
    group.items.push(item);
    if (HEALTHY.has(item.state)) group.currentCount += 1;
    else if (item.state === 'expiring') group.expiringCount += 1;
    else if (item.state === 'missing' || item.state === 'expired') group.missingCount += 1;
  }

  const requiredItems = items.filter(i => i.required);
  const requiredCount = requiredItems.length;
  const verifiedCount = requiredItems.filter(i => HEALTHY.has(i.state)).length;
  const expiringCount = requiredItems.filter(i => i.state === 'expiring').length;
  const missingCount  = requiredItems.filter(i => i.state === 'missing' || i.state === 'expired').length;

  // Percentages are of the REQUIRED set, and are 0 rather than NaN when nothing
  // is required — a "NaN%" on a compliance bar is worse than an honest zero.
  const pct = (n: number): number => (requiredCount === 0 ? 0 : Math.round((n / requiredCount) * 100));

  return {
    totalDocuments: live.length,
    requiredCount,
    verifiedCount,
    expiringCount,
    missingCount,
    verifiedPercent: pct(verifiedCount),
    expiringPercent: pct(expiringCount),
    missingPercent: pct(missingCount),
    categoryCount: groupMap.size,
    groups: [...groupMap.values()].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
  };
}

/** Read the sources and build the health model for one employee. */
export async function getDocumentHealth(
  employeeId: string,
  canSeeSensitive: boolean,
  today: string,
): Promise<DocumentHealthSummary> {
  const [empRes, requirementList, docsRes] = await Promise.all([
    sb.from('app_users').select('id, full_name, role, employment_type, department_id')
      .eq('id', employeeId)
      .maybeSingle<{ id: string; full_name: string | null; role: string; employment_type: string | null; department_id: string | null }>(),
    listRequirements(true),
    sb.from('hr_employee_documents')
      .select('id, employee_id, document_type, title, status, expiry_date, confidentiality, verified_at, uploaded_at')
      .eq('employee_id', employeeId).neq('status', 'archived'),
  ]);
  if (empRes.error) throw new Error(`Document health employee read failed: ${empRes.error.message}`);
  if (docsRes.error) throw new Error(`Document health document read failed: ${docsRes.error.message}`);
  if (!empRes.data) throw Object.assign(new Error('Employee not found.'), { status: 404 });

  const requirements = resolveRequiredTypesForEmployee(empRes.data, requirementList);
  const visible = filterVisibleDocs(docsRes.data as HealthDocRow[], canSeeSensitive);
  return buildDocumentHealth(requirements, visible, today);
}
