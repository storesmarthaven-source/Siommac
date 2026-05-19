/**
 * src/components/sections/AdminLeave/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';
import type { LeaveDetail, LeaveRecord } from './types';

export async function listAllLeaves(signal?: AbortSignal): Promise<LeaveRecord[]> {
  const res = await apiPost<{ success: boolean; data: LeaveRecord[] }>(
    'listAllLeaves',
    {},
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error('Failed to load leave applications');
  return res.data ?? [];
}

export async function getLeaveById(leaveId: string, signal?: AbortSignal): Promise<LeaveDetail> {
  const res = await apiPost<{ success: boolean; data: LeaveDetail; message?: string }>(
    'getLeaveById',
    { leaveId } as unknown as Record<string, unknown>,
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Cannot load leave record');
  return res.data;
}

export async function deleteLeaveApi(leaveId: string, signal?: AbortSignal): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'deleteLeave',
    { leaveId } as unknown as Record<string, unknown>,
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to delete leave');
}
