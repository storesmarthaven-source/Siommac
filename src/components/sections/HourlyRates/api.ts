/**
 * src/components/sections/HourlyRates/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost }          from '@lib/api';
import type { HourlyRateRow } from './types';

interface ApiResponse { success: boolean; message?: string; }
interface RatesResponse extends ApiResponse { data?: HourlyRateRow[]; }
interface BulkImportResponse extends ApiResponse { updated?: number; total?: number; skipped?: number; }

export async function listHourlyRates(signal?: AbortSignal): Promise<HourlyRateRow[]> {
  const res = await apiPost<RatesResponse>('listHourlyRates', {}, signal ? { signal } : undefined);
  return (res.success && res.data) ? res.data : [];
}

export async function updateHourlyRateApi(
  username: string,
  rate: number,
  signal?: AbortSignal,
): Promise<{ success: boolean; message?: string }> {
  return apiPost<ApiResponse>('updateHourlyRate', { username, rate }, signal ? { signal } : undefined);
}

export interface BulkImportResult {
  success: boolean;
  updated: number;
  total:   number;
  skipped: number;
  message?: string;
}

export async function bulkImportRatesApi(
  rows: { username: string; rate: number }[],
  signal?: AbortSignal,
): Promise<BulkImportResult> {
  const res = await apiPost<BulkImportResponse>('bulkImportRates', { rows }, signal ? { signal } : undefined);
  return {
    success: res.success,
    updated: res.updated ?? 0,
    total:   res.total   ?? rows.length,
    skipped: res.skipped ?? 0,
    message: res.message,
  };
}

/** Parse a CSV string into { username, rate } pairs. */
export function parseRatesCsv(text: string): { username: string; rate: number }[] {
  const rows: string[][] = [];
  let i = 0, inQuote = false, field = '', row: string[] = [];
  const push = () => { row.push(field); field = ''; };
  const eol  = () => { push(); rows.push(row); row = []; };
  while (i < text.length) {
    // noUncheckedIndexedAccess: loop guard ensures c is always defined
    const c = text[i]!;
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuote = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"')  { inQuote = true; i++; continue; }
    if (c === ',')  { push(); i++; continue; }
    if (c === '\n') { eol();  i++; continue; }
    if (c === '\r') { i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) eol();
  while (rows.length && rows[rows.length - 1]!.every(c => !c.trim())) rows.pop();
  if (rows.length < 2) throw new Error('CSV needs a header row + at least one data row');
  const header  = rows[0]!.map(s => s.trim().toLowerCase());
  const userIdx = header.findIndex(h => /^(user|username|emp|employee)$/.test(h));
  const rateIdx = header.findIndex(h => /^(rate|hourly|hourlyrate|hourly_rate|amount)$/.test(h));
  if (userIdx < 0 || rateIdx < 0) throw new Error('CSV must have "username" and "rate" columns');
  return rows.slice(1).map(r => ({
    username: (r[userIdx] ?? '').trim(),
    rate:     Number((r[rateIdx] ?? '').replace(/[^\d.-]/g, '')),
  })).filter(r => r.username);
}
