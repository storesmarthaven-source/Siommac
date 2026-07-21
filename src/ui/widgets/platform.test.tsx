import { render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrateBoardLayout } from './migration';
import { deriveResponsivePlacements } from './placement';
import { clearWidgetDataSourcesForTests, registerWidgetDataSource } from './dataSources';
import { resolveWidgetAccess } from './access';
import { setWidgetGovernancePolicies } from './governance';
import { WidgetPlaceholder } from './WidgetPlaceholder';
import type { WidgetDef, WidgetInstance } from './types';

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
