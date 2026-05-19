/**
 * src/components/sections/LiveMap/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';

interface ApiResponse { success: boolean; message?: string; }

export interface LiveAttendanceRow {
  id:              string | number;
  userId:          string;
  username:        string;
  fullName:        string;
  siteId:          string | number;
  siteName?:       string;
  department?:     string;
  position?:       string;
  employeeId?:     string;
  status:          string;
  isCheckedOut:    boolean;
  checkInLat?:     number | null;
  checkInLng?:     number | null;
  checkInTime?:    string | null;
  checkOutLat?:    number | null;
  checkOutLng?:    number | null;
  checkOutTime?:   string | null;
  lastSeen?:       string | null;
  profileImage?:   string | null;
  checkInPhotoUrl?:  string | null;
  checkOutPhotoUrl?: string | null;
  [key: string]: unknown;
}

interface LiveResponse extends ApiResponse { data?: LiveAttendanceRow[]; }

export async function getLiveAttendance(
  scope: string,
  signal?: AbortSignal,
): Promise<LiveAttendanceRow[]> {
  const res = await apiPost<LiveResponse>(
    'getLiveAttendance',
    { scope },
    signal ? { signal } : undefined,
  );
  return (res.success && res.data) ? res.data : [];
}
