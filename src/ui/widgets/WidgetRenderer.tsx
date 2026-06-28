// src/ui/widgets/WidgetRenderer.tsx — resolve a board item's renderer (page-local map
// first, then global registry) and render its live component (which fetches its own data
// via module hooks — reuse-hooks model). In DEMO mode, registry widgets render their static
// sample renderPreview instead, so the board shows a populated visual without live data.
import type { VNode } from 'preact';
import { EmptyState } from '@ui';
import { resolveBoardWidget } from './resolveBoardWidget';
import { findWidgetDef } from './registry';
import type { BoardWidgetInstance, LocalWidgetMap } from './types';

export function WidgetRenderer({ item, preview, local, demo }: { item: BoardWidgetInstance; preview?: boolean; local?: LocalWidgetMap; demo?: boolean }): VNode {
  const resolved = resolveBoardWidget(item.widgetId, local);
  if (!resolved) return <EmptyState icon="fa-puzzle-piece" title="Widget unavailable" text={`Unknown widget: ${item.widgetId}`} />;
  const def = findWidgetDef(item.widgetId);
  const merged = { ...(def?.defaultConfig ?? {}), ...item.config };

  // Demo data: show the representative static sample (registry widgets only; local widgets
  // like the register have no renderPreview and fall through to their live render).
  if (demo && def?.renderPreview) {
    return def.renderPreview({ widgetId: item.widgetId, sizeKey: item.sizeKey, config: merged });
  }

  const Live = resolved.render;
  return (
    <Live
      widgetId={item.widgetId} instanceId={item.instanceId} pageKey={item.pageKey} zoneId={item.zoneId}
      sizeKey={item.sizeKey} config={merged} preview={preview}
    />
  );
}
