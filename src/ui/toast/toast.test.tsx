/**
 * src/ui/toast/toast.test.tsx
 *
 * Tests for the Siomac toast system (toastStore + toast API + Toaster component).
 * Updated for the verbatim reference port (cpop-toast grid, no deck stacking).
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

  it('toast.rich() stores summary and note fields', () => {
    toast.rich({
      title:   'Test',
      summary: [{ label: 'Employee', value: 'Jane Doe' }],
      note:    'This is a note',
    });
    const t = getToasts()[0];
    expect(t?.summary).toEqual([{ label: 'Employee', value: 'Jane Doe' }]);
    expect(t?.note).toBe('This is a note');
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
    expect(document.querySelector('.cpop-toasts')).toBeNull();
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
    act(() => { toast.rich({ title: 'System alert', variant: 'critical' }); });
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('card element uses the cpop-toast class', () => {
    renderToaster();
    act(() => { toast.info('Hello'); });
    const card = document.querySelector('.cpop-toast');
    expect(card).toBeTruthy();
  });

  it('card has the variant class (cpop-toast-info for info)', () => {
    renderToaster();
    act(() => { toast.info('Hello'); });
    const card = document.querySelector('.cpop-toast-info');
    expect(card).toBeTruthy();
  });

  it('card has tier-normal class for normal toasts', () => {
    renderToaster();
    act(() => { toast.success('Simple'); });
    const card = document.querySelector('.tier-normal');
    expect(card).toBeTruthy();
  });

  it('action toast does NOT have tier-normal class', () => {
    renderToaster();
    act(() => { toast.action('Done', { label: 'Undo', onClick: vi.fn() }); });
    const tieredNormal = document.querySelector('.tier-normal');
    const cards = document.querySelectorAll('.cpop-toast');
    expect(cards.length).toBe(1);
    expect(tieredNormal).toBeNull();
    expect(screen.getByText('Undo')).toBeTruthy();
  });

  it('renders the title dot element', () => {
    renderToaster();
    act(() => { toast.success('Check'); });
    const dot = document.querySelector('.cpop-toast-dot');
    expect(dot).toBeTruthy();
  });

  it('renders title in .cpop-toast-title', () => {
    renderToaster();
    act(() => { toast.rich({ title: 'My Title', body: 'Body text' }); });
    const titleEl = document.querySelector('.cpop-toast-title');
    expect(titleEl?.textContent).toBe('My Title');
  });

  it('renders body text in .cpop-toast-text', () => {
    renderToaster();
    act(() => { toast.rich({ title: 'Title', body: 'Body text here' }); });
    const textEl = document.querySelector('.cpop-toast-text');
    expect(textEl?.textContent).toBe('Body text here');
  });

  it('renders kicker chips in .cpop-toast-chip', () => {
    renderToaster();
    act(() => {
      toast.rich({ title: 'Tagged', meta: ['Finance Payroll', 'Due today'] });
    });
    const chips = document.querySelectorAll('.cpop-toast-chip');
    expect(chips.length).toBe(2);
    expect(chips[0]?.textContent).toBe('Finance Payroll');
    expect(chips[1]?.textContent).toBe('Due today');
  });

  it('renders summary rows in .cpop-action-line', () => {
    renderToaster();
    act(() => {
      toast.rich({
        title: 'Approval',
        summary: [
          { label: 'Employee', value: 'Marcus James' },
          { label: 'Ref',      value: 'PIT-1042' },
        ],
      });
    });
    const lines = document.querySelectorAll('.cpop-action-line');
    expect(lines.length).toBe(2);
    const labels = document.querySelectorAll('.cpop-action-label');
    expect(labels[0]?.textContent).toBe('Employee');
    expect(labels[1]?.textContent).toBe('Ref');
    const values = document.querySelectorAll('.cpop-action-value');
    expect(values[0]?.textContent).toBe('Marcus James');
    expect(values[1]?.textContent).toBe('PIT-1042');
  });

  it('renders note in .cpop-action-note', () => {
    renderToaster();
    act(() => {
      toast.rich({ title: 'Note toast', note: 'This is the note line.' });
    });
    const noteEl = document.querySelector('.cpop-action-note');
    expect(noteEl?.textContent).toBe('This is the note line.');
  });

  it('renders a countdown badge when duration > 0', () => {
    renderToaster();
    act(() => { toast.success('With countdown', { duration: 5000 }); });
    const badge = document.querySelector('.cpop-toast-countdown');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toMatch(/^\d+s$/);
  });

  it('does NOT render countdown badge when duration is 0 (sticky)', () => {
    renderToaster();
    act(() => { toast.rich({ title: 'Sticky', duration: 0 }); });
    const badge = document.querySelector('.cpop-toast-countdown');
    expect(badge).toBeNull();
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

  it('dismiss button has aria-label="Dismiss notification"', () => {
    renderToaster();
    act(() => { toast.warning('Warn me'); });
    const btn = screen.getByLabelText('Dismiss notification');
    expect(btn).toBeTruthy();
    expect(btn.tagName.toLowerCase()).toBe('button');
  });

  it('auto-dismisses after the duration expires', () => {
    renderToaster();
    act(() => { toast.success('Auto gone', { duration: 1000 }); });
    expect(screen.getByText('Auto gone')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1100); });          // duration fires
    act(() => { vi.advanceTimersByTime(TOAST_EXIT_MS); });  // exit animation
    expect(screen.queryByText('Auto gone')).toBeNull();
  });

  it('renders all toast cards in the DOM (simple grid, no hidden cards)', () => {
    renderToaster();
    act(() => {
      for (let i = 0; i < 6; i++) toast.info(`Toast ${i}`, { duration: 0 });
    });
    // All 6 cards must be in the DOM — simple grid, no stacking/hiding
    const cards = document.querySelectorAll('.cpop-toast');
    expect(cards.length).toBe(6);
    // No deck-hidden or overflow-pill elements
    const pill = document.querySelector('.toast-overflow-pill');
    expect(pill).toBeNull();
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
    const card = document.querySelector<HTMLElement>('.cpop-toast');
    expect(card).toBeTruthy();
    if (card) {
      fireEvent.keyDown(card, { key: 'Escape' });
    }
    act(() => { vi.advanceTimersByTime(TOAST_EXIT_MS); });
    expect(screen.queryByText('Press Esc')).toBeNull();
  });

  it('renders without crashing under prefers-reduced-motion', () => {
    renderToaster();
    act(() => { toast.success('Motion safe'); });
    expect(screen.getByText('Motion safe')).toBeTruthy();
  });

  it('action strip buttons are in .cpop-toast-actions container', () => {
    renderToaster();
    act(() => {
      toast.action('NIS pending', { label: 'Verify', onClick: vi.fn() });
    });
    const actionsRow = document.querySelector('.cpop-toast-actions');
    expect(actionsRow).toBeTruthy();
    const btn = actionsRow?.querySelector('.cpop-toast-action');
    expect(btn?.textContent).toBe('Verify');
  });

  it('container uses .cpop-toasts class', () => {
    renderToaster();
    act(() => { toast.info('Hello'); });
    expect(document.querySelector('.cpop-toasts')).toBeTruthy();
  });

  it('newest toast is rendered first in the DOM (top of grid)', () => {
    renderToaster();
    act(() => {
      toast.info('First', { duration: 0 });
      toast.info('Second', { duration: 0 });
    });
    const cards = document.querySelectorAll('.cpop-toast');
    // Second (newest) should be first in DOM
    expect(cards[0]?.textContent).toContain('Second');
    expect(cards[1]?.textContent).toContain('First');
  });

  it('exiting toast gets toast-card--exiting class', () => {
    renderToaster();
    act(() => { toast.info('Exiting toast', { duration: 0 }); });
    const toastList = getToasts();
    const id = toastList[0]?.id;
    expect(id).toBeTruthy();
    if (id) {
      act(() => { toast.dismiss(id); });
    }
    const exiting = document.querySelector('.toast-card--exiting');
    expect(exiting).toBeTruthy();
  });
});
