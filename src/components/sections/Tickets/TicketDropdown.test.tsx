/**
 * src/components/sections/Tickets/TicketDropdown.test.tsx
 *
 * Verifies two key properties of the header ticket dropdown:
 *   1. The list query (useMyTickets) is DISABLED while the modal is hidden.
 *   2. An API error shows a clean error state without crashing the header.
 *
 * Does NOT test the badge DOM write — that responsibility belongs to badgeSync.ts.
 */

import { render, screen } from '@testing-library/preact';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { h } from 'preact';

// ── Mutable control for modal-open state ─────────────────────────────────────
let _isModalOpen = false;
vi.mock('@/hooks/useHeaderModalOpen', () => ({
  useHeaderModalOpen: () => _isModalOpen,
}));

interface TicketQueryResult {
  data: { items: unknown[]; total: number; nextCursor: null } | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
}
type TicketsArgs = [Record<string, unknown>, { enabled?: boolean }?];
type TicketFn = (...args: TicketsArgs) => TicketQueryResult;
const myTickets = vi.fn<TicketFn>();

vi.mock('@api/communications', () => ({
  useMyTickets: (...args: TicketsArgs) => myTickets(...args),
  useCommsSummary: () => ({ data: { ticketsUnread: 0 } }),
  useMarkTicketRead: () => ({ mutate: vi.fn() }),
}));

vi.mock('@components/nav/navCore', () => ({
  showSection: vi.fn(),
}));

vi.mock('@lib/permissions', () => ({ useCan: () => false }));
vi.mock('./TicketCreateDialog', () => ({ TicketCreateDialog: () => null }));

import { TicketDropdown } from './TicketDropdown';

function makeResult(overrides: Partial<TicketQueryResult> = {}): TicketQueryResult {
  return {
    data:       { items: [], total: 0, nextCursor: null },
    isLoading:  false,
    isFetching: false,
    isError:    false,
    refetch:    vi.fn(),
    ...overrides,
  };
}

function renderDropdown() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(TicketDropdown, null)),
  );
}

describe('TicketDropdown query gating', () => {
  beforeEach(() => {
    _isModalOpen = false;
    myTickets.mockReset();
    myTickets.mockReturnValue(makeResult());
  });

  it('passes enabled:false to useMyTickets when the modal is hidden', () => {
    _isModalOpen = false;
    renderDropdown();
    const call = myTickets.mock.calls[0];
    const opts = call?.[1];
    expect(opts?.enabled).toBe(false);
  });

  it('passes enabled:true to useMyTickets when the modal is open', () => {
    _isModalOpen = true;
    renderDropdown();
    const call = myTickets.mock.calls[0];
    const opts = call?.[1];
    expect(opts?.enabled).toBe(true);
  });

  it('renders an error state (not a blank crash) when the tickets API fails', () => {
    _isModalOpen = true;
    myTickets.mockReturnValue(makeResult({ data: undefined, isError: true }));
    renderDropdown();
    // The dropdown shows a recovery message instead of a blank screen.
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
  });
});
