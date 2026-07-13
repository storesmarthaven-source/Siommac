/**
 * src/api/attendance.ts
 *
 * Typed Supabase API functions for the Attendance domain.
 *
 * READ queries go direct to Supabase (fast, typed, cancellable).
 * WRITE operations (check-in, check-out) go through the Netlify backend because
 * they require server-side validation (geofencing, photo upload, status calc).
 *
 * @see docs/ARCHITECTURE.md §API-Layer
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { supabase }                              from '@lib/supabase';
import { logger }                                from '@lib/logger';
import type { CheckInPayload, CheckOutPayload }   from './schemas/attendance';
import type { AttendanceFilter }                  from './schemas/attendance';
import type { Attendance }                        from '../../types/db';

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Fetch all attendance rows for the current user within a filter period.
 * Used by the employee Attendance section.
 */
export async function listMyAttendance(
  username: string,
  filter: AttendanceFilter,
  signal?: AbortSignal,
) {
  let query = supabase
    .from('attendance')
    .select('*')
    .eq('username', username)
    .order('work_date', { ascending: false });

  if ('month' in filter) {
    const { month, year } = filter;
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    query = query.gte('work_date', from).lte('work_date', to);
  } else {
    query = query.gte('work_date', filter.dateFrom).lte('work_date', filter.dateTo);
  }

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/attendance] listMyAttendance failed', { error });
    throw new Error(error.message);
  }

  return data as unknown as Attendance[];
}

/**
 * Fetch all attendance for a date range — used by admin/manager views.
 */
export async function listAllAttendance(
  filter: AttendanceFilter,
  signal?: AbortSignal,
) {
  let query = supabase
    .from('attendance')
    .select('*, users!attendance_user_id_fkey(full_name, department_id)')
    .order('work_date', { ascending: false })
    .order('check_in_time', { ascending: false });

  if ('month' in filter) {
    const { month, year } = filter;
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    query = query.gte('work_date', from).lte('work_date', to);
  } else {
    query = query.gte('work_date', filter.dateFrom).lte('work_date', filter.dateTo);
  }

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/attendance] listAllAttendance failed', { error });
    throw new Error(error.message);
  }

  // users join adds full_name and department_id to each row
  return data as unknown as Array<Attendance & { users: { full_name: string; department_id: string | null } | null }>;
}

/**
 * Get today's attendance record for a user (null if not checked in).
 */
export async function getTodayAttendance(username: string, signal?: AbortSignal) {
  const today = new Date().toISOString().slice(0, 10);

  let filterQuery = supabase
    .from('attendance')
    .select('*')
    .eq('username', username)
    .eq('work_date', today);

  if (signal) filterQuery = filterQuery.abortSignal(signal);

  const { data, error } = await filterQuery.maybeSingle() as unknown as
    { data: Attendance | null; error: { message: string } | null };

  if (error) {
    logger.error('[api/attendance] getTodayAttendance failed', { username, error });
    throw new Error(error.message);
  }

  return data;  // null if no record yet
}

/**
 * Fetch live attendance snapshot — all employees checked in today.
 * Used by the LiveMap section.
 */
export async function getLiveAttendance(signal?: AbortSignal) {
  const today = new Date().toISOString().slice(0, 10);

  const query = supabase
    .from('attendance')
    .select(`
      id, username, work_date, status,
      check_in_time, check_out_time,
      check_in_lat, check_in_lng, check_in_site_id,
      users!attendance_user_id_fkey(full_name, profile_image, department_id)
    `)
    .eq('work_date', today)
    .not('check_in_time', 'is', null)
    .order('check_in_time', { ascending: false });

  if (signal) query.abortSignal(signal);

  const { data, error } = await query;

  if (error) {
    logger.error('[api/attendance] getLiveAttendance failed', { error });
    throw new Error(error.message);
  }

  return data;
}

// ── Write (delegated to backend) ──────────────────────────────────────────────

/**
 * Record a check-in. Delegates to the Netlify backend for:
 *   - Geofence validation against assigned project sites
 *   - Photo storage (Supabase Storage upload)
 *   - Status calculation (present vs late)
 */
export async function checkIn(payload: CheckInPayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'checkIn',
    payload,
  );
  if (!res.success) throw new Error(res.message ?? 'Check-in failed.');
}

/**
 * Record a check-out.
 */
export async function checkOut(payload: CheckOutPayload): Promise<void> {
  const { apiPost } = await import('@lib/api');
  const res = await apiPost<{ success: boolean; message?: string }>(
    'checkOut',
    payload,
  );
  if (!res.success) throw new Error(res.message ?? 'Check-out failed.');
}
