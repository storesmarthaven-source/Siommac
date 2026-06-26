/**
 * src/api/hr/employeeImport.ts
 *
 * Typed client for the HR Employee Master bulk-import backend (routes/hrEmployeeImport.ts,
 * 7-step wizard: upload → map → policy → validate → resolve → commit → report).
 * Wired to the REAL endpoints (POST `hr/employees/import/*`, camelCase `body.args`)
 * via the shared apiPost — no new backend. The browser sends the raw CSV as base64;
 * the backend parses + stages + validates + commits via the shared provisionEmployee.
 */

import { apiPost } from '@lib/api';

async function call<T>(path: string, args: Record<string, unknown>): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T }>(path, args);
  return res.data;
}

// ── contracts (mirror routes/hrEmployeeImport.ts) ──────────────────────────────

export type ImportMode = 'create' | 'update' | 'create_update';

export interface ImportPolicy {
  duplicateEmployeeNumber: 'skip' | 'update' | 'error';
  duplicateUsername:       'skip' | 'error';
  missingSupervisor:       'allow' | 'warn' | 'block';
  missingStatutory:        'allow' | 'warn' | 'block';
  createLogins:            boolean;
  contractorRows:          'import' | 'reject';
}

export interface ImportUploadResult {
  batchId: string; batchNo: string; totalRows: number;
  columns: string[]; sample: Record<string, string>[];
}
export interface ImportValidateSummary { ready: number; warning: number; blocked: number; duplicate: number }
export interface ImportCommitResult { batchId: string; created: number; updated: number; failed: number }
export interface ImportReportRow {
  id: string; row_no: number; status: string; severity: string | null; resolution: string | null;
  target_employee_id: string | null; mapped_data: Record<string, string>;
}
export interface ImportReportError { row_id: string; field_key: string | null; error_code: string; severity: string; message: string }
export interface ImportReport {
  batch: Record<string, unknown>;
  rows: ImportReportRow[];
  errors: ImportReportError[];
}

// ── API ────────────────────────────────────────────────────────────────────────

export const hrImportApi = {
  upload: (a: { fileName: string; fileType: 'csv'; fileBase64: string; importMode?: ImportMode; defaultSiteId?: string | null; defaultDepartmentId?: string | null }) =>
    call<ImportUploadResult>('hr/employees/import/upload', a),
  mapFields: (a: { batchId: string; mapping: Record<string, string> }) =>
    call<{ batchId: string }>('hr/employees/import/map-fields', a),
  setPolicy: (a: { batchId: string; policy: Partial<ImportPolicy> }) =>
    call<{ batchId: string }>('hr/employees/import/set-policy', a),
  validate: (a: { batchId: string }) =>
    call<{ batchId: string; summary: ImportValidateSummary }>('hr/employees/import/validate', a),
  resolveRow: (a: { batchId: string; rowId: string; action: 'edit' | 'ignore' | 'skip' | 'assign'; patch?: Record<string, string> }) =>
    call<{ rowId: string; status: string }>('hr/employees/import/resolve-row', a),
  commit: (a: { batchId: string }) =>
    call<ImportCommitResult>('hr/employees/import/commit', a),
  report: (a: { batchId: string }) =>
    call<ImportReport>('hr/employees/import/report', a),
};
