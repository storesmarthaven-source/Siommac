/**
 * src/components/sections/Settings/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';

export interface AppSettings {
  companyName:       string;
  companyAddress:    string;
  companyPhone:      string;
  companyEmail:      string;
  companyNIS:        string;
  companyBIR:        string;
  companyLogoUrl:    string;
  currency:          string;
  latePenaltyPerDay: string;
  leaveFinePerDay:   string;
  lateThresholdHHMM: string;
  maxDistanceM:      string;
  workHoursStart:    string;
  workHoursEnd:      string;
}

interface RawSettings {
  companyName?:       string;
  companyAddress?:    string;
  companyPhone?:      string;
  companyEmail?:      string;
  companyNIS?:        string;
  companyBIR?:        string;
  companyLogoUrl?:    string;
  currency?:          string;
  latePenaltyPerDay?: string | number;
  leaveFinePerDay?:   string | number;
  lateThresholdHHMM?: string;
  maxDistanceM?:      string | number;
  workHours?:         string;   // JSON: { start, end }
}

export async function fetchSettings(signal?: AbortSignal): Promise<AppSettings> {
  const res = await apiPost<{ success: boolean; data: RawSettings }>(
    'getSettings',
    {},
    signal ? { signal } : undefined,
  );
  const s: RawSettings = res.data ?? {};

  let workHoursStart = '08:00';
  let workHoursEnd   = '17:00';
  try {
    const wh = s.workHours ? (JSON.parse(s.workHours) as { start?: string; end?: string }) : {};
    workHoursStart = wh.start ?? '08:00';
    workHoursEnd   = wh.end   ?? '17:00';
  } catch { /* keep defaults */ }

  return {
    companyName:       s.companyName        ?? 'My Company',
    companyAddress:    s.companyAddress      ?? '',
    companyPhone:      s.companyPhone        ?? '',
    companyEmail:      s.companyEmail        ?? '',
    companyNIS:        s.companyNIS          ?? '',
    companyBIR:        s.companyBIR          ?? '',
    companyLogoUrl:    s.companyLogoUrl      ?? '',
    currency:          s.currency            ?? 'TT',
    latePenaltyPerDay: String(s.latePenaltyPerDay  ?? '0'),
    leaveFinePerDay:   String(s.leaveFinePerDay     ?? '0'),
    lateThresholdHHMM: s.lateThresholdHHMM   ?? '09:00',
    maxDistanceM:      String(s.maxDistanceM  ?? '200'),
    workHoursStart,
    workHoursEnd,
  };
}

export async function updateSetting(
  key: string,
  value: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'updateSetting',
    { key, value },
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? `Failed to save ${key}`);
}

// ── Per-role session idle timeout (minutes) ───────────────────────────────────

export type TimeoutRole = 'superadmin' | 'admin' | 'manager' | 'employee';

/** Default idle-timeout (minutes) per role — mirrors the server fallback. */
export const SESSION_TIMEOUT_DEFAULTS: Record<TimeoutRole, number> = {
  superadmin: 60, admin: 240, manager: 240, employee: 480,
};

/** Read the configured per-role idle timeouts (minutes) from settings. */
export async function fetchSessionTimeouts(signal?: AbortSignal): Promise<Record<TimeoutRole, number>> {
  const res = await apiPost<{ success: boolean; data: Record<string, string> }>(
    'getSettings', {}, signal ? { signal } : undefined,
  );
  const raw = res.data ?? {};
  const out = { ...SESSION_TIMEOUT_DEFAULTS };
  (Object.keys(out) as TimeoutRole[]).forEach(role => {
    const v = Number(raw[`sessionIdleTimeout.${role}`]);
    if (Number.isFinite(v) && v > 0) out[role] = v;
  });
  return out;
}

/** Persist one role's idle timeout (minutes). */
export async function setSessionTimeout(role: TimeoutRole, minutes: number, signal?: AbortSignal): Promise<void> {
  await updateSetting(`sessionIdleTimeout.${role}`, String(minutes), signal);
}

export async function saveWorkHoursApi(
  start: string,
  end: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'saveWorkHours',
    { start, end },
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Could not save work hours');
}

export async function uploadLogoApi(
  base64: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await apiPost<{ success: boolean; url?: string; message?: string }>(
    'uploadLogo',
    { base64 },
    signal ? { signal } : undefined,
  );
  if (!res.success) throw new Error(res.message ?? 'Upload failed');
  return res.url ?? '';
}
