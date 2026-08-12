/**
 * src/ui/data/DataTable/DataTable.tsx — THE table.
 *
 * One engine. Search, filters, sorting, pagination, rows-per-page, selection,
 * bulk actions, the column chooser and row actions are all optional capabilities
 * of this component. There is no SimpleTable, PaginatedTable, SelectableTable or
 * ServerTable — the audit found four table implementations and 186 raw
 * `<table>` precisely because "this one is a bit different" kept winning.
 *
 * ── What it composes rather than reinvents ──────────────────────────────────
 *   row actions   Button (iconOnly) + Menu — not a private kebab
 *   selection     Checkbox, including the tri-state header
 *   toolbar       SearchInput, MultiSelect, Badge chips
 *   empty         EmptyState
 *   loading       TableSkeleton
 *   pagination    Button + Select
 *
 * ── What it does NOT do ─────────────────────────────────────────────────────
 * Fetch. Ever. It receives `rows` plus controlled state and reports intent;
 * TanStack Query stays outside. That is what lets one table serve an in-memory
 * list and a 4,000-row server register.
 *
 * No virtualisation either — deliberately. Server pagination covers the datasets
 * SIOMAC actually has, and virtualisation costs accessibility, sticky headers,
 * keyboard navigation and testability. Build it when a measured page needs it.
 */

import { type VNode } from 'preact';
import { useId, useState } from 'preact/hooks';
import { LucideIcon } from '../../LucideIcon';
import { Button } from '../../primitives/Button';
import { Checkbox } from '../../primitives/choice';
import { EmptyState } from '../../components/EmptyState';
import { TableSkeleton } from '../../components/Skeleton';
import { DropdownMenu, type MenuItems } from '../../overlays/DropdownMenu';
import { useDataTable } from './useDataTable';
import { DataTableToolbar, DataTableBulkBar } from './DataTableToolbar';
import { type DataTableAction, type DataTableProps } from './types';
import './dataTable.recipe.css';

