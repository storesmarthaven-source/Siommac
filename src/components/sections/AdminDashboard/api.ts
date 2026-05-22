/**
 * src/components/sections/AdminDashboard/api.ts
 *
 * API calls for the admin dashboard stat cards and recent attendance table.
 * Kept separate from the Employees api.ts so Vite can split this into a
 * lightweight chunk without pulling in the full Employees module.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { apiPost } from '@lib/api';
import type { AdminStats, RecentAttendanceRow } from '../Employees/types';

interface ApiResult<T> { success: boolean; data?: T; message?: string; }

function unwrap<T>(res: ApiResult<T>, fallback: T): T {
  return res.success && res.data !== undefined ? res.data : fallback;
}

export async function getAdminStats(signal?: AbortSignal): Promise<AdminStats> {
  const res = await apiPost<ApiResult<AdminStats>>('getAdminStats', {}, signal ? { signal } : undefined);
  return unwrap(res, { totalEmployees: 0, presentToday: 0, absentToday: 0, onLeaveToday: 0, lateToday: 0, activeLocations: 0 });
}

export async function getRecentAttendance(limit = 10, signal?: AbortSignal): Promise<RecentAttendanceRow[]> {
  const res = await apiPost<ApiResult<RecentAttendanceRow[]>>('getRecentAttendance', { limit }, signal ? { signal } : undefined);
  return unwrap(res, []);
}
