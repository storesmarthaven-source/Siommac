// lib/finance/payroll/controlCenterCursor.ts
// PURE (DB-free) opaque keyset-cursor codec for the Command Center run register.
// Encodes the deterministic order tuple + a filter fingerprint; decode throws { status: 422 }
// on malformed input OR a filter-fingerprint mismatch (a cursor replayed with different filters).
// Unit-testable per approved §10 ("cursor validation"). No Supabase import.

export interface RegisterCursorTuple {
  payDate: string | null; // YYYY-MM-DD or null
  periodEnd: string;      // YYYY-MM-DD
  runNo: string;
  id: string;             // uuid
}

/** Stable, dependency-free string hash (djb2) → 8 hex chars. */
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Deterministic fingerprint of the filters a cursor is only valid within. */
export function filterFingerprint(input: {
  window: { from: string; to: string };
  payGroupIds: string[];
  tab: string;
  search: string | null;
}): string {
  const canonical = JSON.stringify({
    from: input.window.from,
    to: input.window.to,
    pg: [...input.payGroupIds].sort(),
    tab: input.tab,
    q: input.search ?? '',
  });
  return hashStr(canonical);
}

export function encodeCursor(tuple: RegisterCursorTuple, fingerprint: string): string {
  const json = JSON.stringify({ f: fingerprint, k: [tuple.payDate, tuple.periodEnd, tuple.runNo, tuple.id] });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** Decode + validate. Throws { status: 422 } on malformed OR filter-fingerprint mismatch. */
export function decodeCursor(cursor: string, fingerprint: string): RegisterCursorTuple {
  const malformed = (): never => {
    throw Object.assign(new Error('Malformed register cursor.'), { status: 422 });
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return malformed();
  }
  const obj = parsed as { f?: unknown; k?: unknown };
  if (typeof obj?.f !== 'string' || !Array.isArray(obj.k) || obj.k.length !== 4) return malformed();
  if (obj.f !== fingerprint) {
    throw Object.assign(
      new Error('Register cursor does not match the current filters.'),
      { status: 422 },
    );
  }
  // Validate the typed tuple VALUES (not just JS types) so invalid dates/uuids can never reach the
  // SQL function's typed cursor parameters and fail with a Postgres cast error (500 instead of 422).
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const k = obj.k as unknown[];
  const payDateOk = k[0] === null || (typeof k[0] === 'string' && DATE.test(k[0]));
  const periodEndOk = typeof k[1] === 'string' && DATE.test(k[1]);
  const runNoOk = typeof k[2] === 'string' && k[2].length > 0 && k[2].length <= 100;
  const idOk = typeof k[3] === 'string' && UUID.test(k[3]);
  if (!(payDateOk && periodEndOk && runNoOk && idOk)) return malformed();
  return {
    payDate: k[0] as string | null,
    periodEnd: k[1] as string,
    runNo: k[2] as string,
    id: k[3] as string,
  };
}
