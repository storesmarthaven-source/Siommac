/**
 * src/ui/lib/exportCsv.ts
 *
 * Client-side CSV export for register tables. No backend round-trip — serialises
 * already-loaded rows and triggers a download. Shared across every ERP register
 * (incidents, CAPA, employees, …) so export behaviour is uniform.
 *
 * RFC 4180 quoting: fields containing comma, quote, CR or LF are wrapped in
 * double quotes with internal quotes doubled. A UTF-8 BOM is prepended so Excel
 * opens accented/Unicode content correctly.
 */

export interface CsvColumn<T> {
  /** Column header text. */
  header: string;
  /** Cell value extractor. Return string | number | null | undefined. */
  value: (row: T) => string | number | null | undefined;
}

/** Quote a single CSV field per RFC 4180. */
function csvField(raw: string | number | null | undefined): string {
  const s = raw == null ? '' : String(raw);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build CSV text (header + rows) from a column spec. */
export function toCsv<T>(rows: readonly T[], columns: ReadonlyArray<CsvColumn<T>>): string {
  const head = columns.map(c => csvField(c.header)).join(',');
  const body = rows.map(r => columns.map(c => csvField(c.value(r))).join(',')).join('\r\n');
  return body ? `${head}\r\n${body}` : head;
}

/**
 * Serialise rows to CSV and trigger a browser download.
 * @param filenameBase  base name; a date stamp + ".csv" are appended.
 */
export function exportCsv<T>(
  rows: readonly T[],
  columns: ReadonlyArray<CsvColumn<T>>,
  filenameBase: string,
): void {
  const csv  = toCsv(rows, columns);
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
