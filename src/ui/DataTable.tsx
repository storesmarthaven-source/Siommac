// src/ui/DataTable.tsx — the reusable, tailorable register table.
//
// A custom instance of the Employee Master table design (filter-chip bar, sortable
// headers, row highlighting + click-to-open, ⋮ row actions, skeleton loading, empty
// state, pagination + rows-per-page, optional detail-drawer slot), lifted into one
// component so every register/list in the app configures it with a thin `columns[]`
// config instead of re-implementing a table. Scoped `dt-*` classes (DataTable.css).
import type { ComponentChildren, VNode } from 'preact';
import { TableSkeleton, EmptyState } from '@ui';
import { LucideIcon, type LucideName } from './LucideIcon';
import { TableSearch } from './table/FilterBar';
import './DataTable.css';

export type DtAlign = 'left' | 'center' | 'right';
/** Row tint — a subtle status highlight down the row's left edge + background. */
export type DtRowStatus = 'default' | 'active' | 'success' | 'warning' | 'danger' | 'muted';

export interface DtColumn<T> {
  key: string;
  label: string;
  /** Cell content for a row. */
  renderCell: (row: T) => ComponentChildren;
  /** Provide to make the column sortable — returns the comparable value. */
  sortAccessor?: (row: T) => string | number | null | undefined;
  align?: DtAlign;
  /** CSS width (e.g. '120px', 'minmax(140px,1.4fr)') applied to the column. */
  width?: string;
  /** Pin as the sticky first column (stays visible on horizontal scroll). */
  isPinned?: boolean;
}

export interface DtAction<T> {
  key: string;
  label: string;
  icon?: string;                    // Font Awesome name w/o the `fa-` prefix
  tone?: 'default' | 'danger';
  onClick: (row: T) => void;
}

export interface DtActiveFilter { label: string; onRemove: () => void }

export interface DataTableProps<T> {
  columns: DtColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Per-row status → left-edge tint + subtle bg (e.g. active version, retired). */
  rowStatus?: (row: T) => DtRowStatus;
  rowActions?: (row: T) => DtAction<T>[];
  onRowClick?: (row: T) => void;
  onRowHover?: (row: T) => void;
  onRowHoverEnd?: (row: T) => void;
  /** Key of the currently-open row → highlighted as selected. */
  selectedKey?: string | null;

  loading?: boolean;
  skeletonRows?: number;
  emptyState?: { icon?: string; title: string; text?: string };

  /** Toolbar (left→right): search, filter chips (basic), advanced filter; toolbarRight is pushed to the end. */
  globalSearch?: { value: string; onChange: (v: string) => void; placeholder?: string };
  filterChips?: ComponentChildren;
  advancedFilter?: ComponentChildren;
  toolbarRight?: ComponentChildren;

  /** Active-filter summary bar under the toolbar (chips you can remove + Clear all). */
  activeFilters?: DtActiveFilter[];
  onClearFilters?: () => void;

  sort?: { field: string; dir: 'asc' | 'desc'; onSort: (field: string, dir: 'asc' | 'desc') => void };
  pagination?: { page: number; pageCount: number; total: number; onPage: (p: number) => void };
  rowsPerPage?: { value: number; options: number[]; onChange: (n: number) => void };
  /** Plural noun for the pagination summary ("versions", "bands"). */
  noun?: string;
  /** Accessible name for the table + its scroll region (e.g. "Rate versions"). */
  ariaLabel?: string;

  /** Rendered after the table — typically the detail drawer this table opens. */
  drawerSlot?: ComponentChildren;
}

const ACT_ICON: Record<string, LucideName> = {
  view: 'Eye', file: 'FileText', edit: 'Pencil', refresh: 'RotateCw',
  send: 'Send', check: 'Check', close: 'X', trash: 'Trash2', reject: 'X',
};

function pageWindow(cur: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const lo = Math.max(2, cur - 1), hi = Math.min(total - 1, cur + 1);
  if (lo > 2) out.push('…');
  for (let p = lo; p <= hi; p++) out.push(p);
  if (hi < total - 1) out.push('…');
  out.push(total);
  return out;
}

