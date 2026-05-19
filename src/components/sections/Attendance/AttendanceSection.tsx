/**
 * src/components/sections/Attendance/AttendanceSection.tsx
 *
 * Main orchestrating component for the admin Attendance section.
 * Section id: 's-adm-attendance'
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode } from 'preact';
import { useState, useMemo, useCallback } from 'preact/hooks';
import { DataTable, type DataTableColumn } from '@shared/DataTable';
import { AttendanceStatCards }   from './StatCards';
import { AttendanceCharts }      from './AttendanceCharts';
import { AttendanceFiltersBar }  from './FiltersBar';
import { EmployeeDetailModal }   from './EmployeeDetailModal';
import { PhotoModal }            from './PhotoModal';
import { useAttendanceData }     from './hooks';
import {
  fmtLocalTime,
  currentMonth,
  currentYear,
  statusColor,
  statusBgColor,
} from './utils';
import type { AttendanceRow, FilterMode, MonthFilter, RangeFilter } from './types';

// ── HTML escape helper ────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── DataTable column definitions ──────────────────────────────────────────────

const LOG_COLUMNS: DataTableColumn<AttendanceRow>[] = [
  {
    title: 'Employee',
    data:  'name',
    render: (_val, _type, row) =>
      `<span style="font-weight:600;color:#111827">${esc(row.name)}</span>`,
  },
  {
    title: 'Department',
    data:  'department',
    render: (_val, _type, row) =>
      `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;background:#EFF6FF;color:#1E40AF;font-weight:500">${esc(row.department)}</span>`,
  },
  {
    title: 'Date',
    data:  'date',
  },
  {
    title: 'Check In',
    data:  'checkIn',
    render: (_val, _type, row) => esc(fmtLocalTime(row.checkIn)),
  },
  {
    title: 'Check Out',
    data:  'checkOut',
    render: (_val, _type, row) => esc(fmtLocalTime(row.checkOut)),
  },
  {
    title: 'Hours',
    data:  'hours',
    render: (_val, _type, row) => row.hours > 0 ? `${row.hours}h` : '—',
  },
  {
    title: 'Status',
    data:  'status',
    render: (_val, _type, row) => {
      const fg = statusColor(row.status);
      const bg = statusBgColor(row.status);
      return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${bg};color:${fg};white-space:nowrap">${esc(row.status)}</span>`;
    },
  },
  {
    title:      'Actions',
    data:       null,
    orderable:  false,
    searchable: false,
    render: (_val, _type, row) =>
      `<button type="button" data-username="${esc(row.username)}" style="padding:4px 12px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;font-size:12px;font-weight:500;color:#1B2D55" aria-label="View details for ${esc(row.name)}">Details</button>`,
  },
];

// ── PhotoState type ───────────────────────────────────────────────────────────

interface PhotoState {
  inUrl:  string | null;
  outUrl: string | null;
  name:   string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AttendanceSection(): VNode {
  // ── Filter state ───────────────────────────────────────────────────────────
  const [filterMode, setFilterMode] = useState<FilterMode>('month');
  const [month,      setMonth]      = useState<number>(currentMonth());
  const [year,       setYear]       = useState<number>(currentYear());
  const [dateFrom,   setDateFrom]   = useState<string>('');
  const [dateTo,     setDateTo]     = useState<string>('');

  // ── UI state ───────────────────────────────────────────────────────────────
  const [search,           setSearch]           = useState<string>('');
  const [dept,             setDept]             = useState<string>('all');
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [photoState,       setPhotoState]       = useState<PhotoState | null>(null);

  // ── Derived query filter ───────────────────────────────────────────────────
  const filter = useMemo((): MonthFilter | RangeFilter => {
    if (filterMode === 'range' && dateFrom !== '') {
      return { dateFrom, dateTo: dateTo !== '' ? dateTo : dateFrom };
    }
    return { month, year };
  }, [filterMode, dateFrom, dateTo, month, year]);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data, isLoading, refetch } = useAttendanceData(filter);

  // ── Derived values ─────────────────────────────────────────────────────────
  const depts = useMemo<string[]>(() => {
    if (!data?.rows) return [];
    const set = new Set<string>();
    for (const row of data.rows) set.add(row.department);
    return Array.from(set).sort();
  }, [data?.rows]);

  const filteredRows = useMemo<AttendanceRow[]>(() => {
    if (!data?.rows) return [];
    const q = search.toLowerCase();
    return data.rows.filter((row) => {
      const matchSearch = q === '' || row.name.toLowerCase().includes(q);
      const matchDept   = dept === 'all' || row.department === dept;
      return matchSearch && matchDept;
    });
  }, [data?.rows, search, dept]);

  const isSingleDay = data?.dateRange?.days === 1;

  // ── Details button click delegation ───────────────────────────────────────
  const handleTableClick = useCallback((e: MouseEvent) => {
    const target  = e.target as HTMLElement;
    const btn     = target.closest<HTMLElement>('[data-username]');
    if (!btn) return;
    const username = btn.dataset['username'];
    if (username) setSelectedUsername(username);
  }, []);

  // ── Refresh handler ────────────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  // ── Record count label ─────────────────────────────────────────────────────
  const recordCount = filteredRows.length;

  return (
    <div style={{ padding: '24px' }}>
      {/* Stat cards */}
      <AttendanceStatCards
        stats={data?.stats ?? null}
        loading={isLoading}
        isSingleDay={isSingleDay}
      />

      {/* Filters bar */}
      <AttendanceFiltersBar
        search={search}      onSearch={setSearch}
        dept={dept}          depts={depts}     onDept={setDept}
        mode={filterMode}    onMode={setFilterMode}
        month={month}        year={year}       onMonth={setMonth}  onYear={setYear}
        dateFrom={dateFrom}  dateTo={dateTo}   onDateFrom={setDateFrom}  onDateTo={setDateTo}
        onRefresh={handleRefresh}
        isLoading={isLoading}
      />

      {/* Charts */}
      <AttendanceCharts
        trend={data?.dailyTrend ?? []}
        rows={filteredRows}
        loading={isLoading}
      />

      {/* Attendance log card */}
      <div
        style={{
          background:   '#fff',
          borderRadius: '12px',
          boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
          overflow:     'hidden',
        }}
      >
        {/* Card header */}
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '16px 20px',
            borderBottom:   '1px solid #f3f4f6',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontWeight: '600', fontSize: '15px', color: '#111827' }}>
              Attendance Log
            </span>
            {!isLoading && (
              <span
                style={{
                  padding:      '2px 10px',
                  borderRadius: '999px',
                  background:   '#EFF6FF',
                  color:        '#1E40AF',
                  fontSize:     '12px',
                  fontWeight:   '600',
                }}
              >
                {recordCount} {recordCount === 1 ? 'record' : 'records'}
              </span>
            )}
          </div>
        </div>

        {/* DataTable — click delegation wrapper */}
        <div onClick={handleTableClick} style={{ padding: '0 4px 4px' }}>
          <DataTable<AttendanceRow>
            id="att-log-table"
            columns={LOG_COLUMNS}
            data={filteredRows}
            loading={isLoading}
            emptyMessage="No attendance records found for the selected period."
            dtOptions={{
              order:      [[3, 'desc']],
              pageLength: 25,
            }}
          />
        </div>
      </div>

      {/* Employee detail modal */}
      <EmployeeDetailModal
        username={selectedUsername}
        rows={data?.rows ?? []}
        dateRange={data?.dateRange ?? null}
        onClose={() => setSelectedUsername(null)}
      />

      {/* Photo modal — only rendered when a photo state is set */}
      {photoState !== null && (
        <PhotoModal
          inUrl={photoState.inUrl}
          outUrl={photoState.outUrl}
          name={photoState.name}
          onClose={() => setPhotoState(null)}
        />
      )}
    </div>
  );
}
