/**
 * Modal.test.tsx
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { describe, it, expect, vi }  from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { type VNode }                from 'preact';
import { useState }                  from 'preact/hooks';
import { Modal }                     from './Modal';

// Wrapper that manages open state
function _Controlled({ closeOnBackdrop = true, closeOnEscape = true } = {}): VNode {
  const [open, setOpen] = useState(true);
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Test Dialog"
      closeOnBackdrop={closeOnBackdrop}
      closeOnEscape={closeOnEscape}
    >
      <p>Dialog content</p>
      <button type="button">Focusable</button>
    </Modal>
  );
}

describe('Modal', () => {
  it('renders nothing when open=false', () => {
    render(<Modal open={false} onClose={vi.fn()} title="Hidden"><p>x</p></Modal>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog when open=true', () => {
    render(<Modal open onClose={vi.fn()} title="My Dialog"><p>content</p></Modal>);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('My Dialog')).toBeTruthy();
  });

  it('calls onClose when the × button is clicked', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T"><p>x</p></Modal>);
    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T"><p>x</p></Modal>);
    fireEvent.keyDown(screen.getByRole('dialog').parentElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does NOT call onClose on Escape when closeOnEscape=false', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T" closeOnEscape={false}><p>x</p></Modal>);
    fireEvent.keyDown(screen.getByRole('dialog').parentElement!, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T"><p>x</p></Modal>);
    // The backdrop is the direct parent of the panel
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does NOT call onClose when panel itself is clicked (not backdrop)', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T"><p>x</p></Modal>);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the footer when provided', () => {
    render(
      <Modal open onClose={vi.fn()} title="T" footer={<button type="button">Save</button>}>
        <p>x</p>
      </Modal>,
    );
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('sets aria-labelledby to the title heading id', () => {
    render(<Modal open onClose={vi.fn()} title="Aria Test"><p>x</p></Modal>);
    const dialog = screen.getByRole('dialog');
    const labelId = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)?.textContent).toBe('Aria Test');
  });
});
