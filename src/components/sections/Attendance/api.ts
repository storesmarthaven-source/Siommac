/**
 * src/components/sections/Attendance/api.ts
 *
 * Typed API client for the Attendance section.
 * Routes through the shared apiPost helper from @lib/api.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';
import type { AttendanceData, MonthFilter, RangeFilter } from './types';

// ── Response envelope ─────────────────────────────────────────────────────────

interface AttendanceApiResponse {
  success:  boolean;
  data:     AttendanceData;
  message?: string;
}

// ── listDailyLog ──────────────────────────────────────────────────────────────

/**
 * Fetch attendance rows for a month or a custom date range.
 *
 * @param filter - Either { month, year } or { dateFrom, dateTo }
 * @param signal - Optional AbortSignal for cancellation
 */
export async function listDailyLog(
  filter: MonthFilter | RangeFilter,
  signal?: AbortSignal,
): Promise<AttendanceData> {
  const res = await apiPost<AttendanceApiResponse>(
    'listDailyLog',
    filter as unknown as Record<string, unknown>,
    signal ? { signal } : undefined,
  );

  if (!res.success) {
    throw new Error(res.message ?? 'Failed to load attendance data.');
  }

  return res.data;
}
