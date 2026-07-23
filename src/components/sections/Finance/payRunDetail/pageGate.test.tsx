/**
 * WP-4 (P0-6) — PayRunDetailPage atomic required-query gate:
 *   G1 while run/workspace load → ONE page skeleton; no header, no zero-count metrics
 *   G2 a required-query failure → page error band (typed code + correlation id) + Retry;
 *      never a "clean run with zero blockers"
 *   G3 settled → content renders with REAL workspace counts
 *   G4 release preflight is requested ONLY for approved/locked/released/exported states
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/preact';

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

import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { PayRunDetailPage } from '../PayRunDetailPage';
// Typed error built from the REAL class exported by the (partially mocked) api module.
import * as payrollApi from '@api/finance/payroll';

// Post-gate panels use real TanStack hooks (e.g. useEmployeeNames) — provide a client.
function renderPage(props: Parameters<typeof PayRunDetailPage>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return render(<QueryClientProvider client={qc}><PayRunDetailPage {...props} /></QueryClientProvider>);
}

const drawerActions = new Proxy({}, { get: () => vi.fn() }) as never;

function makeRun(over: Record<string, unknown> = {}) {
  return {
    id: 'run-1', runNo: 'PAY-2026-07-M01', periodMonth: '2026-07-01', status: 'calculation_failed',
    runType: 'scheduled', payFrequency: 'monthly', weeksInPeriod: 4.333,
    employeeCount: 3, grossTotal: 1000, deductionTotal: 100, netTotal: 900,
    createdBy: 'u-1', approvedBy: null, payGroup: null, payGroupId: null,
    payDate: null, cutOffDate: null, payPolicy: null, ...over,
  };
}
function makeWorkspace() {
  return {
    run: makeRun(), inputSnapshot: null, currentCalculationVersion: null,
    calculationAttempts: [{
      id: 'att-1', runId: 'run-1', inputSnapshotId: 'snap-1', attemptNo: 2, status: 'failed',
      stage: 'statutory', progress: 40, correlationId: 'corr-run-1-2', errorCode: 'calculation.failed',
      errorMessage: 'x', createdBy: 'u-1', startedAt: '2026-07-28T10:42:03Z',
      leaseExpiresAt: '2026-07-28T10:47:03Z', completedAt: '2026-07-28T10:42:26Z',
    }],
    findingSummary: { total: 2, actionable: 2, blockers: 2, warnings: 0, info: 0, byState: {}, byDomain: {} },
    priorityFindings: [],
    audit: [],
    actions: {
      canLockInputs: false, canCalculate: true, canCertify: false, canSubmit: false,
      canApprove: false, canReject: false, canLock: false, canReopen: false,
      canConfirmFunding: false, canRelease: false, canGeneratePayslips: false,
      canDistributePayslips: false, canPreviewGl: false, canPostGl: false, canExport: false,
      disabledReasons: {},
    },
  };
}
const pageProps = { runId: 'run-1', onBack: vi.fn(), canManage: true, canApprove: true, actions: drawerActions };

beforeEach(() => {
  hooks.usePayrollRun.mockReset();
  hooks.useRunWorkspace.mockReset();
  hooks.useReleasePreflight.mockReset();
  hooks.useReleasePreflight.mockReturnValue(q());
});

describe('P0-6 PayRunDetailPage atomic gate', () => {
  it('G1 — loading required queries shows ONE stable skeleton; no metrics, no fake zeros', () => {
    hooks.usePayrollRun.mockReturnValue(q({ isLoading: true }));
    hooks.useRunWorkspace.mockReturnValue(q({ isLoading: true }));
    renderPage(pageProps);
    expect(screen.getByRole('status')).toBeTruthy();               // one page skeleton
    expect(screen.queryByText('Blockers')).toBeNull();             // no metric strip yet
    expect(screen.queryByText('PAY-2026-07-M01')).toBeNull();      // no header yet
  });

  it('G2 — a required-query failure renders the page error band with correlation id + Retry (never zero blockers)', () => {
    hooks.usePayrollRun.mockReturnValue(q({ data: makeRun() }));
    const wsErr = new payrollApi.PayrollApiError({
      code: 'payroll.error', message: 'workspace unavailable', correlationId: 'corr-ws-1', retryable: true,
    });
    const wsRefetch = vi.fn();
    hooks.useRunWorkspace.mockReturnValue(q({ isError: true, error: wsErr, refetch: wsRefetch }));
    renderPage(pageProps);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/payroll\.error · ref corr-ws-1/)).toBeTruthy();
    expect(screen.queryByText('Blockers')).toBeNull();             // API failure ≠ clean zero-blocker run
    screen.getByText('Retry').click();
    expect(wsRefetch).toHaveBeenCalled();
  });

  it('G3 — settled queries reveal the workspace with REAL counts', () => {
    hooks.usePayrollRun.mockReturnValue(q({ data: makeRun() }));
    hooks.useRunWorkspace.mockReturnValue(q({ data: makeWorkspace() }));
    renderPage(pageProps);
    expect(screen.getAllByText('PAY-2026-07-M01').length).toBeGreaterThan(0);
    expect(screen.getByText('Blockers')).toBeTruthy();             // real metric strip, count=2 from workspace
  });

  it('G4 — release preflight is requested only for release-relevant states', () => {
    hooks.usePayrollRun.mockReturnValue(q({ data: makeRun({ status: 'draft' }) }));
    hooks.useRunWorkspace.mockReturnValue(q({ data: makeWorkspace() }));
    renderPage(pageProps);
    expect(hooks.useReleasePreflight).toHaveBeenCalledWith(null);  // draft → not fetched

    hooks.useReleasePreflight.mockClear();
    hooks.usePayrollRun.mockReturnValue(q({ data: makeRun({ status: 'locked' }) }));
    hooks.useReleasePreflight.mockReturnValue(q({ data: { blockers: [], ready: true } }));
    renderPage(pageProps);
    expect(hooks.useReleasePreflight).toHaveBeenCalledWith('run-1'); // locked → fetched
  });
});
