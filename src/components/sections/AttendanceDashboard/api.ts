/**
 * src/components/sections/AttendanceDashboard/api.ts
 *
 * Data fetchers for the employee attendance dashboard.
 * All functions use the shared apiFetch layer (JWT, retry, AbortSignal).
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';
import type {
  AttendanceStatus,
  ProjectSiteOption,
  MarkAttendanceResponse,
  LocationData,
} from './types';

// ── Response shapes ───────────────────────────────────────────────────────────

interface MyStatusResponse {
  success: boolean;
  data?:   AttendanceStatus;
}

interface SitesResponse {
  success: boolean;
  data?:   ProjectSiteOption[];
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

/** Fetch the current employee's today attendance status. */
export async function getMyStatus(
  username: string,
  signal?:  AbortSignal,
): Promise<AttendanceStatus> {
  const res = await apiPost<MyStatusResponse>(
    'getMyStatus',
    { username },
    { signal },
  );
  if (res.success && res.data) return res.data;
  return { hasCheckedIn: false, hasCheckedOut: false, checkInTime: null, checkOutTime: null, location: '' };
}

/** Fetch the list of project sites for the check-in site selector. */
export async function listProjectSites(signal?: AbortSignal): Promise<ProjectSiteOption[]> {
  const res = await apiPost<SitesResponse>(
    'listProjectSites',
    {},
    { signal },
  );
  return (res.success && res.data) ? res.data : [];
}

/** Submit a check-in or check-out with a selfie photo and GPS location. */
export async function markAttendance(payload: {
  username:    string;
  action:      'CheckIn' | 'CheckOut';
  photoBase64: string;
  location:    Pick<LocationData, 'latitude' | 'longitude' | 'accuracy'> | null;
  siteId:      string;
}): Promise<MarkAttendanceResponse> {
  return apiPost<MarkAttendanceResponse>(
    'markAttendance',
    payload as unknown as Record<string, unknown>,
  );
}
