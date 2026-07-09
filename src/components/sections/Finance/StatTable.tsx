/**
 * src/components/sections/Finance/StatTable.tsx
 *
 * Statutory-dashboard register table — a fully `.sdb`-scoped port of the
 * conv-statutory-config-dashboard.html table (toolbar → table → footer/pager).
 * Belongs to the dashboard's own design language, so it carries NO dependency
 * on the Aurora `.hrfin` scope (that mismatch was the "unstyled tables" bug).
 *
 * Props mirror the shape the tabs already use, so swapping HrfinTable → StatTable
 * is mechanical. Row actions reuse the generic portalled RowActionMenu overlay.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { RowActionMenu, type RowActionItem } from '@ui';

export interface StatColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ComponentChildren;
  /** When true, the header becomes a sort toggle (driven by sortField/onSort). */
  sortable?: boolean;
  /** Cell + header alignment. Defaults to left. */
  align?: 'left' | 'center';
}

export interface StatTableProps<T> {
  searchValue?: string;
  onSearch?: (v: string) => void;
  searchPlaceholder?: string;
  /** Filter chips / selects rendered after the search box. */
  toolbarLeft?: ComponentChildren;
  /** Primary / secondary actions rendered at the far right of the toolbar. */
  toolbarRight?: ComponentChildren;
  columns: ReadonlyArray<StatColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** When provided, a trailing ⋮ cell opens the state-aware action menu. */
  rowActions?: (row: T) => RowActionItem[];
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  noun?: string;
  loading?: boolean;
  emptyMessage?: string;
  /** When set, an error row replaces the table body. */
  error?: string;
  sortField?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (field: string, dir: 'asc' | 'desc') => void;
}

// ── Scoped status badge (replaces the Aurora HrfinPill inside cells) ──────────
export type StatTone = 'ok' | 'bad' | 'wn' | 'nu' | 'dr';
const TONE_CLASS: Record<StatTone, string> = { ok: 'green', bad: 'red', wn: 'amber', nu: 'blue', dr: 'grey' };
export function StatBadge({ tone = 'dr', children }: { tone?: StatTone; children: ComponentChildren }): VNode {
  return <span class={`sdb-badge sdb-badge--${TONE_CLASS[tone]}`}>{children}</span>;
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

export function StatTable<T>({
  searchValue, onSearch, searchPlaceholder = 'Search…', toolbarLeft, toolbarRight,
  columns, rows, rowKey, onRowClick, rowActions,
  page, pageCount, total, pageSize, onPage, noun = 'records', loading, emptyMessage,
  error, sortField, sortDir, onSort,
}: StatTableProps<T>): VNode {
  const [menu, setMenu] = useState<{ row: T; x: number; y: number } | null>(null);
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const span = columns.length + (rowActions ? 1 : 0);
  const hasToolbar = !!onSearch || !!toolbarLeft || !!toolbarRight;

  return (
    <>
      {hasToolbar && (
        <div class="sdb-toolbar">
          {onSearch && (
            <span class="sdb-search">
              <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
              <input
                value={searchValue ?? ''}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                onInput={e => onSearch((e.target as HTMLInputElement).value)}
              />
            </span>
          )}
          {toolbarLeft}
          {toolbarRight && <span class="sdb-toolbar-grow" />}
          {toolbarRight}
        </div>
      )}

      <div class="sdb-tbl-wrap">
        <table class="sdb-tbl">
          <thead>
            <tr>
              {columns.map(c => {
                const centerCls = c.align === 'center' ? 'sdb-th--center' : undefined;
                if (c.sortable && onSort) {
                  const isActive = sortField === c.key;
                  const nextDir: 'asc' | 'desc' = isActive && sortDir === 'asc' ? 'desc' : 'asc';
                  return (
                    <th key={c.key} class={centerCls}>
                      <button
                        type="button"
                        class={`sdb-th-sort${isActive ? ' is-active' : ''}`}
                        onClick={() => onSort(c.key, nextDir)}
                        aria-label={`Sort by ${c.label} ${nextDir === 'asc' ? 'ascending' : 'descending'}`}
                      >
                        {c.label}
                        <span class="sdb-th-sort-ico" aria-hidden="true">{isActive ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}</span>
                      </button>
                    </th>
                  );
                }
                return <th key={c.key} class={centerCls}>{c.label}</th>;
              })}
              {rowActions && <th class="sdb-th--center">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={span}>
                  <div class="sdb-error"><strong>Failed to load {noun}.</strong> {error}</div>
                </td>
              </tr>
            ) : loading ? (
              Array.from({ length: Math.min(pageSize, 6) }, (_, r) => (
                <tr key={`s${r}`}>
                  {columns.map(c => <td key={c.key}><span class="sdb-skel" /></td>)}
                  {rowActions && <td />}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={span}><div class="sdb-empty">{emptyMessage ?? `No ${noun} found.`}</div></td>
              </tr>
            ) : (
              rows.map(row => (
                <tr
                  key={rowKey(row)}
                  class={onRowClick ? 'is-clickable' : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map(c => (
                    <td key={c.key} class={c.align === 'center' ? 'sdb-td--center' : undefined}>{c.render(row)}</td>
                  ))}
                  {rowActions && (
                    <td class="sdb-td--center">
                      <button
                        type="button" class="sdb-dots" aria-label="Row actions"
                        onClick={e => {
                          e.stopPropagation();
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setMenu({ row, x: r.right, y: r.bottom });
                        }}
                      >
                        <i class="fa-solid fa-ellipsis" aria-hidden="true" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && !error && total > 0 && (
        <div class="sdb-tfoot">
          <span>Showing {from} to {to} of {total} {noun}</span>
          <div class="sdb-pager">
            <button type="button" class="sdb-pg" aria-label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)}>
              <i class="fa-solid fa-angle-left" aria-hidden="true" />
            </button>
            {pageWindow(page, pageCount).map((p, i) => p === '…'
              ? <span key={`e${i}`} class="sdb-pg" style={{ border: 0, background: 'none', cursor: 'default' }}>…</span>
              : <button key={p} type="button" class={`sdb-pg${p === page ? ' is-on' : ''}`} onClick={() => onPage(p)}>{p + 1}</button>)}
            <button type="button" class="sdb-pg" aria-label="Next page" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>
              <i class="fa-solid fa-angle-right" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {menu && rowActions && <RowActionMenu items={rowActions(menu.row)} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </>
  );
}
