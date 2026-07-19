/**
 * PayrollCommandCenter.loadingGate.test.tsx
 *
 * Proves the hard-reload loading gate: the Command Center reveals as ONE unit only
 * after ALL initial dependencies resolve — control-center data AND both widget-board
 * layouts AND the installed-widget registry — instead of painting the portfolio first
 * and letting the KPI/operational boards mount empty and fill in a beat later.
 *
 * Two layers:
 *  1. `commandCenterReady` truth table — the decision logic in isolation.
 *  2. A mounted sequencing test — with the RGL-backed `WidgetBoard` stubbed (react-grid-
 *     layout is CJS and can't render under vitest/jsdom; the tile render itself is verified
 *     via the prod build / browser). The stub is a render-spy, so we can assert the boards
 *     MOUNT only on reveal, never behind the skeleton.
 */
import { render, screen, cleanup } from '@testing-library/preact';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { commandCenterReady } from './PayrollCommandCenter';

// Shared, mutable scenario state — hoisted so the vi.mock factories (which run before the
// imports) can close over it. Each test sets the fields, then renders.
const H = vi.hoisted(() => ({
  cc: { data: undefined as unknown, isLoading: true, isError: false, error: null as unknown, isFetching: false, refetch: () => {} },
  mainLayoutLoading: true,
  kpiLayoutLoading: true,
  pkg: { isLoading: true, isSuccess: false },
  boardMounts: [] as string[],
}));

vi.mock('@api/finance/payroll/controlCenter', async orig => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, usePayrollControlCenter: () => H.cc };
});
// Mutations are unrelated to the gate — stub so no QueryClient/network is needed.
vi.mock('@api/finance/payroll', () => ({
  usePayrollMutation: () => ({ mutateAsync: vi.fn() }),
  financePayrollApi: {},
}));
vi.mock('./PayRunDrawer', () => ({ PayRunDrawer: () => null }));
vi.mock('./PayNewRunWizard', () => ({ PayNewRunWizard: () => null }));
// Stub the RGL board. It's a RENDER SPY (records the pageKey it mounts with) so the test can
// prove both boards mount only once the page is ready — never behind the skeleton.
vi.mock('@ui/widgets', () => ({
  WidgetBoard: (props: { pageKey: string }) => { H.boardMounts.push(props.pageKey); return null; },
  WidgetBoardToolbar: () => null,
  WidgetLibraryModal: () => null,
  useBoardLayout: (pageKey: string) => ({
    layout: { pageKey, zones: { main: [] } },
    isLoading: pageKey.includes('kpis') ? H.kpiLayoutLoading : H.mainLayoutLoading,
    addWidget: vi.fn(), setAsDefault: vi.fn(), resetLayout: vi.fn(), isDefaultDirty: false,
  }),
  useInstalledWidgetPackages: () => H.pkg,
  WIDGET_REGISTRY: [],
  commitPreviewWidget: vi.fn(),
}));

// A response complete enough for the eagerly-rendered surface (PortfolioBand, header actions,
// drawer props). Board tiles read more, but the board is stubbed so their render fns never run.
function fullData(): unknown {
  return {
    capabilities: { canCreateRun: true, canManageRun: true, canApprove: true },
    portfolioHealth: { state: 'healthy', criticalCount: 0, atRiskCount: 0, primaryIntervention: null, openBlockerCount: 0, overdueActionCount: 0 },
    kpis: {
      funding: { required: { amount: 0 }, gap: { amount: 0 }, state: 'confirmed' },
      nextPayDate: { date: null, runNo: null, runId: null },
      activeRuns: 0, employeesDue: 0, grossPayroll: { amount: 0 }, netPayroll: { amount: 0 },
    },
    upcomingDeadlines: [],
    runRegister: { tabCounts: { approval: 0 }, items: [] },
  };
}

// The four gate inputs, defaulting to "still loading". Override per scenario.
function setScenario(o: { data?: unknown; mainLayoutLoading?: boolean; kpiLayoutLoading?: boolean; pkgLoading?: boolean }): void {
  H.cc = { ...H.cc, data: o.data, isLoading: o.data === undefined, isError: false };
  H.mainLayoutLoading = o.mainLayoutLoading ?? false;
  H.kpiLayoutLoading = o.kpiLayoutLoading ?? false;
  H.pkg = { isLoading: o.pkgLoading ?? false, isSuccess: !(o.pkgLoading ?? false) };
}

