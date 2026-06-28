// src/ui/widgets/declarative/declarativeToWidgetDef.tsx — adapter: a data-only spec → a
// normal WidgetDef whose render is the generic engine. So declarative widgets (code-defined
// samples now; .zip-installed later) flow through the library + board exactly like code widgets.
import type { VNode } from 'preact';
import type { WidgetDef, WidgetGridSize, WidgetPreviewVariant, WidgetSizeDef, WidgetSizeKey } from '../types';
import { DeclarativeWidgetView } from './DeclarativeWidgetView';
import type { DeclarativeView, DeclarativeWidgetSpec } from './types';

const SIZE_GRID: Record<WidgetSizeKey, WidgetGridSize> = {
  compact: { w: 3, h: 2 }, standard: { w: 4, h: 2 }, wide: { w: 6, h: 2 },
  large: { w: 6, h: 4 }, tall: { w: 4, h: 4 }, hero: { w: 12, h: 4 },
};
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const sizeDef = (k: WidgetSizeKey): WidgetSizeDef => ({ key: k, label: cap(k), grid: SIZE_GRID[k] });
const VARIANT: Record<DeclarativeView['kind'], WidgetPreviewVariant> = {
  metric: 'metric', donut: 'donut', trend: 'trend', bars: 'status-stack', list: 'table', html: 'metric',
};

export function declarativeToWidgetDef(spec: DeclarativeWidgetSpec): WidgetDef {
  const keys = spec.allowedSizes?.length ? spec.allowedSizes : [spec.defaultSize ?? 'standard'];
  const render = (): VNode => <DeclarativeWidgetView spec={spec} />;
  // HTML cards size with viewport/relative units → preview them at a board-like canvas (default-size
  // shape) and scale down, so the thumbnail looks like the board (see WidgetPreviewScaler).
  const defGrid = SIZE_GRID[spec.defaultSize ?? 'standard'];
  return {
    id: spec.id,
    module: 'enterprise', area: 'custom',
    title: spec.title, description: spec.description, icon: spec.icon,
    category: spec.category, tags: spec.tags ?? [],
    previewVariant: VARIANT[spec.view.kind],
    // list = framed (title + border); metric/donut/trend/bars bring their own card.
    chrome: spec.view.kind === 'list' ? 'standard' : 'none',
    supportedPages: [], supportedZones: ['main', 'overview'],
    defaultSize: spec.defaultSize ?? 'standard',
    allowedSizes: keys.map(sizeDef),
    ...(spec.view.kind === 'html' ? { previewAspect: defGrid.w / defGrid.h } : {}),
    defaultConfig: {}, configSchema: [],
    dataSource: { sourceKey: 'declarative', label: 'Embedded sample data', permissions: [] },
    render, renderPreview: render,
  };
}
