import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refetch = vi.fn();
const markAll = vi.fn();

vi.mock('@lib/permissions', () => ({
  useCan: () => true,
}));

vi.mock('@api/communications', () => ({
  useNotifications: () => ({
    data: [],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch,
  }),
  useCommsSummary: () => ({
    data: {
      notificationsTotal: 4,
      notificationsUnread: 2,
      notificationsActionRequired: 1,
      notificationsCritical: 1,
      notificationsArchived: 0,
    },
  }),
  useMarkNotificationRead: () => ({ mutate: vi.fn() }),
  useMarkAllNotificationsRead: () => ({ mutate: markAll, isPending: false }),
  useArchiveNotification: () => ({ mutate: vi.fn() }),
}));

vi.mock('./NotificationItem', () => ({ NotificationItem: () => null }));
vi.mock('./BroadcastComposer', () => ({ BroadcastComposer: () => null }));
vi.mock('./NotificationPreferencesPanel', () => ({ NotificationPreferencesPanel: () => null }));
vi.mock('./notifAction', () => ({
  openNotificationTarget: vi.fn(() => false),
  openTicketNotification: vi.fn(),
}));

import { NotificationCenter } from './NotificationCenter';

describe('NotificationCenter page chrome', () => {
  beforeEach(() => {
    refetch.mockClear();
    markAll.mockClear();
  });

  it('renders every page action inside the canonical UI Kit PageHeader', () => {
    const { container } = render(<NotificationCenter />);
    const header = container.querySelector('.ui-page-header');

    expect(header).toBeTruthy();
    expect(header?.querySelector('.ui-page-title')?.textContent).toBe('Notification Center');

    expect(header?.querySelector('.ui-page-actions')).toBeTruthy();

    for (const label of ['Mark All Read', 'Notification Settings', 'Send Broadcast']) {
      const button = screen.getByRole('button', { name: label });
      expect(button.classList.contains('ui-btn')).toBe(true);
      expect(button.classList.contains('ui-btn--sm')).toBe(false);
      expect(header?.contains(button)).toBe(true);
    }

    expect(header?.contains(screen.getByRole('button', { name: 'More page actions' }))).toBe(true);
  });

  it('starts with staged examples and reveals the illustrated live empty state on demand', () => {
    const { container } = render(<NotificationCenter />);

    expect(screen.getByText('Feature Preview')).toBeTruthy();
    expect(container.querySelector('.nc-results-head')?.textContent).toContain('8 Notifications');
    expect(container.querySelector('.nc-workspace-head .ui-tabs-list')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: 'Show Live Notifications' }));

    expect(screen.getByText('Live Notifications')).toBeTruthy();
    expect(screen.getByText("You're All Caught Up")).toBeTruthy();
    expect(container.querySelector('.nc-empty-visual')).toBeTruthy();
  });
});
