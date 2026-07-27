import { render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrateBoardLayout, rebaseBoardLayoutColumns } from './migration';
import { compactWidgets, deriveResponsivePlacements, insertWidgetsAtRow, insertWidgetsAtTop, placeWidgetsAtBottom } from './placement';
import { clearWidgetDataSourcesForTests, registerWidgetDataSource } from './dataSources';
import { resolveWidgetAccess } from './access';
import { setWidgetGovernancePolicies } from './governance';
import { WidgetPlaceholder } from './WidgetPlaceholder';
import type { LocalWidgetMap, WidgetDef, WidgetInstance } from './types';
import { CANONICAL_GAP, CANONICAL_ROW_PX, clampWidgetInstanceToMinimum, resizeGridElement } from './WidgetBoardZone';
import { widgetPreviewCanvas } from './WidgetPreviewScaler';
import { WIDGET_REGISTRY } from './registry';

const def = (overrides: Partial<WidgetDef> = {}): WidgetDef => ({
  id: 'test.widget', module: 'enterprise', area: 'test', title: 'Test', description: 'Test widget',
  icon: 'fa-test', category: 'Test', tags: [], previewVariant: 'metric', supportedPages: ['test.page'], supportedZones: ['main'],
  defaultSize: 'standard', allowedSizes: [{ key: 'standard', label: 'Standard', grid: { w: 4, h: 3 } }],
  defaultConfig: {}, configSchema: [], dataSource: { sourceKey: 'legacy', label: 'Legacy', permissions: ['records.view'] },
  render: () => <div>live</div>, ...overrides,
});
const instance: WidgetInstance = { instanceId: 'i1', widgetId: 'test.widget', pageKey: 'test.page', zoneId: 'main', x: 6, y: 2, w: 6, h: 3, sizeKey: 'standard', config: {} };

beforeEach(() => { setWidgetGovernancePolicies([]); clearWidgetDataSourcesForTests(); });

