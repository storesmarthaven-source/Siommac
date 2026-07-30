import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { PageHeaderSkeleton, WidgetSkeleton } from '../../src/ui/components/Skeleton';

describe('UI-kit loading standards', () => {
  it('provides a page-header cold state', () => {
    const { container } = render(<PageHeaderSkeleton />);

    const head = container.querySelector('.ui-dashboard-skeleton-head');
    expect(head).not.toBeNull();
    // The header placeholder is inert: the page owns the single aria-busy announcement,
    // so a screen reader hears "loading" once instead of once per shimmer block.
    expect(head?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('.ui-skeleton').length).toBeGreaterThan(0);
  });

  it('provides reusable widget density variants', () => {
    const { container } = render(<WidgetSkeleton variant="chart" />);
    expect(container.querySelector('.ui-widget-skeleton--chart')).not.toBeNull();
    expect(container.querySelector('.ui-widget-skeleton-chart')).not.toBeNull();
  });

  it('covers every density a board tile can declare', () => {
    for (const variant of ['metric', 'card', 'chart', 'list', 'table'] as const) {
      const { container } = render(<WidgetSkeleton variant={variant} />);
      expect(container.querySelector(`.ui-widget-skeleton--${variant}`), variant).not.toBeNull();
      expect(container.querySelector('.ui-widget-skeleton')?.getAttribute('aria-busy'), variant).toBe('true');
    }
  });

  it('gives a table tile real register rows rather than paragraph lines', () => {
    const { container } = render(<WidgetSkeleton variant="table" />);
    expect(container.querySelectorAll('.ui-skeleton-row')).toHaveLength(7);
    expect(container.querySelector('.ui-skeleton-cell--avatar')).not.toBeNull();
  });
});
