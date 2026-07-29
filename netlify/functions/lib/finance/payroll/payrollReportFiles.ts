// ============================================================================
// Payroll Reports Center (F-12) — file rendering (Slice 3)
// ============================================================================
// Renders a completed interactive report (the same §5B DTO the preview returns)
// to csv / pdf. ONE table-extraction per report feeds both renderers, so a file is
// always a faithful projection of the previewed data. XLSX is deferred (exceljs
// pulled a flagged transitive dep) and the audit-package ZIP is deferred (jszip
// not yet approved). PDF reuses the existing pdfkit dependency; CSV is hand-rolled.
// ============================================================================

import { renderTableFile, type RenderedFile } from '../../reportTable';
import type { MoneyValue, ReportRunResult, StandardFileFormat } from '../../../../../types/payrollReports';

export type { RenderedFile };

type Completed = Extract<ReportRunResult, { state: 'completed' }>;
type Cell = string | number;

interface ReportTable { title: string; headers: string[]; rows: Cell[][] }

const m = (v: MoneyValue): number => v.amount;

/** Flatten any completed report into a single titled table (money → numbers). */
export function toReportTable(d: Completed): ReportTable {
  switch (d.report) {
    case 'payroll_register':
      return {
        title: 'Payroll Register',
        headers: ['Employee ID', 'Employee', 'Pay group', 'Gross', 'PAYE', 'NIS', 'Other', 'Net'],
        rows: d.rows.map(r => [r.employeeId, r.employeeName, r.payGroup, m(r.gross), m(r.paye), m(r.nis), m(r.other), m(r.net)]),
      };
    case 'net_pay_summary':
      return {
        title: 'Net Pay Summary',
        headers: ['Group', 'Employees', 'Gross', 'Deductions', 'Net', 'Readiness'],
        rows: d.rows.map(r => [r.group, r.employees, m(r.gross), m(r.deductions), m(r.net), r.readiness]),
      };
    case 'payroll_cost_analysis':
      return {
        title: 'Payroll Cost Analysis',
        headers: ['Department', 'Cost centre', 'Employees', 'Gross', 'Employer cost', 'vs prior %'],
        rows: d.rows.map(r => [r.department, r.costCentre, r.employees, m(r.gross), m(r.employerCost), r.vsPriorPct]),
      };
    case 'gross_to_net_reconciliation':
      return {
        title: 'Gross-to-Net Reconciliation',
        headers: ['Source', 'Register total', 'Summary total', 'Difference', 'Matched', 'Evidence'],
        rows: d.reconciliation.sources.map(s => [s.source, m(s.registerTotal), m(s.summaryTotal), m(s.difference), s.matched ? 'yes' : 'no', s.evidenceRef]),
      };
    case 'variance_analysis':
      return {
        title: 'Variance Analysis',
        headers: ['Measure', 'Prior', 'Current', 'Change %', 'Driver', 'Certified'],
        rows: d.rows.map(r => {
          const prior = r.value.unit === 'money' ? m(r.value.prior) : r.value.prior;
          const current = r.value.unit === 'money' ? m(r.value.current) : r.value.current;
          return [r.measure, prior, current, r.changePct, r.driver, r.certified ? 'yes' : 'no'];
        }),
      };
    case 'overtime_allowance_analysis':
      return {
        title: 'Overtime & Allowance Analysis',
        headers: ['Department', 'Employees', 'OT hours', 'OT cost', 'Allowance cost', 'Control'],
        rows: d.rows.map(r => [r.department, r.employees, r.overtimeHours, m(r.overtimeCost), m(r.allowanceCost), r.controlStatus]),
      };
    case 'population_movements':
      return {
        title: 'Population Movements',
        headers: ['Employee ID', 'Employee', 'Movement', 'Effective', 'From', 'To', 'Impact', 'Evidence'],
        rows: d.rows.map(r => [r.employeeId, r.employeeName, r.movement, r.effectiveDate, r.priorAssignment, r.currentAssignment, r.payrollImpact, r.evidence]),
      };
    case 'nis_exceptions':
      return {
        title: 'NIS Exceptions',
        headers: ['Employee ID', 'Employee', 'NIS number', 'Class', 'Profile', 'Impact', 'Owner'],
        rows: d.rows.map(r => [r.employeeId, r.employeeName, r.nisNumber ?? '', r.nisClass, r.profileStatus, r.payrollImpact, r.owner]),
      };
    default: {
      const _exhaustive: never = d;
      return { title: 'Report', headers: [], rows: (_exhaustive as { rows?: Cell[][] }).rows ?? [] };
    }
  }
}

/** Render a completed report to a file buffer. XLSX + export_audit_package (zip) are deferred. */
export async function renderReportFile(d: Completed, format: StandardFileFormat): Promise<RenderedFile> {
  // `StandardFileFormat` still carries formats this renderer does not produce;
  // anything other than csv falls to the PDF path, exactly as before.
  return renderTableFile(toReportTable(d), format === 'csv' ? 'csv' : 'pdf', d.generatedAt);
}
