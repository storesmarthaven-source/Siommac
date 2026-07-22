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
