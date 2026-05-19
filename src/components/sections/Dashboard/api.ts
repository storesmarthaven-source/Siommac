/**
 * src/components/sections/Dashboard/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';

interface ApiResponse { success: boolean; message?: string; }

export interface DashboardChartData {
  trend?:   unknown;
  dept?:    unknown;
  status?:  unknown;
  leave?:   unknown;
  activity?: unknown;
  [key: string]: unknown;
}

interface DashChartsResponse extends ApiResponse { data?: DashboardChartData; }

export async function getDashboardCharts(signal?: AbortSignal): Promise<DashboardChartData> {
  const res = await apiPost<DashChartsResponse>('getDashboardCharts', {}, signal ? { signal } : undefined);
  return (res.success && res.data) ? res.data : {};
}

export interface MyChartData {
  present?: number;
  late?:    number;
  absent?:  number;
  sundays?: number;
  [key: string]: unknown;
}

interface MyChartResponse extends ApiResponse { data?: MyChartData; }

export async function getMyChart(username: string, signal?: AbortSignal): Promise<MyChartData> {
  const today = new Date();
  const res = await apiPost<MyChartResponse>(
    'getMyChart',
    { username, year: today.getFullYear(), month: today.getMonth() },
    signal ? { signal } : undefined,
  );
  return (res.success && res.data) ? res.data : {};
}
