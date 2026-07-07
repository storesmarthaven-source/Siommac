/**
 * src/ui/hrfin/HrfinTable.tsx — Aurora register (1:1 with the mockup
 * `.hrfin-table-card`): tabs → search + filter tools → table (with a trailing
 * row-actions cell) → pager. Server-paginated (reflects page/pageCount/total).
 */

import { type VNode, type ComponentChildren } from 'preact';
import { HrfinIcon, type HrfinIconName } from './icon';

export interface HrfinColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ComponentChildren;
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
  columns: ReadonlyArray<HrfinColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  noun?: string;
  loading?: boolean;
  emptyMessage?: string;
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
  filters = [], columns, rows, rowKey, onRowClick,
  page, pageCount, total, pageSize, onPage, noun = 'records', loading, emptyMessage,
}: HrfinTableProps<T>): VNode {
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
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
          <thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {loading ? (
              Array.from({ length: Math.min(pageSize, 6) }, (_, r) => (
                <tr key={`s${r}`}>{columns.map(c => <td key={c.key}><span class="hrfin-skel" style={{ width: '70%', height: 12 }} /></td>)}<td /></tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length + 1}><div class="hrfin-empty" style={{ textAlign: 'center', padding: '24px 0' }}>{emptyMessage ?? `No ${noun} found.`}</div></td></tr>
            ) : (
              rows.map(row => (
                <tr key={rowKey(row)} class={onRowClick ? 'is-clickable' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {columns.map(c => <td key={c.key}>{c.render(row)}</td>)}
                  <td><button type="button" aria-label="More row actions" onClick={e => e.stopPropagation()}><HrfinIcon name="more" /></button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && total > 0 && (
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
  );
}
