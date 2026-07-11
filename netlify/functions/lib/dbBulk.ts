// ============================================================================
// Bulk DB helpers — scale past PostgREST's default 1000-row page + payload caps
// ============================================================================
// PostgREST returns at most `max-rows` (default 1000) per select and rejects
// very large insert payloads. Payroll runs of several hundred to ~2000 employees
// exceed both silently (a SELECT would TRUNCATE at 1000 → wrong calc; a big
// INSERT would fail). These helpers paginate reads and chunk writes so the calc
// pipeline is correct + safe at that scale, using a CONSTANT number of round
// trips relative to the row count (no per-row N+1).
// ============================================================================

import { sb } from './db';

/** A query builder that still accepts `.range()` (select not yet awaited). */
interface Rangeable<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

/**
 * Fetch EVERY row of a select, paging past the 1000-row cap. `build` must return
 * a FRESH query (select + filters + order, WITHOUT range) each call.
 */
export async function selectAllRows<T>(build: () => Rangeable<T>, page = 1000): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await build().range(offset, offset + page - 1);
    if (error) throw Object.assign(new Error('selectAllRows: ' + error.message), { status: 500 });
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < page) break;
    offset += page;
  }
  return out;
}

/** Split an array into chunks of at most `size`. */
export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Insert rows in batches so a large payload never exceeds PostgREST limits. */
export async function chunkedInsert(table: string, rows: Record<string, unknown>[], size = 500): Promise<void> {
  for (const batch of chunk(rows, size)) {
    const { error } = await sb.from(table).insert(batch);
    if (error) throw Object.assign(new Error(`chunkedInsert(${table}): ` + error.message), { status: 500 });
  }
}
