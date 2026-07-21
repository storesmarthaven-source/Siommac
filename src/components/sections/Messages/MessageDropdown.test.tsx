/**
 * src/components/sections/Messages/MessageDropdown.test.tsx
 *
 * Verifies two key properties of the header message dropdown:
 *   1. The list query (useMessageThreadsFull) stays warm while the modal is hidden.
 *   2. The same warm query is used when the modal is open.
 *
 * Does NOT test the badge DOM write — that responsibility belongs to badgeSync.ts.
 */

import { render } from '@testing-library/preact';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { h } from 'preact';

// ── Mutable control for modal-open state ─────────────────────────────────────
let _isModalOpen = false;
vi.mock('@/hooks/useHeaderModalOpen', () => ({
  useHeaderModalOpen: () => _isModalOpen,
}));

// Track whether useMessageThreadsFull was called with the correct enabled option.
type ThreadsArgs = [Record<string, unknown>?, ({ enabled?: boolean } | undefined)?];
type ThreadFn = (...args: ThreadsArgs) => {
  data: { items: unknown[]; total: number; nextCursor: null } | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => void;
};
const threadsFull = vi.fn<ThreadFn>().mockReturnValue({
  data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn(),
});

vi.mock('@api/communications', () => ({
  useMessageThreadsFull: (...args: ThreadsArgs) => threadsFull(...args),
  useCommsSummary: () => ({ data: { messagesUnread: 0 } }),
  useMarkThreadRead: () => ({ mutate: vi.fn() }),
}));

vi.mock('@components/nav/navCore', () => ({
  showSection: vi.fn(),
}));

vi.mock('./MessageDropdownItem', () => ({ MessageDropdownItem: () => null }));
vi.mock('./ComposeThreadDialog', () => ({ ComposeThreadDialog: () => null }));

import { MessageDropdown } from './MessageDropdown';

function renderDropdown() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(MessageDropdown, null)),
  );
}

describe('MessageDropdown query gating', () => {
  beforeEach(() => {
    _isModalOpen = false;
    threadsFull.mockClear();
  });

  it('keeps useMessageThreadsFull warm when the modal is hidden', () => {
    _isModalOpen = false;
    renderDropdown();
    const call = threadsFull.mock.calls[0];
    const opts = call?.[1];
    expect(opts).toBeUndefined();
  });

  it('keeps useMessageThreadsFull warm when the modal is open', () => {
    _isModalOpen = true;
    renderDropdown();
    const call = threadsFull.mock.calls[0];
    const opts = call?.[1];
    expect(opts).toBeUndefined();
  });

  it('renders without crashing when modal is open and no threads are loaded', () => {
    _isModalOpen = true;
    const { container } = renderDropdown();
    // Component renders a non-empty structure.
    expect(container.firstChild).toBeTruthy();
  });
});
