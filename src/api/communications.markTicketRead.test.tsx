/**
 * Regression guard for the ticket mark-read cache shape.
 *
 * useMyTickets stores the list as a TicketListPage ({ items, total, nextCursor }).
 * useMarkTicketRead's optimistic update must map old.items — an earlier version
 * treated the cache as a bare CanonicalTicket[] (old?.map), which wiped the entry
 * to undefined and made rows vanish.
 */
import { render, waitFor } from '@testing-library/preact';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { h } from 'preact';

const apiPost = vi.fn(() => Promise.resolve({ success: true, data: { lastReadSequence: 5 } }));
vi.mock('@lib/api', () => ({ apiPost: (...a: unknown[]) => apiPost(...a) }));

import { useMarkTicketRead } from './communications';
import { ticketKeys } from './queryKeys';

type Mark = ReturnType<typeof useMarkTicketRead>;
function Probe({ capture }: { capture: (m: Mark) => void }) {
  capture(useMarkTicketRead());
  return null;
}

describe('useMarkTicketRead — preserves the TicketListPage cache shape', () => {
  it('maps old.items in place; the cache stays { items, total, nextCursor }', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const listKey = ticketKeys.list({ scope: 'all', limit: 30 });
    qc.setQueryData(listKey, {
      items: [{ id: 'T1', unreadCount: 2, activitySequence: 5 }],
      total: 1,
      nextCursor: null,
    });

    let mutation!: Mark;
    render(h(QueryClientProvider, { client: qc }, h(Probe, { capture: (m) => { mutation = m; } })));
    mutation.mutate({ ticketId: 'T1', sequence: 5 });

    await waitFor(() => {
      // Still a page object — NOT undefined and NOT a bare array.
      expect(qc.getQueryData(listKey)).toEqual({
        items: [{ id: 'T1', unreadCount: 0, activitySequence: 5, lastReadSequence: 5 }],
        total: 1,
        nextCursor: null,
      });
    });
  });
});
