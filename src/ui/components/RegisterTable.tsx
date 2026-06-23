/**
 * src/ui/components/RegisterTable.tsx
 *
 * The register-page table frame: a scrollable `.vt-table` with a sticky header
 * built from a column spec, plus an optional footer summary row. Rows are passed
 * as children (row markup varies per page; the frame does not).
 *
 * Wraps existing `.vt-table-scroll` / `.vt-table` classes — no new CSS.
 */

import { type VNode, type ComponentChildren, toChildArray } from 'preact';
import { usePagination, Pagination, DEFAULT_PAGE_SIZE } from './Pagination';

export interface Column {
  label: string;
  /** Fixed column width, e.g. "110px". Omit for a flexible column. */
  width?: string;
}

interface RegisterTableProps {
  columns: ReadonlyArray<Column>;
  /** `<tr>` rows. */
  children: ComponentChildren;
  /** Optional footer content (e.g. "Showing 12 of 40"). */
  footer?: ComponentChildren;
  /** Rows per page (default 10). Pass 0 to disable pagination. */
  pageSize?: number;
  /** Count noun shown by the pager, e.g. "incidents". */
  noun?: string;
}

export function RegisterTable({ columns, children, footer, pageSize = DEFAULT_PAGE_SIZE, noun }: RegisterTableProps): VNode {
  const rows = toChildArray(children);
  const paged = pageSize > 0;
  const pg = usePagination(rows, paged ? pageSize : Math.max(1, rows.length));

  return (
    <>
      <div class="vt-table-scroll">
        <table class="vt-table">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} style={c.width ? { width: c.width } : undefined}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>{paged ? pg.pageItems : rows}</tbody>
        </table>
      </div>
      {footer && (
        <div style={{
          padding: '7px 16px',
          borderTop: '1px solid var(--border)',
          fontSize: '0.68rem',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          {footer}
        </div>
      )}
      {paged && (
        <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPage={pg.setPage} noun={noun} />
      )}
    </>
  );
}
