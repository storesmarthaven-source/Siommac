/**
 * src/ui/widgets/BoardSkeleton.test.tsx
 *
 * Regression suite for the layout-driven board cold state.
 *
 * The bug being locked out: the page declared hard-coded skeleton counts
 * (`kpiCount={6} widgetCount={3}`) while the board itself rendered whatever the
 * user had saved — 19 instances on the Employee Master fixture below. The skeleton
 * therefore described a page that did not exist, and the real board "flashed" in as
 * a different shape. These tests assert the skeleton is derived from the SAVED
 * LAYOUT: same instance count, same geometry, registry-resolved density, and that
 * rearranging or removing widgets changes it with no code change.
 */

import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { BoardSkeleton } from './BoardSkeleton';
import { widgetSkeletonVariant } from './skeletonVariant';
import type { BoardLayout, LocalWidgetMap, WidgetInstance, WidgetSizeKey } from './types';

const COLUMNS = 24;
const CELL_HEIGHT = 6;
const GAP: readonly [number, number] = [12, 12];

const REGISTER_ID = 'hr.employees.register';

/** The employee register is a PAGE-LOCAL widget — no registry entry, so it declares
 *  its own cold-state density alongside its renderer (as EmployeeMaster does). */
const LOCAL_WIDGETS: LocalWidgetMap = {
  [REGISTER_ID]: { render: () => <div />, chrome: 'none', skeletonVariant: 'table' },
};

function inst(widgetId: string, x: number, y: number, w: number, h: number, pageKey: string, sizeKey: WidgetSizeKey = 'standard'): WidgetInstance {
  return { instanceId: `${widgetId}#${x}-${y}`, widgetId, pageKey, zoneId: 'main', x, y, w, h, sizeKey, config: {} };
}

function board(pageKey: string, items: WidgetInstance[]): BoardLayout {
  return { pageKey, columns: COLUMNS, zones: { main: items } };
}

// ── The fixture: a real user's SAVED Employee Master workspace — 6 KPI tiles on the
// fixed KPI board plus 13 widgets on the customizable board below it. 19 instances,
// which is exactly what the old `kpiCount=6 / widgetCount=3` skeleton mis-described.
const KPI_PAGE_KEY = 'hr.employees.overview.kpis.v2';
const PAGE_KEY = 'hr.employees.overview.v3';

const SAVED_KPI_INSTANCES: WidgetInstance[] = [
  inst('hr.employeeMaster.activeWorkforce', 0, 0, 4, 6, KPI_PAGE_KEY, 'compact'),
  inst('hr.employeeMaster.recordReadiness', 4, 0, 4, 6, KPI_PAGE_KEY, 'compact'),
  inst('hr.employeeMaster.hrWorkQueue', 8, 0, 4, 6, KPI_PAGE_KEY, 'compact'),
  inst('hr.employeeMaster.exceptions', 12, 0, 4, 6, KPI_PAGE_KEY, 'compact'),
  inst('hr.employeeMaster.monthlyHiresCard', 16, 0, 4, 6, KPI_PAGE_KEY, 'compact'),
  inst('hr.employeeMaster.departures', 20, 0, 4, 6, KPI_PAGE_KEY, 'compact'),
];

const SAVED_BOARD_INSTANCES: WidgetInstance[] = [
  inst('hr.employeeMaster.lifecycleActivity', 0, 0, 12, 28, PAGE_KEY, 'wide'),
  inst('enterprise.calendar.upcomingDeadlines', 12, 0, 6, 28, PAGE_KEY),
  inst('hr.employeeMaster.weeklyActivity', 18, 0, 6, 28, PAGE_KEY, 'large'),
  inst('hr.employeeMaster.recordHealth', 0, 28, 8, 22, PAGE_KEY),
  inst('hr.employeeMaster.readinessRadar', 8, 28, 8, 22, PAGE_KEY),
  inst('hr.employeeMaster.recordRisk', 16, 28, 8, 22, PAGE_KEY),
  inst('hr.employeeMaster.weeklyActivity', 0, 50, 10, 22, PAGE_KEY),
  inst('hr.employeeMaster.changeTrend', 10, 50, 10, 22, PAGE_KEY),
  inst('hr.employeeMaster.recordQuality', 20, 50, 4, 22, PAGE_KEY, 'compact'),
  inst('hr.employeeMaster.blockedActions', 0, 72, 10, 28, PAGE_KEY),
  inst('hr.employeeMaster.employeeAttentionNeutral', 10, 72, 8, 28, PAGE_KEY),
  inst('enterprise.calendar.taskPlanner', 18, 72, 6, 28, PAGE_KEY),
  inst(REGISTER_ID, 0, 100, 24, 50, PAGE_KEY, 'hero'),
];

