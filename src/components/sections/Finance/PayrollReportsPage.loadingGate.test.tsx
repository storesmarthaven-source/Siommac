/**
 * PayrollReportsPage.loadingGate.test.tsx
 *
 * Proves the F-12 Reports Center §5.1 UX contract:
 *  1. `reportsBoardCold` gate logic in isolation (truth table).
 *  2. A mounted sequencing test — the KPI board + catalog reveal as ONE unit only
 *     after BOTH the summary and catalog resolve (never a flash of empty/0 tiles).
 *  3. The focus-trapped Run dialog opens on a catalog click, with submit disabled
 *     until the parameters are valid.
 *
 * TanStack Query + the api layer are stubbed (per queryKey) so no network/QueryClient
 * is needed; the shared Modal renders for real (portal into document.body).
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportsBoardCold } from './PayrollReportsPage';

interface QResult { data: unknown; isLoading: boolean; isError: boolean; error: unknown }
const H = vi.hoisted((): { summary: QResult; catalog: QResult; history: QResult } => ({
  summary: { data: undefined, isLoading: true, isError: false, error: null },
  catalog: { data: undefined, isLoading: true, isError: false, error: null },
  history: { data: undefined, isLoading: true, isError: false, error: null },
}));

vi.mock('@tanstack/preact-query', () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const key = opts.queryKey[2];
    if (key === 'summary') return H.summary;
    if (key === 'catalog') return H.catalog;
    if (key === 'history') return H.history;
    return { data: undefined, isLoading: false, isError: false, error: null }; // status
  },
  useMutation: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, data: undefined, error: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@api/finance/payroll', () => ({ financePayrollApi: {} }));
vi.mock('@api/finance/payrollRunsRegister', () => ({ useRunsRegister: () => ({ data: { items: [] } }) }));
vi.mock('@lib/dialog', () => ({ dialog: { success: vi.fn(), error: vi.fn() } }));

function readySummary(): unknown {
  return {
    availableReports:  { value: 8, available: true },
    generatedThisMonth:{ value: 0, available: true },
    nisExceptions:     { value: null, available: false },
    materialVariances: { value: null, available: false },
    auditPackages:     { value: null, available: false },
  };
}
function readyCatalog(): unknown {
  return { reports: [{
    key: 'payroll_register', label: 'Payroll Register', description: 'Per-employee register.',
    category: 'operational', supportedFormats: ['preview', 'csv', 'pdf'], paramKind: 'single_run',
    requiresViewAll: true, requiresExport: false,
  }] };
}

function setReady(): void {
  H.summary = { data: readySummary(), isLoading: false, isError: false, error: null };
  H.catalog = { data: readyCatalog(), isLoading: false, isError: false, error: null };
  H.history = { data: { rows: [], nextCursor: null }, isLoading: false, isError: false, error: null };
}

beforeEach(() => {
  H.summary = { data: undefined, isLoading: true, isError: false, error: null };
  H.catalog = { data: undefined, isLoading: true, isError: false, error: null };
  H.history = { data: undefined, isLoading: true, isError: false, error: null };
});
afterEach(() => cleanup());

describe('reportsBoardCold (gate logic)', () => {
  const ready = { hasSummary: true, hasCatalog: true, summaryError: false, catalogError: false };
  it('is NOT cold once both summary + catalog have resolved', () => {
    expect(reportsBoardCold(ready)).toBe(false);
  });
  it('is cold while the summary is still loading', () => {
    expect(reportsBoardCold({ ...ready, hasSummary: false })).toBe(true);
  });
  it('is cold while the catalog is still loading', () => {
    expect(reportsBoardCold({ ...ready, hasCatalog: false })).toBe(true);
  });
  it('reveals (not cold) on error so the error banner can show', () => {
    expect(reportsBoardCold({ hasSummary: false, hasCatalog: false, summaryError: true, catalogError: false })).toBe(false);
  });
});

describe('PayrollReportsPage — skeleton-to-content + Run dialog', () => {
  async function renderPage() {
    const { PayrollReportsPage } = await import('./PayrollReportsPage');
    return render(<PayrollReportsPage />);
  }

  it('1. shows only skeletons while summary/catalog load (no tiles, no catalog, no fake 0)', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('.prc-cat-sk')).toBeTruthy();     // catalog skeleton
    expect(container.querySelector('.prc-kpi')).toBeNull();          // no REAL kpi tile
    expect(screen.queryByText('Payroll Register')).toBeNull();       // catalog hidden
  });

  it('2. once summary + catalog resolve, the KPI board and catalog reveal together', async () => {
    setReady();
    const { container } = await renderPage();
    expect(container.querySelector('.prc-cat-sk')).toBeNull();       // skeleton gone
    expect(container.querySelectorAll('.prc-kpi').length).toBe(5);   // 5 real tiles
    expect(screen.getByText('Payroll Register')).toBeTruthy();       // catalog revealed
  });

  it('3. clicking a report opens the focus-trapped Run dialog; submit is disabled until valid', async () => {
    setReady();
    await renderPage();
    fireEvent.click(screen.getByText('Payroll Register'));
    const dlg = await screen.findByRole('dialog');
    expect(dlg).toBeTruthy();
    const runBtn = screen.getByText('Run preview').closest('button');
    expect(runBtn?.disabled).toBe(true);                            // no run selected yet
  });
});
