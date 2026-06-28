// src/ui/widgets/createPreviewWidgetInstance.ts — build an EPHEMERAL preview widget
// (rendered on the board, never persisted) from a def + size.
import type { PreviewWidgetInstance, WidgetDef, WidgetSizeKey } from './types';

export function createPreviewWidgetInstance({
  widget, pageKey, zoneId, sizeKey, config,
}: {
  widget: WidgetDef;
  pageKey: string;
  zoneId: string;
  sizeKey?: WidgetSizeKey;
  config?: Record<string, unknown>;
}): PreviewWidgetInstance {
  const resolvedSizeKey = sizeKey ?? widget.defaultSize;
  const size = widget.allowedSizes.find(s => s.key === resolvedSizeKey);
  if (!size) throw new Error(`Widget ${widget.id} does not support size ${resolvedSizeKey}`);
  const previewId = `preview_${crypto.randomUUID()}`;
  return {
    preview: true,
    previewId,
    source: 'widget-library',
    instanceId: previewId,
    widgetId: widget.id,
    pageKey, zoneId,
    x: 0, y: 0, w: size.grid.w, h: size.grid.h,
    sizeKey: resolvedSizeKey,
    config: { ...widget.defaultConfig, ...config },
  };
}
