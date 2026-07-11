/** Smart alignment guides: snap a dragged element to page + peer edges/centres. */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapResult {
  /** Snapped position (falls back to the proposed position on the axis when nothing aligns). */
  x: number;
  y: number;
  /** Design-space guide lines to draw (vertical positions, horizontal positions). */
  guidesX: number[];
  guidesY: number[];
}

/** Nearest line within `tol` of any of the moving element's candidate lines. */
function bestSnap(movingLines: number[], targetLines: number[], tol: number): { delta: number; line: number } | null {
  let best: { delta: number; line: number } | null = null;
  let bestAbs = tol + 1;
  for (const m of movingLines) {
    for (const t of targetLines) {
      const d = t - m;
      const abs = Math.abs(d);
      if (abs <= tol && abs < bestAbs) {
        bestAbs = abs;
        best = { delta: d, line: t };
      }
    }
  }
  return best;
}

/**
 * Compute the snapped position of `moving` against page bounds and every peer box.
 * `tol` is the snap radius in design pixels (pass ~6/zoom to keep it screen-consistent).
 */
/** Candidate snap lines (page thirds + every peer edge/centre) on each axis. */
function snapLines(others: Box[], page: { w: number; h: number }): { x: number[]; y: number[] } {
  const x = [0, page.w / 2, page.w];
  const y = [0, page.h / 2, page.h];
  for (const o of others) {
    x.push(o.x, o.x + o.w / 2, o.x + o.w);
    y.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { x, y };
}

function nearestLine(v: number, lines: number[], tol: number): number | null {
  let best: number | null = null;
  let bestAbs = tol + 1;
  for (const l of lines) {
    const abs = Math.abs(l - v);
    if (abs <= tol && abs < bestAbs) {
      bestAbs = abs;
      best = l;
    }
  }
  return best;
}

export interface ResizeSnapResult {
  x: number;
  y: number;
  w: number;
  h: number;
  guidesX: number[];
  guidesY: number[];
}

/**
 * Snap the edges being dragged during a resize to page/peer lines. Only the edges
 * implied by `dir` move; the opposite edges stay put. Returns the adjusted rect and
 * the guide lines to draw. `minW`/`minH` keep the box from collapsing past the snap.
 */
export function snapResize(
  rect: Box,
  dir: string,
  others: Box[],
  page: { w: number; h: number },
  tol: number,
  minW: number,
  minH: number,
): ResizeSnapResult {
  const lines = snapLines(others, page);
  let { x, y, w, h } = rect;
  const guidesX: number[] = [];
  const guidesY: number[] = [];

  if (dir.includes('w')) {
    const snap = nearestLine(x, lines.x, tol);
    if (snap != null && x + w - snap >= minW) {
      w = x + w - snap;
      x = snap;
      guidesX.push(snap);
    }
  }
  if (dir.includes('e')) {
    const snap = nearestLine(x + w, lines.x, tol);
    if (snap != null && snap - x >= minW) {
      w = snap - x;
      guidesX.push(snap);
    }
  }
  if (dir.includes('n')) {
    const snap = nearestLine(y, lines.y, tol);
    if (snap != null && y + h - snap >= minH) {
      h = y + h - snap;
      y = snap;
      guidesY.push(snap);
    }
  }
  if (dir.includes('s')) {
    const snap = nearestLine(y + h, lines.y, tol);
    if (snap != null && snap - y >= minH) {
      h = snap - y;
      guidesY.push(snap);
    }
  }

  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), guidesX, guidesY };
}

export function computeSnap(moving: Box, others: Box[], page: { w: number; h: number }, tol: number): SnapResult {
  const targetX = [0, page.w / 2, page.w];
  const targetY = [0, page.h / 2, page.h];
  for (const o of others) {
    targetX.push(o.x, o.x + o.w / 2, o.x + o.w);
    targetY.push(o.y, o.y + o.h / 2, o.y + o.h);
  }

  const movX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const movY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  const sx = bestSnap(movX, targetX, tol);
  const sy = bestSnap(movY, targetY, tol);

  return {
    x: sx ? Math.round(moving.x + sx.delta) : moving.x,
    y: sy ? Math.round(moving.y + sy.delta) : moving.y,
    guidesX: sx ? [sx.line] : [],
    guidesY: sy ? [sy.line] : [],
  };
}
