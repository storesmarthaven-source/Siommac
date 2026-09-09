import { act, render, waitFor } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMeeting, useMeetingsList } from './meetings';
import { useSessionStore } from '@store/session';

const apiPost = vi.hoisted(() => vi.fn<(route: string, args?: Record<string, unknown>) => Promise<unknown>>());

vi.mock('@lib/api', () => ({ apiPost, registerAuthExpiredHandler: vi.fn() }));

function ProtectedMeetingReads() {
  useMeetingsList({ statuses: ['scheduled'] });
  useMeeting('meeting-1');
  return null;
}

describe('protected Meetings query gate', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockResolvedValue({ success: true, data: { items: [], nextCursor: null } });
    useSessionStore.setState({ isAuthenticated: false, token: null, userId: null });
  });

  afterEach(() => useSessionStore.setState({ isAuthenticated: false, token: null, userId: null }));

  it('does not query Meetings until authentication is established', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><ProtectedMeetingReads /></QueryClientProvider>);

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(apiPost).not.toHaveBeenCalled();

    await act(() => { useSessionStore.setState({ isAuthenticated: true, token: 'test-token', userId: 'USR-TEST' }); });

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2));
    expect(apiPost.mock.calls.map(([route]) => route)).toEqual(expect.arrayContaining(['meetings/list', 'meetings/get']));
  });
});
