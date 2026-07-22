// ============================================================================
// Payroll Reports Center (F-12) — file rendering (Slice 3)
// ============================================================================
// Renders a completed interactive report (the same §5B DTO the preview returns)
// to xlsx / csv / pdf. ONE table-extraction per report feeds all three renderers,
// so a file is always a faithful projection of the previewed data. The audit-
// package ZIP is deferred (jszip not yet approved) — see REPORT_ZIP_ENABLED.
// PDF reuses the existing pdfkit dependency; CSV is hand-rolled; XLSX uses exceljs.
// ============================================================================

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { MoneyValue, ReportRunResult } from '../../../../../types/payrollReports';

type Completed = Extract<ReportRunResult, { state: 'completed' }>;
type StandardFileFormat = 'xlsx' | 'csv' | 'pdf';
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

const CSV_ESCAPE = (v: Cell): string => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function renderCsv(t: ReportTable): FileBytes {
  const lines = [t.headers.map(CSV_ESCAPE).join(','), ...t.rows.map(r => r.map(CSV_ESCAPE).join(','))];
  // BOM so Excel opens UTF-8 correctly.
  return { buffer: Buffer.from('﻿' + lines.join('\r\n'), 'utf8'), contentType: 'text/csv; charset=utf-8', ext: 'csv' };
}

async function renderXlsx(t: ReportTable): Promise<FileBytes> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIOMAC Payroll';
  const ws = wb.addWorksheet(t.title.slice(0, 31));
  const header = ws.addRow(t.headers);
  header.font = { bold: true };
  for (const r of t.rows) ws.addRow(r);
  ws.columns.forEach(col => {
    let max = 10;
    col.eachCell?.({ includeEmpty: true }, c => { max = Math.max(max, String(c.value ?? '').length + 2); });
    col.width = Math.min(max, 48);
  });
  const ab = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(ab as ArrayBuffer), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
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

/** Render a completed report to a file buffer. export_audit_package (zip) is deferred. */
export async function renderReportFile(d: Completed, format: StandardFileFormat): Promise<RenderedFile> {
  const table = toReportTable(d);
  const f = format === 'csv' ? renderCsv(table)
    : format === 'xlsx' ? await renderXlsx(table)
    : await renderPdf(table, d.generatedAt);
  return { ...f, rowCount: table.rows.length };
}
