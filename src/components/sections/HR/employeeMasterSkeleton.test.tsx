// @vitest-environment jsdom
/**
 * src/components/sections/HR/employeeMasterSkeleton.test.tsx
 *
 * Employee Master cold-state regressions.
 *
 * Three things went wrong on this page and are pinned here:
 *   1. the skeleton was a hard-coded shape (`kpiCount=6 widgetCount=3`) instead of the
 *      saved board — so it now must be built from the SAME layout the boards render;
 *   2. the skeleton could hand over before every dataset the board renders had
 *      arrived, so widgets flashed their own card skeletons after the page skeleton
 *      had already gone;
 *   3. the loaded board must NOT play an entrance reveal on top of that hand-over.
 *
 * `WidgetBoard` is mocked because the react-grid-layout stack is CJS-only and cannot
 * render under vitest (see vitest.config.ts) — the mock records the props the page
 * passes, which is exactly what claims 1 and 3 are about.
 */

import { render } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import type { VNode } from 'preact';
import type { BoardLayout, WidgetInstance } from '@ui/widgets';

const COLUMNS = 24;
const KPI_PAGE_KEY = 'hr.employees.overview.kpis.v2';
const PAGE_KEY = 'hr.employees.overview.v3';

function inst(widgetId: string, x: number, y: number, w: number, h: number, pageKey: string): WidgetInstance {
  return { instanceId: `${widgetId}#saved`, widgetId, pageKey, zoneId: 'main', x, y, w, h, sizeKey: 'standard', config: {} };
}

/** The user's SAVED workspace: 6 KPI tiles + 13 board widgets = 19 instances. */
const SAVED_KPI: WidgetInstance[] = [
  'activeWorkforce', 'recordReadiness', 'hrWorkQueue', 'exceptions', 'monthlyHiresCard', 'departures',
].map((name, index) => inst(`hr.employeeMaster.${name}`, index * 4, 0, 4, 6, KPI_PAGE_KEY));

const SAVED_BOARD: WidgetInstance[] = [
  inst('hr.employeeMaster.lifecycleActivity', 0, 0, 12, 28, PAGE_KEY),
  inst('enterprise.calendar.upcomingDeadlines', 12, 0, 6, 28, PAGE_KEY),
  inst('hr.employeeMaster.weeklyActivity', 18, 0, 6, 28, PAGE_KEY),
  inst('hr.employeeMaster.recordHealth', 0, 28, 8, 22, PAGE_KEY),
  inst('hr.employeeMaster.readinessRadar', 8, 28, 8, 22, PAGE_KEY),
  inst('hr.employeeMaster.recordRisk', 16, 28, 8, 22, PAGE_KEY),
  inst('hr.employeeMaster.weeklyActivity', 0, 50, 10, 22, PAGE_KEY),
  inst('hr.employeeMaster.changeTrend', 10, 50, 10, 22, PAGE_KEY),
  inst('hr.employeeMaster.recordQuality', 20, 50, 4, 22, PAGE_KEY),
  inst('hr.employeeMaster.blockedActions', 0, 72, 10, 28, PAGE_KEY),
  inst('hr.employeeMaster.employeeAttentionNeutral', 10, 72, 8, 28, PAGE_KEY),
  inst('enterprise.calendar.taskPlanner', 18, 72, 6, 28, PAGE_KEY),
  inst('hr.employees.register', 0, 100, 24, 50, PAGE_KEY),
];

// ── Mutable test state the mocked hooks read ──────────────────────────────────
interface Phase { listLoading: boolean; statsLoading: boolean; rosterLoading: boolean; deadlineLoading: boolean; layoutLoading: boolean }
const phase: Phase = { listLoading: true, statsLoading: true, rosterLoading: true, deadlineLoading: true, layoutLoading: false };
const savedZones: { kpi: WidgetInstance[]; board: WidgetInstance[] } = { kpi: SAVED_KPI, board: SAVED_BOARD };

const boardProps: Record<string, unknown>[] = [];

