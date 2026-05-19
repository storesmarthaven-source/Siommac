/**
 * Badge.test.tsx
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { describe, it, expect } from 'vitest';
import { render, screen }        from '@testing-library/preact';
import { Badge }                 from './Badge';

describe('Badge', () => {
  it('renders a domain status with the correct label', () => {
    render(<Badge status="active" />);
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('uses a custom label when provided', () => {
    render(<Badge status="pending" label="Awaiting review" />);
    expect(screen.getByText('Awaiting review')).toBeTruthy();
  });

  it('renders with an explicit variant when status is absent', () => {
    render(<Badge variant="danger" label="Overdue" />);
    const el = screen.getByText('Overdue');
    expect(el.style.background).toBe('rgb(254, 226, 226)'); // #fee2e2
  });

  it('renders the dot indicator when dot=true', () => {
    render(<Badge status="active" dot />);
    // The dot is a span with aria-hidden
    const dots = document.querySelectorAll('[aria-hidden="true"]');
    expect(dots.length).toBeGreaterThan(0);
  });

  it('maps every domain status without throwing', () => {
    const statuses = [
      'active', 'inactive', 'present', 'late', 'absent',
      'pending', 'approved', 'rejected', 'draft', 'paid',
      'completed', 'idle', 'connecting', 'connected', 'error',
    ] as const;
    for (const s of statuses) {
      expect(() => render(<Badge status={s} />)).not.toThrow();
    }
  });
});
