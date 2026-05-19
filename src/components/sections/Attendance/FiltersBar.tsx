/**
 * src/components/sections/Attendance/FiltersBar.tsx
 *
 * Filters bar for the Attendance section:
 *   - Search input
 *   - Department select
 *   - Mode toggle (Month | Date Range)
 *   - Month + Year selects (month mode)
 *   - Date range inputs (range mode)
 *   - Refresh button
 *   - Export placeholder button
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode } from 'preact';
import { getMonthName, getYearOptions } from './utils';
import type { FilterMode } from './types';

// ── Props ─────────────────────────────────────────────────────────────────────

interface AttendanceFiltersBarProps {
  search:      string;
  onSearch:    (v: string) => void;

  dept:        string;
  depts:       string[];
  onDept:      (v: string) => void;

  mode:        FilterMode;
  onMode:      (m: FilterMode) => void;

  month:       number;
  year:        number;
  onMonth:     (v: number) => void;
  onYear:      (v: number) => void;

  dateFrom:    string;
  dateTo:      string;
  onDateFrom:  (v: string) => void;
  onDateTo:    (v: string) => void;

  onRefresh:   () => void;
  isLoading:   boolean;
}

// ── Shared input style ────────────────────────────────────────────────────────

const INPUT_STYLE: Record<string, string | number> = {
  padding:      '6px 10px',
  border:       '1px solid #e5e7eb',
  borderRadius: '8px',
  fontSize:     '13px',
  color:        '#374151',
  background:   '#fff',
  outline:      'none',
  height:       '34px',
};

// ── Toggle button ─────────────────────────────────────────────────────────────

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active:   boolean;
  onClick:  () => void;
  children: string;
}): VNode {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding:      '5px 14px',
        border:       'none',
        borderRadius: '6px',
        cursor:       'pointer',
        fontSize:     '13px',
        fontWeight:   '500',
        background:   active ? '#1B2D55' : '#f3f4f6',
        color:        active ? '#fff'    : '#374151',
        transition:   'background 0.15s, color 0.15s',
      }}
    >
      {children}
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AttendanceFiltersBar({
  search,
  onSearch,
  dept,
  depts,
  onDept,
  mode,
  onMode,
  month,
  year,
  onMonth,
  onYear,
  dateFrom,
  dateTo,
  onDateFrom,
  onDateTo,
  onRefresh,
  isLoading,
}: AttendanceFiltersBarProps): VNode {
  const yearOptions = getYearOptions();

  return (
    <div
      style={{
        display:      'flex',
        flexWrap:     'wrap',
        gap:          '10px',
        alignItems:   'center',
        background:   '#fff',
        borderRadius: '12px',
        padding:      '12px 16px',
        boxShadow:    '0 1px 4px rgba(0,0,0,0.06)',
        marginBottom: '16px',
      }}
    >
      {/* 1. Search */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <i
          class="fas fa-search"
          aria-hidden="true"
          style={{
            position:  'absolute',
            left:      '9px',
            color:     '#9ca3af',
            fontSize:  '13px',
            pointerEvents: 'none',
          }}
        />
        <input
          type="search"
          placeholder="Search employee…"
          value={search}
          onInput={(e) => onSearch((e.target as HTMLInputElement).value)}
          style={{ ...INPUT_STYLE, paddingLeft: '30px', minWidth: '180px' } as Record<string, string | number>}
          aria-label="Search employees"
        />
      </div>

      {/* 2. Department select */}
      <select
        value={dept}
        onChange={(e) => onDept((e.target as HTMLSelectElement).value)}
        style={INPUT_STYLE as Record<string, string>}
        aria-label="Filter by department"
      >
        <option value="all">All Departments</option>
        {depts.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      {/* 3. Mode toggle */}
      <div
        style={{
          display:      'flex',
          gap:          '4px',
          background:   '#f3f4f6',
          borderRadius: '8px',
          padding:      '3px',
        }}
      >
        <ToggleBtn active={mode === 'month'} onClick={() => onMode('month')}>
          Month
        </ToggleBtn>
        <ToggleBtn active={mode === 'range'} onClick={() => onMode('range')}>
          Date Range
        </ToggleBtn>
      </div>

      {/* 4a. Month mode filters */}
      {mode === 'month' && (
        <>
          <select
            value={month}
            onChange={(e) => onMonth(Number((e.target as HTMLSelectElement).value))}
            style={INPUT_STYLE as Record<string, string>}
            aria-label="Select month"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>{getMonthName(i)}</option>
            ))}
          </select>

          <select
            value={year}
            onChange={(e) => onYear(Number((e.target as HTMLSelectElement).value))}
            style={INPUT_STYLE as Record<string, string>}
            aria-label="Select year"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </>
      )}

      {/* 4b. Range mode filters */}
      {mode === 'range' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: '#6b7280', whiteSpace: 'nowrap' }}>From</label>
            <input
              type="date"
              value={dateFrom}
              onInput={(e) => onDateFrom((e.target as HTMLInputElement).value)}
              style={INPUT_STYLE as Record<string, string>}
              aria-label="Date from"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: '#6b7280', whiteSpace: 'nowrap' }}>To</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onInput={(e) => onDateTo((e.target as HTMLInputElement).value)}
              style={INPUT_STYLE as Record<string, string>}
              aria-label="Date to"
            />
          </div>
          {dateFrom && (
            <span style={{ fontSize: '12px', color: '#9ca3af', whiteSpace: 'nowrap' }}>
              {dateFrom}{dateTo && dateTo !== dateFrom ? ` → ${dateTo}` : ''}
            </span>
          )}
        </>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* 6. Refresh button */}
      <button
        type="button"
        onClick={onRefresh}
        disabled={isLoading}
        aria-label="Refresh attendance data"
        title="Refresh"
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          width:          '34px',
          height:         '34px',
          border:         '1px solid #e5e7eb',
          borderRadius:   '8px',
          background:     '#fff',
          cursor:         isLoading ? 'not-allowed' : 'pointer',
          color:          '#374151',
          opacity:        isLoading ? 0.6 : 1,
        }}
      >
        <i
          class="fas fa-sync-alt"
          aria-hidden="true"
          style={{
            fontSize:  '13px',
            animation: isLoading ? 'siomac-spin 0.75s linear infinite' : 'none',
          }}
        />
      </button>

      {/* 7. Export placeholder */}
      <button
        type="button"
        disabled
        title="Use DataTable export buttons"
        aria-label="Export (use DataTable export buttons below)"
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            '6px',
          height:         '34px',
          padding:        '0 12px',
          border:         '1px solid #e5e7eb',
          borderRadius:   '8px',
          background:     '#f9fafb',
          cursor:         'not-allowed',
          color:          '#9ca3af',
          fontSize:       '13px',
          opacity:        0.7,
        }}
      >
        <i class="fas fa-download" aria-hidden="true" style={{ fontSize: '12px' }} />
        Export
      </button>
    </div>
  );
}
