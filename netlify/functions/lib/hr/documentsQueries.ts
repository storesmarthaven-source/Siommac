/**
 * netlify/functions/lib/hr/documentsQueries.ts
 *
 * Cross-employee document reads: register list, stats, expiry lists.
 * All reads apply filterVisibleDocs using a pre-computed canSeeSensitive flag.
 */

import { sb } from '../db';
import { filterVisibleDocs, computeExpiryState } from './documentsCore';
import type { ExpiryState } from './documentsCore';

export interface DocFilters {
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

interface RawDocRow {
  id: string;
  employee_id: string;
  document_type: string;
  title: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  confidentiality: string;
  status: string;
  expiry_date: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  verified_by: string | null;
  verified_at: string | null;
  rejected_reason: string | null;
  archived_at: string | null;
  metadata: Record<string, unknown>;
}

export interface DocListRow extends RawDocRow {
  expiryState: ExpiryState;
  employeeName: string | null;
  departmentName: string | null;
}

export interface ListAllDocumentsResult {
  rows: DocListRow[];
  total: number;
}

/**
 * Cross-employee document register. Applies the confidentiality gate.
 * Default excludes archived unless status:'archived' is explicitly requested.
 */
export async function listAllDocuments(
  canSeeSensitive: boolean,
  filters: DocFilters,
): Promise<ListAllDocumentsResult> {
  const today = new Date().toISOString().slice(0, 10);
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 50, 200);

  let q = sb
    .from('hr_employee_documents')
    .select('*', { count: 'exact' })
    .order('uploaded_at', { ascending: false });

  // Exclude archived unless explicitly requested
  if (!filters.status) {
    q = q.neq('status', 'archived');
  } else {
    q = q.eq('status', filters.status);
  }

  if (filters.employeeId)     q = q.eq('employee_id', filters.employeeId);
  if (filters.documentType)   q = q.eq('document_type', filters.documentType);
  if (filters.confidentiality) q = q.eq('confidentiality', filters.confidentiality);

  if (filters.expiryState === 'expired') {
    q = q.lt('expiry_date', today).not('expiry_date', 'is', null);
  } else if (filters.expiryState === 'expiring') {
    const withinDays = filters.expiringWithinDays ?? 30;
    const threshold = new Date(today);
    threshold.setDate(threshold.getDate() + withinDays);
    const thresholdISO = threshold.toISOString().slice(0, 10);
    q = q.gte('expiry_date', today).lte('expiry_date', thresholdISO);
  } else if (filters.expiryState === 'valid') {
    const withinDays = filters.expiringWithinDays ?? 30;
    const threshold = new Date(today);
    threshold.setDate(threshold.getDate() + withinDays);
    const thresholdISO = threshold.toISOString().slice(0, 10);
    q = q.gt('expiry_date', thresholdISO);
  } else if (filters.expiryState === 'none') {
    q = q.is('expiry_date', null);
  }

  // Pagination
  const from = (page - 1) * pageSize;
  q = q.range(from, from + pageSize - 1);

