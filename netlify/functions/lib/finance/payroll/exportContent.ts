import { createHash } from 'node:crypto';

export type PayrollExportFormat = 'csv' | 'json';

// The export artifact itself is serialized inside finance_payroll_record_export_tx
// (one SQL authority). TypeScript only re-verifies the SHA-256 of downloaded bytes.
export function payrollExportChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