vi.mock('@ui/widgets', async importOriginal => {
  const actual = await importOriginal<typeof import('@ui/widgets')>();
  const layoutFor = (pageKey: string): BoardLayout => ({
    pageKey,
    columns: COLUMNS,
    zones: { main: phase.layoutLoading ? [] : (pageKey === KPI_PAGE_KEY ? savedZones.kpi : savedZones.board) },
  });
  return {
    ...actual,
    useBoardLayout: (pageKey: string) => ({
      layout: layoutFor(pageKey),
      isLoading: phase.layoutLoading,
      isDefaultDirty: false,
      isDirty: false,
      isSaving: false,
      updateZoneLayout: vi.fn(() => Promise.resolve()),
      addWidget: vi.fn(() => Promise.resolve()),
      removeWidget: vi.fn(() => Promise.resolve()),
      saveLayout: vi.fn(() => Promise.resolve(true)),
      cancelLayout: vi.fn(() => Promise.resolve()),
      setAsDefault: vi.fn(() => Promise.resolve()),
      resetLayout: vi.fn(() => Promise.resolve()),
    }),
    WidgetBoard: (props: Record<string, unknown>) => {
      boardProps.push(props);
      return <div data-testid="widget-board" data-page-key={String(props.pageKey)} />;
    },
    WidgetLibraryModal: () => null,
    WidgetBoardToolbar: () => null,
  };
});

const listQuery = (): unknown => ({
  data: phase.listLoading ? undefined : { rows: [], meta: { total: 0, departments: [], statuses: [], employmentTypes: [], trainingStatuses: [] } },
  meta: undefined,
  isLoading: phase.listLoading,
  isFetching: phase.listLoading,
  isError: false,
  error: undefined,
  refetch: vi.fn(() => Promise.resolve(undefined)),
});

vi.mock('@api/hr/employees', async importOriginal => {
  const actual = await importOriginal<typeof import('@api/hr/employees')>();
  return {
    ...actual,
    useHrEmployeesPage: (args: { statuses?: string[] }) =>
      // The attention-roster warm-up asks for a DIFFERENT slice than the register.
      (args.statuses?.[0] === 'active' && args.statuses.length === 1
        ? { ...(listQuery() as object), isLoading: phase.rosterLoading }
        : listQuery()),
    useHrDashboardStats: () => ({ data: undefined, isLoading: phase.statsLoading, isError: false, error: undefined, isFetching: false, refetch: vi.fn() }),
    usePrefetchHrEmployee: () => vi.fn(),
  };
});

vi.mock('@api/hr/employeeProfile', async importOriginal => ({
  ...await importOriginal<typeof import('@api/hr/employeeProfile')>(),
  usePrefetchEmployeeProfileShell: () => vi.fn(),
}));

vi.mock('@ui/widgets/registry.calendarPlanning', async importOriginal => ({
  ...await importOriginal<typeof import('@ui/widgets/registry.calendarPlanning')>(),
  useDeadlineWindowQuery: () => ({
    query: { data: undefined, isLoading: phase.deadlineLoading, isError: false, error: undefined, isFetching: false, refetch: vi.fn() },
  }),
}));

vi.mock('@api/uiPreferences', () => ({
  getUiPreference: vi.fn(() => Promise.resolve(null)),
  saveUiPreference: vi.fn(() => Promise.resolve()),
}));

vi.mock('@lib/permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@lib/permissions')>(),
  can: () => true,
  useAnyCan: () => true,
}));

// Imported after the mocks are registered.
const { EmployeeMaster } = await import('./EmployeeMaster');

function setPhase(next: Partial<Phase>): void { Object.assign(phase, next); }
const allReady: Partial<Phase> = { listLoading: false, statsLoading: false, rosterLoading: false, deadlineLoading: false, layoutLoading: false };

/** The LOADED page mounts the profile drawer, which owns its own record query. */
function withClient(node: VNode): VNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

beforeEach(() => {
  boardProps.length = 0;
  savedZones.kpi = SAVED_KPI;
  savedZones.board = SAVED_BOARD;
  setPhase({ listLoading: true, statsLoading: true, rosterLoading: true, deadlineLoading: true, layoutLoading: false });
});

afterEach(() => { localStorage.clear(); });

