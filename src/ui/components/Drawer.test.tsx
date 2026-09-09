import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Drawer } from './Drawer';

describe('Drawer', () => {
  it('renders a labelled modal drawer in the portal', () => {
    render(<Drawer open title="Employee details" onClose={vi.fn()}>Body</Drawer>);
    const drawer = screen.getByRole('dialog', { name: 'Employee details' });
    expect(drawer.classList.contains('ui-drawer')).toBe(true);
    expect(drawer.getAttribute('aria-modal')).toBe('true');
  });

  it('honours side and canonical size', () => {
    render(<Drawer open title="Filters" side="left" size="sm" onClose={vi.fn()}>Body</Drawer>);
    const drawer = screen.getByRole('dialog', { name: 'Filters' });
    expect(drawer.getAttribute('data-side')).toBe('left');
    expect(drawer.getAttribute('data-size')).toBe('sm');
    expect(drawer.getAttribute('style')).toContain('--ui-drawer-width-sm');
    expect(drawer.getAttribute('style')).toContain('left: 0px');
  });

  it('can block backdrop dismissal without disabling Escape', () => {
    const onClose = vi.fn();
    render(<Drawer open title="Filters" closeOnBackdrop={false} onClose={onClose}>Body</Drawer>);
    fireEvent.click(document.querySelector('.hse-drawer-backdrop')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders inside a feature surface and dismisses from its contained backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(<Drawer open contained title="Edit event" onClose={onClose}>Body</Drawer>);
    const drawer = screen.getByRole('dialog', { name: 'Edit event' });
    expect(container.contains(drawer)).toBe(true);
    expect(drawer.getAttribute('data-contained')).toBe('true');
    expect(drawer.getAttribute('aria-modal')).toBe('false');
    expect(document.querySelector('.hse-drawer-backdrop')).toBeNull();
    const backdrop = container.querySelector('.ui-drawer-contained-backdrop')!;
    expect(backdrop.classList.contains('show')).toBe(true);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the contained drawer mounted in its closing state for CSS exit motion', () => {
    const { rerender } = render(<Drawer open contained title="Edit event" onClose={vi.fn()}>Body</Drawer>);
    rerender(<Drawer open={false} contained title="Edit event" onClose={vi.fn()}>Body</Drawer>);

    expect(document.querySelector('.ui-drawer.hse-drawer')?.classList.contains('show')).toBe(false);
    expect(document.querySelector('.ui-drawer-contained-backdrop')?.classList.contains('show')).toBe(false);
  });
});
