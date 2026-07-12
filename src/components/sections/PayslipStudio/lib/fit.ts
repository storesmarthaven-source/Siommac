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

/**
 * Fit the page to the canvas viewport, waiting (via rAF) until .canvas-wrap has a
 * real measured size before applying the zoom. Measuring a 0-size / mid-layout box
 * yields a garbage ratio that clamps to the 25% floor (or 100% when the element
 * isn't found yet), so a naive one-shot measure can silently "do nothing" or snap
 * to the wrong zoom. Shared by the Fit button, design loads, and the initial open
 * so every fit path behaves identically. Returns a cancel fn for effect cleanup.
 */
export function fitToView(
  applyZoom: (zoom: number) => void,
  page: Pick<PageConfig, 'size' | 'orient'>,
): () => void {
  let raf = 0;
  let tries = 0;
  const step = (): void => {
    const r = document.querySelector('.canvas-wrap')?.getBoundingClientRect();
    if ((!r || r.width < 80 || r.height < 80) && tries++ < 60) {
      raf = requestAnimationFrame(step);
      return;
    }
    applyZoom(computeFitZoom(page));
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
