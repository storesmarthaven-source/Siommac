import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/preact';
import { Tooltip } from './Tooltip';

afterEach(() => vi.useRealTimers());

describe('Tooltip', () => {
  it('shows immediately on focus and describes the existing control', async () => {
    render(<Tooltip content="Locked after approval"><button>Policy</button></Tooltip>);
    const trigger = screen.getByRole('button', { name: 'Policy' });
    await act(() => Promise.resolve().then(() => { trigger.focus(); }));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Locked after approval');
    expect(trigger.getAttribute('aria-describedby')).toContain(tip.parentElement?.id);
  });

  it('preserves the child event handlers it composes', () => {
    const onMouseEnter = vi.fn();
    render(<Tooltip content="Help" showDelay={0}><button onMouseEnter={onMouseEnter}>Policy</button></Tooltip>);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Policy' }));
    expect(onMouseEnter).toHaveBeenCalledOnce();
  });

  it('honours the hover delay and hides after pointer leave', async () => {
    vi.useFakeTimers();
    render(<Tooltip content="Help" showDelay={200} hideDelay={50}><button>Policy</button></Tooltip>);
    const trigger = screen.getByRole('button', { name: 'Policy' });
    fireEvent.mouseEnter(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await act(() => Promise.resolve().then(() => { vi.advanceTimersByTime(200); }));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.mouseLeave(trigger);
    await act(() => Promise.resolve().then(() => { vi.advanceTimersByTime(50); }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('dismisses on Escape without activating the trigger', async () => {
    const onClick = vi.fn();
    render(<Tooltip content="Help"><button onClick={onClick}>Policy</button></Tooltip>);
    const trigger = screen.getByRole('button', { name: 'Policy' });
    await act(() => Promise.resolve().then(() => { trigger.focus(); }));
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not attach a description or open when disabled', async () => {
    render(<Tooltip content="Help" disabled><button>Policy</button></Tooltip>);
    const trigger = screen.getByRole('button', { name: 'Policy' });
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    await act(() => Promise.resolve().then(() => { trigger.focus(); }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
