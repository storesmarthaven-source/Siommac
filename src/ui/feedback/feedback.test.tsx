import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Alert } from './Alert';
import { Progress } from './Progress';

describe('Alert', () => {
  it('is static by default and announces only when requested', () => {
    const { rerender } = render(<Alert tone="warning" title="Review">Check it</Alert>);
    expect(screen.getByText('Check it').closest('section')?.getAttribute('role')).toBeNull();
    rerender(<Alert tone="warning" title="Review" announce>Check it</Alert>);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('runs the dismiss action with a configurable accessible name', () => {
    const dismiss = vi.fn();
    render(<Alert onDismiss={dismiss} dismissLabel="Close notice">Saved</Alert>);
    fireEvent.click(screen.getByRole('button', { name: 'Close notice' }));
    expect(dismiss).toHaveBeenCalledOnce();
  });
});

describe('Progress', () => {
  it('clamps determinate values and exposes the exact range', () => {
    render(<Progress value={140} min={0} max={120} label="Uploading" />);
    const progress = screen.getByRole('progressbar', { name: 'Uploading' });
    expect(progress.getAttribute('aria-valuenow')).toBe('120');
    expect(progress.getAttribute('aria-valuetext')).toBe('100%');
  });

  it('omits numeric ARIA values for indeterminate progress', () => {
    render(<Progress label="Calculating payroll" shape="ring" />);
    const progress = screen.getByRole('progressbar', { name: 'Calculating payroll' });
    expect(progress.hasAttribute('aria-valuenow')).toBe(false);
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  it('honours custom value formatting', () => {
    render(<Progress value={2} max={8} label="Evidence" formatValue={(value) => `${value} of 8 files`} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('2 of 8 files');
  });
});

