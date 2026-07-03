/**
 * src/ui/toast/toast.test.tsx
 *
 * Tests for the Siomac toast system (toastStore + toast API + Toaster component).
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup }         from '@testing-library/preact';
import { toast, Toaster }                                  from '@ui/toast';
import { getToasts, removeToast, TOAST_EXIT_MS }           from './toastStore';

// ── Reset store between tests ─────────────────────────────────────────────────

beforeEach(() => {
  removeToast();         // clear all toasts
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── Helper: render the Toaster ────────────────────────────────────────────────

function renderToaster() {
  return render(<Toaster />);
}

// ── Store: basic CRUD ─────────────────────────────────────────────────────────

describe('toastStore', () => {
  it('starts empty', () => {
    expect(getToasts()).toHaveLength(0);
  });

  it('dismiss() with no arg clears all', () => {
    toast.success('A');
    toast.success('B');
    toast.dismiss();
    expect(getToasts()).toHaveLength(0);
  });

  it('dismiss(id) removes one (after the exit animation)', () => {
    toast.success('Stay');
    const id = toast.success('Gone');
    toast.dismiss(id);
    // Animated out first — still present until the exit window elapses.
    act(() => { vi.advanceTimersByTime(TOAST_EXIT_MS); });
    const remaining = getToasts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.message).toBe('Stay');
  });

  it('duplicate id patches existing instead of adding', () => {
    const id = 'my-id';
    toast.success('First', { id });
    toast.success('Second', { id });
    const toasts = getToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe('Second');
  });
});

// ── API: variant methods ──────────────────────────────────────────────────────

describe('toast API', () => {
  it('toast() creates a neutral toast', () => {
    toast('Hello');
    const t = getToasts()[0];
    expect(t?.variant).toBe('neutral');
    expect(t?.message).toBe('Hello');
  });

  it('toast.success() creates a success toast', () => {
    toast.success('Saved');
    expect(getToasts()[0]?.variant).toBe('success');
  });

  it('toast.error() creates an error toast with 6s default', () => {
    toast.error('Failed');
    const t = getToasts()[0];
    expect(t?.variant).toBe('error');
    expect(t?.duration).toBe(6000);
  });

  it('toast.warning() creates a warning toast with 5s default', () => {
    toast.warning('Watch out');
    expect(getToasts()[0]?.duration).toBe(5000);
  });

  it('toast.info() creates an info toast', () => {
    toast.info('FYI');
    expect(getToasts()[0]?.variant).toBe('info');
  });

  it('toast.loading() creates a sticky loading toast', () => {
    const id = toast.loading('Working…');
    const t = getToasts()[0];
    expect(t?.tier).toBe('loading');
    expect(t?.duration).toBe(0);
    expect(typeof id).toBe('string');
  });

  it('toast.action() creates an action toast with 8s default', () => {
    toast.action('Done', { label: 'Undo', onClick: vi.fn() });
    const t = getToasts()[0];
    expect(t?.tier).toBe('action');
    expect(t?.duration).toBe(8000);
    expect(t?.actions?.[0]?.label).toBe('Undo');
  });

  it('toast.rich() creates a sticky rich toast', () => {
    toast.rich({ title: 'New message', body: 'Hello there', meta: ['hr', 'employee'] });
    const t = getToasts()[0];
    expect(t?.tier).toBe('rich');
    expect(t?.title).toBe('New message');
    expect(t?.body).toBe('Hello there');
    expect(t?.duration).toBe(0);
    expect(t?.meta).toEqual(['hr', 'employee']);
  });

  it('toast.promise() shows loading then success', async () => {
    const p = Promise.resolve('result');
    const promise = toast.promise(p, { loading: 'Loading…', success: 'Done!', error: 'Failed' });
    // Loading state
    expect(getToasts()[0]?.tier).toBe('loading');
    await act(async () => { await promise.catch(() => {}); });
    const t = getToasts()[0];
    expect(t?.message).toBe('Done!');
    expect(t?.variant).toBe('success');
  });

  it('toast.promise() shows loading then error on rejection', async () => {
    const p = Promise.reject(new Error('oops'));
    try {
      await act(async () => {
        await toast.promise(p, { loading: 'Loading…', success: 'Done', error: 'Failed' });
      });
    } catch {
      // expected rejection
    }
    const t = getToasts()[0];
    expect(t?.variant).toBe('error');
    expect(t?.message).toBe('Failed');
  });

  it('returns the toast id from each method', () => {
    const id1 = toast.success('A');
    const id2 = toast.error('B');
    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
    expect(id1).not.toBe(id2);
  });
});

// ── Toaster rendering ─────────────────────────────────────────────────────────

describe('Toaster component', () => {
  it('renders nothing when there are no toasts', () => {
    renderToaster();
    expect(document.querySelector('.siomac-toaster')).toBeNull();
  });

  it('renders a toast added via toast.success()', () => {
    renderToaster();
    act(() => { toast.success('Employee saved'); });
    expect(screen.getByText('Employee saved')).toBeTruthy();
  });

  it('renders error variant with role="alert"', () => {
    renderToaster();
    act(() => { toast.error('Something broke'); });
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('renders non-error variant with role="status"', () => {
    renderToaster();
    act(() => { toast.success('Saved'); });
    const statuses = screen.getAllByRole('status');
    expect(statuses.length).toBeGreaterThan(0);
  });

  it('renders critical with role="alert"', () => {
    renderToaster();
    act(() => { toast('Critical!', { id: 'crit-1' }); });
    // Force variant to critical via rich
    act(() => { toast.rich({ title: 'System alert', variant: 'critical' }); });
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('dismisses a toast when the dismiss button is clicked', () => {
    renderToaster();
    act(() => { toast.info('Hello'); });
    expect(screen.getByText('Hello')).toBeTruthy();
    const dismissBtn = screen.getByLabelText('Dismiss notification');
    fireEvent.click(dismissBtn);
    act(() => { vi.advanceTimersByTime(TOAST_EXIT_MS); });
    expect(screen.queryByText('Hello')).toBeNull();
  });

  it('auto-dismisses after the duration expires', () => {
    renderToaster();
    act(() => { toast.success('Auto gone', { duration: 1000 }); });
    expect(screen.getByText('Auto gone')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1100); });          // duration fires
    act(() => { vi.advanceTimersByTime(TOAST_EXIT_MS); });  // exit animation
    expect(screen.queryByText('Auto gone')).toBeNull();
  });

  it('renders all toast cards in the DOM (deck stacking — no overflow pill)', () => {
    renderToaster();
    act(() => {
      for (let i = 0; i < 6; i++) toast.info(`Toast ${i}`, { duration: 0 });
    });
    // All 6 cards must be in the DOM (stacked via absolute transforms, not hidden)
    const cards = document.querySelectorAll('.toast-card');
    expect(cards.length).toBe(6);
    // No "+N more" pill in the new architecture
    const pill = document.querySelector('.toast-overflow-pill');
    expect(pill).toBeNull();
    // Older toasts (beyond MAX_PEEK=3) carry the hidden class
    const hiddenCards = document.querySelectorAll('.toast-card--hidden');
    expect(hiddenCards.length).toBeGreaterThan(0);
  });

  it('renders rich toast with title, body, and meta', () => {
    renderToaster();
    act(() => {
      toast.rich({ title: 'New notification', body: 'You have a message', meta: ['hse', 'incident'] });
    });
    expect(screen.getByText('New notification')).toBeTruthy();
    expect(screen.getByText('You have a message')).toBeTruthy();
    expect(screen.getByText('hse')).toBeTruthy();
    expect(screen.getByText('incident')).toBeTruthy();
  });

  it('action button calls onClick and dismisses toast', async () => {
    renderToaster();
    const onClickMock = vi.fn().mockReturnValue(undefined);
    act(() => {
      toast.action('Something happened', { label: 'Undo', onClick: onClickMock });
    });
    const undoBtn = screen.getByText('Undo');
    await act(async () => { fireEvent.click(undoBtn); });
    expect(onClickMock).toHaveBeenCalledOnce();
    act(() => { vi.advanceTimersByTime(TOAST_EXIT_MS); });
    expect(screen.queryByText('Something happened')).toBeNull();
  });

  it('action onClick returning false keeps toast open', async () => {
    renderToaster();
    const keepOpen = vi.fn().mockReturnValue(false);
    act(() => {
      toast.action('Pending', { label: 'Cancel', onClick: keepOpen, duration: 0 });
    });
    const cancelBtn = screen.getByText('Cancel');
    await act(async () => { fireEvent.click(cancelBtn); });
    expect(keepOpen).toHaveBeenCalledOnce();
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('Esc key dismisses the focused toast', () => {
    renderToaster();
    act(() => { toast.info('Press Esc', { duration: 0 }); });
    const card = document.querySelector<HTMLElement>('.toast-card');
    expect(card).toBeTruthy();
    if (card) {
      fireEvent.keyDown(card, { key: 'Escape' });
    }
    act(() => { vi.advanceTimersByTime(TOAST_EXIT_MS); });
    expect(screen.queryByText('Press Esc')).toBeNull();
  });

  it('renders without crashing under prefers-reduced-motion', () => {
    // Actual animation suppression is CSS-only; this confirms rendering doesn't break
    renderToaster();
    act(() => { toast.success('Motion safe'); });
    expect(screen.getByText('Motion safe')).toBeTruthy();
  });

  it('front toast has toast-card--front class', () => {
    renderToaster();
    act(() => {
      toast.info('First', { duration: 0 });
      toast.info('Second', { duration: 0 });
    });
    const frontCards = document.querySelectorAll('.toast-card--front');
    expect(frontCards.length).toBe(1);
  });
});
