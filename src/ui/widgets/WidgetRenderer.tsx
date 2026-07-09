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
  const merged = { ...(def?.defaultConfig ?? {}), ...item.config };
  const props = {
    widgetId: item.widgetId, instanceId: item.instanceId, pageKey: item.pageKey, zoneId: item.zoneId,
    sizeKey: item.sizeKey, config: merged, preview,
  };

  // PAGE-LOCAL widget: CALL the render fn so its output DIFFS in place. The page rebuilds
  // its localWidgets map (and thus this closure) on every render, so mounting it as a
  // component TYPE (`<Live/>`) would give Preact a new type each render → the whole subtree
  // REMOUNTS every parent re-render (replaying mount animations, resetting child state,
  // e.g. a hovered chart re-triggering a sibling gauge). Local widgets are permission-gated
  // by the page that placed them, not by this generic mechanism.
  const localDef = local?.[item.widgetId];
  if (localDef) return localDef.render(props);

  // Registry widget — stable render reference, so mounting as a component is safe and lets
  // it own its data hooks. Gate on the viewer's permissions at every render.
  const required = def?.permissions?.requiredPermissions ?? def?.dataSource.permissions ?? [];
  if (required.length && !required.every(can)) {
    return <EmptyState icon="fa-lock" title="No permission" text="You don't have permission to view this widget." />;
  }
  // Demo data: show the representative static sample (registry widgets only).
  if (demo && def?.renderPreview) {
    return def.renderPreview({ widgetId: item.widgetId, sizeKey: item.sizeKey, config: merged });
  }
  const Live = resolved.render;
  return <Live {...props} />;
}
