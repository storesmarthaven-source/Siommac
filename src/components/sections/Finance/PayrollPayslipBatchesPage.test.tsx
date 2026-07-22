/**
 * PayrollPayslipBatchesPage.test.tsx — F-10 batch register unit coverage.
 *
 *  PSB1  KPI strip shows the aggregates; tabs show tabCounts.
 *  PSB2  A batch row renders reference / counts / lifecycle pill.
 *  PSB3  Empty items → the empty state.
 *
 * usePayslipBatches + usePayGroups are mocked so the page renders deterministically.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import type { PayslipBatchListResult, PayslipBatchListItem } from '@api/finance/payrollPayslipBatches';

const mockQ = vi.fn<(req: unknown) => unknown>();
vi.mock('@api/finance/payrollPayslipBatches', () => ({ usePayslipBatches: (req: unknown) => mockQ(req) }));
vi.mock('@api/finance/payroll', () => ({ usePayGroups: () => ({ data: [] }) }));

import { PayrollPayslipBatchesPage } from './PayrollPayslipBatchesPage';

function batch(over: Partial<PayslipBatchListItem> = {}): PayslipBatchListItem {
  return {
    id: 'run-1', reference: 'PAY-2026-07-M01', runState: 'locked',
    payGroup: { id: 'pg-1', name: 'Monthly Salaried' }, payDate: '2026-07-31',
    template: { id: 't-1', name: 'Standard v6', status: 'approved' },
    counts: { generated: 302, rendered: 301, delivered: 298, failed: 1 },
    lifecycle: 'attention', lifecycleLabel: 'Needs Action',
    owner: { id: 'u-1', name: 'Maya Joseph' }, createdAt: '2026-07-31T16:48:00Z', updatedAt: '2026-07-31T16:48:00Z',
    ...over,
  };
}
function result(over: Partial<PayslipBatchListResult> = {}): PayslipBatchListResult {
  return {
    items: [batch()], total: 1,
    tabCounts: { all: 12, active: 3, attention: 2, scheduled: 1, completed: 8 },
    aggregates: { activeBatches: 6, rendered: 1416, delivered: 1408, failed: 3 },
    asOf: '2026-07-31T17:00:00Z', ...over,
  };
}
const asQuery = (data: PayslipBatchListResult | undefined) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });

describe('F-10 PayrollPayslipBatchesPage', () => {
  it('PSB1 — KPI aggregates + tab counts render', () => {
    mockQ.mockReturnValue(asQuery(result()));
    render(<PayrollPayslipBatchesPage />);
    expect(screen.getByText('Active Batches')).toBeTruthy();
    expect(screen.getByText('1,416')).toBeTruthy();   // rendered aggregate
    expect(screen.getByText('1,408')).toBeTruthy();   // delivered aggregate
    expect(screen.getByText('In Progress')).toBeTruthy();  // tab label (unambiguous)
    expect(screen.getByText('8')).toBeTruthy();        // completed tab count
  });

  it('PSB2 — a batch row shows its reference, counts and lifecycle', () => {
    mockQ.mockReturnValue(asQuery(result()));
    render(<PayrollPayslipBatchesPage />);
    expect(screen.getByText('PAY-2026-07-M01')).toBeTruthy();
    expect(screen.getByText('302')).toBeTruthy();           // generated
    expect(screen.getByText('Standard v6')).toBeTruthy();   // template
    // lifecycle pill label (also appears as the Needs Action tab, so use getAllByText)
    expect(screen.getAllByText('Needs Action').length).toBeGreaterThan(1);
    expect(screen.getByText(/298 delivered/)).toBeTruthy();
  });

  it('PSB3 — empty items renders the empty state', () => {
    mockQ.mockReturnValue(asQuery(result({ items: [], total: 0 })));
    render(<PayrollPayslipBatchesPage />);
    expect(screen.getByText('No payslip batches match this view')).toBeTruthy();
  });
});
