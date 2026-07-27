// lib/hr/importLimits.ts — explicit resource + structural limits for Employee Import.
//
// The upload endpoint previously accepted any non-empty base64 string: no byte, row,
// column, header or cell limit. The whole file was held in the request, decoded into
// memory, parsed, and inserted with one statement, so a large file could exhaust
// function memory or blow the request/statement size.
//
// These are PRODUCT limits, checked before any expensive work or staging write.
// Enterprise-sized imports need private storage plus a background staging worker
// (audit slice 3); until that exists, an over-limit file is refused with a clear
// message rather than accepted and failed halfway.

export const IMPORT_LIMITS = {
  /** Decoded file size. */
  maxFileBytes: 5 * 1024 * 1024,
  /** Base64 inflates by ~4/3; cap the encoded string so the payload is rejected
   *  by schema validation before it is ever decoded. */
  maxBase64Chars: Math.ceil((5 * 1024 * 1024) * 4 / 3) + 1024,
  maxRows: 5_000,
  maxColumns: 60,
  maxHeaderLength: 120,
  maxCellLength: 1_000,
} as const;

export interface ParsedCsvLike {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Structural and size validation for a parsed CSV.
 * Returns an error message, or null when the file is acceptable.
 */
export function checkImportLimits(parsed: ParsedCsvLike): string | null {
  const { headers, rows } = parsed;

  if (rows.length > IMPORT_LIMITS.maxRows) {
    return `This file has ${rows.length.toLocaleString()} rows. The limit is ${IMPORT_LIMITS.maxRows.toLocaleString()} — split it into smaller batches.`;
  }
  if (headers.length > IMPORT_LIMITS.maxColumns) {
    return `This file has ${headers.length} columns. The limit is ${IMPORT_LIMITS.maxColumns}.`;
  }

  // Blank headers cannot be mapped and silently swallow their column.
  const blankAt = headers.findIndex(h => !h.trim());
  if (blankAt !== -1) {
    return `Column ${blankAt + 1} has a blank header. Every column needs a name.`;
  }

  const tooLong = headers.find(h => h.length > IMPORT_LIMITS.maxHeaderLength);
  if (tooLong) {
    return `The column header "${tooLong.slice(0, 40)}…" is longer than ${IMPORT_LIMITS.maxHeaderLength} characters.`;
  }

  // Duplicate headers make a mapping ambiguous — the later column silently wins.
  const seen = new Set<string>();
  for (const h of headers) {
    const key = h.trim().toLowerCase();
    if (seen.has(key)) return `The column "${h.trim()}" appears more than once. Column names must be unique.`;
    seen.add(key);
  }

  // Control characters (incl. NUL) corrupt downstream storage and display.
  for (const h of headers) {
    let hasControl = false;
    for (let j = 0; j < h.length && !hasControl; j++) { const code = h.charCodeAt(j); hasControl = code < 0x20 || code === 0x7f; }
    if (hasControl) {
      return `The column header "${h.trim().slice(0, 40)}" contains control characters.`;
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows.at(i);
    if (!row) continue;
    for (const [col, value] of Object.entries(row)) {
      if (typeof value === 'string' && value.length > IMPORT_LIMITS.maxCellLength) {
        return `Row ${i + 1}, column "${col}" is longer than ${IMPORT_LIMITS.maxCellLength} characters.`;
      }
    }
  }

  return null;
}
