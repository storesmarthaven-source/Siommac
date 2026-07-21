import { render } from '@testing-library/preact';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { h } from 'preact';

let _isModalOpen = false;
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

vi.mock('@api/communications', () => ({
  useNotifications: (...args: NotificationsArgs) => notifications(...args),
  useCommsSummary: () => ({ data: { notificationsUnread: 0 } }),
  useMarkNotificationRead: () => ({ mutate: vi.fn() }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveNotification: () => ({ mutate: vi.fn() }),
}));

vi.mock('@components/nav/navCore', () => ({
  showSection: vi.fn(),
}));

vi.mock('./NotificationDropdownItem', () => ({ NotificationDropdownItem: () => null }));
vi.mock('./notifAction', () => ({
  openNotificationTarget: vi.fn(() => false),
  openTicketNotification: vi.fn(),
}));

import { NotificationDropdown } from './NotificationDropdown';

function renderDropdown() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(NotificationDropdown, null)),
  );
}

describe('NotificationDropdown query warming', () => {
  beforeEach(() => {
    _isModalOpen = false;
    notifications.mockClear();
  });

  it('keeps the canonical notification preview query warm when hidden', () => {
    _isModalOpen = false;
    renderDropdown();
    const call = notifications.mock.calls[0];
    expect(call?.[0]?.limit).toBe(30);
    expect(call?.[0]?.unreadOnly).toBeUndefined();
    expect(call?.[0]?.actionRequiredOnly).toBeUndefined();
    expect(call?.[1]).toBeUndefined();
  });

  it('uses the same warm query when open', () => {
    _isModalOpen = true;
    renderDropdown();
    const call = notifications.mock.calls[0];
    expect(call?.[0]?.limit).toBe(30);
    expect(call?.[1]).toBeUndefined();
  });
});