const skeletonShown = (c: Element): boolean => !!c.querySelector('.pcc-skel-band') || !!c.querySelector('.pcc-skel-head');

beforeEach(() => {
  H.cc = { data: undefined, isLoading: true, isError: false, error: null, isFetching: false, refetch: () => {} };
  H.mainLayoutLoading = true; H.kpiLayoutLoading = true; H.pkg = { isLoading: true, isSuccess: false };
  H.boardMounts = [];
});
afterEach(() => cleanup());

describe('commandCenterReady (gate logic)', () => {
  const base = { hasData: true, mainLayoutLoading: false, kpiLayoutLoading: false, registryLoading: false };
  it('is ready only when data + both layouts + registry have all resolved', () => {
    expect(commandCenterReady(base)).toBe(true);
  });
  it('is NOT ready while the control-center data is still loading', () => {
    expect(commandCenterReady({ ...base, hasData: false })).toBe(false);
  });
  it('is NOT ready while the main board layout is still loading', () => {
    expect(commandCenterReady({ ...base, mainLayoutLoading: true })).toBe(false);
  });
  it('is NOT ready while the KPI board layout is still loading', () => {
    expect(commandCenterReady({ ...base, kpiLayoutLoading: true })).toBe(false);
  });
  it('is NOT ready while the installed-widget registry is still loading', () => {
    expect(commandCenterReady({ ...base, registryLoading: true })).toBe(false);
  });
});

describe('PayrollCommandCenter — skeleton-to-content sequencing', () => {
  // Import lazily so the vi.mock factories are registered first.
  async function renderPage() {
    const { PayrollCommandCenter } = await import('./PayrollCommandCenter');
    return render(<PayrollCommandCenter />);
  }

  it('1. shows only the skeleton initially (everything loading)', async () => {
    const { container } = await renderPage();
    expect(skeletonShown(container)).toBe(true);
    expect(screen.queryByLabelText('Payroll portfolio health')).toBeNull();
    expect(screen.queryByText('Payroll Command Center')).toBeNull();   // real header hidden
    expect(H.boardMounts).toEqual([]);                                  // boards not mounted
  });

  it('2. data arriving alone does NOT reveal content (layouts + registry still loading)', async () => {
    setScenario({ data: fullData(), mainLayoutLoading: true, kpiLayoutLoading: true, pkgLoading: true });
    const { container } = await renderPage();
    expect(skeletonShown(container)).toBe(true);
    expect(screen.queryByLabelText('Payroll portfolio health')).toBeNull();
    expect(H.boardMounts).toEqual([]);
  });

  it('3a. one unresolved board layout keeps the skeleton visible', async () => {
    setScenario({ data: fullData(), mainLayoutLoading: false, kpiLayoutLoading: true, pkgLoading: false });
    const { container } = await renderPage();
    expect(skeletonShown(container)).toBe(true);
    expect(H.boardMounts).toEqual([]);
  });

  it('3b. an unresolved installed-widget registry keeps the skeleton visible', async () => {
    setScenario({ data: fullData(), mainLayoutLoading: false, kpiLayoutLoading: false, pkgLoading: true });
    const { container } = await renderPage();
    expect(skeletonShown(container)).toBe(true);
    expect(H.boardMounts).toEqual([]);
  });

  it('4. once data + both layouts + registry resolve, header, portfolio and BOTH boards reveal together', async () => {
    setScenario({ data: fullData(), mainLayoutLoading: false, kpiLayoutLoading: false, pkgLoading: false });
    const { container } = await renderPage();
    expect(skeletonShown(container)).toBe(false);                              // skeleton gone
    expect(screen.getByLabelText('Payroll portfolio health')).toBeTruthy();    // portfolio band
    expect(screen.getByText('Payroll Command Center')).toBeTruthy();           // real header
    expect(screen.getByText('New Payroll Run')).toBeTruthy();                  // data-dependent action, revealed WITH content
    expect(H.boardMounts).toContain('finance.payroll.commandCenter.v3');       // main board
    expect(H.boardMounts).toContain('finance.payroll.commandCenter.kpis.v1');  // KPI board
  });
});
