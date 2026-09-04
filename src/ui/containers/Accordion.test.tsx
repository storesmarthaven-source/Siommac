import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/preact';
import { Accordion } from './Accordion';

const ITEMS = [
  { id: 'scope', title: 'Scope', content: 'All operating sites' },
  { id: 'rules', title: 'Rules', content: 'Two approval rules' },
  { id: 'locked', title: 'Locked', content: 'Unavailable', disabled: true },
];

describe('Accordion', () => {
  it('expands one section at a time by default', () => {
    render(<Accordion items={ITEMS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scope' }));
    expect(screen.getByRole('region', { name: 'Scope' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    expect(screen.queryByRole('region', { name: 'Scope' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Rules' })).toBeTruthy();
  });

  it('supports multiple expansion and reports the next value', () => {
    const onChange = vi.fn();
    render(<Accordion items={ITEMS} multiple defaultExpanded={['scope']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    expect(screen.getAllByRole('region')).toHaveLength(2);
    expect(onChange).toHaveBeenLastCalledWith(['scope', 'rules']);
  });

  it('keeps controlled state under consumer ownership', () => {
    const onChange = vi.fn();
    render(<Accordion items={ITEMS} expanded={['scope']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    expect(screen.getByRole('region', { name: 'Scope' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Rules' })).toBeNull();
    expect(onChange).toHaveBeenCalledWith(['rules']);
  });

  it('uses native disabled behavior', () => {
    render(<Accordion items={ITEMS} />);
    expect(screen.getByRole('button', { name: 'Locked' }).hasAttribute('disabled')).toBe(true);
  });

  it('keeps animated panel content mounted for a smooth close transition', () => {
    const { container } = render(<Accordion items={[{ id: 'today', title: 'Today', trailing: '6', content: 'Six alerts' }]} defaultExpanded={['today']} />);
    const root = container.querySelector('.ui-accordion');
    const trigger = screen.getByRole('button', { name: 'Today6' });

    expect(root?.classList.contains('ui-accordion--animated')).toBe(true);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.ui-accordion__panel')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent).toContain('Six alerts');
  });
});