/** Every skeleton tile, in DOM order, with the geometry it actually rendered at. */
function renderedTiles(container: HTMLElement): { widgetId: string; column: string; row: string; variant: string | null }[] {
  return [...container.querySelectorAll<HTMLElement>('.wbi-skeleton-item')].map(el => {
    const skeleton = el.querySelector<HTMLElement>('.ui-widget-skeleton');
    const variant = [...(skeleton?.classList ?? [])]
      .find(name => name.startsWith('ui-widget-skeleton--'))?.replace('ui-widget-skeleton--', '') ?? null;
    return {
      widgetId: el.dataset.widgetId ?? '',
      column: el.style.gridColumn,
      row: el.style.gridRow,
      variant,
    };
  });
}

function renderBoards(kpi: WidgetInstance[], main: WidgetInstance[]): HTMLElement {
  const { container } = render(
    <>
      <BoardSkeleton layout={board(KPI_PAGE_KEY, kpi)} columns={COLUMNS} cellHeight={CELL_HEIGHT} gap={GAP} />
      <BoardSkeleton layout={board(PAGE_KEY, main)} columns={COLUMNS} cellHeight={CELL_HEIGHT} gap={GAP}
        localWidgets={LOCAL_WIDGETS} />
    </>,
  );
  return container as HTMLElement;
}

