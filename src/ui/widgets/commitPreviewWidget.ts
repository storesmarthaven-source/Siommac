// src/ui/widgets/commitPreviewWidget.ts — graduate an ephemeral preview into a saved
// WidgetInstance (fresh instanceId; drops the preview flags), keeping its geometry.
import type { PreviewWidgetInstance, WidgetInstance } from './types';

export function commitPreviewWidget(preview: PreviewWidgetInstance): WidgetInstance {
  return {
    instanceId: crypto.randomUUID(),
    widgetId: preview.widgetId,
    pageKey: preview.pageKey,
    zoneId: preview.zoneId,
    x: preview.x, y: preview.y, w: preview.w, h: preview.h,
    sizeKey: preview.sizeKey,
    config: preview.config,
  };
}
