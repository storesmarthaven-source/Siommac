import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { ListSkeleton, Skeleton } from './Skeleton';
import { Spinner } from './Spinner';

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
});
