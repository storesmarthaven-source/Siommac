import type { PageConfig } from '@payslip/types';
import { pageDimensions } from '@payslip/constants/pageSizes';
import { clamp } from './geometry';

const PADDING = 92;

/** Zoom that fits the given page inside the current .canvas-wrap viewport. */
export function computeFitZoom(page: Pick<PageConfig, 'size' | 'orient'>): number {
  const wrap = document.querySelector('.canvas-wrap');
  if (!wrap) return 1;
  const [pw, ph] = pageDimensions(page);
  const availW = wrap.clientWidth - PADDING;
  const availH = wrap.clientHeight - PADDING;
  return clamp(Math.min(availW / pw, availH / ph), 0.25, 2.5);
}
