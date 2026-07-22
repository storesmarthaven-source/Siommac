// Unit coverage for the F-12 shared report contract after the review remediation:
//  #10 — period month must be a REAL month (01–12); YYYY-99/-13 are rejected.
//  #14 — XLSX was removed from the format matrix (exceljs dropped); CSV/PDF remain.
import { describe, it, expect } from 'vitest';
import { reportParamsSchema, REPORT_FORMAT_MATRIX, PAYROLL_REPORT_KEYS } from '../../../../types/payrollReports';

describe('report period validation (#10)', () => {
  const cost = (from: string, to: string) => reportParamsSchema.safeParse({ report: 'payroll_cost_analysis', period: { from, to } });

  it('accepts a well-formed month range', () => {
    expect(cost('2026-01', '2026-06').success).toBe(true);
  });
  it('rejects an out-of-range month (YYYY-99) structurally', () => {
    expect(cost('2026-99', '2026-12').success).toBe(false);
  });
  it('rejects month 13', () => {
    expect(cost('2026-13', '2026-12').success).toBe(false);
  });
  it('rejects month 00', () => {
    expect(cost('2026-00', '2026-12').success).toBe(false);
  });
  // Note: reversed ranges (to < from) are a SEMANTIC 422 enforced in the engine
  // (assertValidPeriod), not a structural schema failure — so they parse here.
  it('parses a reversed range structurally (engine returns 422)', () => {
    expect(cost('2026-06', '2026-01').success).toBe(true);
  });
});

describe('format matrix (#14 — XLSX deferred)', () => {
  it('offers preview/csv/pdf but never xlsx for standard reports', () => {
    for (const key of PAYROLL_REPORT_KEYS) {
      if (key === 'export_audit_package') continue;
      const fmts = REPORT_FORMAT_MATRIX[key];
      expect(fmts).toContain('csv');
      expect(fmts).toContain('pdf');
      expect(fmts).not.toContain('xlsx');
    }
  });
  it('keeps the audit package as zip-only', () => {
    expect([...REPORT_FORMAT_MATRIX.export_audit_package]).toEqual(['zip']);
  });
});