  const { data, count, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  let rows = (data ?? []) as RawDocRow[];

  // Confidentiality gate
  rows = filterVisibleDocs(rows, canSeeSensitive);

  // Client-side text search (applied after confidentiality filter)
  if (filters.q) {
    const s = filters.q.toLowerCase();
    rows = rows.filter(r =>
      r.title.toLowerCase().includes(s) ||
      r.document_type.toLowerCase().includes(s) ||
      r.employee_id.toLowerCase().includes(s),
    );
  }

  // Enrich with employee names + department
  const empIds = Array.from(new Set(rows.map(r => r.employee_id)));
  let empMap = new Map<string, { full_name: string | null; department_id: string | null }>();
  if (empIds.length) {
    const { data: emps } = await sb
      .from('app_users')
      .select('id, full_name, department_id')
      .in('id', empIds);
    for (const e of (emps ?? []) as { id: string; full_name: string | null; department_id: string | null }[]) {
      empMap.set(e.id, { full_name: e.full_name, department_id: e.department_id });
    }
  }

  // Filter by department if requested
  let filteredRows = rows;
  if (filters.departmentId) {
    filteredRows = rows.filter(r => empMap.get(r.employee_id)?.department_id === filters.departmentId);
  }

  // Resolve department names
  const deptIds = Array.from(new Set(
    Array.from(empMap.values()).map(e => e.department_id).filter((x): x is string => !!x),
  ));
  let deptMap = new Map<string, string>();
  if (deptIds.length) {
    const { data: depts } = await sb
      .from('departments')
      .select('id, name')
      .in('id', deptIds);
    for (const d of (depts ?? []) as { id: string; name: string }[]) {
      deptMap.set(d.id, d.name);
    }
  }

  const enriched: DocListRow[] = filteredRows.map(r => {
    const emp = empMap.get(r.employee_id);
    const deptId = emp?.department_id ?? null;
    return {
      ...r,
      expiryState: computeExpiryState(r.expiry_date, today),
      employeeName: emp?.full_name ?? null,
      departmentName: deptId ? (deptMap.get(deptId) ?? null) : null,
    };
  });

  return { rows: enriched, total: count ?? enriched.length };
}

export interface DocumentsStats {
  total: number;
  uploaded: number;      // pending verification
  verified: number;
  expiringSoon: number;  // within 30 days
  expired: number;
  missingRequired: number;
}

/**
 * Aggregate document counts for the stats row.
 * missingRequired is passed in — computed separately by getComplianceOverview.
 */
export async function getDocumentsStats(
  canSeeSensitive: boolean,
  missingRequired = 0,
): Promise<DocumentsStats> {
  const today = new Date().toISOString().slice(0, 10);
  const threshold30 = new Date(today);
  threshold30.setDate(threshold30.getDate() + 30);
  const threshold30ISO = threshold30.toISOString().slice(0, 10);

  const [totalRes, uploadedRes, verifiedRes, expiringSoonRes, expiredRes] = await Promise.all([
    sb.from('hr_employee_documents').select('id', { count: 'exact', head: true }).neq('status', 'archived'),
    sb.from('hr_employee_documents').select('id', { count: 'exact', head: true }).eq('status', 'uploaded'),
    sb.from('hr_employee_documents').select('id', { count: 'exact', head: true }).eq('status', 'verified'),
    sb.from('hr_employee_documents').select('id', { count: 'exact', head: true })
      .gte('expiry_date', today).lte('expiry_date', threshold30ISO).neq('status', 'archived'),
    sb.from('hr_employee_documents').select('id', { count: 'exact', head: true })
      .lt('expiry_date', today).neq('status', 'archived'),
  ]);

  // Confidentiality gate is best-effort for stats (hidden tiers reduce count for non-sensitive viewers)
  return {
    total:           totalRes.count ?? 0,
    uploaded:        uploadedRes.count ?? 0,
    verified:        verifiedRes.count ?? 0,
    expiringSoon:    expiringSoonRes.count ?? 0,
    expired:         expiredRes.count ?? 0,
    missingRequired,
  };
}

export interface ExpiringDocRow extends RawDocRow {
  expiryState: ExpiryState;
  employeeName: string | null;
}

/**
 * Documents with expiry_date within the given window (default 30 days) or already expired.
 * Used by the Expiring tab.
 */
export async function listExpiring(
  canSeeSensitive: boolean,
  opts: { withinDays?: number } = {},
): Promise<ExpiringDocRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const days = opts.withinDays ?? 30;
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + days);
  const thresholdISO = threshold.toISOString().slice(0, 10);

  const { data, error } = await sb
    .from('hr_employee_documents')
    .select('*')
    .not('expiry_date', 'is', null)
    .lte('expiry_date', thresholdISO)
    .neq('status', 'archived')
    .order('expiry_date', { ascending: true });

  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  let rows = filterVisibleDocs((data ?? []) as RawDocRow[], canSeeSensitive);

  const empIds = Array.from(new Set(rows.map(r => r.employee_id)));
  let empMap = new Map<string, string | null>();
  if (empIds.length) {
    const { data: emps } = await sb.from('app_users').select('id, full_name').in('id', empIds);
    for (const e of (emps ?? []) as { id: string; full_name: string | null }[]) {
      empMap.set(e.id, e.full_name);
    }
  }

  return rows.map(r => ({
    ...r,
    expiryState: computeExpiryState(r.expiry_date, today, days),
    employeeName: empMap.get(r.employee_id) ?? null,
  }));
}
