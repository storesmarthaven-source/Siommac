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
  statusColor,
  statusBgColor,
  rateColor,
  buildConsistencyFromRows,
} from './utils';
import type { AttendanceRow, DateRange } from './types';

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
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}): VNode {
  return (
    <div
      style={{
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        gap:           '2px',
        padding:       '10px 16px',
        background:    '#f9fafb',
        borderRadius:  '10px',
        minWidth:      '80px',
        flex:          '1',
      }}
    >
      <span
        style={{
          fontSize:   '18px',
          fontWeight: '700',
          color:      color ?? '#111827',
          lineHeight: '1',
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: '11px', color: '#6b7280', textAlign: 'center', marginTop: '2px' }}>
        {label}
      </span>
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
        <div style={{ textAlign: 'center', color: '#6b7280', fontSize: '14px', padding: '32px 0' }}>
          No records in this period.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Header: avatar + name + dept + period */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Avatar circle */}
            <div
              style={{
                width:          '56px',
                height:         '56px',
                borderRadius:   '50%',
                background:     '#1B2D55',
                color:          '#fff',
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                fontSize:       '20px',
                fontWeight:     '700',
                flexShrink:     0,
              }}
            >
              {initials}
            </div>

            <div>
              <div style={{ fontWeight: '700', fontSize: '17px', color: '#111827' }}>{emp.name}</div>
              <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>{emp.department}</div>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>{periodLabel}</div>
            </div>
          </div>

          {/* Stat chips */}
          {consistency !== null && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <StatChip label="Present" value={consistency.presentDays} color="#2E7D32" />
              <StatChip label="Late"    value={consistency.lateDays}    color="#D97706" />
              <StatChip label="Absent"  value={consistency.absentDays}  color="#DC2626" />
              <StatChip label="Avg Hrs" value={`${consistency.avgHours}h`} />
              <StatChip
                label="Rate"
                value={`${consistency.attendanceRate}%`}
                color={rateColor(consistency.attendanceRate)}
              />
            </div>
          )}

          {/* Day-by-day log table */}
          {empRows.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#6b7280', fontSize: '13px', padding: '16px 0' }}>
              No records in this period.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto' }}>
              <table
                style={{
                  width:          '100%',
                  borderCollapse: 'collapse',
                  fontSize:       '13px',
                }}
              >
                <thead>
                  <tr
                    style={{
                      background:   '#f9fafb',
                      position:     'sticky',
                      top:          0,
                      zIndex:       1,
                    }}
                  >
                    {['Date', 'Check In', 'Check Out', 'Hours', 'Status'].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding:    '8px 12px',
                          textAlign:  'left',
                          fontWeight: '600',
                          color:      '#374151',
                          borderBottom: '1px solid #e5e7eb',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {empRows
                    .slice()
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((row) => (
                      <tr
                        key={`${row.username}-${row.date}`}
                        style={{ borderBottom: '1px solid #f3f4f6' }}
                      >
                        <td style={{ padding: '8px 12px', color: '#374151' }}>{fmtDate(row.date)}</td>
                        <td style={{ padding: '8px 12px', color: '#374151' }}>{fmtLocalTime(row.checkIn)}</td>
                        <td style={{ padding: '8px 12px', color: '#374151' }}>{fmtLocalTime(row.checkOut)}</td>
                        <td style={{ padding: '8px 12px', color: '#374151' }}>
                          {row.hours > 0 ? `${row.hours}h` : '—'}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <span
                            style={{
                              display:      'inline-block',
                              padding:      '2px 10px',
                              borderRadius: '999px',
                              fontSize:     '12px',
                              fontWeight:   '600',
                              background:   statusBgColor(row.status),
                              color:        statusColor(row.status),
                              whiteSpace:   'nowrap',
                            }}
                          >
                            {row.status}
                          </span>
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
