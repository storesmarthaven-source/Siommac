/**
 * src/ui/data/DataTable/types.ts — the DataTable contract.
 *
 * ONE table. Search, filters, sorting, pagination, rows-per-page, selection,
 * bulk actions, the column chooser and row actions are CAPABILITIES — every one
 * of them optional, every one of them the same component. There is no
 * SimpleTable, PaginatedTable, SelectableTable or ServerTable, and there must
 * never be: the audit found four table implementations and 186 raw `<table>`
 * precisely because "this one is a bit different" kept winning.
 *
 * Two rules that keep it reusable across every SIOMAC module:
 *
 *  1. **No business concepts.** Nothing here knows about employees, payroll,
 *     risk or onboarding. A person column is a `cell` that returns `<PersonCell>`;
 *     a status column is a `cell` that returns `<Badge>`. The table stays generic.
 *
 *  2. **No data fetching.** DataTable never calls an API. It receives `rows` and
 *     controlled state, and reports intent through callbacks. TanStack Query
 *     stays outside.
 */

import { type ComponentChildren, type VNode } from 'preact';

/* ── Columns ───────────────────────────────────────────────────────────────*/

export interface DataTableColumn<T> {
  id: string;
  header: string;
  /** Render the cell. Return a Badge, a PersonCell, a Button — anything. */
  cell: (row: T) => ComponentChildren;

  width?: number | string;
  minWidth?: number;
  maxWidth?: number;
  align?: 'left' | 'center' | 'right';
  /** Keep an identity column visible while the table scrolls horizontally. */
  pinned?: boolean;
  sortable?: boolean;
  /** Hidden by default; the column chooser can bring it back. */
  hidden?: boolean;
  /** Excluded from the column chooser — an identity column you must always see. */
  alwaysVisible?: boolean;
  /**
   * Value used by the built-in client sort. Omit for a server-sorted column, or
   * for one whose display value is not what you sort by.
   */
  sortValue?: (row: T) => string | number | null | undefined;
}

/* ── Capabilities ──────────────────────────────────────────────────────────*/

export interface DataTableSort {
  columnId: string;
  direction: 'asc' | 'desc';
}

export interface DataTableSorting {
  value: DataTableSort | null;
  onChange: (sort: DataTableSort | null) => void;
  /**
   * CLIENT sorting: when true the table sorts `rows` itself using each column's
   * `sortValue`. Leave false for server sorting — the table then only reports
   * the intent and renders whatever comes back.
   */
  client?: boolean;
}

export interface DataTablePagination {
  page: number;            // 1-based
  pageSize: number;
  /**
   * Total row count on the SERVER. Its presence is what selects the mode:
   * given → server-paginated (rows are rendered as supplied); omitted → client
   * mode, and the table slices `rows` itself. One prop, two modes, no second
   * component.
   */
  total?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
}

export interface DataTableSelection<T> {
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  /** Rows that cannot be selected — a locked or in-flight record. */
  isSelectable?: (row: T) => boolean;
  /** Shown in the bulk bar once anything is selected. */
  bulkActions?: readonly DataTableBulkAction[];
}

export interface DataTableBulkAction {
  id: string;
  label: string;
  icon?: VNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect: (ids: readonly string[]) => void;
}

export interface DataTableSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** A faceted filter. Rendered in the toolbar with active values as chips. */
export interface DataTableFilter {
  id: string;
  label: string;
  options: readonly { value: string; label: string; subtitle?: string }[];
  values: readonly string[];
  onChange: (values: string[]) => void;
}

/** A row action. Rendered through the canonical Button + Menu — never a private kebab. */
export interface DataTableAction {
  id: string;
  label: string;
  icon?: VNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

export interface DataTableEmptyState {
  title: string;
  text?: string;
  /** FontAwesome class — EmptyState still takes one. */
  icon?: string;
  actions?: ComponentChildren;
}

export type DataTableDensity = 'compact' | 'standard' | 'comfortable';

/* ── The component ─────────────────────────────────────────────────────────*/

export interface DataTableProps<T> {
  rows: readonly T[];
  columns: readonly DataTableColumn<T>[];
  /** Stable identity. Required — selection, keys and row actions all depend on it. */
  getRowId: (row: T) => string;

  loading?: boolean;
  error?: string | null;
  /** Retry handler shown on the error state. */
  onRetry?: () => void;

  density?: DataTableDensity;
  stickyHeader?: boolean;
  /** Zebra striping. Off by default — grid lines already separate rows. */
  zebra?: boolean;

  sorting?: DataTableSorting;
  pagination?: DataTablePagination;
  selection?: DataTableSelection<T>;
  search?: DataTableSearch;
  filters?: readonly DataTableFilter[];

  rowActions?: (row: T) => readonly DataTableAction[];
  onRowClick?: (row: T) => void;
  /** Highlight a row as current — a drawer-open row, say. */
  isRowActive?: (row: T) => boolean;

  /** Lets the user show/hide columns. Off unless there is something worth hiding. */
  columnChooser?: boolean;

  emptyState?: DataTableEmptyState;
  /** Accessible name for the table. */
  label: string;
  /** Module-specific filter controls placed after search and before actions. */
  toolbarContent?: ComponentChildren;
  /** Extra toolbar content, right-aligned — a "New" button, an export. */
  toolbarActions?: ComponentChildren;
  class?: string;
}
