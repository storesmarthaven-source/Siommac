// lib/hr/csvParse.ts — minimal, correct CSV parser (no dependency).
//
// Handles quoted fields, escaped quotes (""), embedded commas/newlines, CRLF line
// endings, and a leading UTF-8 BOM. Returns the header row + one object per data
// row keyed by trimmed header. CSV-only for now; XLSX is a flagged follow-up that
// must use the patched SheetJS CDN build (see CLAUDE.md), never `npm i xlsx`.

export interface ParsedCsv { headers: string[]; rows: Record<string, string>[] }

export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;   // strip BOM
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); records.push(row); row = []; field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); records.push(row); }

  // Drop fully-empty records (e.g. a trailing newline).
  const nonEmpty = records.filter(r => r.some(c => c.trim() !== ''));
  const headerRow = nonEmpty[0];
  if (!headerRow) return { headers: [], rows: [] };

  const headers = headerRow.map(h => h.trim());
  const rows = nonEmpty.slice(1).map(r => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => { o[h] = (r[idx] ?? '').trim(); });
    return o;
  });
  return { headers, rows };
}
