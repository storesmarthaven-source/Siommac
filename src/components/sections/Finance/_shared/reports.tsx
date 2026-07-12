/**
 * src/components/sections/Finance/_shared/reports.tsx
 *
 * Shared report-surface layer for all six Finance Wave 2B pages.
 * Wires the existing per-module reports endpoints + exportCsv into a
 * reusable panel so each page builds its reports tab without duplicating
 * selector / preview / export UI.
 *
 * The backend already ships report endpoints (payroll, statutory, remittances,
 * expenses, budgets, disbursements). This layer is purely presentational +
 * export plumbing — no new backend required.
 *
 * Exported:
 *   ReportPanel       — selector + optional params area + data table + export
 *   ReportDataTable   — standalone scrollable table (for embedding in drawers)
 *   exportReportCsv() — imperative export from a ReportResult
 *
 * Usage:
 *   <ReportPanel
 *     reports={[
 *       { key: 'variance',     label: 'Budget vs Actual' },
 *       { key: 'summary',      label: 'Budget Summary' },
 *     ]}
 *     selectedReport={reportKey}
 *     onSelectReport={setReportKey}
 *     params={<BudgetReportParams value={params} onChange={setParams} />}
 *     result={reportResult}
 *     columns={VARIANCE_COLUMNS}
 *     exportFilename="budget-report"
 *     loading={isLoading}
 *     error={error?.message}
 *   />
 */

import type { VNode, ComponentChildren } from 'preact';
import { exportCsv, type CsvColumn } from '@ui/lib/exportCsv';
import './reports.css';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Matches the backend `ReportResult` shape from all finance report endpoints. */
export interface ReportResult {
  report:      string;
  generatedAt: string;
  rows:        ReportRow[];
}

/** A single report data row (untyped; column specs extract typed values). */
export type ReportRow = Record<string, unknown>;

/** Column spec for the report preview table and CSV export. */
export interface ReportColumn {
  /** Column header label (preview table + CSV). */
  header: string;
  /**
   * Value extractor. Return a string/number for raw display.
   * If omitted, falls back to `row[key]` stringification.
   */
  value?: (row: ReportRow) => string | number | null | undefined;
  /** Used as fallback key when `value` is not provided. */
  key?: string;
  /**
   * Optional display format hint (does not affect CSV — CSV is always plain text).
   * 'currency' → right-align + 2 dp; 'number' → right-align; 'date' → date-only display.
   */
  format?: 'text' | 'number' | 'currency' | 'date';
  /** When true the column is hidden in the preview table (but still exported to CSV). */
  hiddenInTable?: boolean;
}

export interface ReportDescriptor {
  key:          string;
  label:        string;
  description?: string;
}

// ── Export helper ─────────────────────────────────────────────────────────────

/**
 * Trigger a browser download of the given report result as a UTF-8 CSV.
 * Reuses the shared exportCsv utility so all Finance exports behave consistently.
 */
export function exportReportCsv(
  result: ReportResult,
  columns: ReportColumn[],
  filenameBase: string,
): void {
  const csvCols: CsvColumn<ReportRow>[] = columns.map(c => ({
    header: c.header,
    value:  c.value
      ? (row: ReportRow) => c.value!(row)
      : (row: ReportRow) => {
          const k = c.key ?? c.header.toLowerCase().replace(/\s+/g, '_');
          const v = row[k];
          return v == null ? '' : String(v);
        },
  }));
  exportCsv<ReportRow>(result.rows, csvCols, filenameBase);
}

// ── ReportDataTable ───────────────────────────────────────────────────────────

interface ReportDataTableProps {
  columns: ReportColumn[];
  rows:    ReportRow[];
  /** Max visible rows before the table scrolls vertically. Default: 200. */
  maxVisible?: number;
}

/**
 * Scrollable table for a report result.
 * Used inside `ReportPanel` and can also be embedded in drawers (e.g., the
 * "Run Lines" tab of a payroll drawer).
 */