describe('Employee Master cold state', () => {
  it('mirrors all 19 saved widget instances instead of a hard-coded count', () => {
    const { container } = render(withClient(<EmployeeMaster />));

    expect(container.querySelector('[data-testid="employee-master-skeleton"]')).not.toBeNull();
    expect(container.querySelectorAll('.ui-widget-skeleton')).toHaveLength(19);
    expect([...container.querySelectorAll<HTMLElement>('.wbi-skeleton-zone')]
      .map(zone => zone.dataset.skeletonCount)).toEqual(['6', '13']);
  });

  it('follows a rearranged or reduced saved board with no page change', () => {
    savedZones.kpi = SAVED_KPI.slice(0, 4);
    savedZones.board = [{ ...SAVED_BOARD[12]!, x: 0, y: 0 }, ...SAVED_BOARD.slice(0, 6)];

    const { container } = render(withClient(<EmployeeMaster />));

    expect(container.querySelectorAll('.ui-widget-skeleton')).toHaveLength(11);
    const first = container.querySelectorAll<HTMLElement>('.wbi-skeleton-zone')[1]
      ?.querySelector<HTMLElement>('.wbi-skeleton-item');
    expect(first?.dataset.widgetId).toBe('hr.employees.register');
    expect(first?.style.gridRow).toBe('1 / span 50');
  });

  it.each([
    ['the register page', { listLoading: true }],
    ['the dashboard stats', { statsLoading: true }],
    ['the attention roster', { rosterLoading: true }],
    ['the deadline window', { deadlineLoading: true }],
    ['the saved layout', { layoutLoading: true }],
  ])('holds the skeleton while %s is still loading', (_label, pending) => {
    setPhase({ ...allReady, ...pending });
    const { container } = render(withClient(<EmployeeMaster />));

    expect(container.querySelector('[data-testid="employee-master-skeleton"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="widget-board"]')).toBeNull();
    expect(container.querySelector('[data-testid="employee-register"]')).toBeNull();
  });

  it('hands over to the loaded board in one transition — never both at once', () => {
    const { container, rerender } = render(withClient(<EmployeeMaster />));
    expect(container.querySelector('[data-testid="employee-master-skeleton"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="widget-board"]')).toBeNull();

    setPhase(allReady);
    rerender(withClient(<EmployeeMaster />));

    expect(container.querySelector('[data-testid="employee-master-skeleton"]')).toBeNull();
    expect(container.querySelectorAll('.wbi-skeleton-zone')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="widget-board"]')).toHaveLength(2);
  });

  it('announces one busy region for the whole page rather than per widget', () => {
    const { container } = render(withClient(<EmployeeMaster />));
    const root = container.querySelector('[data-testid="employee-master-skeleton"]');

    expect(root?.getAttribute('aria-busy')).toBe('true');
    expect(root?.getAttribute('role')).toBe('status');
    // Each placeholder tile is aria-hidden, so the page is announced once.
    expect([...container.querySelectorAll('.wbi-skeleton-zone')]
      .every(zone => zone.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('reveals the loaded board without an entrance animation', () => {
    setPhase(allReady);
    render(withClient(<EmployeeMaster />));

    const boards = boardProps.filter(props => props.pageKey === KPI_PAGE_KEY || props.pageKey === PAGE_KEY);
    expect(new Set(boards.map(props => props.pageKey))).toEqual(new Set([KPI_PAGE_KEY, PAGE_KEY]));
    // revealOnMount=false: the board replaces the skeleton in place, so no tile fades or
    // rises in after the hand-over (which would read as a second, flashing entrance).
    // Asserted on EVERY render pass, not just the first — a later pass must not re-enable it.
    for (const props of boards) expect(props.revealOnMount, String(props.pageKey)).toBe(false);
  });

  it('draws the skeleton on the same grid geometry the boards use', () => {
    setPhase(allReady);
    render(withClient(<EmployeeMaster />));
    const boards = boardProps.filter(props => props.pageKey === KPI_PAGE_KEY || props.pageKey === PAGE_KEY);
    for (const props of boards) {
      expect(props.column).toBe(COLUMNS);
      expect(props.cellHeight).toBe(6);
      expect(props.gap).toEqual([12, 12]);
    }

    setPhase({ listLoading: true });
    const { container } = render(withClient(<EmployeeMaster />));
    for (const zone of container.querySelectorAll<HTMLElement>('.wbi-skeleton-zone')) {
      expect(zone.style.gridTemplateColumns).toBe(`repeat(${COLUMNS}, minmax(0, 1fr))`);
      expect(zone.style.gridAutoRows).toBe('6px');
      expect(zone.style.columnGap).toBe('12px');
      expect(zone.style.rowGap).toBe('12px');
    }
  });
});
