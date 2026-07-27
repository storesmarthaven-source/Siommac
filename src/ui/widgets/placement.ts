import type { WidgetBreakpoint, WidgetInstance, WidgetPlacement, WidgetResponsivePlacements } from './types';

export const BREAKPOINT_COLUMNS: Record<WidgetBreakpoint, number> = { desktop: 12, tablet: 8, mobile: 4 };

export function placeWidgetsAtBottom(existing: WidgetInstance[], additions: WidgetInstance[]): WidgetInstance[] {
  let y = Math.max(0, ...existing.map(item => item.y + item.h));
  return additions.map(item => {
    const placed = { ...item, x: 0, y };
    y += item.h;
    return placed;
  });
}

export function insertWidgetsAtTop(existing: WidgetInstance[], additions: WidgetInstance[]): WidgetInstance[] {
  return insertWidgetsAtRow(existing, additions, 0);
}

export function insertWidgetsAtRow(existing: WidgetInstance[], additions: WidgetInstance[], row: number): WidgetInstance[] {
  let y = 0;
  const placed = additions.map(item => {
    const next = { ...item, x: 0, y: row + y };
    y += item.h;
    return next;
  });
  return [...existing.map(item => item.y >= row ? { ...item, y: item.y + y } : item), ...placed];
}

// Close the hole left by a removed widget.
//
// react-grid-layout only compacts VERTICALLY (compactType='vertical'), which cannot fill a
// horizontal gap: delete the left tile of a two-column row and the right tile stays pinned right
// with dead space beside it. This re-packs with up-then-left gravity in reading order, which is
// what a dashboard is expected to do after a delete.
//
// Properties that make it safe to run on every removal:
//   • It only ever moves a widget into space that is genuinely EMPTY — it never overlaps.
//   • It is a FIXED POINT for an already-tidy board: a side-by-side pair stays side by side,
//     because the right tile's leftward slide is blocked by the left tile at the same rows.
//     So removing one widget does not scramble the arrangement of the others.
//   • It is idempotent — re-packing a packed layout returns the same geometry.
export function compactWidgets(widgets: WidgetInstance[], columns: number): WidgetInstance[] {
  const overlaps = (a: WidgetPlacement, b: WidgetPlacement): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const placed: WidgetInstance[] = [];
  // Reading order: top-to-bottom, then left-to-right. Anything already placed is an obstacle.
  for (const item of [...widgets].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let next = { ...item, x: Math.max(0, Math.min(item.x, columns - item.w)) };
    // Alternate up and left until neither direction can improve — one axis freeing up often
    // unblocks the other (a tile slides left, which then lets it rise).
    for (let moved = true; moved;) {
      moved = false;
      while (next.y > 0 && !placed.some(p => overlaps({ ...next, y: next.y - 1 }, p))) { next = { ...next, y: next.y - 1 }; moved = true; }
      while (next.x > 0 && !placed.some(p => overlaps({ ...next, x: next.x - 1 }, p))) { next = { ...next, x: next.x - 1 }; moved = true; }
    }
    placed.push(next);
  }
  // Preserve the caller's array order; only geometry changes.
  const byId = new Map(placed.map(p => [p.instanceId, p]));
  return widgets.map(w => byId.get(w.instanceId) ?? w);
}

export function deriveResponsivePlacements(instance: WidgetInstance): Required<WidgetResponsivePlacements> {
  const derive = (columns: number): WidgetPlacement => {
    const w = Math.max(1, Math.min(columns, Math.round(instance.w * columns / 12)));
    return { x: Math.max(0, Math.min(columns - w, Math.round(instance.x * columns / 12))), y: instance.y, w, h: instance.h };
  };
  return {
    desktop: instance.responsive?.desktop ?? { x: instance.x, y: instance.y, w: instance.w, h: instance.h },
    tablet: instance.responsive?.tablet ?? derive(8),
    mobile: instance.responsive?.mobile ?? { ...derive(4), x: 0, w: 4 },
  };
}
