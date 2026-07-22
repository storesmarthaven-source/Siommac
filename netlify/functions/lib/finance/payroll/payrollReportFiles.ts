// ============================================================================
// Payroll Reports Center (F-12) — file rendering (Slice 3)
// ============================================================================
// Renders a completed interactive report (the same §5B DTO the preview returns)
// to csv / pdf. ONE table-extraction per report feeds both renderers, so a file is
// always a faithful projection of the previewed data. XLSX is deferred (exceljs
// pulled a flagged transitive dep) and the audit-package ZIP is deferred (jszip
// not yet approved). PDF reuses the existing pdfkit dependency; CSV is hand-rolled.
// ============================================================================

import PDFDocument from 'pdfkit';
import type { MoneyValue, ReportRunResult, StandardFileFormat } from '../../../../../types/payrollReports';

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

interface FileBytes { buffer: Buffer; contentType: string; ext: StandardFileFormat }
export interface RenderedFile extends FileBytes { rowCount: number }

// A text cell that opens with one of these is treated as a formula by Excel/Sheets
// → prefix a single quote to neutralize injection. Applied ONLY to string cells,
// so numeric values (incl. negatives like -500) are never mangled.
const FORMULA_LEAD = /^[=+\-@\t\r]/;
const CSV_ESCAPE = (v: Cell): string => {
  let s = String(v ?? '');
  if (typeof v === 'string' && FORMULA_LEAD.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function renderCsv(t: ReportTable): FileBytes {
  const lines = [t.headers.map(CSV_ESCAPE).join(','), ...t.rows.map(r => r.map(CSV_ESCAPE).join(','))];
  // BOM so Excel opens UTF-8 correctly.
  return { buffer: Buffer.from('﻿' + lines.join('\r\n'), 'utf8'), contentType: 'text/csv; charset=utf-8', ext: 'csv' };
}

function renderPdf(t: ReportTable, generatedAt: string): Promise<FileBytes> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: 'application/pdf', ext: 'pdf' }));

      doc.fontSize(16).font('Helvetica-Bold').text(t.title);
      doc.fontSize(9).font('Helvetica').fillColor('#666').text(`Generated ${new Date(generatedAt).toLocaleString('en-GB')} · currency TTD`);
      doc.moveDown(0.8).fillColor('#000');

      const pageW = doc.page.width - 72;
      const colW = t.headers.length ? pageW / t.headers.length : pageW;
      const drawRow = (cells: Cell[], bold: boolean): void => {
        const y = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        cells.forEach((c, i) => doc.text(String(c ?? ''), 36 + i * colW, y, { width: colW - 4, ellipsis: true }));
        doc.moveDown(0.2);
        if (doc.y > doc.page.height - 48) doc.addPage();
      };
      drawRow(t.headers, true);
      doc.moveTo(36, doc.y).lineTo(36 + pageW, doc.y).strokeColor('#ccc').stroke().moveDown(0.2);
      if (!t.rows.length) doc.font('Helvetica-Oblique').fontSize(9).text('No rows for this selection.');
      for (const r of t.rows) drawRow(r, false);
      doc.end();
    } catch (e) { reject(e as Error); }
  });
}

/** Render a completed report to a file buffer. XLSX + export_audit_package (zip) are deferred. */
export async function renderReportFile(d: Completed, format: StandardFileFormat): Promise<RenderedFile> {
  const table = toReportTable(d);
  const f = format === 'csv' ? renderCsv(table) : await renderPdf(table, d.generatedAt);
  return { ...f, rowCount: table.rows.length };
}
