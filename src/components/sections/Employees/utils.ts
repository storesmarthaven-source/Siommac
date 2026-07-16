/**
 * src/components/sections/Employees/utils.ts
 *
 * Pure utility functions for the Employees feature domain.
 * No side effects, no imports from Preact — these are safe to use anywhere.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import type { TodayStatus, AttendanceStatus } from './types';

// fmtTTD / fmtAmount REMOVED — only the retired legacy PayslipsSection used them
// (the canonical Finance pages format currency via financeShared helpers).

// ── Date / time formatting ────────────────────────────────────────────────────

/**
 * Format an ISO timestamp to a short local time string.
 * Mirrors the legacy fmtLocalTime() from app.js.
 */
export function fmtLocalTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-TT', {
      hour:   '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

/**
 * Format a YYYY-MM-DD date string to a human-readable short form.
 * @example fmtDate('2024-03-15') → 'Mar 15, 2024'
 */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return d;
  }
}

/**
 * Return today's date as YYYY-MM-DD in the local timezone.
 */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Short weekday label for a date string.
 */
export function dayOfWeek(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short' });
  } catch {
    return '—';
  }
}

// ── Status label / colour helpers ─────────────────────────────────────────────

export const TODAY_STATUS_LABEL: Record<TodayStatus, string> = {
  checkedin:  'Checked In',
  checkedout: 'Checked Out',
  notchecked: 'Not In',
};

export const TODAY_STATUS_COLOR: Record<TodayStatus, string> = {
  checkedin:  '#16a34a',
  checkedout: '#2563eb',
  notchecked: '#9ca3af',
};

// LEAVE_STATUS_LABEL / LEAVE_STATUS_COLOR / LEAVE_TYPE_LABEL / LEAVE_TYPE_COLOR REMOVED.
// Legacy leave utilities retired with the legacy leave system. Use types/hrLeave.ts instead.

export const ATTENDANCE_STATUS_COLOR: Record<AttendanceStatus, { bg: string; text: string }> = {
  present: { bg: '#dcfce7', text: '#166534' },
  late:    { bg: '#fef9c3', text: '#92400e' },
  absent:  { bg: '#fee2e2', text: '#991b1b' },
};

// PAY_CYCLE_LABEL REMOVED with the legacy PayslipsSection (its only consumer).

// ── CSV export ────────────────────────────────────────────────────────────────

/**
 * Trigger a browser download of a CSV file.
 */
export function downloadCsv(rows: (string | number)[][], filename: string): void {
  const csv = rows
    .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Photo helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a File object to a base64 data string (no prefix).
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:image/...;base64, prefix
      const b64 = result.split(',')[1];
      if (b64) resolve(b64);
      else reject(new Error('Could not read file'));
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsDataURL(file);
  });
}

// ── Name initials ─────────────────────────────────────────────────────────────

/**
 * Extract up to 2 initials from a full name.
 * @example initials('Jane Doe') → 'JD'
 */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

// printPayslipHtml REMOVED — the legacy print-popup died with PayslipsSection;
// canonical payslips are server-rendered PDFs behind audited signed URLs.
