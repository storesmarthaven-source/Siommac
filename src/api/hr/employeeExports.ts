/**
 * src/api/hr/employeeExports.ts — client for the three authenticated employee
 * exports.
 *
 * These endpoints return FILE BYTES, not JSON, so they cannot go through
 * `apiPost`. This module issues the request with the same Authorization header
 * and base URL, then hands the blob to the browser.
 *
 * Nothing here builds the file. The rows, the confidentiality filtering and the
 * totals are all produced server-side from the authorised service — an export
 * assembled from rows the browser happens to hold could only ever contain what
 * the browser was given, and would move the security filtering to where it can
 * be tampered with.
 *
 * FORMATS: csv and pdf. XLSX is deliberately absent — the Excel writer was
 * removed from this repository for a flagged transitive dependency, and the
 * dialog must not offer a format the backend refuses to produce.
 */
import { API_URL } from '@cfg';
import { getToken } from '@lib/session';

/** The only formats the backend renders. */
export type EmployeeExportFormat = 'csv' | 'pdf';

/** Scopes the locked Export Document Index dialog offers. */
export type DocumentIndexScope = 'all_authorised' | 'current_filters' | 'expiring_missing';

export interface AuditExportOptions {
  dateFrom?: string | null;
  dateTo?: string | null;
  area?: string | null;
  /** Mandatory business justification — the backend refuses without it. */
  reason: string;
}

export interface ExportOutcome {
  fileName: string;
  rowCount: number;
  /** Correlates the downloaded file with its `audit_logs` row. */
  correlationId: string;
}

/**
 * POST for a file and save it.
 *
 * A failed export still returns JSON, so the error path parses the body rather
 * than saving a file containing an error message — which is exactly what a naive
 * blob download would hand the user.
 */
async function downloadExport(
  path: string, args: Record<string, unknown>,
): Promise<ExportOutcome> {
  const token = getToken();
  const res = await fetch(`${API_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    // The backend envelope unwraps `args` — matching apiPost's contract.
    body: JSON.stringify({ args }),
  });

  if (!res.ok || res.headers.get('Content-Type')?.includes('application/json')) {
    let message = `Export failed (${res.status}).`;
    try {
      const body = await res.json() as { message?: string };
      if (body.message) message = body.message;
    } catch { /* non-JSON error body — keep the status message */ }
    throw new Error(message);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'employee-export';

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoking immediately after click is safe and avoids leaking the object URL.
    URL.revokeObjectURL(url);
  }

  return {
    fileName,
    rowCount: Number(res.headers.get('X-Export-Rows') ?? 0),
    correlationId: res.headers.get('X-Correlation-Id') ?? '',
  };
}

/** Document metadata and status only — never a document binary. */
export function exportDocumentIndex(
  employeeId: string, format: EmployeeExportFormat, scope: DocumentIndexScope,
): Promise<ExportOutcome> {
  return downloadExport('hr/employees/exports/document-index', { employeeId, format, scope });
}

/** The employee's real readiness matrix: controls, owners, blockers, due dates. */
export function exportReadinessBreakdown(
  employeeId: string, format: EmployeeExportFormat,
): Promise<ExportOutcome> {
  return downloadExport('hr/employees/exports/readiness-breakdown', { employeeId, format });
}

/** Audit history with date range, area filter and capability masking. */
export function exportAuditHistory(
  employeeId: string, format: EmployeeExportFormat, options: AuditExportOptions,
): Promise<ExportOutcome> {
  return downloadExport('hr/employees/exports/audit-history', {
    employeeId, format,
    dateFrom: options.dateFrom ?? null,
    dateTo: options.dateTo ?? null,
    area: options.area ?? null,
    reason: options.reason,
  });
}
