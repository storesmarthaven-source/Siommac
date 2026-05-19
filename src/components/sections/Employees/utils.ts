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

import type { TodayStatus, LeaveStatus, LeaveType, AttendanceStatus } from './types';

// ── Currency formatting ───────────────────────────────────────────────────────

/**
 * Format a number as TTD currency string.
 * @example fmtTTD(1234.5) → 'TTD 1,234.50'
 */
export function fmtTTD(n: number | null | undefined): string {
  return 'TTD ' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a number with commas and 2 decimal places (no currency prefix).
 */
export function fmtAmount(n: number | null | undefined): string {
  return Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

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

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending:  'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
};

export const LEAVE_STATUS_COLOR: Record<LeaveStatus, { bg: string; text: string }> = {
  pending:  { bg: '#fef9c3', text: '#92400e' },
  approved: { bg: '#dcfce7', text: '#166534' },
  rejected: { bg: '#fee2e2', text: '#991b1b' },
};

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  sick:    'Sick',
  casual:  'Casual',
  annual:  'Annual',
  medical: 'Medical',
};

export const LEAVE_TYPE_COLOR: Record<LeaveType, { bg: string; text: string }> = {
  sick:    { bg: '#fee2e2', text: '#991b1b' },
  casual:  { bg: '#dbeafe', text: '#1e40af' },
  annual:  { bg: '#dcfce7', text: '#166534' },
  medical: { bg: '#f3e8ff', text: '#6b21a8' },
};

export const ATTENDANCE_STATUS_COLOR: Record<AttendanceStatus, { bg: string; text: string }> = {
  present: { bg: '#dcfce7', text: '#166534' },
  late:    { bg: '#fef9c3', text: '#92400e' },
  absent:  { bg: '#fee2e2', text: '#991b1b' },
};

export const PAY_CYCLE_LABEL: Record<string, string> = {
  daily:        'Daily',
  weekly:       'Weekly',
  fortnightly:  'Fortnightly',
  biweekly:     'Bi-Weekly',
  monthly:      'Monthly',
};

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

// ── Payslip print ─────────────────────────────────────────────────────────────

/**
 * Open a new window and print the payslip HTML.
 * Mirrors the legacy window._printPayslip() function.
 */
export function printPayslipHtml(html: string, css: string, headerHtml: string): void {
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) return;

  const faUrl = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
  win.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payslip</title>` +
    `<link rel="stylesheet" href="${faUrl}">` +
    `<style>${css}</style></head><body>${headerHtml}${html}</body></html>`,
  );
  win.document.close();

  const faLink = win.document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
  let printed  = false;
  const doPrint = () => { if (!printed) { printed = true; win.focus(); win.print(); } };

  if (faLink) {
    faLink.onload  = () => setTimeout(doPrint, 200);
    faLink.onerror = () => setTimeout(doPrint, 200);
    setTimeout(doPrint, 1500);
  } else {
    setTimeout(doPrint, 600);
  }
}
