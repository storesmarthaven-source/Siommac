import { act, render, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCommsSummary,
  useMessageThreadsFull,
  useMyTickets,
  useNotificationPreferences,
  useNotifications,
} from './communications';
import { useSessionStore } from '@store/session';

const apiPost = vi.hoisted(() => vi.fn());

vi.mock('@lib/api', () => ({
  apiPost,
  registerAuthExpiredHandler: vi.fn(),
}));

function ProtectedCommunicationsReads() {
  useCommsSummary();
  useNotifications();
  useNotificationPreferences();
  useMessageThreadsFull();
  useMyTickets();
  return null;
}

describe('protected communications query gate', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockResolvedValue({ success: true, data: [], total: 0, nextCursor: null });
    useSessionStore.setState({ isAuthenticated: false, token: null, userId: null });
  });

  afterEach(() => {
    useSessionStore.setState({ isAuthenticated: false, token: null, userId: null });
  });

  it('does not start dropdown or settings requests until authentication is established', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={client}>
        <ProtectedCommunicationsReads />
      </QueryClientProvider>,
    );

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(apiPost).not.toHaveBeenCalled();

    await act(() => {
      useSessionStore.setState({ isAuthenticated: true, token: 'test-token', userId: 'USR-TEST' });
    });

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(5));
    const routes = (apiPost.mock.calls as [unknown, ...unknown[]][]).map(([route]) => String(route));
    expect(routes).toEqual(expect.arrayContaining([
      'communications/summary',
      'communications/notifications/list',
      'communications/notifications/preferences/get',
      'communications/messages/threads',
      'communications/tickets/list',
    ]));
  });
});
