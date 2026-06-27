/**
 * src/ui/widgets/registry.ts
 *
 * Widget catalogue types for the resizable widget board (gridstack). A page builds
 * a WidgetRegistry (id → WidgetDef) — the board renders placed widgets, the picker
 * lists available ones. `dataGate` locks a widget whose source data/module doesn't
 * exist yet (it shows in the picker as locked, never as fake data).
 *
 * @see docs/WIDGET_BOARD_SPEC.md
 */

import { type VNode } from 'preact';

export interface WidgetDef {
  /** Stable id, e.g. 'hr.deptDist'. Persisted in the board layout. */
  id: string;
  title: string;
  /** Font Awesome class, e.g. 'fa-chart-pie'. */
  icon: string;
  /** Group shown in the picker, e.g. 'Workforce'. */
  category: string;
  /** Default grid span (columns 1–12) and height (row units). */
  defaultW: number;
  defaultH: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  /** Render WITHOUT the board's card chrome — the widget is already a full card
   *  (e.g. a StatsCard). Edit controls float over it instead. */
  bare?: boolean;
  /** Return a reason string to LOCK the widget (no data/module yet), or null when ready. */
  dataGate?: () => string | null;
  render: () => VNode;
}

export type WidgetRegistry = Record<string, WidgetDef>;

/** Default board = the widgets a page ships with, flowed left-to-right across the
 *  12-col grid (wrapping to a new row when the next widget won't fit). */
export function defaultBoard(defs: WidgetDef[]): { id: string; x: number; y: number; w: number; h: number }[] {
  let x = 0, y = 0, rowH = 0;
  return defs.map(d => {
    if (x + d.defaultW > 12) { x = 0; y += rowH; rowH = 0; }
    const item = { id: d.id, x, y, w: d.defaultW, h: d.defaultH };
    x += d.defaultW;
    rowH = Math.max(rowH, d.defaultH);
    return item;
  });
}
