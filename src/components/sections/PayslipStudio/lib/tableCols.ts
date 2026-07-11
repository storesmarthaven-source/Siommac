import type { TableElement } from '@payslip/types';

/** Minimum width any single column may shrink to (fraction of table width). */
export const MIN_COL_FR = 0.06;

/** Number of visible columns for the table's current layout. */
export function columnCount(el: TableElement): number {
  return el.showHoursRate ? 4 : 2;
}

const DEFAULT_FR: Record<number, number[]> = {
  2: [0.68, 0.32],
  4: [0.4, 0.18, 0.18, 0.24],
};

/**
 * Resolved column widths as fractions summing to 1. Falls back to sensible
 * defaults when no custom widths are stored (or the stored set is stale after
 * toggling the Hours/Rate columns).
 */
export function columnFractions(el: TableElement): number[] {
  const n = columnCount(el);
  const fr = el.colFr;
  if (fr && fr.length === n) {
    const sum = fr.reduce((a, b) => a + b, 0) || 1;
    return fr.map((x) => x / sum);
  }
  return DEFAULT_FR[n]!;
}

/** X positions (in element space, px) of each internal column boundary. */
export function columnBoundaries(el: TableElement): number[] {
  const pad = el.padding ?? 0;
  const bw = el.borderW ?? 0;
  const innerW = Math.max(1, el.w - pad * 2 - bw * 2);
  const fr = columnFractions(el);
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < fr.length - 1; i++) {
    acc += fr[i]!;
    out.push(pad + bw + acc * innerW);
  }
  return out;
}
