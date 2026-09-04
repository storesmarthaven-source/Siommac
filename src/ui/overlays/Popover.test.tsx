import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Popover } from './Popover';

function anchor(): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = 'Trigger';
  document.body.appendChild(element);
  return element;
}

describe('Popover', () => {
  it('renders a named non-modal dialog only while open', () => {
    const trigger = anchor();
    const { rerender } = render(<Popover open={false} anchor={trigger} onClose={vi.fn()} label="Details">Body</Popover>);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<Popover open anchor={trigger} onClose={vi.fn()} label="Details">Body</Popover>);
    expect(screen.getByRole('dialog', { name: 'Details' }).textContent).toContain('Body');
    trigger.remove();
  });

  it('closes on Escape and returns focus to the anchor', () => {
    const trigger = anchor();
    const onClose = vi.fn();
    render(<Popover open anchor={trigger} onClose={onClose} label="Details"><button>Inside</button></Popover>);
    screen.getByRole('button', { name: 'Inside' }).focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('can move focus to the first interactive descendant', () => {
    const trigger = anchor();
    render(<Popover open anchor={trigger} onClose={vi.fn()} label="Details" initialFocus><button>Inside</button></Popover>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inside' }));
    trigger.remove();
  });

  it('dismisses for a pointer outside both surface and anchor', () => {
    const trigger = anchor();
    const onClose = vi.fn();
    render(<Popover open anchor={trigger} onClose={onClose} label="Details">Body</Popover>);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
    trigger.remove();
  });

  it('stays open while its own scrollable surface is mouse-wheel scrolled', () => {
    const trigger = anchor();
    const onClose = vi.fn();
    render(<Popover open anchor={trigger} onClose={onClose} label="Scrollable details">Body</Popover>);

    fireEvent.scroll(screen.getByRole('dialog', { name: 'Scrollable details' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalledOnce();
    trigger.remove();
  });

  it('flips a measured form surface above its anchor instead of clipping its footer', () => {
    const trigger = anchor();
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 100, y: 500, top: 500, bottom: 540, left: 100, right: 200,
      width: 100, height: 40, toJSON: () => ({}),
    });
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400);
    const offsetWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320);

    render(<Popover open anchor={trigger} onClose={vi.fn()} label="Add Shift" maxHeight={520}>Form content</Popover>);

    const surface = screen.getByRole('dialog', { name: 'Add Shift' });
    expect(surface.dataset.placement).toBe('top');
    expect(surface.style.bottom).not.toBe('');
    expect(surface.style.top).toBe('');

    scrollHeight.mockRestore();
    offsetWidth.mockRestore();
    trigger.remove();
  });
});
