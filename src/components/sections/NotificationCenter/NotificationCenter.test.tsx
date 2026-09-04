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

    for (const label of ['Send Broadcast', 'Notification Settings']) {
      const button = screen.getByRole('button', { name: label });
      expect(button.classList.contains('ui-btn')).toBe(true);
      expect(button.classList.contains('ui-btn--sm')).toBe(false);
      expect(header?.contains(button)).toBe(true);
    }

    const orderedActions = Array.from(header?.querySelectorAll('button') ?? []).map(button => button.textContent.trim());
    expect(orderedActions.indexOf('Send Broadcast')).toBeLessThan(orderedActions.indexOf('Notification Settings'));

    for (const label of ['Mark All as Read', 'Archive All Read']) {
      const button = screen.getByRole('button', { name: label });
      expect(header?.contains(button)).toBe(false);
      expect(container.querySelector('.nc-results-head')?.contains(button)).toBe(true);
    }

    expect(header?.contains(screen.getByRole('button', { name: 'More page actions' }))).toBe(true);
  });

  it('starts with staged examples and reveals the illustrated live empty state on demand', () => {
    const { container } = render(<NotificationCenter />);

    expect(screen.queryByText('Feature Preview')).toBeNull();
    expect(screen.queryByText('Explore staged examples without changing live data.')).toBeNull();
    const summaryStats = container.querySelectorAll('.nc-summary-stat');
    expect(summaryStats).toHaveLength(3);
    expect(summaryStats[0]?.textContent).toContain('8Notifications');
    expect(summaryStats[1]?.querySelector('strong')?.textContent).toBe('4');
    expect(summaryStats[1]?.textContent).toContain('Unread');
    expect(summaryStats[2]?.querySelector('strong')?.textContent).toBe('2');
    expect(summaryStats[2]?.textContent).toContain('Need Action');
    expect(container.querySelectorAll('.nc-summary-stat > svg')).toHaveLength(3);
    expect(container.querySelector('.nc-mode-row .ui-tabs--lg.ui-tabs--full-width.ui-tabs--flush > .ui-tabs-list')).toBeTruthy();

    const today = screen.getByRole('button', { name: /Today/i });
    expect(today.getAttribute('aria-expanded')).toBe('true');
    expect(today.querySelector('.nc-date-group-count')).toBeTruthy();
    fireEvent.click(today);
    expect(today.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'More page actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show Live Notifications' }));

    expect(screen.getByText("You're All Caught Up")).toBeTruthy();
    expect(container.querySelector('.nc-empty-visual')).toBeTruthy();
  });
});
