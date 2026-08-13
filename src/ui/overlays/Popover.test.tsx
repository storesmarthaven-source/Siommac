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
});
