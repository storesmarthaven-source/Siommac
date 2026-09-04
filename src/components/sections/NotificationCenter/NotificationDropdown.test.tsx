import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { h } from 'preact';

let _isModalOpen = false;
let _canBroadcast = true;
vi.mock('@/hooks/useHeaderModalOpen', () => ({
  useHeaderModalOpen: () => _isModalOpen,
}));

type NotificationsArgs = [Record<string, unknown>?, ({ enabled?: boolean } | undefined)?];
type NotificationsFn = (...args: NotificationsArgs) => {
  data: unknown[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};
const notifications = vi.fn<NotificationsFn>().mockReturnValue({
  data: [], isLoading: false, isError: false, refetch: vi.fn(),
});
const summary = { notificationsUnread: 0, notificationsTotal: 0, notificationsActionRequired: 0 };
const quietPreferences: { data: { snooze: { mutedUntil: string | null } | null } } = { data: { snooze: null } };
const markAllMutate = vi.fn();

vi.mock('@api/communications', () => ({
  useNotifications: (...args: NotificationsArgs) => notifications(...args),
  useCommsSummary: () => ({ data: summary }),
  useNotificationPreferences: () => quietPreferences,
  useMarkNotificationRead: () => ({ mutate: vi.fn() }),
  useMarkAllNotificationsRead: () => ({ mutate: markAllMutate, isPending: false }),
  useArchiveNotification: () => ({ mutate: vi.fn() }),
}));

vi.mock('@components/nav/navCore', () => ({
  showSection: vi.fn(),
}));
vi.mock('@lib/permissions', () => ({
  useCan: () => _canBroadcast,
}));

vi.mock('./NotificationDropdownItem', () => ({
  NotificationDropdownItem: ({ n }: { n: { title: string } }) => <div data-testid="notification-row">{n.title}</div>,
}));
vi.mock('./BroadcastComposer', () => ({
  BroadcastComposer: ({ open }: { open: boolean }) => open
    ? <div role="dialog" aria-label="Send Broadcast Dialog" />
    : null,
}));
vi.mock('./NotificationPreferencesPanel', () => ({
  NotificationPreferencesPanel: ({ open }: { open: boolean }) => open
    ? <div role="dialog" aria-label="Notification Settings Dialog" />
    : null,
}));
vi.mock('./notifAction', () => ({
  openNotificationTarget: vi.fn(() => false),
  openTicketNotification: vi.fn(),
}));

import { NotificationDropdown } from './NotificationDropdown';
import { showSection } from '@components/nav/navCore';

function renderDropdown() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(NotificationDropdown, null)),
  );
}

