export const GRID = 10;

export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

export function snapValue(v: number, snap: boolean): number {
  return snap ? Math.round(v / GRID) * GRID : Math.round(v);
}

export type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_W = 20;
export const MIN_H = 10;

/** Apply a resize delta (in page px) to a rect for a given handle direction. */
export function resizeRect(start: Rect, dir: ResizeDir, dx: number, dy: number, snap: boolean): Rect {
  let { x, y, w, h } = start;
  if (dir.includes('e')) w = Math.max(MIN_W, snapValue(start.w + dx, snap));
  if (dir.includes('s')) h = Math.max(MIN_H, snapValue(start.h + dy, snap));
  if (dir.includes('w')) {
    const nw = Math.max(MIN_W, snapValue(start.w - dx, snap));
    x = snapValue(start.x + (start.w - nw), snap);
    w = nw;
  }
  if (dir.includes('n')) {
    const nh = Math.max(MIN_H, snapValue(start.h - dy, snap));
    y = snapValue(start.y + (start.h - nh), snap);
    h = nh;
  }
  return { x, y, w, h };
}
