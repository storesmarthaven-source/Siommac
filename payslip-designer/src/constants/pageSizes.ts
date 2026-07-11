import type { Orientation, PageConfig, PageSize } from '@/types';

/** Portrait pixel dimensions (96dpi). Landscape swaps width/height. */
export const PAGE_SIZES: Record<PageSize, readonly [number, number]> = {
  a4: [794, 1123],
  letter: [816, 1056],
  legal: [816, 1344],
  a5: [559, 794],
  half: [559, 794], // Half A4 == A5 (148×210mm)
};

export const PAGE_SIZE_LABELS: Record<PageSize, string> = {
  a4: 'A4 (210×297)',
  letter: 'Letter (216×279)',
  legal: 'Legal (216×356)',
  a5: 'A5 (148×210)',
  half: 'Half A4 / A5 (148×210)',
};

/** Paper name used for the print `@page` rule. */
export const PRINT_PAPER: Record<PageSize, string> = {
  a4: 'A4',
  letter: 'letter',
  legal: 'legal',
  a5: 'A5',
  half: 'A5',
};

/** Resolved on-screen dimensions for a page, honouring orientation. */
export function pageDimensions(page: Pick<PageConfig, 'size' | 'orient'>): [number, number] {
  const [w, h] = PAGE_SIZES[page.size];
  return page.orient === 'landscape' ? [h, w] : [w, h];
}

export function isLandscape(orient: Orientation): boolean {
  return orient === 'landscape';
}
