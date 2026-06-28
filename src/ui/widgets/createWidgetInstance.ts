// src/ui/widgets/createWidgetInstance.ts — build a saved WidgetInstance from a def + size.
import type { WidgetDef, WidgetInstance, WidgetSizeKey } from './types';

export function createWidgetInstance({
  widget, pageKey, zoneId, sizeKey, config,
}: {
  widget: WidgetDef;
  pageKey: string;
  zoneId: string;
  sizeKey?: WidgetSizeKey;
  config?: Record<string, unknown>;
}): WidgetInstance {
  const resolvedSizeKey = sizeKey ?? widget.defaultSize;
  const size = widget.allowedSizes.find(s => s.key === resolvedSizeKey);
  if (!size) throw new Error(`Widget ${widget.id} does not support size ${resolvedSizeKey}`);
  return {
    instanceId: crypto.randomUUID(),
    widgetId: widget.id,
    pageKey, zoneId,
    x: 0, y: 0, w: size.grid.w, h: size.grid.h,
    sizeKey: resolvedSizeKey,
    config: { ...widget.defaultConfig, ...config },
  };
}