export function ReportDataTable({ columns, rows, maxVisible = 200 }: ReportDataTableProps): VNode {
  const visibleCols = columns.filter(c => !c.hiddenInTable);
  const displayRows = rows.slice(0, maxVisible);
  const truncated   = rows.length > maxVisible;

  function cellValue(row: ReportRow, col: ReportColumn): string {
    if (col.value) {
      const v = col.value(row);
      return v == null ? '' : String(v);
    }
    const k = col.key ?? col.header.toLowerCase().replace(/\s+/g, '_');
    const v = row[k];
    if (v == null) return '';
    if (col.format === 'currency') return Number(v).toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (col.format === 'date' && typeof v === 'string') return v.slice(0, 10);
    return String(v);
  }

  const isNumeric = (col: ReportColumn) => col.format === 'number' || col.format === 'currency';

  if (rows.length === 0) {
    return (
      <div class="rpt-empty hse-muted">No data for this report and parameters.</div>
    );
  }

  return (
    <div class="rpt-table-wrap">
      <table class="rpt-table">
        <thead>
          <tr>
            {visibleCols.map(col => (
              <th
                key={col.key ?? col.header}
                class={`rpt-th${isNumeric(col) ? ' rpt-th--num' : ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, i) => (
            <tr key={String(row.id ?? i)} class="rpt-row">
              {visibleCols.map(col => (
                <td
                  key={col.key ?? col.header}
                  class={`rpt-td${isNumeric(col) ? ' rpt-td--num' : ''}`}
                >
                  {cellValue(row, col)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <p class="rpt-truncated hse-muted">
          Showing first {maxVisible} of {rows.length} rows. Export CSV to see all rows.
        </p>
      )}
    </div>
  );
}

// ── ReportPanel ───────────────────────────────────────────────────────────────

export interface ReportPanelProps {
  /** Available report types shown in the selector. */
  reports:          ReportDescriptor[];
  /** Currently selected report key. */
  selectedReport:   string | null;
  /** Called when the user selects a report from the list. */
  onSelectReport:   (key: string) => void;
  /**
   * Optional parameter form rendered between the selector and the data table.
   * The caller supplies the form fields (period pickers, fiscal year inputs, etc.).
   * The caller also owns the "Run" button / query trigger — it re-fetches when
   * params change.
   */
  params?:          ComponentChildren;
  /** The report result from the backend (null = not yet fetched). */
  result:           ReportResult | null;
  /** Column specs for the preview table and CSV export. */
  columns:          ReportColumn[];
  /** Base filename for CSV export (date stamp appended by exportCsv). */
  exportFilename:   string;
  /** True while the report query is in-flight. */
  loading?:         boolean;
  /** Non-null when the query failed. */
  error?:           string | null;
}

/**
 * Full report panel: report-type selector + optional parameter area + data
 * table preview + CSV export button.
 *
 * The caller owns data-fetching (runs a useQuery based on `selectedReport` +
 * the current param values) and passes `result` down once available.
 */
export function ReportPanel({
  reports,
  selectedReport,
  onSelectReport,
  params,
  result,
  columns,
  exportFilename,
  loading  = false,
  error    = null,
}: ReportPanelProps): VNode {
  const selectedDesc = reports.find(r => r.key === selectedReport);

  function handleExport() {
    if (!result) return;
    exportReportCsv(result, columns, exportFilename);
  }

  return (
    <div class="rpt-panel">
      {/* Report selector */}
      <div class="rpt-selector">
        <ul class="rpt-list" role="listbox" aria-label="Report type">
          {reports.map(r => (
            <li
              key={r.key}
              role="option"
              aria-selected={r.key === selectedReport}
              class={`rpt-list-item${r.key === selectedReport ? ' rpt-list-item--active' : ''}`}
              onClick={() => onSelectReport(r.key)}
            >
              <span class="rpt-list-label">{r.label}</span>
              {r.description && (
                <span class="rpt-list-desc hse-muted">{r.description}</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Report body */}
      <div class="rpt-body">
        {/* Parameter area (caller-supplied form fields) */}
        {params && (
          <div class="rpt-params">
            {params}
          </div>
        )}

        {/* Status bar */}
        <div class="rpt-toolbar">
          <div class="rpt-meta">
            {selectedDesc && (
              <span class="rpt-report-name">{selectedDesc.label}</span>
            )}
            {result && !loading && (
              <span class="rpt-meta-gen hse-muted">
                {' · '}
                Generated {new Date(result.generatedAt).toLocaleTimeString()}
                {' · '}
                {result.rows.length} row{result.rows.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            class="hrfin-btn hrfin-btn--outline rpt-export-btn"
            onClick={handleExport}
            disabled={!result || result.rows.length === 0 || loading}
            title={!result ? 'Run the report first' : 'Download as CSV'}
            aria-label="Export report as CSV"
          >
            <svg viewBox="0 0 20 20" class="rpt-ico" aria-hidden="true">
              <path
                d="M10 3v10m0 0-3-3m3 3 3-3M4 16h12"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            Export CSV
          </button>
        </div>

        {/* Data area */}
        {loading && (
          <div class="rpt-loading" aria-busy="true" aria-label="Loading report">
            <span class="rpt-spinner" />
            <span class="hse-muted">Running report…</span>
          </div>
        )}

        {!loading && error && (
          <div class="rpt-error" role="alert">
            <strong>Report failed:</strong> {error}
          </div>
        )}

        {!loading && !error && !result && selectedReport && (
          <div class="rpt-placeholder hse-muted">
            Set your parameters and run the report.
          </div>
        )}

        {!loading && !error && !selectedReport && (
          <div class="rpt-placeholder hse-muted">
            Select a report from the list on the left.
          </div>
        )}

        {!loading && !error && result && (
          <ReportDataTable
            columns={columns}
            rows={result.rows}
            maxVisible={200}
          />
        )}
      </div>
    </div>
  );
}
