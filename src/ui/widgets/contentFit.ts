export interface WidgetContentFitResult {
  fits: boolean;
  reasons: string[];
  horizontalOverflow: boolean;
  verticalOverflow: boolean;
}

const TOLERANCE = 1;

function overflows(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth + TOLERANCE
    || element.scrollHeight > element.clientHeight + TOLERANCE;
}

function intersects(a: DOMRect, b: DOMRect): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > TOLERANCE
    && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > TOLERANCE;
}

/** Checks required widget content at its currently rendered size. Definitions provide the hard
 * grid/pixel floor; this runtime check catches dynamic text, zoom, localization, and populated
 * states that exceed that declared floor. Optional content must not be tagged as required. */
export function checkWidgetContentFit(container: HTMLElement): WidgetContentFitResult {
  const reasons: string[] = [];
  const boundary = container.getBoundingClientRect();
  let horizontalOverflow = container.scrollWidth > container.clientWidth + TOLERANCE;
  let verticalOverflow = container.scrollHeight > container.clientHeight + TOLERANCE;

  if (overflows(container)) reasons.push('container-overflow');

  const required = [...container.querySelectorAll<HTMLElement>('[data-widget-fit-required]')];
  for (const element of required) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden') reasons.push('required-content-hidden');
    const outsideHorizontal = rect.left < boundary.left - TOLERANCE || rect.right > boundary.right + TOLERANCE;
    const outsideVertical = rect.top < boundary.top - TOLERANCE || rect.bottom > boundary.bottom + TOLERANCE;
    if (outsideHorizontal || outsideVertical) {
      reasons.push('required-content-outside');
      horizontalOverflow ||= outsideHorizontal;
      verticalOverflow ||= outsideVertical;
    }
    if (overflows(element)) {
      reasons.push('required-content-overflow');
      horizontalOverflow ||= element.scrollWidth > element.clientWidth + TOLERANCE;
      verticalOverflow ||= element.scrollHeight > element.clientHeight + TOLERANCE;
    }
    const minWidth = Number(element.dataset.widgetMinWidth ?? 0);
    const minHeight = Number(element.dataset.widgetMinHeight ?? 0);
    const belowMinWidth = !!minWidth && rect.width + TOLERANCE < minWidth;
    const belowMinHeight = !!minHeight && rect.height + TOLERANCE < minHeight;
    if (belowMinWidth || belowMinHeight) {
      reasons.push('required-content-too-small');
      horizontalOverflow ||= belowMinWidth;
      verticalOverflow ||= belowMinHeight;
    }
  }

  for (const element of container.querySelectorAll<HTMLElement>('[data-widget-fit-full-text]')) {
    if (overflows(element)) {
      reasons.push('required-text-truncated');
      horizontalOverflow ||= element.scrollWidth > element.clientWidth + TOLERANCE;
      verticalOverflow ||= element.scrollHeight > element.clientHeight + TOLERANCE;
    }
  }

  const groups = container.querySelectorAll<HTMLElement>('[data-widget-fit-group]');
  for (const group of groups) {
    const peers = [...group.querySelectorAll<HTMLElement>(':scope > [data-widget-fit-no-overlap]')];
    for (let i = 0; i < peers.length; i += 1) {
      for (let j = i + 1; j < peers.length; j += 1) {
        const first = peers[i];
        const second = peers[j];
        if (first && second && intersects(first.getBoundingClientRect(), second.getBoundingClientRect())) {
          reasons.push('required-content-overlap');
          horizontalOverflow = true;
        }
      }
    }
  }

  return { fits: reasons.length === 0, reasons: [...new Set(reasons)], horizontalOverflow, verticalOverflow };
}
