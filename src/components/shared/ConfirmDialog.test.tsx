/**
 * ConfirmDialog.test.tsx
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { ConfirmDialog }                       from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders nothing when open=false', () => {
    render(
      <ConfirmDialog
        open={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete?"
        message="Are you sure?"
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the title and message when open=true', () => {
    render(
      <ConfirmDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Delete Employee"
        message="This cannot be undone."
      />,
    );
    expect(screen.getByText('Delete Employee')).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog open onClose={onClose} onConfirm={vi.fn()} title="T" message="M" />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onConfirm when Confirm is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open onClose={vi.fn()} onConfirm={onConfirm} title="T" message="M" />,
    );
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('uses custom button labels', () => {
    render(
      <ConfirmDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="T"
        message="M"
        confirmLabel="Yes, delete"
        cancelLabel="No, keep it"
      />,
    );
    expect(screen.getByText('Yes, delete')).toBeTruthy();
    expect(screen.getByText('No, keep it')).toBeTruthy();
  });

  it('shows a spinner and disables buttons while loading=true', () => {
    render(
      <ConfirmDialog open onClose={vi.fn()} onConfirm={vi.fn()} title="T" message="M" loading />,
    );
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => expect((btn as HTMLButtonElement).disabled).toBe(true));
  });

  it('awaits an async onConfirm and shows spinner during execution', async () => {
    let resolve!: () => void;
    const asyncConfirm = vi.fn(() => new Promise<void>((r) => { resolve = r; }));

    render(
      <ConfirmDialog open onClose={vi.fn()} onConfirm={asyncConfirm} title="T" message="M" />,
    );

    fireEvent.click(screen.getByText('Confirm'));

    // Spinner should appear while async op is pending
    await waitFor(() => expect(screen.getByLabelText('Processing…')).toBeTruthy());

    // Resolve the promise
    resolve();
    await waitFor(() => expect(screen.queryByLabelText('Processing…')).toBeNull());
  });
});
