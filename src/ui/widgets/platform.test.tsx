import { render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrateBoardLayout, rebaseBoardLayoutColumns } from './migration';
import { deriveResponsivePlacements, placeWidgetsAtBottom } from './placement';
import { clearWidgetDataSourcesForTests, registerWidgetDataSource } from './dataSources';
import { resolveWidgetAccess } from './access';
import { setWidgetGovernancePolicies } from './governance';
import { WidgetPlaceholder } from './WidgetPlaceholder';
import type { WidgetDef, WidgetInstance } from './types';
import { clampWidgetInstanceToMinimum, isResizeProgressTowardFit, resizeGridElement } from './WidgetBoardZone';
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
  it('repairs saved geometry below the widget-specific grid floor without losing instance data', () => {
    const widget = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.changeTrend')!;
    const undersized = { ...instance, widgetId: widget.id, w: 1, h: 1, config: { locale: 'es' } };
    expect(clampWidgetInstanceToMinimum(undersized)).toMatchObject({ w: 6, h: 4, config: { locale: 'es' } });
  });
  it('restores code-owned geometry for a fixed global widget in both directions', () => {
    const widget = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.activeWorkforce')!;
    expect(widget.resizable).toBe(false);
    expect(clampWidgetInstanceToMinimum({ ...instance, widgetId: widget.id, w: 11, h: 7 })).toMatchObject({ w: 6, h: 2 });
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
  it('lets an already-undersized saved tile grow toward its content-safe floor without allowing further shrinkage', () => {
    const previous = { width: 173, height: 388 };
    expect(isResizeProgressTowardFit(previous, { width: 210, height: 388 }, { horizontal: true, vertical: false })).toBe(true);
    expect(isResizeProgressTowardFit(previous, { width: 210, height: 388 }, { horizontal: false, vertical: true })).toBe(true);
    expect(isResizeProgressTowardFit(previous, { width: 160, height: 388 }, { horizontal: true, vertical: false })).toBe(false);
    expect(isResizeProgressTowardFit(previous, { width: 210, height: 370 }, { horizontal: true, vertical: true })).toBe(false);
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
