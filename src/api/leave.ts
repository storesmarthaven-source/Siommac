/**
 * src/api/leave.ts
 *
 * Typed Supabase API functions for the Leave Request domain.
 *
 * @see docs/ARCHITECTURE.md §API-Layer
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { supabase }                from '@lib/supabase';
import { logger }                  from '@lib/logger';
import type { SubmitLeavePayload, ReviewLeavePayload } from './schemas/leave';

// ── Read ──────────────────────────────────────────────────────────────────────

/** All leave requests for the current employee */
export async function getMyLeaves(username: string, signal?: AbortSignal) {
  const query = supabase
    .from('leave_requests')
    .select('*')
    .eq('username', username)
    .order('created_at', { ascending: false });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/leave] getMyLeaves failed', { error });
    throw new Error(error.message);
  }

  return data;
}

/** Pending leaves for a manager's department */
export async function getPendingLeavesForManager(
  departmentId: string,
  signal?: AbortSignal,
) {
  const query = supabase
    .from('leave_requests')
    .select('*')
    .eq('department_id', departmentId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/leave] getPendingLeavesForManager failed', { error });
    throw new Error(error.message);
  }

  return data;
}

/** All leave requests — admin view, with full details */
export async function listAllLeaves(signal?: AbortSignal) {
  const query = supabase
    .from('leave_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/leave] listAllLeaves failed', { error });
    throw new Error(error.message);
  }

  return data;
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function submitLeave(
  username: string,
  payload: SubmitLeavePayload,
): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'submitLeave',
    { ...payload, username },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to submit leave request.');
}

export async function reviewLeave(payload: ReviewLeavePayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'reviewLeave',
    payload,
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to update leave status.');
}

export async function deleteLeave(id: string): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'deleteLeave',
    { id },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to delete leave request.');
}