describe('BoardSkeleton — one skeleton per SAVED widget instance', () => {
  it('produces a matching skeleton for all 19 saved widget instances', () => {
    const container = renderBoards(SAVED_KPI_INSTANCES, SAVED_BOARD_INSTANCES);

    expect(SAVED_KPI_INSTANCES.length + SAVED_BOARD_INSTANCES.length).toBe(19);
    expect(container.querySelectorAll('.ui-widget-skeleton')).toHaveLength(19);
    expect(container.querySelectorAll('.wbi-skeleton-item')).toHaveLength(19);
    // Each zone reports its own count, so a mismatch names the board that drifted.
    expect([...container.querySelectorAll<HTMLElement>('.wbi-skeleton-zone')]
      .map(zone => zone.dataset.skeletonCount)).toEqual(['6', '13']);
  });

  it('places every skeleton at the saved instance geometry', () => {
    const container = renderBoards(SAVED_KPI_INSTANCES, SAVED_BOARD_INSTANCES);
    const tiles = renderedTiles(container);
    const saved = [...SAVED_KPI_INSTANCES, ...SAVED_BOARD_INSTANCES];

    expect(tiles.map(tile => tile.widgetId)).toEqual(saved.map(item => item.widgetId));
    // CSS grid restates react-grid-layout exactly: 1-based line + span, so a `w`/`h` of
    // n occupies n columns/rows separated by the board's own gap.
    for (const [index, item] of saved.entries()) {
      expect(tiles[index]?.column, item.widgetId).toBe(`${item.x + 1} / span ${item.w}`);
      expect(tiles[index]?.row, item.widgetId).toBe(`${item.y + 1} / span ${item.h}`);
    }
  });

  it('mirrors the board grid geometry rather than a fixed three-column strip', () => {
    const container = renderBoards(SAVED_KPI_INSTANCES, SAVED_BOARD_INSTANCES);
    const zone = container.querySelector<HTMLElement>('.wbi-skeleton-zone')!;

    expect(zone.style.gridTemplateColumns).toBe(`repeat(${COLUMNS}, minmax(0, 1fr))`);
    expect(zone.style.gridAutoRows).toBe(`${CELL_HEIGHT}px`);
    expect(zone.style.columnGap).toBe(`${GAP[0]}px`);
    expect(zone.style.rowGap).toBe(`${GAP[1]}px`);
  });

  it('renders each widget in its registered cold-state density', () => {
    const container = renderBoards(SAVED_KPI_INSTANCES, SAVED_BOARD_INSTANCES);
    const byWidget = new Map(renderedTiles(container).map(tile => [tile.widgetId, tile.variant]));

    // metric previewVariant → metric density
    expect(byWidget.get('hr.employeeMaster.activeWorkforce')).toBe('metric');
    expect(byWidget.get('hr.employeeMaster.recordReadiness')).toBe('metric');
    // trend / donut / risk → chart or list density, never a generic card
    expect(byWidget.get('hr.employeeMaster.lifecycleActivity')).toBe('chart');
    expect(byWidget.get('hr.employeeMaster.recordHealth')).toBe('chart');
    expect(byWidget.get('enterprise.calendar.upcomingDeadlines')).toBe('list');
    expect(byWidget.get('hr.employeeMaster.blockedActions')).toBe('list');
    // the page-local register declares its own density and renders real table rows
    expect(byWidget.get(REGISTER_ID)).toBe('table');
    expect(container.querySelectorAll('.ui-widget-skeleton--table .ui-skeleton-row')).toHaveLength(7);
  });

  it('follows a rearranged and reduced board automatically', () => {
    // The user drags the register to the top, moves two widgets, and removes four.
    const rearranged: WidgetInstance[] = [
      { ...SAVED_BOARD_INSTANCES[12]!, x: 0, y: 0 },
      { ...SAVED_BOARD_INSTANCES[0]!, x: 0, y: 50, w: 24, h: 20 },
      { ...SAVED_BOARD_INSTANCES[1]!, x: 0, y: 70 },
      ...SAVED_BOARD_INSTANCES.slice(2, 11),
    ];
    const kpiWithOneHidden = SAVED_KPI_INSTANCES.slice(0, 5);

    const container = renderBoards(kpiWithOneHidden, rearranged);
    const tiles = renderedTiles(container);

    expect(container.querySelectorAll('.ui-widget-skeleton')).toHaveLength(17);
    expect(tiles[5]?.widgetId).toBe(REGISTER_ID);
    expect(tiles[5]?.column).toBe('1 / span 24');
    expect(tiles[5]?.row).toBe('1 / span 50');
    expect(tiles[6]?.column).toBe('1 / span 24');
    expect(tiles[6]?.row).toBe('51 / span 20');
    // Removed widgets leave no placeholder behind.
    expect(tiles.some(tile => tile.widgetId === 'enterprise.calendar.taskPlanner')).toBe(false);
    expect(tiles.some(tile => tile.widgetId === 'hr.employeeMaster.departures')).toBe(false);
  });

  it('renders nothing for an empty zone instead of inventing tiles', () => {
    const { container } = render(
      <BoardSkeleton layout={board(PAGE_KEY, [])} columns={COLUMNS} cellHeight={CELL_HEIGHT} gap={GAP} />,
    );
    expect(container.querySelectorAll('.ui-widget-skeleton')).toHaveLength(0);
    expect(container.querySelector<HTMLElement>('.wbi-skeleton-zone')?.dataset.skeletonCount).toBe('0');
  });

  it('is inert to assistive tech — the page owns the single busy announcement', () => {
    const container = renderBoards(SAVED_KPI_INSTANCES, SAVED_BOARD_INSTANCES);
    expect(container.querySelector('.wbi-skeleton-zone')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('widgetSkeletonVariant — resolution order', () => {
  it('prefers a page-local declaration over anything in the registry', () => {
    expect(widgetSkeletonVariant(REGISTER_ID, LOCAL_WIDGETS)).toBe('table');
  });

  it('defaults a page-local widget with no declaration to a card', () => {
    expect(widgetSkeletonVariant('page.local.undeclared', { 'page.local.undeclared': { render: () => <div /> } })).toBe('card');
  });

  it('derives from the registered previewVariant when the widget declares no skeleton', () => {
    expect(widgetSkeletonVariant('hr.employeeMaster.activeWorkforce')).toBe('metric');
    expect(widgetSkeletonVariant('hr.employeeMaster.weeklyActivity')).toBe('chart');
    expect(widgetSkeletonVariant('enterprise.calendar.taskPlanner')).toBe('list');
  });

  it('falls back to a card for a widget id that resolves to nothing', () => {
    expect(widgetSkeletonVariant('hr.employeeMaster.doesNotExist')).toBe('card');
  });
});