export function DataTable<T>({
  rows, columns, getRowId,
  loading = false, error = null, onRetry,
  density = 'standard', stickyHeader = false, zebra = false,
  sorting, pagination, selection, search, filters,
  rowActions, onRowClick, isRowActive,
  columnChooser = false,
  emptyState, label, toolbarContent, toolbarActions, class: extra,
}: DataTableProps<T>): VNode {
  const uid = useId();
  const t = useDataTable({ rows, columns, getRowId, sorting, pagination, selection, columnChooser });

  const colSpan = t.visibleColumns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);
  const showBulk = selection && selection.selectedIds.length > 0 && (selection.bulkActions?.length ?? 0) > 0;

  return (
    <div class={`ui-dt ui-dt--${density}${extra ? ` ${extra}` : ''}`}>
      <DataTableToolbar
        search={search}
        filters={filters}
        columns={columns}
        hiddenIds={t.hiddenIds}
        onToggleColumn={t.toggleColumn}
        columnChooser={columnChooser}
        content={toolbarContent}
        actions={toolbarActions}
      />

      {showBulk && (
        <DataTableBulkBar
          count={selection.selectedIds.length}
          actions={selection.bulkActions ?? []}
          onClear={() => selection.onChange([])}
        />
      )}

      <div class={`ui-dt-scroll${stickyHeader ? ' ui-dt-scroll--sticky' : ''}`}>
        {/* A real <table>. Semantics are not negotiable: a grid of divs has no
            column headers, no row/column relationships, and no way for a screen
            reader to say which column a cell belongs to. */}
        <table class={`ui-dt-table${zebra ? ' ui-dt-table--zebra' : ''}`} aria-label={label} aria-busy={loading || undefined}>
          <thead>
            <tr>
              {selection && (
                <th class="ui-dt-th ui-dt-th--check" scope="col">
                  <Checkbox
                    checked={t.allSelected}
                    indeterminate={t.someSelected && !t.allSelected}
                    disabled={t.selectableRows.length === 0}
                    onChange={t.toggleAll}
                    aria-label={t.allSelected ? 'Deselect all rows on this page' : 'Select all rows on this page'}
                  />
                </th>
              )}

              {t.visibleColumns.map(col => {
                const active = sorting?.value?.columnId === col.id;
                const dir = active ? sorting.value?.direction : undefined;
                return (
                  <th
                    key={col.id}
                    class={`ui-dt-th ui-dt-th--${col.align ?? 'left'}${col.sortable && sorting ? ' ui-dt-th--sortable' : ''}${col.pinned ? ' ui-dt-th--pinned' : ''}`}
                    scope="col"
                    style={{ width: col.width, minWidth: col.minWidth, maxWidth: col.maxWidth }}
                    // aria-sort belongs on the header cell, not the button — it
                    // describes the COLUMN's state, not the control's.
                    aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {col.sortable && sorting
                      ? (
                        <button
                          type="button"
                          class="ui-dt-sort"
                          onClick={() => t.toggleSort(col.id)}
                        >
                          <span>{col.header}</span>
                          <LucideIcon
                            name={!active ? 'ChevronsUpDown' : dir === 'asc' ? 'ChevronUp' : 'ChevronDown'}
                            class={`ui-dt-sort-icon${active ? ' is-active' : ''}`}
                          />
                        </button>
                      )
                      : col.header}
                  </th>
                );
              })}

              {rowActions && <th class="ui-dt-th ui-dt-th--actions" scope="col"><span class="ui-sr-only">Actions</span></th>}
            </tr>
          </thead>

          <tbody>
            {loading && <TableSkeleton rows={pagination?.pageSize ?? 8} cols={colSpan} firstCellAvatar={false} />}

            {!loading && error && (
              <tr>
                <td colSpan={colSpan} class="ui-dt-state">
                  <EmptyState
                    icon="fa-triangle-exclamation"
                    tone="amber"
                    title="Couldn’t load this list"
                    text={error}
                    actions={onRetry
                      ? <Button variant="outline" iconLeft={<LucideIcon name="RotateCw" />} onClick={onRetry}>Retry</Button>
                      : undefined}
                  />
                </td>
              </tr>
            )}

            {!loading && !error && t.pageRows.length === 0 && (
              <tr>
                <td colSpan={colSpan} class="ui-dt-state">
                  <EmptyState
                    icon={emptyState?.icon ?? 'fa-inbox'}
                    title={emptyState?.title ?? 'Nothing to show'}
                    text={emptyState?.text}
                    actions={emptyState?.actions}
                  />
                </td>
              </tr>
            )}

            {!loading && !error && t.pageRows.map(row => {
              const id = getRowId(row);
              const selected = selection ? t.isSelected(row) : false;
              const selectable = selection?.isSelectable ? selection.isSelectable(row) : true;
              return (
                <tr
                  key={id}
                  class={[
                    'ui-dt-tr',
                    selected ? 'is-selected' : '',
                    isRowActive?.(row) ? 'is-active' : '',
                    onRowClick ? 'is-clickable' : '',
                  ].filter(Boolean).join(' ')}
                  aria-selected={selection ? selected : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selection && (
                    // stopPropagation: ticking a row must not also fire the
                    // row-click that opens a drawer over the list you are picking from.
                    <td class="ui-dt-td ui-dt-td--check" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={selected}
                        disabled={!selectable}
                        onChange={() => t.toggleRow(row)}
                        aria-label={`Select row ${id}`}
                      />
                    </td>
                  )}

                  {t.visibleColumns.map(col => (
                    <td
                      key={col.id}
                      class={`ui-dt-td ui-dt-td--${col.align ?? 'left'}${col.pinned ? ' ui-dt-td--pinned' : ''}`}
                      style={{ width: col.width, minWidth: col.minWidth, maxWidth: col.maxWidth }}
                    >
                      {col.cell(row)}
                    </td>
                  ))}

                  {rowActions && (
                    <td class="ui-dt-td ui-dt-td--actions" onClick={e => e.stopPropagation()}>
                      <RowActions actions={rowActions(row)} rowId={id} tableId={uid} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pagination && !error && (
        <DataTablePaginationBar
          pagination={pagination}
          totalRows={t.totalRows}
          pageCount={t.pageCount}
          shown={t.pageRows.length}
        />
      )}
    </div>
  );
}

/* ── Row actions — the canonical Button + Menu, never a private kebab ───────*/

function RowActions(
  { actions, rowId, tableId }: { actions: readonly DataTableAction[]; rowId: string; tableId: string },
): VNode | null {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;

  const items: MenuItems = actions.map(a => ({
    id: a.id,
    label: a.label,
    icon: a.icon,
    danger: a.tone === 'danger',
    disabled: a.disabled,
    onSelect: a.onSelect,
  }));

  return (
    <>
      <span ref={setAnchor} style={{ display: 'inline-flex' }}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`Actions for row ${rowId}`}
          aria-haspopup="menu"
          aria-expanded={open}
          iconLeft={<LucideIcon name="EllipsisVertical" />}
          onClick={() => setOpen(o => !o)}
        />
      </span>
      <DropdownMenu
        id={`dt${tableId}-${rowId}`}
        open={open}
        anchor={anchor}
        onClose={() => { setOpen(false); anchor?.querySelector('button')?.focus(); }}
        items={items}
        label="Row actions"
      />
    </>
  );
}

/* ── Pagination ────────────────────────────────────────────────────────────*/

function DataTablePaginationBar(
  { pagination, totalRows, pageCount, shown }:
  { pagination: NonNullable<DataTableProps<unknown>['pagination']>; totalRows: number; pageCount: number; shown: number },
): VNode {
  const { page, pageSize, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 100] } = pagination;

  // A server that omits or zeroes its count must not make the table claim there
  // is nothing here while rows are visibly rendered. Trust what is on screen.
  const effectiveTotal = totalRows > 0 ? totalRows : shown;
  const first = effectiveTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = effectiveTotal === 0 ? 0 : first + shown - 1;

  return (
    <div class="ui-dt-pagination">
      <span class="ui-dt-count">
        {effectiveTotal === 0 ? 'No rows' : <>Showing <strong>{first}–{last}</strong> of <strong>{effectiveTotal}</strong></>}
      </span>

      {onPageSizeChange && (
        <label class="ui-dt-pagesize">
          <span>Rows</span>
          <select
            class="ui-dt-pagesize-select"
            value={String(pageSize)}
            aria-label="Rows per page"
            /* `onInput`, not `onChange`: the app loads `preact/compat`, which
               remaps form-control handlers onto the `input` event. Binding it
               explicitly means this behaves the same with or without compat. */
            onInput={e => {
              // Changing page size while deep in the list would land the user on
              // a page that no longer exists — go back to the first.
              onPageSizeChange(Number((e.target as HTMLSelectElement).value));
              onPageChange(1);
            }}
          >
            {pageSizeOptions.map(o => <option key={o} value={String(o)}>{o}</option>)}
          </select>
        </label>
      )}

      <nav class="ui-dt-pager" aria-label="Pagination">
        <Button
          variant="outline" size="sm" iconOnly
          aria-label="Previous page"
          disabled={page <= 1}
          iconLeft={<LucideIcon name="ChevronLeft" />}
          onClick={() => onPageChange(page - 1)}
        />
        <span class="ui-dt-pageno" aria-live="polite">Page {page} of {pageCount}</span>
        <Button
          variant="outline" size="sm" iconOnly
          aria-label="Next page"
          disabled={page >= pageCount}
          iconLeft={<LucideIcon name="ChevronRight" />}
          onClick={() => onPageChange(page + 1)}
        />
      </nav>
    </div>
  );
}
