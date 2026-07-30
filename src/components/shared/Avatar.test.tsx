/**
 * Avatar.test.tsx
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { describe, it, expect }    from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { Avatar }                    from './Avatar';

describe('Avatar', () => {
  it('renders an img when src is provided', () => {
    render(<Avatar name="Jane Doe" src="https://example.com/photo.jpg" />);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- getByRole returns HTMLElement; cast needed for .src
    const img = screen.getByRole('img', { name: 'Jane Doe' }) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.src).toContain('photo.jpg');
  });

  it('falls back to initials when src is absent', () => {
    render(<Avatar name="Jane Doe" />);
    expect(screen.getByText('JD')).toBeTruthy();
  });

  it('falls back to initials on image error', () => {
    render(<Avatar name="Jane Doe" src="https://broken.example.com/photo.jpg" />);
    const img = document.querySelector('img')!;
    fireEvent.error(img);
    expect(screen.getByText('JD')).toBeTruthy();
  });

  it('derives single-word initials correctly', () => {
    render(<Avatar name="Prince" />);
    expect(screen.getByText('P')).toBeTruthy();
  });

  it('ignores a leading honorific', () => {
    render(<Avatar name="Dr. Camille Joseph" />);
    expect(screen.getByText('CJ')).toBeTruthy();
  });

  it('ignores a trailing generational suffix', () => {
    render(<Avatar name="Terrence Baptiste Jr." />);
    expect(screen.getByText('TB')).toBeTruthy();
  });

  it('keeps a mononym that collides with a suffix word', () => {
    // "Sr" alone is the whole name here, not an honorific to strip.
    render(<Avatar name="Sr" />);
    expect(screen.getByText('S')).toBeTruthy();
  });

  it('handles hyphenated surnames', () => {
    render(<Avatar name="Shivani Boodoo-Persad" />);
    expect(screen.getByText('SB')).toBeTruthy();
  });

  it('gives the same colour for the same seed regardless of name', () => {
    const { container: a } = render(<Avatar name="Anisa Mohammed" seed="emp-1" />);
    const { container: b } = render(<Avatar name="Anisa Ramsundar" seed="emp-1" />);
    const bg = (c: Element): string => {
      const el = c.firstElementChild;
      return el instanceof HTMLElement ? el.style.background : '';
    };
    expect(bg(a)).toBe(bg(b));
  });

  it('renders the generic icon for an empty name', () => {
    render(<Avatar name="" />);
    expect(screen.getByLabelText('Unknown user')).toBeTruthy();
  });

  it('applies circle border-radius by default', () => {
    render(<Avatar name="Jane Doe" />);
    const el = screen.getByLabelText('Jane Doe');
    expect(el.style.borderRadius).toBe('50%');
  });

  it('applies square border-radius when variant="square"', () => {
    render(<Avatar name="Jane Doe" variant="square" />);
    const el = screen.getByLabelText('Jane Doe');
    expect(el.style.borderRadius).toBe('6px');
  });

  it('uses the given size', () => {
    render(<Avatar name="Jane Doe" size={64} />);
    const el = screen.getByLabelText('Jane Doe');
    expect(el.style.width).toBe('64px');
  });
});
