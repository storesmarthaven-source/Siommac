// ============================================================================
// Shared tabular export renderer — CSV and PDF.
// ============================================================================
// Extracted from lib/finance/payroll/payrollReportFiles.ts so Payroll Reports and
// the HR employee exports render through ONE implementation. Duplicating the CSV
// escaping in particular would have been dangerous: the formula-injection guard
// below is a security control, and a second copy is a second place to forget it.
//
// XLSX IS DELIBERATELY NOT SUPPORTED — and must not be re-added here.
// The Excel writer (exceljs) was removed from this repository because it pulled a
// flagged transitive dependency. Re-introducing it to satisfy a dialog option
// would trade a real vulnerability for a file format, which the build's
// no-expedient-dependencies rule forbids. PDF reuses the existing `pdfkit`
// dependency; CSV is hand-rolled and opens correctly in Excel via the BOM.
// ============================================================================

import PDFDocument from 'pdfkit';

/** Formats this renderer can produce. Intentionally excludes xlsx. */
export type ExportFileFormat = 'csv' | 'pdf';

export type ReportCell = string | number;

export interface ReportTable {
  title: string;
  /** Rendered under the title, e.g. the employee and the applied scope. */
  subtitle?: string;
  headers: string[];
  rows: ReportCell[][];
}

export interface FileBytes {
  buffer: Buffer;
  contentType: string;
  ext: ExportFileFormat;
}

export interface RenderedFile extends FileBytes { rowCount: number }

// A text cell opening with one of these is treated as a formula by Excel/Sheets
// → prefix a single quote to neutralize injection. Applied ONLY to string cells,
// so numeric values (incl. negatives like -500) are never mangled.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

const CSV_ESCAPE = (v: ReportCell): string => {
  let s = String(v);
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
      const meta = [`Generated ${new Date(generatedAt).toLocaleString('en-GB')}`, t.subtitle].filter(Boolean).join(' · ');
      doc.fontSize(9).font('Helvetica').fillColor('#666').text(meta);
      doc.moveDown(0.8).fillColor('#000');

      const pageW = doc.page.width - 72;
      const colW = t.headers.length ? pageW / t.headers.length : pageW;
      const drawRow = (cells: ReportCell[], bold: boolean): void => {
        const y = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        cells.forEach((c, i) => doc.text(String(c), 36 + i * colW, y, { width: colW - 4, ellipsis: true }));
        doc.moveDown(0.2);
        if (doc.y > doc.page.height - 48) doc.addPage();
      };
      drawRow(t.headers, true);
      doc.moveTo(36, doc.y).lineTo(36 + pageW, doc.y).strokeColor('#ccc').stroke().moveDown(0.2);
      if (!t.rows.length) doc.font('Helvetica-Oblique').fontSize(9).text('No rows for this selection.');
      for (const r of t.rows) drawRow(r, false);
      doc.end();
    } catch (e) { reject(e instanceof Error ? e : new Error('PDF render failed')); }
  });
}

/** Render a table to a file buffer. */
export async function renderTableFile(
  table: ReportTable, format: ExportFileFormat, generatedAt: string,
): Promise<RenderedFile> {
  const f = format === 'csv' ? renderCsv(table) : await renderPdf(table, generatedAt);
  return { ...f, rowCount: table.rows.length };
}