describe('Widget Platform v3 layout contract', () => {
  it('migrates v2 layouts without losing instances, config, unknown extension fields, or legacy geometry', () => {
    const migrated = migrateBoardLayout({ pageKey: 'test.page', extension: { owner: 'x' }, zones: { main: [{ ...instance, w: 24, config: { a: 1 }, custom: 'kept' }] } }, 'test.page');
    expect(migrated).toMatchObject({ version: 3, columns: 12, extension: { owner: 'x' } });
    expect(migrated?.zones.main?.[0]).toMatchObject({ instanceId: 'i1', w: 24, config: { a: 1 }, custom: 'kept' });
  });
  it('repairs missing v1 context deterministically', () => {
    expect(migrateBoardLayout({ zones: { main: [{ widgetId: 'a', x: 0, y: 0, w: 4, h: 2 }] } }, 'fallback')?.zones.main?.[0])
      .toMatchObject({ instanceId: 'a:main:0', pageKey: 'fallback', zoneId: 'main', sizeKey: 'standard', config: {} });
  });
  it('derives bounded tablet/mobile placements from the canonical 12-column desktop placement', () => {
    expect(deriveResponsivePlacements(instance)).toEqual({
      desktop: { x: 6, y: 2, w: 6, h: 3 }, tablet: { x: 4, y: 2, w: 4, h: 3 }, mobile: { x: 0, y: 2, w: 4, h: 3 },
    });
  });
  it('rebases a saved 12-column layout to 24 columns without losing instance data', () => {
    const source = { version: 3 as const, columns: 12, pageKey: 'test.page', zones: { main: [
      { ...instance, responsive: { desktop: { x: 6, y: 2, w: 6, h: 3 }, mobile: { x: 0, y: 2, w: 4, h: 3 } } },
    ] } };
    const rebased = rebaseBoardLayoutColumns(source, 24);
    expect(rebased).toMatchObject({ columns: 24, zones: { main: [{ x: 12, y: 2, w: 12, h: 3, config: {} }] } });
    expect(rebased.zones.main?.[0]?.responsive).toEqual({
      desktop: { x: 12, y: 2, w: 12, h: 3 }, mobile: { x: 0, y: 2, w: 4, h: 3 },
    });
    expect(rebaseBoardLayoutColumns(rebased, 24)).toBe(rebased);
  });
  it('does not double-scale 24-column geometry whose legacy API envelope was mislabeled as 12', () => {
    const mislabeled = { version: 3 as const, columns: 12, pageKey: 'test.page', zones: { main: [
      { ...instance, x: 0, w: 24 },
    ] } };
    expect(rebaseBoardLayoutColumns(mislabeled, 24)).toMatchObject({
      columns: 24, zones: { main: [{ x: 0, w: 24, config: {} }] },
    });
  });
  it('places a multi-select batch atomically below the current board in selection order', () => {
    expect(placeWidgetsAtBottom([instance], [
      { ...instance, instanceId: 'i2', y: 0, h: 4 },
      { ...instance, instanceId: 'i3', y: 0, h: 2 },
    ])).toMatchObject([{ instanceId: 'i2', x: 0, y: 5 }, { instanceId: 'i3', x: 0, y: 9 }]);
  });
  it('inserts a multi-select batch at the top and shifts existing widgets down', () => {
    expect(insertWidgetsAtTop([instance], [
      { ...instance, instanceId: 'i2', x: 3, y: 9, h: 4 },
      { ...instance, instanceId: 'i3', x: 6, y: 12, h: 2 },
    ])).toMatchObject([
      { instanceId: 'i1', x: 6, y: 8 },
      { instanceId: 'i2', x: 0, y: 0 },
      { instanceId: 'i3', x: 0, y: 4 },
    ]);
  });
  it('inserts widgets at a section row without moving earlier rows', () => {
    const kpi = { ...instance, instanceId: 'kpi', x: 0, y: 0, w: 4, h: 1 };
    const register = { ...instance, instanceId: 'register', x: 0, y: 10, w: 24, h: 9 };
    expect(insertWidgetsAtRow([kpi, register], [{ ...instance, instanceId: 'new', y: 99, h: 4 }], 1)).toMatchObject([
      { instanceId: 'kpi', y: 0 },
      { instanceId: 'register', y: 14 },
      { instanceId: 'new', x: 0, y: 1 },
    ]);
  });
  it('repairs saved geometry below the widget-specific grid floor without losing instance data', () => {
    const widget = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.changeTrend')!;
    const undersized = { ...instance, widgetId: widget.id, w: 1, h: 1, config: { locale: 'es' } };
    // h:12 == the widget's RENDER floor (204px), not its default size — see the shrink guard below.
    expect(clampWidgetInstanceToMinimum(undersized)).toMatchObject({ w: 6, h: 12, config: { locale: 'es' } });
  });
  it('restores code-owned geometry for a fixed global widget in both directions', () => {
    const widget = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.activeWorkforce')!;
    expect(widget.resizable).toBe(false);
    expect(clampWidgetInstanceToMinimum({ ...instance, widgetId: widget.id, w: 11, h: 7 })).toMatchObject({ w: 4, h: 6 });
  });
  it('uses the board pixel floor when constructing library preview canvases', () => {
    const widget = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.changeTrend')!;
    expect(widgetPreviewCanvas(widget.previewAspect!, widget.sizeConstraints)).toEqual({ width: 475, height: 380 });
    expect(widgetPreviewCanvas(.5, { ...widget.sizeConstraints!, minWidth: 420, minHeight: 440 })).toEqual({ width: 420, height: 440 });
  });
  it('measures the enclosing grid item when react-grid-layout supplies its resize handle', () => {
    const gridItem = document.createElement('div');
    gridItem.className = 'react-grid-item';
    const handle = document.createElement('span');
    handle.className = 'react-resizable-handle';
    gridItem.append(handle);
    expect(resizeGridElement(handle)).toBe(gridItem);
  });
  // Resize is bounded by the grid floor alone (Statutory-parity). The pixel/content-overflow
  // resize gate that this block used to cover was removed — it fired on the first pixel of
  // travel for any widget whose declared minWidth met or exceeded its own default placement
  // width, which pinned the tile instead of guarding it. The floor that remains is minW/minH.
  // Removal must CLOSE the hole. RGL compacts vertically only, so deleting the left tile of a
  // two-column row used to leave the right tile pinned right with dead space beside it.
  it('re-packs a zone so a removed widget leaves no gap, without scrambling the survivors', () => {
    const at = (id: string, x: number, y: number, w: number, h: number): WidgetInstance =>
      ({ ...instance, instanceId: id, widgetId: id, x, y, w, h });
    // Two side-by-side charts over a full-width register (the Employee Master shape).
    const board = [at('left', 0, 0, 12, 22), at('right', 12, 0, 12, 22), at('register', 0, 22, 24, 50)];

    // Already tidy → a FIXED POINT. The pair must stay side by side, not collapse into a column.
    expect(compactWidgets(board, 24)).toMatchObject([
      { instanceId: 'left', x: 0, y: 0 }, { instanceId: 'right', x: 12, y: 0 }, { instanceId: 'register', x: 0, y: 22 },
    ]);

    // Remove the LEFT tile — the survivor must take the freed space rather than stay pinned right.
    expect(compactWidgets(board.filter(w => w.instanceId !== 'left'), 24)).toMatchObject([
      { instanceId: 'right', x: 0, y: 0 }, { instanceId: 'register', x: 0, y: 22 },
    ]);

    // Idempotent: re-packing a packed layout changes nothing.
    const packed = compactWidgets(board.filter(w => w.instanceId !== 'left'), 24);
    expect(compactWidgets(packed, 24)).toEqual(packed);
  });
  it('never overlaps two widgets while closing a gap', () => {
    const at = (id: string, x: number, y: number, w: number, h: number): WidgetInstance =>
      ({ ...instance, instanceId: id, widgetId: id, x, y, w, h });
    const packed = compactWidgets([at('a', 12, 40, 6, 28), at('b', 18, 40, 6, 28), at('c', 0, 80, 24, 20)], 24);
    for (const a of packed) {
      for (const b of packed) {
        if (a === b) continue;
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      }
    }
    // Everything floats to the top-left when nothing blocks it.
    expect(packed.map(p => ({ x: p.x, y: p.y }))).toEqual([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 28 }]);
  });
  // THE unit-system guard. Every board runs the canonical grid (18px per row), so a widget's
  // authored height and its pixel size describe the SAME thing. Keyed off defaultRows — the size
  // the widget is MEANT to occupy — because minRows is deliberately a much lower floor (below).
  // A widget still authored in the old coarse 88px units declares ~5x too few rows and fails here.
  it('declares every widget height in the canonical grid unit', () => {
    const offenders = WIDGET_REGISTRY
      .filter(w => w.sizeConstraints?.minHeight && w.sizeConstraints.defaultRows)
      .map(w => {
        const { defaultRows, minHeight } = w.sizeConstraints!;
        return { id: w.id, defaultRows, derived: Math.ceil((minHeight! + CANONICAL_GAP[1]) / CANONICAL_ROW_PX) };
      })
      // Tolerance absorbs honest rounding; a coarse-unit widget is off by ~16.
      .filter(w => w.defaultRows < w.derived - 4);
    expect(offenders).toEqual([]);
  });

  // No resizable widget may declare a TALL vertical floor. minRows and defaultRows had drifted
  // into meaning the same thing: widgets shipped with minRows === defaultRows (22–28 rows,
  // 384–492px), so the vertical resize handle moved and snapped straight back — the widget could
  // not be made smaller than its own default. The two fields mean different things:
  //   defaultRows — the size the card looks good at, used when it is placed.
  //   minRows     — the smallest it can still RENDER. Content scrolls; it is not a design opinion.
  // MAX_FLOOR_ROWS is the Statutory board's own deadline-card floor (h12 = 204px), which is the
  // reference for how a board should feel. A fixed widget (the KPI tile) is exempt — min == max
  // == default is precisely what "fixed" means.
  it('keeps every resizable widget free to shrink vertically', () => {
    const MAX_FLOOR_ROWS = 12;
    const tooTall = WIDGET_REGISTRY
      .filter(w => w.resizable !== false && w.sizeConstraints)
      .filter(w => w.sizeConstraints!.minRows > MAX_FLOOR_ROWS)
      .map(w => `${w.id} (minRows ${w.sizeConstraints!.minRows} = ${w.sizeConstraints!.minRows * CANONICAL_ROW_PX - CANONICAL_GAP[1]}px floor)`);
    expect(tooTall).toEqual([]);
  });
  it('clamps a saved tile up to its widget grid floor rather than blocking the gesture', () => {
    const local: LocalWidgetMap = {
      'w.floored': { render: () => <div />, allowedSizes: [{ key: 'standard', label: 'Default', grid: { w: 6, h: 20 } }] },
    };
    const saved: WidgetInstance = { instanceId: 'i1', widgetId: 'w.floored', pageKey: 'p', zoneId: 'main', x: 0, y: 0, w: 2, h: 3, sizeKey: 'standard', config: {} };
    expect(clampWidgetInstanceToMinimum(saved, local)).toMatchObject({ w: 6, h: 20 });
  });
});

