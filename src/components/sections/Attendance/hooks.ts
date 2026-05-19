/**
 * src/components/sections/Attendance/hooks.ts
 *
 * TanStack Query hooks for the Attendance section.
 * Uses @tanstack/preact-query — NOT react-query.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { useQuery, type UseQueryResult } from '@tanstack/preact-query';
import { listDailyLog } from './api';
import type { AttendanceData, MonthFilter, RangeFilter } from './types';

// ── useAttendanceData ─────────────────────────────────────────────────────────

/**
 * Fetches attendance log data for the given filter.
 * The query is always enabled; pass either a MonthFilter or a RangeFilter.
 * The AbortSignal from TanStack Query is threaded through to the fetch call
 * so in-flight requests are cancelled when the component unmounts or the
 * query key changes.
 *
 * @param filter - { month, year } or { dateFrom, dateTo }
 */
export function useAttendanceData(
  filter: MonthFilter | RangeFilter,
): UseQueryResult<AttendanceData> {
  return useQuery({
    queryKey: ['attendance', 'log', filter],
    queryFn:  ({ signal }) => listDailyLog(filter, signal),
    staleTime: 60_000,
    enabled:   true,
  });
}
