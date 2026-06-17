/**
 * src/components/sections/Attendance/EmployeeDetailModal.tsx
 *
 * Modal showing a single employee's attendance detail for the selected period.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode } from 'preact';
import { useMemo } from 'preact/hooks';
import { Modal } from '@shared/Modal';
import {
  fmtDate,
  fmtLocalTime,
  rateColor,
  buildConsistencyFromRows,
} from './utils';
import type { AttendanceRow, DateRange } from './types';

// ── Status → branded badge class ──────────────────────────────────────────────

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'Present': return 'att-badge att-present';
    case 'Late':    return 'att-badge att-late';
    case 'Absent':  return 'att-badge att-absent';
    default:        return 'att-badge';
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface EmployeeDetailModalProps {
  username:  string | null;
  rows:      AttendanceRow[];
  dateRange: DateRange | null;
  onClose:   () => void;
}

// ── Chip component ────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  variant,
  valueColor,
}: {
  label:       string;
  value:       string | number;
  /** Branded colour modifier for the value. */
  variant?:    'present' | 'late' | 'absent' | 'hours';
  /** Dynamic inline colour (e.g. rate gradient) when no fixed variant applies. */
  valueColor?: string;
}): VNode {
  return (
    <div class={`adp-stat ${variant ? `adp-stat--${variant}` : ''}`}>
      <span
        class="adp-stat-val"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
      <span class="adp-stat-lbl">{label}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EmployeeDetailModal({
  username,
  rows,
  dateRange,
  onClose,
}: EmployeeDetailModalProps): VNode {
  const empRows = useMemo(
    () => rows.filter((r) => r.username === username),
    [rows, username],
  );

  const consistency = useMemo(() => {
    if (!username || empRows.length === 0) return null;
    const all = buildConsistencyFromRows(empRows, dateRange);
    return all[0] ?? null;
  }, [empRows, username, dateRange]);

  const emp = empRows[0] ?? null;

  // Initials avatar
  const initials = emp
    ? emp.name
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
    : '?';

  // Period label
  const periodLabel = dateRange
    ? `${fmtDate(dateRange.start)} – ${fmtDate(dateRange.end)} (${dateRange.days}d)`
    : 'Selected Period';

  return (
    <Modal
      open={!!username}
      onClose={onClose}
      title="Employee Attendance Details"
      size="lg"
    >
      {emp === null ? (
        <div class="att-empty">No records in this period.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Header: avatar + name + dept + period */}
          <div class="adp-header">
            <div class="adp-avatar">{initials}</div>
            <div class="adp-identity">
              <div class="adp-name">{emp.name}</div>
              <div class="adp-meta">
                <span class="adp-dept">
                  <i class="fas fa-building" aria-hidden="true" /> {emp.department}
                </span>
                <span class="adp-period">
                  <i class="fas fa-calendar-alt" aria-hidden="true" /> {periodLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Stat chips */}
          {consistency !== null && (
            <div class="adp-stats">
              <StatChip label="Present" value={consistency.presentDays} variant="present" />
              <StatChip label="Late"    value={consistency.lateDays}    variant="late" />
              <StatChip label="Absent"  value={consistency.absentDays}  variant="absent" />
              <StatChip label="Avg Hrs" value={`${consistency.avgHours}h`} variant="hours" />
              <StatChip
                label="Rate"
                value={`${consistency.attendanceRate}%`}
                valueColor={rateColor(consistency.attendanceRate)}
              />
            </div>
          )}

          {/* Day-by-day log table */}
          {empRows.length === 0 ? (
            <div class="att-empty">No records in this period.</div>
          ) : (
            <div class="adp-log-wrap" style={{ maxHeight: '320px', overflowY: 'auto', padding: 0 }}>
              <table class="adp-log-table">
                <thead>
                  <tr>
                    {['Date', 'Check In', 'Check Out', 'Hours', 'Status'].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {empRows
                    .slice()
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((row) => (
                      <tr key={`${row.username}-${row.date}`} class="adp-log-row">
                        <td class="adp-log-date">{fmtDate(row.date)}</td>
                        <td class="adp-log-time">{fmtLocalTime(row.checkIn)}</td>
                        <td class="adp-log-time">{fmtLocalTime(row.checkOut)}</td>
                        <td class="adp-log-hours">
                          {row.hours > 0 ? `${row.hours}h` : '—'}
                        </td>
                        <td class="adp-log-action" style={{ textAlign: 'left' }}>
                          <span class={statusBadgeClass(row.status)}>{row.status}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