describe('capability, governance, and API fail-closed chain', () => {
  it('denies before mount when page, governance, widget, or source capability is absent', () => {
    const none = () => false;
    expect(resolveWidgetAccess(def(), { pageKey: 'test.page', pagePermission: 'page.view', has: none }).mount).toBe(false);
    setWidgetGovernancePolicies([{ widgetId: 'test.widget', state: 'disabled', discoverable: true }]);
    expect(resolveWidgetAccess(def(), { pageKey: 'test.page', has: () => true }).state).toBe('disabled');
    setWidgetGovernancePolicies([]);
    expect(resolveWidgetAccess(def(), { pageKey: 'test.page', has: none }).state).toBe('restricted');
    expect(resolveWidgetAccess(def({ dataSourceKey: 'missing', dataSource: { sourceKey: 'missing', label: 'Missing', permissions: [] } }), { pageKey: 'test.page', has: () => true }).mount).toBe(false);
  });
  it('accepts only approved authenticated /api data sources and treats realtime as invalidation metadata', () => {
    expect(() => registerWidgetDataSource({ key: 'bad', label: 'Bad', endpoint: 'https://example.test', permission: 'x', scope: 'organization', refresh: { mode: 'manual' }, authenticated: true })).toThrow('/api/');
    registerWidgetDataSource({ key: 'approved', label: 'Approved', endpoint: '/api/hr/widget', permission: 'records.view', scope: 'record', refresh: { mode: 'realtime-invalidation' }, authenticated: true });
    expect(resolveWidgetAccess(def({ dataSourceKey: 'approved' }), { pageKey: 'test.page', has: key => key === 'records.view' })).toMatchObject({ mount: true, state: 'live-api' });
  });
});

describe('placement-preserving placeholders', () => {
  it.each(['missing', 'restricted', 'disabled'] as const)('renders the %s state explicitly', state => {
    render(<WidgetPlaceholder state={state} reason="Position preserved." />);
    expect(screen.getByRole('status').getAttribute('data-widget-state')).toBe(state);
    expect(screen.getByText('Position preserved.')).toBeTruthy();
  });
});
