/**
 * actions.test.tsx — behaviour for the rest of the Actions family.
 *
 * The assertions concentrate on the things that distinguish these components
 * from "a button with different CSS": the ARIA a screen reader announces, the
 * keyboard model, and focus return. Those are exactly what a visual check
 * cannot see.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { SegmentedControl, DropdownButton, SplitButton } from './actions';
import { DropdownMenu, type MenuItems } from '../overlays/DropdownMenu';

const OPTIONS = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board', disabled: true },
] as const;

const MENU: MenuItems = [
  { id: 'edit',   label: 'Edit details' },
  { id: 'lock',   label: 'Locked action', disabled: true },
  { id: 'delete', label: 'Delete', danger: true },
];

describe('SegmentedControl', () => {
  it('is a radiogroup, not a row of buttons', () => {
    render(<SegmentedControl label="View mode" value="grid" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole('radiogroup', { name: 'View mode' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('marks the selected option aria-checked', () => {
    render(<SegmentedControl label="View" value="list" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole('radio', { name: 'List' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Grid' }).getAttribute('aria-checked')).toBe('false');
  });

  it('keeps only the selected option in the tab order', () => {
    // Roving focus: Tab must skip the whole control, not step through options.
    render(<SegmentedControl label="View" value="list" onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole('radio', { name: 'List' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('radio', { name: 'Grid' }).getAttribute('tabindex')).toBe('-1');
  });

  it('moves selection with ArrowRight, skipping disabled options', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="View" value="list" onChange={onChange} options={OPTIONS} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'List' }), { key: 'ArrowRight' });
    // Board is disabled, so it wraps to Grid.
    expect(onChange).toHaveBeenCalledWith('grid');
  });

  it('moves backwards with ArrowLeft', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="View" value="list" onChange={onChange} options={OPTIONS} />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'List' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('grid');
  });

  it('selects on click', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="View" value="grid" onChange={onChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(onChange).toHaveBeenCalledWith('list');
  });
});

describe('DropdownMenu', () => {
  function open(items: MenuItems = MENU, onClose = vi.fn()): { anchor: HTMLElement; onClose: typeof onClose } {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    render(<DropdownMenu open anchor={anchor} onClose={onClose} items={items} label="Row actions" />);
    return { anchor, onClose };
  }

  it('renders menu semantics', () => {
    open();
    expect(screen.getByRole('menu', { name: 'Row actions' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });

  it('focuses the first enabled item on open', () => {
    open();
    expect(document.activeElement?.textContent).toContain('Edit details');
  });

  it('skips disabled items when arrowing', () => {
    open();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('Delete');
  });

  it('marks disabled items aria-disabled and does not activate them', () => {
    const onSelect = vi.fn();
    open([{ id: 'a', label: 'Locked', disabled: true, onSelect }]);
    const item = screen.getByRole('menuitem', { name: 'Locked' });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes before running the handler', () => {
    // An action that opens a dialog must not have the menu still mounted, or
    // the two focus managers fight.
    const order: string[] = [];
    const onClose = vi.fn(() => order.push('close'));
    const onSelect = vi.fn(() => order.push('select'));
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    render(<DropdownMenu open anchor={anchor} onClose={onClose} label="M" items={[{ id: 'a', label: 'Go', onSelect }]} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go' }));
    expect(order).toEqual(['close', 'select']);
  });

  it('closes on Escape without letting it reach a parent overlay', () => {
    const outer = vi.fn();
    const onClose = vi.fn();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    render(
      <div onKeyDown={outer}>
        <DropdownMenu open anchor={anchor} onClose={onClose} items={MENU} label="M" />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });

  it('closes on Tab so focus can leave', () => {
    const { onClose } = open();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders group headings and separators', () => {
    open([
      { label: 'Record', items: [{ id: 'a', label: 'Edit' }] },
      { label: 'Danger', items: [{ id: 'b', label: 'Delete', danger: true }] },
    ]);
    expect(screen.getByRole('group', { name: 'Danger' })).toBeTruthy();
    expect(screen.getByRole('separator')).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    const anchor = document.createElement('button');
    render(<DropdownMenu open={false} anchor={anchor} onClose={vi.fn()} items={MENU} label="M" />);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('DropdownButton', () => {
  it('advertises its menu with aria-haspopup', () => {
    render(<DropdownButton label="Actions" items={MENU} />);
    const btn = screen.getByRole('button', { name: /Actions/ });
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the menu on click', () => {
    render(<DropdownButton label="Actions" items={MENU} />);
    fireEvent.click(screen.getByRole('button', { name: /Actions/ }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Actions/ }).getAttribute('aria-expanded')).toBe('true');
  });
});

describe('SplitButton', () => {
  it('renders two separate buttons', () => {
    // One element that inspects click coordinates cannot be used by keyboard.
    render(<SplitButton action={{ label: 'Save' }} items={MENU} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /More save options/ })).toBeTruthy();
  });

  it('runs the default action from the main half only', () => {
    const onSelect = vi.fn();
    render(<SplitButton action={{ label: 'Save', onSelect }} items={MENU} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the menu from the chevron half only', () => {
    const onSelect = vi.fn();
    render(<SplitButton action={{ label: 'Save', onSelect }} items={MENU} />);
    fireEvent.click(screen.getByRole('button', { name: /More save options/ }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disables both halves while loading', () => {
    render(<SplitButton action={{ label: 'Save' }} items={MENU} loading />);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /More save options/ }).disabled).toBe(true);
  });
});
