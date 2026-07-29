import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { DashboardPageSkeleton, WidgetSkeleton } from '../../src/ui/components/Skeleton';

describe('UI-kit loading standards', () => {
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

  it('provides reusable widget density variants', () => {
    const { container } = render(<WidgetSkeleton variant="chart" />);
    expect(container.querySelector('.ui-widget-skeleton--chart')).not.toBeNull();
    expect(container.querySelector('.ui-widget-skeleton-chart')).not.toBeNull();
  });
});