function switchToLiveNotifications(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Notification Settings' }));
  const staged = screen.getByRole('menuitemcheckbox', { name: 'Show Staged Notifications' });
  expect(staged.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(staged);
}

describe('NotificationDropdown query warming', () => {
  beforeEach(() => {
    _isModalOpen = false;
    _canBroadcast = true;
    notifications.mockClear();
    markAllMutate.mockClear();
    summary.notificationsUnread = 0;
    summary.notificationsTotal = 0;
    summary.notificationsActionRequired = 0;
    quietPreferences.data.snooze = null;
    notifications.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
  });

  it('does not request live notifications while the preview is hidden', () => {
    _isModalOpen = false;
    renderDropdown();
    const call = notifications.mock.calls[0];
    expect(call?.[0]?.limit).toBe(30);
    expect(call?.[0]?.unreadOnly).toBeUndefined();
    expect(call?.[0]?.actionRequiredOnly).toBeUndefined();
    expect(call?.[1]).toEqual({ enabled: false });
  });

  it('keeps live notifications disabled until the user selects live mode', () => {
    _isModalOpen = true;
    renderDropdown();
    const call = notifications.mock.calls[0];
    expect(call?.[0]?.limit).toBe(30);
    expect(call?.[1]).toEqual({ enabled: false });
  });

  it('shows the staged-data control as an enabled compact switch', () => {
    renderDropdown();
    fireEvent.click(screen.getByRole('button', { name: 'Notification Settings' }));

    const staged = screen.getByRole('menuitemcheckbox', { name: 'Show Staged Notifications' });
    expect(staged.getAttribute('aria-checked')).toBe('true');
    expect(staged.getAttribute('aria-disabled')).toBeNull();
    expect(document.querySelector('.nc-dropdown__menu-switch .ui-switch-track--sm')).toBeTruthy();
  });

  it('uses canonical full-width tabs and an illustrated live empty state', () => {
    const { container } = renderDropdown();
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'View All' }).classList.contains('ui-tab')).toBe(true);
    expect(screen.getByRole('button', { name: 'View All Notifications' }).classList.contains('ui-btn')).toBe(true);
    expect(screen.getAllByTestId('notification-row')).toHaveLength(8);
    expect(container.querySelector('.ui-notification-popover__navigation .ui-tabs-list')).toBeTruthy();

    switchToLiveNotifications();
    expect(screen.getByText("You're All Caught Up")).toBeTruthy();
    expect(container.querySelector('.nc-empty-visual--compact')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark All Read' }).disabled).toBe(true);
    for (const name of ['Mark All Read', 'Send Broadcast', 'Notification Settings', 'Close Notifications']) {
      expect(screen.getByRole('button', { name }).style.background).toBe('transparent');
    }
  });

  it('shows a persistent Quiet Mode indicator when routine popups are paused', () => {
    _isModalOpen = true;
    quietPreferences.data.snooze = { mutedUntil: null };
    renderDropdown();

    expect(screen.getByText('Quiet Mode On')).toBeTruthy();
    expect(screen.getByText(/Until Resumed · routine popups paused/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy();
  });

  it('filters the warm result locally for unread and action-required views', () => {
    notifications.mockReturnValue({
      data: [
        { id: 'read', title: 'Read Item', is_read: true, action_required: false, action_status: 'none', created_at: new Date().toISOString() },
        { id: 'unread', title: 'Unread Item', is_read: false, action_required: false, action_status: 'none', created_at: new Date().toISOString() },
        { id: 'action', title: 'Action Item', is_read: false, action_required: true, action_status: 'pending', created_at: new Date().toISOString() },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    summary.notificationsUnread = 2;
    summary.notificationsTotal = 3;
    summary.notificationsActionRequired = 1;

    renderDropdown();
    switchToLiveNotifications();
    expect(screen.getAllByTestId('notification-row')).toHaveLength(3);

    fireEvent.click(screen.getByRole('tab', { name: 'Unread, 2' }));
    expect(screen.getAllByTestId('notification-row')).toHaveLength(2);
    expect(screen.queryByText('Read Item')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Needs Action, 1' }));
    expect(screen.getAllByTestId('notification-row')).toHaveLength(1);
    expect(screen.getByText('Action Item')).toBeTruthy();
  });

  it('marks all notifications read from the header action', () => {
    summary.notificationsUnread = 3;
    renderDropdown();
    switchToLiveNotifications();
    fireEvent.click(screen.getByRole('button', { name: 'Mark All Read' }));
    expect(markAllMutate).toHaveBeenCalledWith({});
  });

  it('opens the broadcast composer from the admin header action', () => {
    renderDropdown();
    const button = screen.getByRole('button', { name: 'Send Broadcast' });
    expect(button.classList.contains('ui-btn')).toBe(true);
    expect(button.classList.contains('ui-btn--ghost')).toBe(true);
    expect(button.classList.contains('nc-dropdown__broadcast-action')).toBe(true);
    expect(button.style.background).toBe('transparent');
    expect(button.querySelector('svg')?.style.color).toContain('--siomac-red');
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Send Broadcast Dialog' })).toBeTruthy();
  });

  it('keeps Send Broadcast visible but disabled without admin permission', () => {
    _canBroadcast = false;
    renderDropdown();
    const button = screen.getByRole('button', { name: 'Send Broadcast' });
    expect(button.classList.contains('nc-dropdown__broadcast-action')).toBe(true);
    expect(button.disabled).toBe(true);
  });

  it('opens notification settings in place without navigating away', () => {
    renderDropdown();
    fireEvent.click(screen.getByRole('button', { name: 'Notification Settings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Notification Preferences/ }));

    expect(screen.getByRole('dialog', { name: 'Notification Settings Dialog' })).toBeTruthy();
    expect(showSection).not.toHaveBeenCalled();
  });
});
