/**
 * src/ui/components/Pagination.tsx
 *
 * Standard table pagination — 10 rows per page by default.
 *   • usePagination(items, pageSize?) → the current page's items + controls state
 *   • <Pagination …/> → the "Showing X–Y of Z" + page buttons bar (the kit foot)
 *
 * Used by RegisterTable (automatic) and any raw register table.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';

export const DEFAULT_PAGE_SIZE = 10;

export interface PaginationState<T> {
  page: number;
  setPage: (p: number) => void;
  pageCount: number;
  pageItems: T[];
  total: number;
  pageSize: number;
}

/** Slice `items` into pages of `pageSize` (default 10) and track the current page. */
export function usePagination<T>(items: readonly T[], pageSize: number = DEFAULT_PAGE_SIZE): PaginationState<T> {
  const [page, setPage] = useState(0);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(page, pageCount - 1);
  const pageItems = items.slice(clamped * pageSize, clamped * pageSize + pageSize);
  return { page: clamped, setPage, pageCount, pageItems, total, pageSize };
}

/** A compact window of page numbers around the current page. */
function pageWindow(page: number, pageCount: number): number[] {
  const span = 5;
  let start = Math.max(0, page - Math.floor(span / 2));
  const end = Math.min(pageCount, start + span);
  start = Math.max(0, end - span);
  return Array.from({ length: end - start }, (_, i) => start + i);
}

export interface PaginationProps {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
  /** Noun for the count, e.g. "incidents". Defaults to "records". */
  noun?: string;
}

export function Pagination({ page, pageCount, total, pageSize, onPage, noun = 'records' }: PaginationProps): VNode | null {
  if (total === 0) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const win = pageWindow(page, pageCount);

  return (
    <div class="ui-pager">
      <span class="ui-pager-info">Showing {from}–{to} of {total} {noun}</span>
      {pageCount > 1 && (
        <div class="ui-pager-controls">
          <button class="ui-pager-btn" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
            <i class="fas fa-chevron-left" />
          </button>
          {win[0]! > 0 && <span class="ui-pager-ellipsis">…</span>}
          {win.map(p => (
            <button key={p} class={`ui-pager-btn${p === page ? ' active' : ''}`} onClick={() => onPage(p)}>{p + 1}</button>
          ))}
          {win[win.length - 1]! < pageCount - 1 && <span class="ui-pager-ellipsis">…</span>}
          <button class="ui-pager-btn" disabled={page === pageCount - 1} onClick={() => onPage(page + 1)} aria-label="Next page">
            <i class="fas fa-chevron-right" />
          </button>
        </div>
      )}
    </div>
  );
}
