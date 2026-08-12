/**
 * Dialog.test.tsx — the overlay contract.
 *
 * Focus trapping, focus return, Escape, and the busy state. These are the parts
 * a keyboard or screen-reader user depends on entirely, and the parts that are
 * invisible in a screenshot.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Dialog } from './Dialog';

function Basic(props: { onClose?: () => void; busy?: boolean; closeOnBackdrop?: boolean; closeOnEscape?: boolean }): VNode {
  const close = props.onClose ?? ((): void => { /* noop */ });
  return (
    <Dialog open onClose={close} busy={props.busy} closeOnBackdrop={props.closeOnBackdrop} closeOnEscape={props.closeOnEscape}>
      <Dialog.Header title="Approve payment" sub="PAY-0041" onClose={close} />
      <Dialog.Body>
        <input aria-label="Reason" />
        <button type="button">Middle</button>
      </Dialog.Body>
      <Dialog.Footer>
        <button type="button">Confirm</button>
      </Dialog.Footer>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Dialog open={false} onClose={vi.fn()}><Dialog.Body>x</Dialog.Body></Dialog>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a modal dialog when open', () => {
    render(<Basic />);
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
  });

  it('labels itself with its own title', () => {
    // Without this a screen reader announces only "dialog".
    render(<Basic />);
    const dlg = screen.getByRole('dialog');
    const labelId = dlg.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe('Approve payment');
  });

  it('gives two open dialogs distinct title ids', () => {
    // A confirm opened over a form must not inherit the form's title.
    render(
      <>
        <Dialog open onClose={vi.fn()}><Dialog.Header title="First" /></Dialog>
        <Dialog open onClose={vi.fn()}><Dialog.Header title="Second" /></Dialog>
      </>,
    );
    const [a, b] = screen.getAllByRole('dialog');
    expect(a?.getAttribute('aria-labelledby')).not.toBe(b?.getAttribute('aria-labelledby'));
  });

  it('portals to document.body, not into its invoking tree', () => {
    // A fixed element inside a transformed ancestor (every react-grid-layout
    // tile) positions against that ancestor and is clipped by it.
    const { container } = render(<div style={{ transform: 'translate(10px, 10px)' }}><Basic /></div>);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  // ── Focus ─────────────────────────────────────────────────────────────────

  it('moves focus into the dialog on open', () => {
    render(<Basic />);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('traps Tab within the dialog', () => {
    render(<Basic />);
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    // Tab from the last focusable wraps to the first, never out of the sheet.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(confirm);
  });

  it('wraps backwards on Shift+Tab from the first focusable', () => {
    render(<Basic />);
    const first = screen.getByRole('button', { name: 'Close' });
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm' }));
  });

  it('returns focus to the opener on close', () => {
    function Harness(): VNode {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          <Dialog open={open} onClose={() => setOpen(false)}>
            <Dialog.Header title="Sheet" />
            <Dialog.Body><button type="button">Inside</button></Dialog.Body>
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  // ── Dismissal ─────────────────────────────────────────────────────────────

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Basic onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on Escape when closeOnEscape is false', () => {
    const onClose = vi.fn();
    render(<Basic onClose={onClose} closeOnEscape={false} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click', () => {
    const onClose = vi.fn();
    const { container } = render(<Basic onClose={onClose} />);
    void container;
    const backdrop = document.querySelector('.ui-dialog-backdrop')!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores a click that started inside the sheet', () => {
    const onClose = vi.fn();
    render(<Basic onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on backdrop when closeOnBackdrop is false', () => {
    // The setting that protects a dialog holding unsaved input.
    const onClose = vi.fn();
    render(<Basic onClose={onClose} closeOnBackdrop={false} />);
    fireEvent.click(document.querySelector('.ui-dialog-backdrop')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes via the header close button', () => {
    const onClose = vi.fn();
    render(<Basic onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  // ── Busy ──────────────────────────────────────────────────────────────────

  it('marks itself aria-busy and blocks dismissal while submitting', () => {
    const onClose = vi.fn();
    render(<Basic onClose={onClose} busy />);
    expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true');
    fireEvent.click(document.querySelector('.ui-dialog-backdrop')!);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the close button reachable while busy so a hung request can be escaped', () => {
    const onClose = vi.fn();
    render(<Basic onClose={onClose} busy />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  // ── Structure ─────────────────────────────────────────────────────────────

  it('applies size and variant recipe classes', () => {
    render(
      <Dialog open onClose={vi.fn()} size="xl" variant="destructive">
        <Dialog.Header title="Delete" />
      </Dialog>,
    );
    const dlg = screen.getByRole('dialog');
    expect(dlg.className).toContain('ui-dialog--xl');
    expect(dlg.className).toContain('ui-dialog--destructive');
  });

  it('renders a left-aligned footer slot', () => {
    render(
      <Dialog open onClose={vi.fn()}>
        <Dialog.Header title="Wizard" />
        <Dialog.Footer left={<button type="button">Back</button>}>
          <button type="button">Next</button>
        </Dialog.Footer>
      </Dialog>,
    );
    const left = document.querySelector('.ui-dialog-foot-left');
    expect(left?.textContent).toBe('Back');
  });

  it('omits the close button when no onClose is given to the header', () => {
    // A dialog that must be resolved by its own actions.
    render(
      <Dialog open onClose={vi.fn()}>
        <Dialog.Header title="Must decide" />
      </Dialog>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('restores body scroll when it unmounts', () => {
    document.body.style.overflow = '';   // isolate from any earlier overlay
    const { unmount } = render(<Basic />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
