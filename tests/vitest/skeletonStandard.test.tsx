import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { DashboardPageSkeleton, PageHeaderSkeleton, WidgetSkeleton } from '../../src/ui/components/Skeleton';

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

  it('provides a complete dashboard cold state including widgets and register rows', () => {
    const { container } = render(
      <DashboardPageSkeleton title="Loading Employee Master" kpiCount={4} widgetCount={3} includeTable />,
    );

    const root = container.querySelector('.ui-dashboard-skeleton');
    expect(root?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('.ui-skeleton-stat-card')).toHaveLength(4);
    expect(container.querySelectorAll('.ui-widget-skeleton')).toHaveLength(3);
    expect(container.querySelectorAll('.ui-skeleton-row')).toHaveLength(7);
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
