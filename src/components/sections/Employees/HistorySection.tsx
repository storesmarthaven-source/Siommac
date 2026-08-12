/**
 * HistorySection.tsx
 *
 * Employee self-service attendance history (last 30 days).
 * Replaces: loadHistoryInline, _renderHistoryPage, _exportHistoryCSV,
 *           _bindHistoryControls from employees.js.
 *
 * Features:
 *   ✓ Search by date / day-of-week
 *   ✓ Filter by attendance status
 *   ✓ Animated stat cards (total, present, late, avg hours)
 *   ✓ CSV export
 *   ✓ Photo thumbnails linking to full-size images
 *   ✓ DataTable for sorting
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }                   from 'preact';
import { useState, useMemo, useCallback } from 'preact/hooks';
import { Spinner }                       from '@shared/Spinner';
import { Badge, DataTable, type DataTableColumn, type DataTableSort } from '@ui';
import type { HistoryRecord, AttendanceStatus } from './types';
import { useMyHistory }                  from './hooks';
import { StatCard }                      from './StatCard';
import {
  fmtLocalTime, dayOfWeek, downloadCsv,
} from './utils';

// ── Column definitions ────────────────────────────────────────────────────────

const COLUMNS: DataTableColumn<HistoryRecord>[] = [
  { id: 'date', header: 'Date', cell: row => row.date, sortValue: row => row.date, sortable: true },
  { id: 'day', header: 'Day', cell: row => dayOfWeek(row.date), sortValue: row => dayOfWeek(row.date), sortable: true },
  { id: 'checkIn', header: 'Check In', cell: row => row.checkIn ? fmtLocalTime(row.checkIn) : '—', sortValue: row => row.checkIn, sortable: true },
  { id: 'checkOut', header: 'Check Out', cell: row => row.checkOut ? fmtLocalTime(row.checkOut) : '—', sortValue: row => row.checkOut, sortable: true },
  { id: 'hours', header: 'Hours', align: 'right', cell: row => row.hours != null ? `${row.hours.toFixed(1)}h` : '—', sortValue: row => row.hours, sortable: true },
  {
    id: 'status', header: 'Status', sortValue: row => row.status, sortable: true,
    cell: row => row.status
      ? <Badge tone={row.status === 'present' ? 'success' : row.status === 'late' ? 'warning' : 'danger'}>{row.status.charAt(0).toUpperCase() + row.status.slice(1)}</Badge>
      : '—',
  },
  {
    id: 'checkInPhoto', header: 'In Photo', align: 'center',
    cell: row => row.checkInPhotoUrl
      ? <a href={row.checkInPhotoUrl} target="_blank" rel="noopener"><img src={row.checkInPhotoUrl} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e5e7eb' }} alt="Check-in photo" /></a>
      : <i class="fas fa-camera-slash" style={{ color: '#d1d5db', fontSize: 13 }} aria-label="No check-in photo" />,
  },
  {
    id: 'checkOutPhoto', header: 'Out Photo', align: 'center',
    cell: row => row.checkOutPhotoUrl
      ? <a href={row.checkOutPhotoUrl} target="_blank" rel="noopener"><img src={row.checkOutPhotoUrl} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e5e7eb' }} alt="Check-out photo" /></a>
      : <i class="fas fa-camera-slash" style={{ color: '#d1d5db', fontSize: 13 }} aria-label="No check-out photo" />,
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function HistorySection(): VNode {
  const { data: history = [], isLoading, error, refetch } = useMyHistory(30);

  const [search,       setSearch]      = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | AttendanceStatus>('');
  const [tableSort, setTableSort] = useState<DataTableSort | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(25);

  // ── Filters ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return history.filter(r => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (q) {
        const dow = dayOfWeek(r.date).toLowerCase();
        if (!r.date.includes(q) && !dow.includes(q)) return false;
      }
      return true;
    });
  }, [history, search, statusFilter]);

  // ── Stats (always from full dataset, not filtered) ────────────────────────
  const stats = useMemo(() => {
    const present = history.filter(r => r.status === 'present').length;
    const late    = history.filter(r => r.status === 'late').length;
    const withHours = history.filter(r => r.hours != null && r.hours > 0);
    const avgHours = withHours.length
      ? (withHours.reduce((s, r) => s + Number(r.hours), 0) / withHours.length).toFixed(1)
      : '0';
    return { total: history.length, present, late, avgHours };
  }, [history]);

  // ── CSV export ────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    if (!history.length) return;
    const rows: (string | number)[][] = [
      ['Date', 'Day', 'Check In', 'Check Out', 'Hours', 'Status'],
      ...history.map(r => [
        r.date,
        dayOfWeek(r.date),
        r.checkIn  ? fmtLocalTime(r.checkIn)  : '',
        r.checkOut ? fmtLocalTime(r.checkOut) : '',
        r.hours ?? 0,
        r.status ?? '',
      ]),
    ];
    downloadCsv(rows, `attendance_history_${new Date().toISOString().slice(0, 10)}.csv`);
  }, [history]);

  const handleReset = useCallback(() => { setSearch(''); setStatusFilter(''); setTablePage(1); }, []);

  if (error) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#dc2626' }}>
        <div>Failed to load attendance history.</div>
        <button type="button" onClick={() => void refetch()} style={{ marginTop: '10px', padding: '7px 18px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 'var(--font-weight-bold)', color: '#111827' }}>
            Attendance History
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#6b7280' }}>
            Your last 30 days of attendance records.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!history.length}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '9px 18px', background: history.length ? '#16a34a' : '#9ca3af',
            color: '#fff', border: 'none', borderRadius: '8px',
            cursor: history.length ? 'pointer' : 'not-allowed',
            fontSize: '14px', fontWeight: '500',
          }}
        >
          <i class="fas fa-file-csv" aria-hidden="true" /> Export CSV
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <StatCard icon="fa-calendar-alt" label="Total Days"   value={stats.total}   color="#2563eb" loading={isLoading} />
        <StatCard icon="fa-check-circle" label="Present"      value={stats.present} color="#16a34a" loading={isLoading} />
        <StatCard icon="fa-clock"        label="Late"         value={stats.late}    color="#d97706" loading={isLoading} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: '#fff', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,.08)', flex: '1 1 180px', minWidth: '160px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#7c3aed18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i class="fas fa-hourglass-half" style={{ color: '#7c3aed', fontSize: '20px' }} aria-hidden="true" />
          </div>
          <div>
            <div style={{ fontSize: '26px', fontWeight: 'var(--font-weight-bold)', color: '#111827', lineHeight: 1 }}>{stats.avgHours}h</div>
            <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>Avg Hours/Day</div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <i class="fas fa-search" style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: '12px' }} />
          <input
            type="search"
            value={search}
            onInput={e => { setSearch((e.target as HTMLInputElement).value); setTablePage(1); }}
            placeholder="Search by date or day…"
            aria-label="Search history"
            style={{ width: '100%', padding: '7px 10px 7px 30px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter((e.target as HTMLSelectElement).value as '' | AttendanceStatus); setTablePage(1); }}
          aria-label="Filter by status"
          style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', background: '#fff', cursor: 'pointer' }}
        >
          <option value="">All Statuses</option>
          <option value="present">Present</option>
          <option value="late">Late</option>
          <option value="absent">Absent</option>
        </select>
        {(search || statusFilter) && (
          <button
            type="button"
            onClick={handleReset}
            style={{ padding: '7px 14px', background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
          >
            <i class="fas fa-times" style={{ marginRight: '4px' }} aria-hidden="true" />Reset
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div style={{ padding: '60px', display: 'flex', justifyContent: 'center' }}>
          <Spinner size={36} label="Loading history…" />
        </div>
      ) : (
        <DataTable
          label="Attendance history"
          columns={COLUMNS}
          rows={filtered}
          getRowId={row => row.date}
          sorting={{ value: tableSort, onChange: sort => { setTableSort(sort); setTablePage(1); }, client: true }}
          pagination={{ page: tablePage, pageSize: tablePageSize, onPageChange: setTablePage, onPageSizeChange: setTablePageSize }}
          emptyState={{ title: 'No attendance records', text: 'No attendance records match the current filters.' }}
        />
      )}
    </div>
  );
}
