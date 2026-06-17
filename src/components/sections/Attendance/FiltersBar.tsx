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
 * Uses the branded `.att-*` filter-bar classes (pill search box, mode toggle,
 * date-input wraps, action buttons) defined in views.css / adm-attendance.css
 * rather than ad-hoc inline styles.
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

// ── Mode toggle button ────────────────────────────────────────────────────────

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
      class={`att-mode-btn ${active ? 'active' : ''}`}
      onClick={onClick}
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
    <div class="att-filters-bar">
      {/* 1. Search */}
      <div class="att-search-box">
        <i class="fas fa-search" aria-hidden="true" />
        <input
          type="search"
          placeholder="Search employee…"
          value={search}
          onInput={(e) => onSearch((e.target as HTMLInputElement).value)}
          aria-label="Search employees"
        />
      </div>

      {/* 2. Department select */}
      <select
        class="att-filter-select"
        value={dept}
        onChange={(e) => onDept((e.target as HTMLSelectElement).value)}
        aria-label="Filter by department"
      >
        <option value="all">All Departments</option>
        {depts.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>

      {/* 3. Mode toggle */}
      <div class="att-mode-toggle">
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
            class="att-filter-select"
            value={month}
            onChange={(e) => onMonth(Number((e.target as HTMLSelectElement).value))}
            aria-label="Select month"
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>{getMonthName(i)}</option>
            ))}
          </select>

          <select
            class="att-filter-select"
            value={year}
            onChange={(e) => onYear(Number((e.target as HTMLSelectElement).value))}
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
        <div class="att-filter-group att-range-group">
          <div class="att-date-input-wrap">
            <i class="fas fa-calendar-alt" aria-hidden="true" />
            <input
              type="date"
              class="att-date-input"
              value={dateFrom}
              onInput={(e) => onDateFrom((e.target as HTMLInputElement).value)}
              aria-label="Date from"
            />
          </div>
          <span class="att-range-sep">→</span>
          <div class="att-date-input-wrap">
            <i class="fas fa-calendar-alt" aria-hidden="true" />
            <input
              type="date"
              class="att-date-input"
              value={dateTo}
              min={dateFrom || undefined}
              onInput={(e) => onDateTo((e.target as HTMLInputElement).value)}
              aria-label="Date to"
            />
          </div>
        </div>
      )}

      {/* Action buttons (pushed right via .att-filter-actions margin-left:auto) */}
      <div class="att-filter-actions">
        {/* Refresh */}
        <button
          type="button"
          class="att-action-btn"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh attendance data"
          title="Refresh"
        >
          <i
            class={`fas fa-sync-alt ${isLoading ? 'fa-spin' : ''}`}
            aria-hidden="true"
          />
        </button>

        {/* Export placeholder */}
        <button
          type="button"
          class="att-action-btn"
          disabled
          title="Use DataTable export buttons"
          aria-label="Export (use DataTable export buttons below)"
        >
          <i class="fas fa-download" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
