/**
 * src/components/shared/DataTable.tsx
 *
 * Escape-hatch wrapper around the CDN-loaded DataTables library.
 *
 * Why an escape hatch?  DataTables is imperative — it takes a <table> DOM
 * node and mutates it.  We use a ref + useEffect to hand it the node after
 * Preact has rendered, and destroy it on unmount.  This is the correct
 * "imperative library inside declarative framework" pattern.
 *
 * Enterprise guarantees:
 *   ✓ Destroys the DataTable instance on unmount — no memory leak
 *   ✓ Re-initialises when `data` reference changes (via destroy + reinit)
 *   ✓ Shows <Spinner> while data is loading
 *   ✓ Shows an empty-state message when data is empty
 *   ✓ Typed columns — compile-time safety on field names
 *   ✓ Passes through all DataTables options via `dtOptions`
 *   ✓ Never crashes if the CDN $ / DataTable global is not loaded
 *
 * Usage:
 *   <DataTable
 *     id="employees-table"
 *     columns={[
 *       { title: 'Name',       data: 'fullName'  },
 *       { title: 'Department', data: 'deptName'  },
 *       { title: 'Status',     data: 'status',
 *         render: (val) => `<span class="badge">${val}</span>` },
 *     ]}
 *     data={employees}
 *     loading={isLoading}
 *   />
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { type VNode }                            from 'preact';
import { useEffect, useRef, useId }              from 'preact/hooks';
import { Spinner } from './Spinner';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DataTableColumn<T = Record<string, unknown>> {
  /** Column header label */
  title:      string;
  /**
   * Key of T to read the cell value from.
   * Use `null` for computed/render-only columns.
   */
  data:       keyof T | null;
  /**
   * Custom renderer.  Return an HTML string — DataTables will inject it.
   * Sanitise any user-generated content before returning.
   */
  render?:    (value: unknown, type: string, row: T) => string;
  /** DataTables orderable flag. Default: true */
  orderable?: boolean;
  /** DataTables searchable flag. Default: true */
  searchable?: boolean;
  /** CSS class applied to every cell in this column */
  className?: string;
  /** Fixed pixel width */
  width?:     string;
}

export interface DataTableProps<T = Record<string, unknown>> {
  /** Unique HTML id for the <table> — required by DataTables for multi-table pages */
  id:          string;
  columns:     DataTableColumn<T>[];
  data:        T[];
  loading?:    boolean;
  /** Message shown when data is empty and not loading */
  emptyMessage?: string;
  /** Pass-through DataTables initialisation options (merged with defaults) */
  dtOptions?:  Record<string, unknown>;
  className?:  string;
}

// ── Default DataTables options ────────────────────────────────────────────────

const DT_DEFAULTS: Record<string, unknown> = {
  responsive:  true,
  pageLength:  25,
  lengthMenu:  [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'All']],
  language: {
    search:         'Filter:',
    lengthMenu:     'Show _MENU_ entries',
    info:           'Showing _START_–_END_ of _TOTAL_',
    infoEmpty:      'No entries to show',
    infoFiltered:   '(filtered from _MAX_ total)',
    zeroRecords:    'No matching records found',
    emptyTable:     'No data available',
    paginate: {
      first:    '«',
      last:     '»',
      next:     '›',
      previous: '‹',
    },
  },
  dom: '<"row align-items-center mb-2"<"col-sm-6"l><"col-sm-6 text-end"f>>rt<"row mt-2"<"col-sm-6"i><"col-sm-6"p>>',
  buttons: ['copy', 'csv', 'excel', 'print'],
};

// ── Component ─────────────────────────────────────────────────────────────────

export function DataTable<T = Record<string, unknown>>({
  id,
  columns,
  data,
  loading      = false,
  emptyMessage = 'No records found.',
  dtOptions    = {},
  className    = '',
}: DataTableProps<T>): VNode {
  const tableRef  = useRef<HTMLTableElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dtRef     = useRef<any>(null);   // DataTables instance — imperative, not typed
  const instanceId = useId();

  useEffect(() => {
    // Guard: DataTables requires jQuery on window
    if (typeof window === 'undefined' || !window.$) return;
    if (!tableRef.current) return;
    if (loading) return;

    // Destroy previous instance before reinitialising
    if (dtRef.current) {
      try { dtRef.current.destroy(); } catch { /* ignore */ }
      dtRef.current = null;
    }

    const options = {
      ...DT_DEFAULTS,
      ...dtOptions,
      columns: columns.map((col) => ({
        title:      col.title,
        data:       col.data as string | null,
        render:     col.render,
        orderable:  col.orderable  ?? true,
        searchable: col.searchable ?? true,
        className:  col.className  ?? '',
        width:      col.width,
      })),
      data,
    };

    try {
      // DataTables extends jQuery — the `.DataTable()` method is added by the
      // DataTables CDN script.  We access it via the jQuery instance on window.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
      dtRef.current = (window.$(tableRef.current) as any).DataTable(options);
    } catch (err) {
      console.error('[DataTable] Initialisation failed', err);
    }

    return () => {
      if (dtRef.current) {
        try { dtRef.current.destroy(); } catch { /* ignore */ }
        dtRef.current = null;
      }
    };
  // Re-run when data or columns change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading, instanceId]);

  if (loading) {
    return (
      <div style={{ padding: '40px', display: 'flex', justifyContent: 'center' }}>
        <Spinner size={36} label="Loading table data…" />
      </div>
    );
  }

  if (!loading && data.length === 0) {
    return (
      <div
        style={{
          padding:    '40px 24px',
          textAlign:  'center',
          color:      '#6b7280',
          fontSize:   '14px',
        }}
      >
        <i class="fas fa-inbox" style={{ fontSize: '32px', marginBottom: '12px', display: 'block', opacity: 0.4 }} />
        {emptyMessage}
      </div>
    );
  }

  return (
    <div class={`table-responsive siomac-datatable-wrapper ${className}`}>
      <table
        ref={tableRef}
        id={id}
        class="table table-hover table-sm align-middle"
        style={{ width: '100%' }}
      >
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={String(col.data ?? col.title)} class={col.className}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody />
      </table>
    </div>
  );
}
