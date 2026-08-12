/**
 * Tabs.test.tsx — the tab contract.
 *
 * Most of these assert the KEYBOARD MODEL, because that is what the five legacy
 * implementations actually got wrong. Three of them were plain buttons in a row:
 * no tablist, no roving tabindex, no arrow keys. A user tabbing through a
 * nine-tab drawer had to press Tab nine times to get past the strip, and a
 * screen reader announced nine unrelated buttons instead of "tab 3 of 9".
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { Tabs, TabPanel, type TabItem } from './index';

const ITEMS: TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks',    label: 'Tasks', badge: 4 },
  { id: 'audit',    label: 'Audit', disabled: true, disabledReason: 'No audit permission' },
  { id: 'files',    label: 'Files' },
];

function tabs(props: Partial<Parameters<typeof Tabs>[0]> = {}) {
  const onChange = vi.fn();
  const result = render(
    <Tabs id="t" label="Sections" items={ITEMS} value="overview" onChange={onChange} {...props} />,
  );
  return { ...result, onChange };
}

const tabEl = (name: string): HTMLElement => screen.getByRole('tab', { name });

describe('Tabs — structure', () => {
  it('renders a real tablist with one tab per item', () => {
    tabs();
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('marks exactly one tab selected and points it at its panel', () => {
    render(
      <>
        <Tabs id="t" label="Sections" items={ITEMS} value="tasks" onChange={vi.fn()} />
        <TabPanel tabsId="t" tabId="tasks" value="tasks">Task content</TabPanel>
      </>,
    );
    const selected = screen.getAllByRole('tab').filter(t => t.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);

    const panel = screen.getByRole('tabpanel');
    expect(selected[0]!.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(selected[0]!.id);
  });

  it('renders only the selected panel — panels are unmounted, not hidden', () => {
    // Seven mounted panels behind display:none is how one "tab switch" ends up
    // firing seven queries.
    render(
      <>
        <TabPanel tabsId="t" tabId="overview" value="overview">Overview content</TabPanel>
        <TabPanel tabsId="t" tabId="tasks" value="overview">Task content</TabPanel>
      </>,
    );
    expect(screen.getByText('Overview content')).toBeTruthy();
    expect(screen.queryByText('Task content')).toBeNull();
  });

  it('gives the panel a tab stop so keyboard users can reach its content', () => {
    render(<TabPanel tabsId="t" tabId="a" value="a"><p>Just text</p></TabPanel>);
    expect(screen.getByRole('tabpanel').getAttribute('tabindex')).toBe('0');
  });

  it('carries orientation, variant and size as configuration on one root', () => {
    const { container } = tabs({ orientation: 'vertical', variant: 'contained', size: 'sm' });
    const root = container.querySelector('.ui-tabs')!;
    expect(root.classList.contains('ui-tabs--vertical')).toBe(true);
    expect(root.classList.contains('ui-tabs--contained')).toBe(true);
    expect(root.classList.contains('ui-tabs--sm')).toBe(true);
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical');
  });

  it('renders a badge of 0 rather than hiding it, and announces it separately', () => {
    // "0 open" is information. Treating 0 as absent is why several pages showed
    // nothing where a zero belonged — and without an explicit accessible name
    // the adjacent spans announce as "Open0".
    tabs({ items: [{ id: 'a', label: 'Open', badge: 0 }], value: 'a' });
    expect(tabEl('Open, 0').textContent).toContain('0');
  });
});

describe('Tabs — roving tabindex', () => {
  it('makes the SET one tab stop: only the selected tab is reachable by Tab', () => {
    tabs({ value: 'tasks' });
    const stops = screen.getAllByRole('tab').filter(t => t.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]!.textContent).toContain('Tasks');
  });

  it('keeps a tab stop when the selected tab is collapsed into the overflow menu', () => {
    // Otherwise the whole tablist drops out of the tab order and a keyboard
    // user can reach the "More" trigger but none of the visible tabs.
    const many: TabItem[] = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }));
    render(<Tabs id="t" label="Sections" items={many} value="t7" onChange={vi.fn()} maxVisible={4} />);
    const stops = screen.getAllByRole('tab').filter(t => t.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]!.textContent).toContain('Tab 0');
  });

  it('does not put the tab stop on a disabled tab', () => {
    tabs({ value: 'audit' }); // 'audit' is the disabled one
    const stops = screen.getAllByRole('tab').filter(t => t.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]!.textContent).toContain('Overview');
  });
});

describe('Tabs — keyboard, horizontal', () => {
  it('moves right and left with the arrow keys', () => {
    const { onChange } = tabs({ value: 'overview' });
    fireEvent.keyDown(tabEl('Overview'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('tasks');
  });

  it('skips disabled tabs rather than landing on them', () => {
    const { onChange } = tabs({ value: 'tasks' });
    fireEvent.keyDown(tabEl('Tasks, 4'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('files'); // 'audit' is disabled
  });

  it('wraps at both ends', () => {
    const { onChange } = tabs({ value: 'overview' });
    fireEvent.keyDown(tabEl('Overview'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('files');
  });

  it('goes to the first and last ENABLED tab with Home and End', () => {
    const { onChange } = tabs({ value: 'tasks' });
    fireEvent.keyDown(tabEl('Tasks, 4'), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('overview');
    fireEvent.keyDown(tabEl('Tasks, 4'), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('files');
  });

  it('ignores the vertical arrows when horizontal', () => {
    const { onChange } = tabs({ value: 'overview' });
    fireEvent.keyDown(tabEl('Overview'), { key: 'ArrowDown' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Tabs — keyboard, vertical', () => {
  it('moves with up/down and ignores left/right', () => {
    const { onChange } = tabs({ orientation: 'vertical', value: 'overview' });
    fireEvent.keyDown(tabEl('Overview'), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('tasks');

    onChange.mockClear();
    fireEvent.keyDown(tabEl('Overview'), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Tabs — activation mode', () => {
  it('selects as focus moves under automatic activation (the default)', () => {
    const { onChange } = tabs({ value: 'overview' });
    fireEvent.keyDown(tabEl('Overview'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('tasks');
  });

  it('moves focus WITHOUT selecting under manual activation', () => {
    // What a panel that fires a network request needs: arrowing past four tabs
    // must not fire four queries.
    const { onChange } = tabs({ value: 'overview', activation: 'manual' });
    fireEvent.keyDown(tabEl('Overview'), { key: 'ArrowRight' });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toContain('Tasks');
  });

  it('selects the focused tab on Enter or Space under manual activation', () => {
    const { onChange } = tabs({ value: 'overview', activation: 'manual' });
    fireEvent.keyDown(tabEl('Tasks, 4'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('tasks');
  });
});

describe('Tabs — disabled', () => {
  it('does not fire on click and exposes the reason', () => {
    const { onChange } = tabs();
    const audit = tabEl('Audit');
    fireEvent.click(audit);
    expect(onChange).not.toHaveBeenCalled();
    expect(audit.getAttribute('title')).toBe('No audit permission');
  });

  it('keeps a disabled tab IN the list', () => {
    // Removing it would change the "tab 3 of 4" a screen reader announces, and
    // hide the fact that the section exists but is not available to you.
    tabs();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(tabEl('Audit').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Tabs — overflow', () => {
  const MANY: TabItem[] = Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }));

  it('collapses everything past maxVisible into a More menu', () => {
    render(<Tabs id="t" label="Sections" items={MANY} value="t0" onChange={vi.fn()} maxVisible={4} />);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /More/ })).toBeTruthy();
  });

  it('shows the active tab\'s label on the More button when it is hidden', () => {
    // Otherwise the strip claims nothing is selected while a hidden panel is open.
    render(<Tabs id="t" label="Sections" items={MANY} value="t7" onChange={vi.fn()} maxVisible={4} />);
    expect(screen.getByRole('button', { name: /Tab 7/ })).toBeTruthy();
  });

  it('does not label the More trigger as a tab', () => {
    // It opens a menu; it selects nothing. role="tab" there makes a screen
    // reader announce a selection state for a control that has none.
    render(<Tabs id="t" label="Sections" items={MANY} value="t0" onChange={vi.fn()} maxVisible={4} />);
    const more = screen.getByRole('button', { name: /More/ });
    expect(more.getAttribute('role')).toBeNull();
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('arrow keys stay within the VISIBLE tabs', () => {
    // Moving focus into a collapsed item would focus something off-screen.
    const onChange = vi.fn();
    render(<Tabs id="t" label="Sections" items={MANY} value="t3" onChange={onChange} maxVisible={4} />);
    fireEvent.keyDown(tabEl('Tab 3'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('t0'); // wrapped, not into t4
  });

  it('renders every tab when maxVisible is not exceeded', () => {
    render(<Tabs id="t" label="Sections" items={MANY} value="t0" onChange={vi.fn()} maxVisible={20} />);
    expect(screen.getAllByRole('tab')).toHaveLength(9);
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull();
  });
});

describe('Tabs — mouse', () => {
  it('selects on click', () => {
    const { onChange } = tabs();
    fireEvent.click(tabEl('Files'));
    expect(onChange).toHaveBeenCalledWith('files');
  });

  it('renders right-aligned actions beside the list without putting them in it', () => {
    const { container } = tabs({ actions: <button type="button">Export</button> });
    expect(container.querySelector('.ui-tabs-actions')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export' }).closest('[role="tablist"]')).toBeNull();
  });
});
