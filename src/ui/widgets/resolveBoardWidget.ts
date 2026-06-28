// src/ui/widgets/resolveBoardWidget.ts — resolve a board item's renderer + chrome +
// title from the page-local widget map first, then the global registry.
import type { VNode } from 'preact';
import type { LocalWidgetMap, WidgetChrome, WidgetRenderProps } from './types';
import { findWidgetDef } from './registry';

export interface ResolvedBoardWidget {
  title: string;
  chrome: WidgetChrome;
  render: (props: WidgetRenderProps) => VNode;
}

export function resolveBoardWidget(widgetId: string, local?: LocalWidgetMap): ResolvedBoardWidget | null {
  const lw = local?.[widgetId];
  if (lw) return { title: lw.title ?? '', chrome: lw.chrome ?? 'standard', render: lw.render };
  const def = findWidgetDef(widgetId);
  if (def) return { title: def.title, chrome: def.chrome ?? 'standard', render: def.render };
  return null;
}
