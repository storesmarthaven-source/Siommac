/**
 * DataTable.test.tsx — the engine's contract.
 *
 * The assertions concentrate on what makes it ONE table rather than four:
 * capabilities being genuinely optional, client vs server mode selected by the
 * data you already have, and select-all meaning the page rather than a promise
 * about 4,000 rows nobody loaded.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { DataTable, type DataTableColumn } from './index';
import { Badge } from '../../primitives/Badge';

interface Row { id: string; name: string; dept: string; status: string }

const ROWS: Row[] = [
  { id: 'a', name: 'Amara',  dept: 'Operations', status: 'active' },
  { id: 'b', name: 'Sarah',  dept: 'HSE',        status: 'leave' },
  { id: 'c', name: 'Kwame',  dept: 'Engineering', status: 'inactive' },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'name',   header: 'Name',       sortable: true, sortValue: r => r.name, cell: r => r.name },
  { id: 'dept',   header: 'Department', cell: r => r.dept },
  { id: 'status', header: 'Status',     cell: r => <Badge tone="neutral">{r.status}</Badge> },
];

function table(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable<Row> label="People" rows={ROWS} columns={COLUMNS} getRowId={r => r.id} {...props} />,
  );
}

describe('DataTable — structure', () => {
  it('renders a semantic table with scoped column headers', () => {
    // Not a grid of divs: those have no column headers and no row/column
    // relationships for a screen reader.
    table();
    const t = screen.getByRole('table', { name: 'People' });
    expect(t.tagName).toBe('TABLE');
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.getAllByRole('columnheader')[0]!.getAttribute('scope')).toBe('col');
  });

  it('renders a row per record', () => {
    table();
    expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1);  // + header
  });

  it('renders whatever a cell returns, including other kit components', () => {
    // The composition rule: the table knows nothing about status, only that the
    // column returned a Badge.
    const { container } = table();
    expect(container.querySelectorAll('.ui-badge')).toHaveLength(3);
  });

  it('hides columns marked hidden until the chooser brings them back', () => {
    const cols: DataTableColumn<Row>[] = [...COLUMNS, { id: 'extra', header: 'Extra', hidden: true, cell: () => 'x' }];
    table({ columns: cols });
    expect(screen.queryByRole('columnheader', { name: 'Extra' })).toBeNull();
  });

  it('pins identity columns through the canonical column contract', () => {
    const columns: DataTableColumn<Row>[] = [
      { ...COLUMNS[0]!, pinned: true },
      ...COLUMNS.slice(1),
    ];
    table({ columns });
    expect(screen.getByRole('columnheader', { name: /Name/ }).classList.contains('ui-dt-th--pinned')).toBe(true);
    expect(screen.getAllByRole('cell')[0]!.classList.contains('ui-dt-td--pinned')).toBe(true);
  });
});

describe('DataTable — capabilities are optional', () => {
  it('renders with no capabilities at all', () => {
    const { container } = table();
    expect(container.querySelector('.ui-dt-toolbar')).toBeNull();
    expect(container.querySelector('.ui-dt-pagination')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the toolbar only when a toolbar capability is used', () => {
    const { container } = table({ search: { value: '', onChange: vi.fn() } });
    expect(container.querySelector('.ui-dt-toolbar')).not.toBeNull();
  });

  it('places module-owned filter compositions inside the canonical toolbar', () => {
    table({ toolbarContent: <button type="button">Advanced filter</button> });
    expect(screen.getByRole('button', { name: 'Advanced filter' }).closest('.ui-dt-toolbar')).not.toBeNull();
  });
});

describe('DataTable — sorting', () => {
  it('marks the sorted column with aria-sort on the header CELL', () => {
    // aria-sort describes the column, not the button inside it.
    table({ sorting: { value: { columnId: 'name', direction: 'asc' }, onChange: vi.fn() } });
    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('columnheader', { name: 'Department' }).getAttribute('aria-sort')).toBeNull();
  });

  it('cycles asc → desc → unsorted', () => {
    const onChange = vi.fn();
    const { rerender } = table({ sorting: { value: null, onChange } });
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onChange).toHaveBeenLastCalledWith({ columnId: 'name', direction: 'asc' });

    rerender(<DataTable<Row> label="People" rows={ROWS} columns={COLUMNS} getRowId={r => r.id}
      sorting={{ value: { columnId: 'name', direction: 'asc' }, onChange }} />);
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onChange).toHaveBeenLastCalledWith({ columnId: 'name', direction: 'desc' });

    rerender(<DataTable<Row> label="People" rows={ROWS} columns={COLUMNS} getRowId={r => r.id}
      sorting={{ value: { columnId: 'name', direction: 'desc' }, onChange }} />);
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    // The third press restoring the natural order is what makes a sortable
    // header safe to poke at.
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('sorts rows itself in client mode', () => {
    table({ sorting: { value: { columnId: 'name', direction: 'asc' }, onChange: vi.fn(), client: true } });
    const cells = screen.getAllByRole('cell').filter((_, i) => i % 3 === 0);
    expect(cells.map(c => c.textContent)).toEqual(['Amara', 'Kwame', 'Sarah']);
  });

  it('does NOT reorder rows in server mode', () => {
    // The server already sorted; re-sorting locally would fight it.
    table({ sorting: { value: { columnId: 'name', direction: 'desc' }, onChange: vi.fn() } });
    const cells = screen.getAllByRole('cell').filter((_, i) => i % 3 === 0);
    expect(cells.map(c => c.textContent)).toEqual(['Amara', 'Sarah', 'Kwame']);
  });

  it('does not mutate the caller\'s rows array', () => {
    // `rows` is very often a query cache — sorting in place would corrupt it.
    const rows = [...ROWS];
    table({ rows, sorting: { value: { columnId: 'name', direction: 'desc' }, onChange: vi.fn(), client: true } });
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('DataTable — pagination', () => {
  it('slices rows itself when `total` is absent (client mode)', () => {
    table({ pagination: { page: 1, pageSize: 2, onPageChange: vi.fn() } });
    expect(screen.getAllByRole('row')).toHaveLength(3);   // header + 2
    expect(screen.getByText(/Showing/).textContent).toContain('1–2');
  });

  it('renders rows as supplied when `total` is present (server mode)', () => {
    table({ pagination: { page: 1, pageSize: 2, total: 148, onPageChange: vi.fn() } });
    expect(screen.getAllByRole('row')).toHaveLength(4);   // header + all 3 supplied
    expect(screen.getByText(/Showing/).textContent).toContain('148');
  });

  it('trusts the rendered rows when the server omits its count', () => {
    // Otherwise the footer says "No rows" underneath a full page of rows.
    table({ pagination: { page: 1, pageSize: 25, total: 0, onPageChange: vi.fn() } });
    expect(screen.getByText(/Showing/).textContent).toContain('1–3');
  });

  it('disables Previous on the first page and Next on the last', () => {
    table({ pagination: { page: 1, pageSize: 25, total: 3, onPageChange: vi.fn() } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous page' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next page' }).disabled).toBe(true);
  });

  it('returns to page 1 when the page size changes', () => {
    // Otherwise the user lands on a page that no longer exists.
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    table({ pagination: { page: 4, pageSize: 25, total: 148, onPageChange, onPageSizeChange } });
    fireEvent.input(screen.getByLabelText('Rows per page'), { target: { value: '100' } });
    expect(onPageSizeChange).toHaveBeenCalledWith(100);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});

describe('DataTable — selection', () => {
  const sel = (selectedIds: string[], onChange = vi.fn()) => ({
    selectedIds, onChange, isSelectable: (r: Row) => r.status !== 'inactive',
  });

  it('renders a checkbox per selectable row plus a header checkbox', () => {
    table({ selection: sel([]) });
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
  });

  it('disables the checkbox for an unselectable row', () => {
    table({ selection: sel([]) });
    const boxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes[3]!.disabled).toBe(true);   // Kwame — inactive
  });

  it('shows the header checkbox indeterminate for a partial selection', () => {
    table({ selection: sel(['a']) });
    expect(screen.getAllByRole<HTMLInputElement>('checkbox')[0]!.indeterminate).toBe(true);
  });

  it('select-all covers only the SELECTABLE rows on this page', () => {
    // On a server-paginated table it cannot honestly mean 4,000 unloaded rows.
    const onChange = vi.fn();
    table({ selection: sel([], onChange) });
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
  });

  it('toggles a single row', () => {
    const onChange = vi.fn();
    table({ selection: sel(['a'], onChange) });
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('does not fire onRowClick when a checkbox is ticked', () => {
    // Otherwise ticking a row also opens the drawer over the list you are picking from.
    const onRowClick = vi.fn();
    table({ selection: sel([]), onRowClick });
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('shows the bulk bar with a count once something is selected', () => {
    table({
      selection: { ...sel(['a', 'b']), bulkActions: [{ id: 'x', label: 'Export', onSelect: vi.fn() }] },
    });
    expect(screen.getByRole('status').textContent).toContain('2 selected');
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
  });

  it('hides the bulk bar when nothing is selected', () => {
    table({ selection: { ...sel([]), bulkActions: [{ id: 'x', label: 'Export', onSelect: vi.fn() }] } });
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });
});

describe('DataTable — row actions', () => {
  const actions = (row: Row) => [
    { id: 'view', label: 'View', onSelect: vi.fn() },
    { id: 'del', label: 'Delete', tone: 'danger' as const, disabled: row.status === 'inactive', onSelect: vi.fn() },
  ];

  it('renders them through the canonical Button + Menu', () => {
    table({ rowActions: actions });
    const trigger = screen.getAllByRole('button', { name: /Actions for row/ })[0]!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Row actions' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('carries per-row disabled state into the menu', () => {
    table({ rowActions: actions });
    fireEvent.click(screen.getAllByRole('button', { name: /Actions for row/ })[2]!);  // Kwame
    expect(screen.getByRole('menuitem', { name: 'Delete' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('does not fire onRowClick when the actions cell is clicked', () => {
    const onRowClick = vi.fn();
    table({ rowActions: actions, onRowClick });
    fireEvent.click(screen.getAllByRole('button', { name: /Actions for row/ })[0]!);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('DataTable — states', () => {
  it('shows skeleton rows and marks itself busy while loading', () => {
    const { container } = table({ loading: true });
    expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('.ui-skeleton-row').length).toBeGreaterThan(0);
  });

  it('shows the empty state with its own copy', () => {
    table({ rows: [], emptyState: { title: 'No employees found', text: 'Try clearing the filters.' } });
    expect(screen.getByText('No employees found')).toBeTruthy();
  });

  it('shows an error state distinct from empty, with a retry', () => {
    // A failed request that renders "no results" makes the user retype forever.
    const onRetry = vi.fn();
    table({ error: 'The request timed out.', onRetry });
    expect(screen.getByText('The request timed out.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('prefers loading over error and empty', () => {
    table({ loading: true, error: 'boom', rows: [] });
    expect(screen.queryByText('boom')).toBeNull();
  });

  it('hides pagination while erroring — there is nothing to page through', () => {
    const { container } = table({ error: 'boom', pagination: { page: 1, pageSize: 25, total: 5, onPageChange: vi.fn() } });
    expect(container.querySelector('.ui-dt-pagination')).toBeNull();
  });
});

describe('DataTable — toolbar', () => {
  it('reports search changes without filtering rows itself', () => {
    const onChange = vi.fn();
    table({ search: { value: '', onChange, placeholder: 'Search people' } });
    fireEvent.input(screen.getByLabelText('Search people'), { target: { value: 'sar' } });
    expect(onChange).toHaveBeenCalledWith('sar');
    // Still every row: filtering is the caller's (or the server's) job.
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('shows an active-filter chip that clears its own value', () => {
    const onChange = vi.fn();
    table({
      filters: [{ id: 'dept', label: 'Department', values: ['HSE'], onChange,
        options: [{ value: 'HSE', label: 'HSE' }, { value: 'Ops', label: 'Operations' }] }],
    });
    fireEvent.click(screen.getByLabelText('Remove filter HSE'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('lets the column chooser hide a column but not an identity column', () => {
    const cols: DataTableColumn<Row>[] = [
      { ...COLUMNS[0]!, alwaysVisible: true },
      COLUMNS[1]!,
      COLUMNS[2]!,
    ];
    table({ columns: cols, columnChooser: true });
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    const boxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes[0]!.disabled).toBe(true);            // Name — always visible
    fireEvent.click(boxes[1]!);                       // hide Department
    expect(screen.queryByRole('columnheader', { name: 'Department' })).toBeNull();
  });
});
