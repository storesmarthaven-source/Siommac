import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { ListSkeleton, Skeleton, WorkspaceSkeleton } from './Skeleton';
import { Spinner } from './Spinner';
import { ActivityDots } from './ActivityDots';

describe('loading states', () => {
  it('keeps skeleton geometry out of the accessibility tree', () => {
    const { container } = render(<><Skeleton width={120} height={16} /><ListSkeleton rows={3} /></>);
    expect(container.querySelectorAll('.ui-skeleton-list-row')).toHaveLength(3);
    expect(container.querySelector('.ui-skeleton')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('gives even an unlabelled compact spinner an accessible loading message', () => {
    render(<Spinner />);
    expect(screen.getByRole('status').textContent).toContain('Loading');
  });

  it('provides an accessible compositor-only activity animation', () => {
    const { container } = render(<ActivityDots label="Searching SIOMAC…" size="lg" />);
    expect(screen.getByRole('status').textContent).toContain('Searching SIOMAC');
    expect(container.querySelectorAll('.ui-activity-dots__track > span')).toHaveLength(4);
  });

  it('preserves dense workspace geometry with the canonical element-aware skeleton', () => {
    const { container } = render(<WorkspaceSkeleton columns={5} groups={2} rowsPerGroup={2} filters={3} />);

    expect(screen.getByRole('status', { name: 'Loading workspace' })).toBeTruthy();
    expect(container.querySelector('.ui-dashboard-skeleton-head')).toBeTruthy();
    expect(container.querySelector('.ui-workspace-skeleton__scope')).toBeTruthy();
    expect(container.querySelector('.ui-workspace-skeleton__toolbar')).toBeTruthy();
    expect(container.querySelectorAll('.ui-workspace-skeleton__group')).toHaveLength(2);
    expect(container.querySelectorAll('.ui-workspace-skeleton__row')).toHaveLength(4);
    expect(container.querySelectorAll('.ui-workspace-skeleton__cell')).toHaveLength(20);
    expect(container.querySelector('.ui-workspace-skeleton__inspector')).toBeTruthy();
    expect(container.querySelectorAll('.ui-workspace-skeleton__inspector-field')).toHaveLength(3);
    expect(container.querySelector('.ui-workspace-skeleton__footer')).toBeTruthy();
    expect(container.querySelectorAll('.ui-workspace-skeleton__footer-actions > .ui-skeleton')).toHaveLength(4);
  });

  it('can preserve the real page header while skeletonising only dynamic workspace content', () => {
    const { container } = render(<WorkspaceSkeleton pageHeader={false} />);

    expect(container.querySelector('.ui-dashboard-skeleton-head')).toBeNull();
    expect(container.querySelector('.ui-workspace-skeleton__scope')).toBeTruthy();
    expect(container.querySelector('.ui-workspace-skeleton__frame')).toBeTruthy();
  });
});
