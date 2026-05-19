/**
 * DataTable.test.tsx
 *
 * DataTables requires jQuery which is a CDN global — we stub it here.
 * We test the Preact wrapper's behaviour, not the DataTables library itself.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen }                        from '@testing-library/preact';
import { DataTable }                              from './DataTable';

// Stub the jQuery DataTable API
const mockDestroy   = vi.fn();
const mockDataTable = vi.fn(() => ({ destroy: mockDestroy }));

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).$ = Object.assign(
    vi.fn(() => ({ DataTable: mockDataTable })),
    { fn: {} },
  );
  mockDataTable.mockClear();
  mockDestroy.mockClear();
});

const COLUMNS = [
  { title: 'Name',   data: 'name'   as const },
  { title: 'Status', data: 'status' as const },
];

const DATA = [
  { name: 'Alice', status: 'active'   },
  { name: 'Bob',   status: 'inactive' },
];

describe('DataTable', () => {
  it('shows a spinner when loading=true', () => {
    render(<DataTable id="t1" columns={COLUMNS} data={[]} loading />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByLabelText('Loading table data…')).toBeTruthy();
  });

  it('shows the empty message when data is empty and not loading', () => {
    render(<DataTable id="t2" columns={COLUMNS} data={[]} emptyMessage="Nothing here." />);
    expect(screen.getByText('Nothing here.')).toBeTruthy();
  });

  it('renders a table when data is present', () => {
    render(<DataTable id="t3" columns={COLUMNS} data={DATA} />);
    expect(document.getElementById('t3')).toBeTruthy();
  });

  it('initialises DataTables with the correct columns', () => {
    render(<DataTable id="t4" columns={COLUMNS} data={DATA} />);
    expect(mockDataTable).toHaveBeenCalledOnce();
    const call = mockDataTable.mock.calls[0];
    const opts = (call as unknown as [{ columns: { title: string }[] }])[0];
    expect(opts.columns.map((c) => c.title)).toEqual(['Name', 'Status']);
  });

  it('destroys the DataTable instance on unmount', () => {
    const { unmount } = render(<DataTable id="t5" columns={COLUMNS} data={DATA} />);
    unmount();
    expect(mockDestroy).toHaveBeenCalledOnce();
  });

  it('reinitialises when data changes', () => {
    const { rerender } = render(<DataTable id="t6" columns={COLUMNS} data={DATA} />);
    expect(mockDataTable).toHaveBeenCalledTimes(1);
    rerender(<DataTable id="t6" columns={COLUMNS} data={[...DATA, { name: 'Carol', status: 'active' }]} />);
    expect(mockDestroy).toHaveBeenCalledOnce();
    expect(mockDataTable).toHaveBeenCalledTimes(2);
  });
});
