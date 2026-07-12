/**
 * src/ui/hrfin/HrfinTable.tsx — Aurora register (1:1 with the mockup
 * `.hrfin-table-card`): tabs → search + filter tools → table (with a trailing
 * row-actions cell) → pager. Server-paginated (reflects page/pageCount/total).
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { HrfinIcon, type HrfinIconName } from './icon';
import { RowActionMenu, type RowActionItem } from './RowActionMenu';

export interface HrfinColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ComponentChildren;
  /** When true, the column header becomes a sort toggle. */
  sortable?: boolean;
}
export interface HrfinTab { key: string; label: string; }
export interface HrfinFilter { label: string; icon?: HrfinIconName; onClick?: () => void; }

export interface HrfinTableProps<T> {
  tabs?: HrfinTab[];
  activeTab?: string;
  onTab?: (key: string) => void;
  searchValue?: string;
  onSearch?: (v: string) => void;
  searchPlaceholder?: string;
  filters?: HrfinFilter[];
  columns: readonly HrfinColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** When provided, the trailing ⋮ cell opens a state-aware action menu. */
  rowActions?: (row: T) => RowActionItem[];
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  noun?: string;
  loading?: boolean;
  emptyMessage?: string;
  /** When set, renders an error banner instead of the table body. */
  error?: string;
  /** Currently sorted column key (controlled from outside). */
  sortField?: string;
  /** Sort direction for the active sortField. */
  sortDir?: 'asc' | 'desc';
  /** Called when the user clicks a sortable column header. */
  onSort?: (field: string, dir: 'asc' | 'desc') => void;
}

function pageWindow(page: number, count: number): (number | '…')[] {
  if (count <= 1) return [0];
  const set = new Set<number>([0, count - 1, page, page - 1, page + 1]);
  const nums = [...set].filter(n => n >= 0 && n < count).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  let prev = -1;
  for (const n of nums) { if (prev >= 0 && n - prev > 1) out.push('…'); out.push(n); prev = n; }
  return out;
}

export function HrfinTable<T>({
  tabs, activeTab, onTab, searchValue, onSearch, searchPlaceholder = 'Search…',
  filters = [], columns, rows, rowKey, onRowClick, rowActions,
  page, pageCount, total, pageSize, onPage, noun = 'records', loading, emptyMessage,
  error, sortField, sortDir, onSort,
}: HrfinTableProps<T>): VNode {
  const [menu, setMenu] = useState<{ row: T; x: number; y: number } | null>(null);
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <>
    <article class="hrfin-table-card">
      {tabs && tabs.length > 0 && (
        <div class="hrfin-tabs">
          {tabs.map(t => (
            <button key={t.key} type="button" class={t.key === activeTab ? 'is-active' : ''} onClick={() => onTab?.(t.key)}>{t.label}</button>
          ))}
        </div>
      )}

      <div class="hrfin-table-tools">
        <label>
          <span><HrfinIcon name="filter" /></span>
          <input value={searchValue ?? ''} placeholder={searchPlaceholder} aria-label={searchPlaceholder} onInput={e => onSearch?.((e.target as HTMLInputElement).value)} />
        </label>
        {filters.map((f, i) => (
          <button key={i} type="button" onClick={f.onClick}><HrfinIcon name={f.icon ?? 'filter'} /> {f.label}</button>
        ))}
      </div>

      <div class="hrfin-table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map(c => {
                if (c.sortable && onSort) {
                  const isActive = sortField === c.key;
                  const nextDir: 'asc' | 'desc' = isActive && sortDir === 'asc' ? 'desc' : 'asc';
                  return (
                    <th key={c.key}>
                      <button
                        type="button"
                        class={`hrfin-sort-btn${isActive ? ' is-active' : ''}`}
                        onClick={() => onSort(c.key, nextDir)}
                        aria-label={`Sort by ${c.label} ${nextDir === 'asc' ? 'ascending' : 'descending'}`}
                      >
                        {c.label}
                        <span class="hrfin-sort-icon" aria-hidden="true">
                          {isActive ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                        </span>
                      </button>
                    </th>
                  );
                }
                return <th key={c.key}>{c.label}</th>;
              })}
              <th />
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={columns.length + 1}>
                  <div class="hrfin-empty hrfin-error-state" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--hrfin-danger, #e53)' }}>
                    <strong>Failed to load {noun}.</strong> {error}
                  </div>
                </td>
              </tr>
            ) : loading ? (
              Array.from({ length: Math.min(pageSize, 6) }, (_, r) => (
                <tr key={`s${r}`}>{columns.map(c => <td key={c.key}><span class="hrfin-skel" style={{ width: '70%', height: 12 }} /></td>)}<td /></tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length + 1}><div class="hrfin-empty" style={{ textAlign: 'center', padding: '24px 0' }}>{emptyMessage ?? `No ${noun} found.`}</div></td></tr>
            ) : (
              rows.map(row => (
                <tr key={rowKey(row)} class={onRowClick ? 'is-clickable' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {columns.map(c => <td key={c.key}>{c.render(row)}</td>)}
                  <td>{rowActions ? (
                    <button type="button" aria-label="Row actions" onClick={e => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ row, x: r.right, y: r.bottom }); }}><HrfinIcon name="more" /></button>
                  ) : null}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && !error && total > 0 && (
        <div class="hrfin-pager">
          <span>{from}–{to} of {total} {noun}</span>
          <div>
            <button type="button" aria-label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)}>‹</button>
            {pageWindow(page, pageCount).map((p, i) => p === '…'
              ? <span key={`e${i}`}>…</span>
              : <button key={p} type="button" class={p === page ? 'is-active' : ''} onClick={() => onPage(p)}>{p + 1}</button>)}
            <button type="button" aria-label="Next page" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>›</button>
          </div>
        </div>
      )}
    </article>
    {menu && rowActions && <RowActionMenu items={rowActions(menu.row)} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </>
  );
}
