export const WIDGET_BOARD_REVEAL_EVENT = 'siomac:widget-board-reveal';

export interface WidgetBoardRevealDetail {
  pageKey: string;
  zoneId: string;
  instanceIds: string[];
}

export function requestWidgetBoardReveal(detail: WidgetBoardRevealDetail): void {
  document.dispatchEvent(new CustomEvent<WidgetBoardRevealDetail>(WIDGET_BOARD_REVEAL_EVENT, { detail }));
  // The host application still contains independently mounted Preact islands. Wait two frames so
  // both the page state update and react-grid-layout child commit have completed, then operate on
  // the canonical instance-id contract instead of transient component refs/classes.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const requested = new Set(detail.instanceIds);
    const elements = [...document.querySelectorAll<HTMLElement>('[data-widget-instance-id]')]
      .filter(element => requested.has(element.dataset.widgetInstanceId ?? ''));
    elements[0]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const element of elements) {
      if (!reducedMotion && typeof element.animate === 'function') {
        element.animate([
          { boxShadow: '0 0 0 4px rgba(100,116,139,.28)' },
          { boxShadow: '0 0 0 0 rgba(100,116,139,0)' },
        ], { duration: 1600, easing: 'ease-out' });
      } else {
        element.dataset.widgetRevealed = 'true';
        window.setTimeout(() => { delete element.dataset.widgetRevealed; }, 1600);
      }
    }
  }));
}
