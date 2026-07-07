// src/ui/widgets/WidgetRenderer.tsx — resolve a board item's renderer (page-local map
// first, then global registry) and render its live component (which fetches its own data
// via module hooks — reuse-hooks model). In DEMO mode, registry widgets render their static
// sample renderPreview instead, so the board shows a populated visual without live data.
//
// PERMISSION GATE: a saved board instance is just data (widgetId + geometry) — it does NOT
// re-check the viewer's permissions on its own. A user's permissions can change after they
// placed a widget (role change, revoked grant), so this is enforced here, at mount, every
// render — not just when the library decides what's addable.
import type { VNode } from 'preact';
import { EmptyState } from '@ui';
import { can } from '@lib/permissions';
import { resolveBoardWidget } from './resolveBoardWidget';
import { findWidgetDef } from './registry';
import type { BoardWidgetInstance, LocalWidgetMap } from './types';

export function WidgetRenderer({ item, preview, local, demo }: { item: BoardWidgetInstance; preview?: boolean; local?: LocalWidgetMap; demo?: boolean }): VNode {
  const resolved = resolveBoardWidget(item.widgetId, local);
  if (!resolved) return <EmptyState icon="fa-puzzle-piece" title="Widget unavailable" text={`Unknown widget: ${item.widgetId}`} />;
  const def = findWidgetDef(item.widgetId);

  // Page-local widgets (e.g. the employee register) are gated by the page that placed
  // them, not by this generic mechanism — only registry widgets carry dataSource.permissions.
  const required = def?.permissions?.requiredPermissions ?? def?.dataSource.permissions ?? [];
  if (required.length && !required.every(can)) {
    return <EmptyState icon="fa-lock" title="No permission" text="You don't have permission to view this widget." />;
  }

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
