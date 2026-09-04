import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { SidebarNavigation, type SidebarNavigationGroup } from './SidebarNavigation';

const GROUPS: readonly SidebarNavigationGroup[] = [
  { id: 'overview', items: [{ id: 'overview', label: 'Overview' }] },
  {
    id: 'workforce',
    label: 'Workforce',
    items: [{ id: 'rostering', label: 'Rostering', children: [
      { id: 'planner', label: 'Planner' },
      { id: 'coverage', label: 'Coverage' },
    ] }],
  },
];

describe('SidebarNavigation', () => {
  it('marks the active destination and emits navigation', () => {
    const onNavigate = vi.fn();
    render(<SidebarNavigation groups={GROUPS} activeId="planner" searchable={false} onNavigate={onNavigate} />);
    const planner = screen.getByRole('button', { name: 'Planner' });
    expect(planner.getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(onNavigate).toHaveBeenCalledWith('overview');
  });

  it('controls group and nested expansion without fixed-height assumptions', () => {
    const onGroups = vi.fn();
    const onItems = vi.fn();
    render(
      <SidebarNavigation
        groups={GROUPS}
        searchable={false}
        expandedGroupIds={['overview', 'workforce']}
        expandedItemIds={['rostering']}
        onExpandedGroupsChange={onGroups}
        onExpandedItemsChange={onItems}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Workforce/ }));
    expect(onGroups).toHaveBeenCalledWith(['overview']);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Rostering' }));
    expect(onItems).toHaveBeenCalledWith([]);
  });

  it('searches parents and nested destinations', () => {
    render(<SidebarNavigation groups={GROUPS} />);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'coverage' } });
    expect(screen.getByRole('button', { name: 'Coverage' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull();
  });

  it('renders its compact density as configuration on one component', () => {
    const { container } = render(<SidebarNavigation groups={GROUPS} density="compact" searchable={false} />);
    expect(container.querySelector('.ui-sidebar-nav')?.classList.contains('ui-sidebar-nav--compact')).toBe(true);
  });

  it('renders accessible count and dot notifications and caps large totals', () => {
    const groups: readonly SidebarNavigationGroup[] = [{
      id: 'alerts',
      items: [
        { id: 'approvals', label: 'Approvals', notification: { count: 138, label: '138 pending approvals' } },
        { id: 'messages', label: 'Messages', notification: { dot: true, tone: 'info', label: 'New messages' } },
      ],
    }];
    render(<SidebarNavigation groups={groups} searchable={false} />);
    expect(screen.getByRole('status', { name: '138 pending approvals' }).textContent).toBe('99+');
    expect(screen.getByRole('status', { name: 'New messages' }).classList.contains('is-dot')).toBe(true);
  });

  it('supports a contextual destination catalog without leaking app section attributes', () => {
    const onBack = vi.fn();
    const onNavigate = vi.fn();
    render(
      <SidebarNavigation
        groups={GROUPS}
        searchable={false}
        context={{ label: 'Settings', backLabel: 'Back To App', onBack }}
        destinationAttribute={null}
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back To App' }));
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith('overview');
    expect(screen.getByRole('button', { name: 'Overview' }).hasAttribute('data-section')).toBe(false);
  });

  it('collapses to an icon rail and exposes nested destinations in a side flyout', async () => {
    const onNavigate = vi.fn();
    const onCollapsedChange = vi.fn();
    const onCustomize = vi.fn();
    const { container } = render(
      <SidebarNavigation
        groups={GROUPS}
        collapsed
        onCollapsedChange={onCollapsedChange}
        onCustomize={onCustomize}
        onNavigate={onNavigate}
      />,
    );

    expect(container.querySelector('.ui-sidebar-nav')?.classList.contains('ui-sidebar-nav--collapsed')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Customize Navigation' })).toBeNull();
    expect(container.querySelector('.ui-sidebar-nav__submenu-indicator')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Navigation' }));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: 'Rostering' }));
    const flyout = await screen.findByRole('dialog', { name: 'Rostering Navigation' });
    expect(within(flyout).getByRole('button', { name: 'Close Rostering Navigation' })).toBeTruthy();
    fireEvent.click(within(flyout).getByRole('button', { name: /Planner/ }));
    expect(onNavigate).toHaveBeenCalledWith('planner');
  });

  it('keeps only one collapsed submenu popup open at a time', async () => {
    const groups: readonly SidebarNavigationGroup[] = [{
      id: 'operations',
      items: [
        { id: 'rostering', label: 'Rostering', children: [{ id: 'planner', label: 'Planner' }] },
        { id: 'work', label: 'Work Management', children: [{ id: 'work-orders', label: 'Work Orders' }] },
      ],
    }];
    render(<SidebarNavigation groups={groups} searchable={false} collapsed />);

    fireEvent.click(screen.getByRole('button', { name: 'Rostering' }));
    expect(await screen.findByRole('dialog', { name: 'Rostering Navigation' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Work Management' }));
    expect(await screen.findByRole('dialog', { name: 'Work Management Navigation' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rostering Navigation' })).toBeNull());
  });
});
