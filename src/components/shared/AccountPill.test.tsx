import { render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { AccountPill } from './AccountPill';

vi.mock('@store/session', () => ({
  selectFullName: (s: { fullName: string | null }) => s.fullName,
  selectRole:     (s: { role: string | null }) => s.role,
  useSessionStore: (selector: (s: {
    fullName: string | null;
    role: string | null;
    profileImage: string | null;
    username: string | null;
  }) => unknown) => selector({
    fullName: 'Sam Admin',
    role: 'admin',
    profileImage: null,
    username: 'sam',
  }),
}));

vi.mock('@store/ui', () => ({
  selectTheme: (s: { theme: string }) => s.theme,
  useUiStore: Object.assign(
    (selector: (s: { theme: string; toggleTheme: () => void }) => unknown) =>
      selector({ theme: 'light', toggleTheme: vi.fn() }),
    { getState: () => ({ toggleTheme: vi.fn() }) },
  ),
}));

vi.mock('@lib/dialog', () => ({
  dialog: { confirm: vi.fn(), info: vi.fn() },
}));

vi.mock('@api/communications', () => ({
  useCommsSummary: () => ({
    data: {
      notificationsUnread: 3,
      messagesUnread: 5,
      ticketsUnread: 71,
    },
  }),
}));

describe('AccountPill badges', () => {
  it('renders notification, message, and ticket unread counts from the communications summary query', () => {
    render(<AccountPill iconsFirst />);

    const notifButton = screen.getByTitle('Notifications');
    const msgButton = screen.getByTitle('Messages');
    const ticketButton = screen.getByTitle('Support Tickets');
    const notifBadge = notifButton.querySelector('[data-pill-badge="notif"]');
    const msgBadge = msgButton.querySelector('[data-pill-badge="msg"]');
    const badge = ticketButton.querySelector('[data-pill-badge="ticket"]');

    expect(notifBadge?.textContent).toBe('3');
    expect(msgBadge?.textContent).toBe('5');
    expect(badge?.textContent).toBe('71');
    expect(notifButton.getAttribute('aria-label')).toBe('Notifications, 3 unread');
    expect(msgButton.getAttribute('aria-label')).toBe('Messages, 5 unread');
    expect(ticketButton.getAttribute('aria-label')).toBe('Support Tickets, 71 unread');
    expect((badge as HTMLElement | null)?.style.display).not.toBe('none');
  });
});
