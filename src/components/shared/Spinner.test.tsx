/**
 * Spinner.test.tsx
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { describe, it, expect } from 'vitest';
import { render, screen }       from '@testing-library/preact';
import { Spinner }              from './Spinner';

describe('Spinner', () => {
  it('renders with default label', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByLabelText('Loading…')).toBeTruthy();
  });

  it('renders with a custom label', () => {
    render(<Spinner label="Fetching employees" />);
    expect(screen.getByLabelText('Fetching employees')).toBeTruthy();
  });

  it('renders in fullPage mode with correct structure', () => {
    render(<Spinner fullPage />);
    const el = screen.getByRole('status');
    expect(el.style.minHeight).toBe('200px');
  });

  it('renders the svg with the correct size', () => {
    render(<Spinner size={16} />);
    const svg = document.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
  });
});
