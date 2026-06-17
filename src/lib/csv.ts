/**
 * src/lib/csv.ts
 *
 * App-wide CSV utility. Builds RFC-4180-compliant CSV text from rows of data
 * and triggers a browser download. Dependency-free.
 *
 * Handles the things ad-hoc string concatenation gets wrong:
 *   - quoting values that contain commas, quotes, or newlines
 *   - escaping embedded double-quotes by doubling them
 *   - null/undefined → empty cell
 *   - a UTF-8 BOM so Excel opens accented text correctly
 *
 * USAGE
 *   // From objects + an explicit column spec (recommended):
 *   downloadCsv('audit-log.csv', rows, [
 *     { header: 'When',   value: r => r.created_at },
 *     { header: 'User',   value: r => r.username },
 *     { header: 'Action', value: r => r.action },
 *   ]);
 *
 *   // Or build the string without downloading (e.g. for tests):
 *   const text = toCsv(rows, columns);
 *
 * @see docs/CODING_STANDARDS.md
 */

export interface CsvColumn<T> {
  /** Column header text. */
  header: string;
  /** Extract the cell value for a row. Return any primitive; null/undefined → ''. */
  value: (row: T) => string | number | boolean | null | undefined;
}

/** Escape a single CSV field per RFC 4180. */
export function escapeCsvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Quote if the field contains a comma, double-quote, CR or LF; double any quotes.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build CSV text (with header row) from rows + a column spec. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const headerLine = columns.map(c => escapeCsvField(c.header)).join(',');
  const bodyLines = rows.map(row =>
    columns.map(c => escapeCsvField(c.value(row))).join(','),
  );
  return [headerLine, ...bodyLines].join('\r\n');
}

/** Build CSV text from a plain 2-D array (header row + data rows). */
export function arrayToCsv(rows: readonly (readonly (string | number | boolean | null | undefined)[])[]): string {
  return rows.map(r => r.map(escapeCsvField).join(',')).join('\r\n');
}

/** Trigger a browser download of `text` as a file. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  // Prepend a UTF-8 BOM so spreadsheet apps detect the encoding.
  const blob = new Blob(['﻿', text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Build CSV from rows + columns and download it. */
export function downloadCsv<T>(filename: string, rows: readonly T[], columns: readonly CsvColumn<T>[]): void {
  downloadText(filename, toCsv(rows, columns));
}
