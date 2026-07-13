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
