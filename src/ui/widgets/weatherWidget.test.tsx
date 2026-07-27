import { describe, expect, it } from 'vitest';
import { WIDGET_REGISTRY } from './registry';
import { findWidgetDataSource } from './dataSources';
import { resolveWidgetAccess } from './access';
import { CANONICAL_GAP, CANONICAL_ROW_PX } from './WidgetBoardZone';

const weather = () => WIDGET_REGISTRY.find(w => w.id === 'platform.weather.current')!;

/** The operator asked for SEPARATE catalogue entries, not one widget with a metric selector. */
const WEATHER_IDS = [
  'platform.weather.current',
  'platform.weather.strip',
  'platform.weather.precipitation',
  'platform.weather.uv',
  'platform.weather.wind',
] as const;

describe('Weather widget', () => {
  it('registers one discoverable entry per card, all sharing the same proxy', () => {
    for (const id of WEATHER_IDS) {
      const widget = WIDGET_REGISTRY.find(w => w.id === id);
      expect(widget, id).toBeDefined();
      expect(widget!.dataSourceKey).toBe('platform.weather');
      expect(widget!.category).toBe('Site Conditions');
      // Each renders its own card — a shared renderer reference would mean a copy-paste slip.
      expect(widget!.renderPreview).not.toBe(widget!.render);
    }
  });

  it('registers against the authenticated server-side proxy, not the provider', () => {
    const widget = weather();
    expect(widget.runtimeState).toBe('live-api');
    expect(widget.dataSourceKey).toBe('platform.weather');
    const source = findWidgetDataSource('platform.weather')!;
    // Spec §2: app data comes through an authenticated Netlify JWT API. If this ever points at
    // open-meteo.com the browser is calling the provider directly and the proxy is bypassed.
    expect(source.endpoint).toBe('/api/weather/snapshot');
    expect(source.authenticated).toBe(true);
    expect(source.permission).toBe('platform.weather.view');
  });

  it('fails closed without the weather permission', () => {
    const widget = weather();
    const ctx = { pageKey: 'hr.employees.overview.v3', has: (k: string) => k !== 'platform.weather.view' };
    expect(resolveWidgetAccess(widget, ctx)).toMatchObject({ mount: false, state: 'restricted' });
    expect(resolveWidgetAccess(widget, { ...ctx, has: () => true })).toMatchObject({ mount: true });
  });

  it('is placeable on any board and sized in the canonical grid unit', () => {
    const widget = weather();
    expect(widget.supportedPages).toEqual(['*']);
    const { defaultRows, minRows, minHeight } = widget.sizeConstraints!;
    // A '*' widget lands on cellHeight-6 boards, so its rows must be canonical — the coarse-unit
    // mistake this guard exists for renders it ~5x too short.
    expect(defaultRows).toBeGreaterThanOrEqual(Math.ceil((minHeight! + CANONICAL_GAP[1]) / CANONICAL_ROW_PX) - 4);
    // minRows is a RENDER floor, never a design opinion — the platform guard caps it at 12.
    // It equals defaultRows here because this card's default IS its smallest preset (the
    // workforce-pulse footprint), which is legitimate; what matters is that the floor is low.
    expect(minRows).toBeLessThanOrEqual(defaultRows);
    expect(minRows).toBeLessThanOrEqual(12);
  });

  it('ships a default location so a fresh placement renders before it is configured', () => {
    const widget = weather();
    expect(typeof widget.defaultConfig.place).toBe('string');
    expect(typeof widget.defaultConfig.latitude).toBe('number');
    expect(typeof widget.defaultConfig.longitude).toBe('number');
    // Location is the only configurable thing — the metric is fixed by WHICH widget you place.
    expect(widget.configSchema.map(f => f.key).sort()).toEqual(['latitude', 'longitude', 'place']);
  });

  it('previews from sample data instead of calling the API', () => {
    // The catalogue renders many previews at once; a fetching preview would storm the proxy.
    expect(weather().renderPreview).toBeTypeOf('function');
    expect(weather().renderPreview).not.toBe(weather().render);
  });
});
