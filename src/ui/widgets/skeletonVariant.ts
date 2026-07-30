/**
 * src/ui/widgets/skeletonVariant.ts
 *
 * Resolves the cold-state density a board tile should show, from the SAME registry
 * entry the board renders the live tile from. Nothing here is guessed per page: a
 * widget either declares `skeletonVariant` explicitly or inherits it from the
 * `previewVariant` it already had to declare, through the exhaustive map below.
 *
 * Resolution order (first hit wins):
 *   1. the page-local widget's `skeletonVariant`   (page-local tiles have no registry entry)
 *   2. the registry definition's `skeletonVariant`  (explicit override)
 *   3. the registry definition's `previewVariant`   (derived, exhaustive)
 *   4. 'card'                                       (widget id resolves to nothing — the board
 *                                                    renders an unresolved placeholder for it)
 */

import type { WidgetSkeletonVariant } from '../components/Skeleton';
import type { LocalWidgetMap, WidgetPreviewVariant } from './types';
import { findWidgetDef } from './registry';

/** Exhaustive `previewVariant` → cold-state density. Adding a preview variant to the
 *  union makes this map a compile error until it is classified — no silent default. */
const VARIANT_DENSITY: Record<WidgetPreviewVariant, WidgetSkeletonVariant> = {
  metric:         'metric',
  trend:          'chart',
  donut:          'chart',
  'flow-map':     'chart',
  matrix:         'chart',
  table:          'table',
  people:         'list',
  'task-board':   'list',
  timeline:       'list',
  checklist:      'list',
  risk:           'list',
  'status-stack': 'card',
};

export function widgetSkeletonVariant(widgetId: string, localWidgets?: LocalWidgetMap): WidgetSkeletonVariant {
  const local = localWidgets?.[widgetId];
  if (local) return local.skeletonVariant ?? 'card';
  const def = findWidgetDef(widgetId);
  if (!def) return 'card';
  return def.skeletonVariant ?? VARIANT_DENSITY[def.previewVariant];
}