export function DataTable<T>(props: DataTableProps<T>): VNode {
  const {
    columns, rows, rowKey, rowStatus, rowActions, onRowClick, onRowHover, onRowHoverEnd,
    selectedKey, loading, skeletonRows = 8, emptyState, filterChips, advancedFilter, toolbarRight,
    globalSearch, activeFilters, onClearFilters, sort, pagination, rowsPerPage, noun = 'rows', ariaLabel, drawerSlot,
  } = props;
  const regionLabel = ariaLabel ? `${ariaLabel} table` : `${noun} table`;

  const colStyle = (c: DtColumn<T>) => c.width ? { width: c.width } : undefined;
  const showToolbar = !!(filterChips || advancedFilter || toolbarRight || globalSearch);
  const showActiveBar = !!(activeFilters && activeFilters.length);

  return (
    <div class="dt">
      {showToolbar && (
        <div class="dt-toolbar">
          <div class="dt-toolbar-main">
            {globalSearch && (
              <TableSearch value={globalSearch.value} onChange={globalSearch.onChange} placeholder={globalSearch.placeholder} />
            )}
            {filterChips}
            {advancedFilter}
          </div>
          {toolbarRight && <div class="dt-toolbar-end">{toolbarRight}</div>}
        </div>
      )}

      {showActiveBar && (
        <div class="dt-active-filters">
          <strong>Active filters:</strong>
          {activeFilters!.map(f => (
            <button key={f.label} type="button" class="dt-fchip" onClick={f.onRemove}>{f.label} <LucideIcon name="X" size={12} strokeWidth={2.5} /></button>
          ))}
          {onClearFilters && <button type="button" class="dt-clear" onClick={onClearFilters}>Clear all</button>}
        </div>
      )}

      <div class="dt-scroll" role="region" aria-label={regionLabel} tabIndex={0}>
        <table class="dt-table">
          <caption class="sr-only">{regionLabel}{pagination ? ` — ${pagination.total} ${noun}` : ''}</caption>
          <thead>
            <tr>
              {columns.map(c => {
                const sortable = !!c.sortAccessor;
                const active = sort?.field === c.key;
                const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none';
                return (
                  <th
                    key={c.key} scope="col"
                    class={`${c.align ? `dt-al-${c.align}` : ''}${c.isPinned ? ' dt-pin' : ''}`}
                    style={colStyle(c)} aria-sort={sortable ? (ariaSort as 'ascending' | 'descending' | 'none') : undefined}
                  >
                    {sortable && sort
                      ? <button type="button" class="dt-sort" onClick={() => sort.onSort(c.key, active && sort.dir === 'asc' ? 'desc' : 'asc')}>
                          {c.label}{active && <span aria-hidden="true" class="dt-caret">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                        </button>
                      : c.label}
                  </th>
                );
              })}
              {rowActions && <th scope="col" class="dt-al-right dt-col-actions"><span class="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length
              ? <TableSkeleton rows={skeletonRows} cols={columns.length + (rowActions ? 1 : 0)} />
              : rows.length
                ? rows.map(row => {
                    const key = rowKey(row);
                    const status = rowStatus?.(row) ?? 'default';
                    const acts = rowActions?.(row) ?? [];
                    return (
                      <tr
                        key={key}
                        class={`dt-row dt-st-${status}${selectedKey === key ? ' is-selected' : ''}${onRowClick ? ' dt-clickable' : ''}`}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                        onMouseEnter={onRowHover ? () => onRowHover(row) : undefined}
                        onMouseLeave={onRowHoverEnd ? () => onRowHoverEnd(row) : undefined}
                      >
                        {columns.map(c => (
                          <td key={c.key} class={`${c.align ? `dt-al-${c.align}` : ''}${c.isPinned ? ' dt-pin' : ''}`}>{c.renderCell(row)}</td>
                        ))}
                        {rowActions && (
                          <td class="dt-al-right dt-col-actions" onClick={e => e.stopPropagation()}>
                            <div class="dt-actions">
                              {acts.map(a => (
                                <button
                                  key={a.key} type="button"
                                  class={`dt-act${a.tone === 'danger' ? ' dt-act-danger' : ''}`}
                                  title={a.label} aria-label={a.label} onClick={() => a.onClick(row)}
                                >
                                  <LucideIcon name={(a.icon && ACT_ICON[a.icon]) || 'MoreHorizontal'} size={15} strokeWidth={2} />
                                </button>
                              ))}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                : (
                  <tr>
                    <td colSpan={columns.length + (rowActions ? 1 : 0)}>
                      <div class="dt-empty">
                        <EmptyState icon={emptyState?.icon ?? 'fa-inbox'} title={emptyState?.title ?? 'Nothing to show'} text={emptyState?.text} />
                      </div>
                    </td>
                  </tr>
                )}
          </tbody>
        </table>
      </div>

      {(pagination || rowsPerPage) && (
        <div class="dt-pagination">
          <div class="dt-page-info">
            {pagination && pagination.total
              ? `Showing ${(pagination.page) * (rowsPerPage?.value ?? 0) + 1}–${Math.min((pagination.page + 1) * (rowsPerPage?.value ?? pagination.total), pagination.total)} of ${pagination.total} ${noun}`
              : `${pagination?.total ?? rows.length} ${noun}`}
          </div>
          {pagination && pagination.pageCount > 1 && (
            <nav class="dt-pages" aria-label="Pagination">
              <button type="button" class="dt-page-btn" aria-label="Previous page" disabled={pagination.page <= 0} onClick={() => pagination.onPage(pagination.page - 1)}>‹</button>
              {pageWindow(pagination.page + 1, pagination.pageCount).map((p, i) => p === '…'
                ? <span key={`e${i}`} aria-hidden="true" class="dt-page-gap">…</span>
                : <button key={p} type="button" class={`dt-page-btn${p === pagination.page + 1 ? ' is-on' : ''}`} aria-current={p === pagination.page + 1 ? 'page' : undefined} onClick={() => pagination.onPage((p as number) - 1)}>{p}</button>)}
              <button type="button" class="dt-page-btn" aria-label="Next page" disabled={pagination.page >= pagination.pageCount - 1} onClick={() => pagination.onPage(pagination.page + 1)}>›</button>
            </nav>
          )}
          {rowsPerPage && (
            <div class="dt-rows-sel">
              <label>Rows per page</label>
              <select value={String(rowsPerPage.value)} onChange={e => rowsPerPage.onChange(Number((e.currentTarget as HTMLSelectElement).value))}>
                {rowsPerPage.options.map(o => <option key={o} value={String(o)}>{o}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {drawerSlot}
    </div>
  );
}
