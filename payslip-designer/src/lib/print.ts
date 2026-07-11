import type { PageConfig } from '@/types';
import { PRINT_PAPER } from '@/constants/pageSizes';

const STYLE_ID = 'print-page-rule';

/** Match the print paper to the design's size + orientation, then invoke print. */
export function printDesign(page: PageConfig): void {
  const paper = PRINT_PAPER[page.size];
  const orient = page.orient === 'landscape' ? 'landscape' : 'portrait';

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${paper} ${orient}; margin: 0; }`;

  // Allow the print stylesheet + @page rule to apply before the dialog opens.
  window.setTimeout(() => window.print(), 60);
}
