/**
 * src/ui/data/DataTable — the public surface is ONE component.
 *
 * The parts (toolbar, header, row actions, pagination, the chooser) are
 * implementation files, deliberately not exported: they exist to keep the code
 * readable, not to be assembled by hand. Exporting them would recreate the
 * problem this component was built to end — every page composing its own table
 * out of half the pieces.
 */

export { DataTable } from './DataTable';
export type {
  DataTableProps, DataTableColumn, DataTableSort, DataTableSorting,
  DataTablePagination, DataTableSelection, DataTableBulkAction,
  DataTableSearch, DataTableFilter, DataTableAction,
  DataTableEmptyState, DataTableDensity,
} from './types';
