/**
 * WP-6 / §9.11 — run-workspace tab ARIA + keyboard contract:
 *   tablist/tab/tabpanel roles, aria-selected, aria-controls, roving tabindex,
 *   ArrowRight/ArrowLeft/Home/End navigation, breadcrumbs are real buttons.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';

const q = (over: Record<string, unknown> = {}) => ({
  data: undefined, error: null, isLoading: false, isError: false, refetch: vi.fn(), ...over,
});
const hooks = vi.hoisted(() => ({
  usePayrollRun: vi.fn(),
  useRunWorkspace: vi.fn(),
  useReleasePreflight: vi.fn(),
}));
vi.mock('@api/finance/payroll', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePayrollRun: hooks.usePayrollRun,
  useRunWorkspace: hooks.useRunWorkspace,
  useReleasePreflight: hooks.useReleasePreflight,
}));

import { PayRunDetailPage } from '../PayRunDetailPage';

const drawerActions = new Proxy({}, { get: () => vi.fn() }) as never;
const noActions = {
  canLockInputs: false, canCalculate: false, canCertify: false, canSubmit: false,
  canApprove: false, canReject: false, canLock: false, canReopen: false,
  canConfirmFunding: false, canRelease: false, canGeneratePayslips: false,
  canDistributePayslips: false, canPreviewGl: false, canPostGl: false, canExport: false,
  disabledReasons: {},
};
function makeRun() {
  return {
    id: 'run-1', runNo: 'PAY-2026-07-M01', periodMonth: '2026-07-01', status: 'draft',
    runType: 'scheduled', payFrequency: 'monthly', weeksInPeriod: 4.333,
    employeeCount: 3, grossTotal: 1000, deductionTotal: 100, netTotal: 900,
    createdBy: 'u-1', approvedBy: null, payGroup: null, payGroupId: null,
    payDate: null, cutOffDate: null, payPolicy: null,
  };
}
function makeWorkspace() {
  return {
    run: makeRun(), inputSnapshot: null, currentCalculationVersion: null, calculationAttempts: [],
    findingSummary: { total: 0, actionable: 0, blockers: 0, warnings: 0, info: 0, byState: {}, byDomain: {} },
    priorityFindings: [], audit: [], actions: noActions,
  };
}
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PayRunDetailPage runId="run-1" onBack={vi.fn()} canManage canApprove actions={drawerActions} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  hooks.usePayrollRun.mockReturnValue(q({ data: makeRun() }));
  hooks.useRunWorkspace.mockReturnValue(q({ data: makeWorkspace() }));
  hooks.useReleasePreflight.mockReturnValue(q());
});

describe('WP-6 run-workspace tabs ARIA + keyboard', () => {
  it('renders tablist/tab/tabpanel with aria-selected, aria-controls and roving tabindex', () => {
    renderPage();
    const tablist = screen.getByRole('tablist');
    expect(tablist.getAttribute('aria-label')).toBe('Payroll run sections');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(8);
    const selected = tabs.filter(t => t.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(1);
    expect(selected[0]!.textContent).toContain('Summary');
    expect(selected[0]!.getAttribute('tabindex')).toBe('0');
    expect(tabs.find(t => t.getAttribute('aria-selected') !== 'true')!.getAttribute('tabindex')).toBe('-1');
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe('run-tabpanel');
    expect(selected[0]!.getAttribute('aria-controls')).toBe('run-tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('run-tab-summary');
  });

  it('ArrowRight moves selection; Home/End jump to first/last; panel follows', () => {
    renderPage();
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab').find(t => t.getAttribute('aria-selected') === 'true')!.textContent)
      .toContain('Population');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('run-tab-population');
    fireEvent.keyDown(tablist, { key: 'End' });
    expect(screen.getAllByRole('tab').find(t => t.getAttribute('aria-selected') === 'true')!.textContent)
      .toContain('Audit');
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(screen.getAllByRole('tab').find(t => t.getAttribute('aria-selected') === 'true')!.textContent)
      .toContain('Summary');
  });

  it('ArrowLeft from the first tab wraps to the last', () => {
    renderPage();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(screen.getAllByRole('tab').find(t => t.getAttribute('aria-selected') === 'true')!.textContent)
      .toContain('Audit');
  });

  it('breadcrumbs are real buttons (keyboard + AT reachable), not href-less anchors', () => {
    renderPage();
    const crumb = screen.getByRole('button', { name: 'Payroll runs' });
    expect(crumb.tagName).toBe('BUTTON');
  });
});
