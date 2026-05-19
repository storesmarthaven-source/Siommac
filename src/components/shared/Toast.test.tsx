/**
 * Toast.test.tsx
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act }        from '@testing-library/preact';
import { ToastContainer }                         from './Toast';
import { useUiStore, toast }                      from '@store';

// Reset store between tests
beforeEach(() => {
  useUiStore.setState({ toasts: [] });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastContainer', () => {
  it('renders nothing when there are no toasts', () => {
    render(<ToastContainer />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a toast added via the toast helper', () => {
    render(<ToastContainer />);
    act(() => { toast.success('Employee saved'); });
    expect(screen.getByText('Employee saved')).toBeTruthy();
  });

  it('dismisses a toast when the × button is clicked', () => {
    render(<ToastContainer />);
    act(() => { toast.info('Hello'); });
    expect(screen.getByText('Hello')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(screen.queryByText('Hello')).toBeNull();
  });

  it('auto-dismisses after the duration expires', () => {
    render(<ToastContainer />);
    act(() => { toast.success('Auto gone', 1000); });
    expect(screen.getByText('Auto gone')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1001); });
    expect(screen.queryByText('Auto gone')).toBeNull();
  });

  it('renders error variant with correct role', () => {
    render(<ToastContainer />);
    act(() => { toast.error('Something broke'); });
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.style.borderColor).toBeTruthy();
  });

  it('shows at most 5 toasts', () => {
    render(<ToastContainer />);
    act(() => {
      for (let i = 0; i < 8; i++) toast.info(`Toast ${i}`);
    });
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeLessThanOrEqual(5);
  });
});
