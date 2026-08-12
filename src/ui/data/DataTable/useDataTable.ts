/**
 * src/ui/data/DataTable/useDataTable.ts — the engine's derived state.
 *
 * Pure derivation from props. It sorts and slices ONLY in client mode, and never
 * fetches anything: that is what keeps one table usable for both an in-memory
 * list and a server-paginated register.
 */

import { useCallback, useMemo, useState } from 'preact/hooks';
import {
  type DataTableColumn, type DataTablePagination, type DataTableSelection,
  type DataTableSorting,
} from './types';

interface Params<T> {
  rows: readonly T[];
  columns: readonly DataTableColumn<T>[];
  getRowId: (row: T) => string;
  sorting?: DataTableSorting;
  pagination?: DataTablePagination;
  selection?: DataTableSelection<T>;
  columnChooser?: boolean;
}

export interface DataTableState<T> {
  visibleColumns: DataTableColumn<T>[];
  hiddenIds: string[];
  toggleColumn: (id: string) => void;
  /** The rows actually rendered, after client sort + client slice. */
  pageRows: readonly T[];
  totalRows: number;
  pageCount: number;
  toggleSort: (columnId: string) => void;
  selectableRows: readonly T[];
  allSelected: boolean;
  someSelected: boolean;
  toggleAll: () => void;
  toggleRow: (row: T) => void;
  isSelected: (row: T) => boolean;
}

/**
 * `null` and `undefined` sort last in BOTH directions — an empty cell is not
 * "smallest", it is "unknown", and burying it at the top of a descending sort
 * hides the rows someone is usually looking for.
 */
function compareValues(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function useDataTable<T>({
  rows, columns, getRowId, sorting, pagination, selection, columnChooser,
}: Params<T>): DataTableState<T> {
  // Column visibility is the table's OWN state — it is a view preference, not
  // something a caller should have to hold. Everything else is controlled.
  const [hiddenIds, setHiddenIds] = useState<string[]>(
    () => columns.filter(c => c.hidden).map(c => c.id),
  );

  const toggleColumn = useCallback((id: string) => {
    setHiddenIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }, []);

  const visibleColumns = useMemo(
    () => columns.filter(c => (columnChooser ? !hiddenIds.includes(c.id) : !c.hidden)),
    [columns, hiddenIds, columnChooser],
  );

  const sorted = useMemo(() => {
    if (!sorting?.client || !sorting.value) return rows;
    const col = columns.find(c => c.id === sorting.value?.columnId);
    if (!col?.sortValue) return rows;
    const dir = sorting.value.direction === 'asc' ? 1 : -1;
    // Copy before sorting: `rows` belongs to the caller (very often a query
    // cache), and sorting it in place would mutate their data.
    return [...rows].sort((a, b) => compareValues(col.sortValue!(a), col.sortValue!(b)) * dir);
  }, [rows, sorting?.client, sorting?.value, columns]);

  // Server mode is signalled by `total`. Without it the table owns the slicing.
  const serverPaged = pagination?.total !== undefined;
  const totalRows = pagination?.total ?? sorted.length;

  const pageRows = useMemo(() => {
    if (!pagination || serverPaged) return sorted;
    const start = (pagination.page - 1) * pagination.pageSize;
    return sorted.slice(start, start + pagination.pageSize);
  }, [sorted, pagination?.page, pagination?.pageSize, serverPaged]);

  const pageCount = pagination ? Math.max(1, Math.ceil(totalRows / pagination.pageSize)) : 1;

  const toggleSort = useCallback((columnId: string) => {
    if (!sorting) return;
    const current = sorting.value;
    // asc → desc → unsorted. The third press restoring the natural order is what
    // makes a sortable header safe to poke at.
    if (current?.columnId !== columnId) sorting.onChange({ columnId, direction: 'asc' });
    else if (current.direction === 'asc') sorting.onChange({ columnId, direction: 'desc' });
    else sorting.onChange(null);
  }, [sorting]);

  /* ── Selection ───────────────────────────────────────────────────────────
     Scoped to the CURRENT PAGE. "Select all" on a server-paginated table cannot
     honestly mean 4,000 unloaded rows, and pretending it does is how bulk
     actions delete things nobody saw. */
  const selectableRows = useMemo(
    () => (selection?.isSelectable ? pageRows.filter(selection.isSelectable) : pageRows),
    [pageRows, selection?.isSelectable],
  );

  const selectedSet = useMemo(() => new Set(selection?.selectedIds ?? []), [selection?.selectedIds]);
  const isSelected = useCallback((row: T) => selectedSet.has(getRowId(row)), [selectedSet, getRowId]);

  const allSelected = selectableRows.length > 0 && selectableRows.every(isSelected);
  const someSelected = selectableRows.some(isSelected);

  const toggleAll = useCallback(() => {
    if (!selection) return;
    const pageIds = selectableRows.map(getRowId);
    if (allSelected) selection.onChange(selection.selectedIds.filter(id => !pageIds.includes(id)));
    else selection.onChange([...new Set([...selection.selectedIds, ...pageIds])]);
  }, [selection, selectableRows, allSelected, getRowId]);

  const toggleRow = useCallback((row: T) => {
    if (!selection) return;
    const id = getRowId(row);
    selection.onChange(
      selectedSet.has(id)
        ? selection.selectedIds.filter(x => x !== id)
        : [...selection.selectedIds, id],
    );
  }, [selection, selectedSet, getRowId]);

  return {
    visibleColumns, hiddenIds, toggleColumn,
    pageRows, totalRows, pageCount,
    toggleSort,
    selectableRows, allSelected, someSelected, toggleAll, toggleRow, isSelected,
  };
}
