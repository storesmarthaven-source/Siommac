import { WIDGET_CONTRACT_VERSION, WIDGET_DESKTOP_COLUMNS, type BoardLayout, type WidgetInstance, type WidgetSizeKey } from './types';

const sizeKeys: readonly string[] = ['compact', 'standard', 'wide', 'large', 'tall', 'hero'];
const isSizeKey = (value: unknown): value is WidgetSizeKey => typeof value === 'string' && sizeKeys.includes(value);
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const integer = (value: unknown, fallback: number, min = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.trunc(n)) : fallback;
};

/** Upgrade historical ui_layout.layout values to v3 without dropping instances, config, or unknown extension fields. */
export function migrateBoardLayout(value: unknown, expectedPageKey: string): BoardLayout | null {
  const raw = object(value);
  if (!raw) return null;
  const rawZones = object(raw.zones);
  if (!rawZones) return null;
  const pageKey = typeof raw.pageKey === 'string' && raw.pageKey ? raw.pageKey : expectedPageKey;
  const zones: Record<string, WidgetInstance[]> = {};
  for (const [zoneId, value] of Object.entries(rawZones)) {
    if (!Array.isArray(value)) continue;
    zones[zoneId] = value.flatMap((candidate, index) => {
      const item = object(candidate);
      if (!item || typeof item.widgetId !== 'string' || !item.widgetId) return [];
      const instanceId = typeof item.instanceId === 'string' && item.instanceId ? item.instanceId : `${item.widgetId}:${zoneId}:${index}`;
      const sizeKey: WidgetSizeKey = isSizeKey(item.sizeKey) ? item.sizeKey : 'standard';
      return [{
        ...item, instanceId, widgetId: item.widgetId,
        pageKey: typeof item.pageKey === 'string' && item.pageKey ? item.pageKey : pageKey,
        zoneId: typeof item.zoneId === 'string' && item.zoneId ? item.zoneId : zoneId,
        x: integer(item.x, 0), y: integer(item.y, 0),
        w: integer(item.w, 4, 1), h: integer(item.h, 3, 1),
        sizeKey, config: object(item.config) ?? {},
      }];
    });
  }
  const columns = integer(raw.columns, WIDGET_DESKTOP_COLUMNS, 1);
  return { ...raw, version: WIDGET_CONTRACT_VERSION, columns, pageKey, zones };
}

export function createV3Layout(pageKey: string, zones: BoardLayout['zones'] = {}): BoardLayout {
  return { version: WIDGET_CONTRACT_VERSION, columns: WIDGET_DESKTOP_COLUMNS, pageKey, zones };
}

/** Rebase desktop geometry when a page deliberately changes its canonical board width.
 * Instance identity, vertical placement, configuration and non-desktop responsive overrides are
 * preserved. This is safe to call repeatedly because an already-targeted layout is returned as-is. */
export function rebaseBoardLayoutColumns(layout: BoardLayout, targetColumns: number): BoardLayout {
  const columns = Math.max(1, Math.trunc(targetColumns));
  const declaredColumns = Math.max(1, Math.trunc(layout.columns ?? WIDGET_DESKTOP_COLUMNS));
  // Older API sanitization always wrote `columns: 12`, even for 24-column boards. Recover that
  // metadata loss when placement extents prove the geometry already uses a wider grid; otherwise
  // a subsequent load would scale an already-converted layout a second time.
  const placementExtent = Math.max(1, ...Object.values(layout.zones).flatMap(items => items.map(item => item.x + item.w)));
  const sourceColumns = Math.min(columns, Math.max(declaredColumns, placementExtent));
  if (sourceColumns === columns) return declaredColumns === columns ? layout : { ...layout, columns };
  const scale = columns / sourceColumns;
  const scalePlacement = <T extends { x: number; w: number }>(placement: T): T => {
    const w = Math.max(1, Math.min(columns, Math.round(placement.w * scale)));
    const x = Math.max(0, Math.min(columns - w, Math.round(placement.x * scale)));
    return { ...placement, x, w };
  };
  return {
    ...layout,
    columns,
    zones: Object.fromEntries(Object.entries(layout.zones).map(([zoneId, items]) => [
      zoneId,
      items.map(item => ({
        ...scalePlacement(item),
        responsive: item.responsive?.desktop
          ? { ...item.responsive, desktop: scalePlacement(item.responsive.desktop) }
          : item.responsive,
      })),
    ])),
  };
}
