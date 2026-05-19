/**
 * src/components/sections/Profile/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';
import type { ProfileData, ActivityEvent } from './types';

interface RawEmployee {
  fullName:       string;
  email:          string;
  phone:          string;
  department:     string;
  position:       string;
  employeeNumber: string;
  profileImage:   string;
}

interface RawAttRow {
  date:     string;
  checkIn:  string | null;
  checkOut: string | null;
}

interface RawLeaveRow {
  id:        string;
  type:      string;
  appliedOn: string;
  from?:     string;
  status:    string;
}

export async function fetchMyProfile(username: string, signal?: AbortSignal): Promise<RawEmployee> {
  const res = await apiPost<{ success: boolean; data: RawEmployee; message?: string }>(
    'getEmployeeByUsername',
    { username } as unknown as Record<string, unknown>,
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Cannot load profile');
  return res.data;
}

function fmtLocalTime(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function fmtActivity(d: string | undefined): string {
  if (!d) return '';
  try {
    const dt = new Date(d);
    return (
      dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' +
      dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    );
  } catch { return d; }
}

export async function fetchMyActivity(signal?: AbortSignal): Promise<ActivityEvent[]> {
  const [attRows, leaveRows] = await Promise.all([
    apiPost<{ success: boolean }>('getMyHistory',  {}, signal ? { signal } : undefined).catch(() => null),
    apiPost<{ success: boolean }>('getMyLeaves',   {}, signal ? { signal } : undefined).catch(() => null),
  ]);

  const events: ActivityEvent[] = [];

  // These endpoints return array-directly or {success,data:[]} — normalise via unknown
  const rawAtt: unknown    = attRows;
  const rawLeave: unknown  = leaveRows;

  const attData: RawAttRow[] = Array.isArray(rawAtt)
    ? (rawAtt as unknown as RawAttRow[])
    : (rawAtt && Array.isArray((rawAtt as Record<string, unknown>)['data'])
        ? ((rawAtt as Record<string, unknown>)['data'] as RawAttRow[])
        : []);

  attData.slice(0, 15).forEach(r => {
    if (r.checkIn)  events.push({ icon: 'fa-sign-in-alt',  title: 'Clocked In',  date: r.date + ', ' + fmtLocalTime(r.checkIn),  raw: new Date(r.checkIn)  });
    if (r.checkOut) events.push({ icon: 'fa-sign-out-alt', title: 'Clocked Out', date: r.date + ', ' + fmtLocalTime(r.checkOut), raw: new Date(r.checkOut) });
  });

  const leaveData: RawLeaveRow[] = Array.isArray(rawLeave)
    ? (rawLeave as unknown as RawLeaveRow[])
    : (rawLeave && Array.isArray((rawLeave as Record<string, unknown>)['data'])
        ? ((rawLeave as Record<string, unknown>)['data'] as RawLeaveRow[])
        : []);

  leaveData.slice(0, 10).forEach(r => {
    const status = r.status || '';
    const label  = status === 'Approved' ? 'Leave Approved' : status === 'Rejected' ? 'Leave Rejected' : 'Leave Requested';
    const icon   = status === 'Approved' ? 'fa-check-circle' : status === 'Rejected' ? 'fa-times-circle' : 'fa-calendar-plus';
    const dateRaw = r.appliedOn || r.from || '';
    events.push({ icon, title: label + (r.type ? ` (${r.type})` : ''), date: fmtActivity(dateRaw), raw: new Date(dateRaw) });
  });

  events.sort((a, b) => b.raw.getTime() - a.raw.getTime());
  return events.slice(0, 15);
}

export interface UpdateProfilePayload {
  username:           string;
  fullName:           string;
  email:              string;
  phone:              string;
  profileImageBase64: string;
  removeProfileImage: boolean;
  oldPassword:        string;
  newPassword:        string;
}

export interface UpdateProfileResult {
  fullName:     string;
  profileImage: string;
}

export async function updateMyProfile(
  payload: UpdateProfilePayload,
  signal?: AbortSignal,
): Promise<UpdateProfileResult> {
  const res = await apiPost<{ success: boolean; fullName?: string; profileImage?: string; message?: string }>(
    'updateMyProfile',
    payload as unknown as Record<string, unknown>,
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Update failed');
  return { fullName: res.fullName ?? payload.fullName, profileImage: res.profileImage ?? '' };
}

export async function updateMyPassword(
  payload: { username: string; fullName: string; oldPassword: string; newPassword: string },
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'updateMyProfile',
    {
      ...payload,
      profileImageBase64: '',
      removeProfileImage: false,
    } as unknown as Record<string, unknown>,
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Update failed');
}
