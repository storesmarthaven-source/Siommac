import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalTicket } from '@api/communications';
import { TicketCenter } from './TicketCenter';

const mocks = vi.hoisted(() => ({
  comment: vi.fn(),
  update: vi.fn(),
  markRead: vi.fn(),
  refetch: vi.fn(),
}));

const requester = { id: 'employee-1', displayName: 'Angela Martin', email: 'angela@example.test', role: 'employee', photoUrl: null };
const handler = { id: 'handler-1', displayName: 'Michael Reyes', email: 'michael@example.test', role: 'admin', photoUrl: null };
const ticket = {
  id: '11111111-1111-4111-8111-111111111111',
  ticketNumber: 'TKT-2026-0148',
  requestTypeCode: 'employment_letter',
  queueCode: 'hr',
  category: 'Employee Document',
  priority: 'medium',
  status: 'open',
  subject: 'Employment letter',
  responseDueAt: '2026-07-20T12:00:00Z',
  resolutionDueAt: '2026-07-21T12:00:00Z',
  lastActivityAt: '2026-07-20T10:00:00Z',
  requesterUserId: requester.id,
  assigneeUserId: null,
  activitySequence: 2,
  lastReadSequence: 0,
  unreadCount: 2,
  isConfidential: false,
  canHandle: true,
  tags: [{ key: 'job-letter', label: 'Job letter', kind: 'system' as const }],
  createdAt: '2026-07-20T09:00:00Z',
  version: 1,
  requester,
  assignee: null,
};

const resolvedTicket = { ...ticket, id: '22222222-2222-4222-8222-222222222222', ticketNumber: 'TKT-2026-0149', status: 'resolved', subject: 'Resolved payslip query', unreadCount: 0 };
const closedTicket = { ...ticket, id: '33333333-3333-4333-8333-333333333333', ticketNumber: 'TKT-2026-0150', status: 'closed', subject: 'Archived facilities issue', unreadCount: 0 };
const ALL: CanonicalTicket[] = [ticket, resolvedTicket, closedTicket];
const ACTIVE = new Set(['open', 'assigned', 'in_progress', 'waiting_requester', 'reopened']);

const detail = {
  ticket: { ...ticket, description: 'Please prepare a letter for my visa application.' },
  canHandle: true,
  comments: [{ id: 'comment-1', authorUserId: handler.id, body: 'I will prepare this today.', isInternal: false, isSystem: false, sequence: 2, createdAt: '2026-07-20T10:00:00Z', author: handler }],
  tags: [{ key: 'job-letter', label: 'Job letter', kind: 'system' as const, createdAt: '2026-07-20T09:00:00Z' }],
  attachments: [{ id: 'attachment-1', fileName: 'employment-letter.pdf', contentType: 'application/pdf', sizeBytes: 2048, uploadedBy: handler.id, createdAt: '2026-07-20T10:00:00Z', uploadedAt: '2026-07-20T10:00:00Z' }],
  participants: [{ userId: requester.id, role: 'requester', notificationsMuted: false, user: requester }],
  events: [{ id: 'event-1', eventType: 'created', sequence: 1, actorUserId: requester.id, actor: requester, createdAt: '2026-07-20T09:00:00Z' }],
  lastReadSequence: 0,
  unreadCount: 2,
};
const detailsById: Record<string, typeof detail> = {
  [ticket.id]: detail,
  [resolvedTicket.id]: { ...detail, ticket: { ...resolvedTicket, description: 'Payslip query already resolved.' }, unreadCount: 0 },
  [closedTicket.id]: { ...detail, ticket: { ...closedTicket, description: 'Facilities issue closed out.' }, unreadCount: 0 },
};

// Mutable nav-context — capabilities + server-authoritative counts (never page-derived).
const nav = vi.hoisted(() => ({
  value: {
    capabilities: { isHandler: true, handledServiceAreas: [{ code: 'hr', label: 'People & HR' }] },
    counts: {
      inbox: 1,
      mine:     { active: 1, resolved: 1, archived: 1, all: 3 },
      assigned: { active: 5, resolved: 2, archived: 0, all: 7 },
      all:      { active: 7, resolved: 3, archived: 4, all: 14 },
    },
  },
}));

vi.mock('@store/session', () => ({
  useSessionStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ userId: 'handler-1', fullName: 'Michael Reyes', profileImage: null }),
}));
vi.mock('@store/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@api/communications', () => ({
  // Simulate the server scope + status-group filtering so switching tabs changes the list.
  useMyTickets: (args: { scope?: string; statusGroup?: string } = {}) => {
    const scope = args.scope ?? 'mine';
    const sg = scope === 'queue' ? 'active' : (args.statusGroup ?? 'all');
    let items = ALL;
    if (scope === 'assigned') items = items.filter(t => t.assigneeUserId === 'handler-1');
    else if (scope === 'queue') items = items.filter(t => t.assigneeUserId === null && ACTIVE.has(t.status));
    if (sg === 'active') items = items.filter(t => ACTIVE.has(t.status));
    else if (sg === 'resolved') items = items.filter(t => t.status === 'resolved');
    else if (sg === 'archived') items = items.filter(t => ['closed', 'cancelled'].includes(t.status));
    return { data: { items, total: items.length, nextCursor: null }, isLoading: false, isError: false, refetch: mocks.refetch };
  },
  useTicketNavContext: () => ({ data: nav.value, isLoading: false, isError: false }),
  useTicket: (id: string) => ({ data: id ? detailsById[id] : undefined, isLoading: false, isError: false, refetch: mocks.refetch }),
  useCommsSummary: () => ({ data: { ticketsOpen: 1, ticketsUnread: 2 } }),
  useCommentTicket: () => ({ mutate: mocks.comment, isPending: false }),
  useUpdateTicket: () => ({ mutate: mocks.update, isPending: false }),
  useMarkTicketRead: () => ({ mutate: mocks.markRead }),
  useTicketRequestTypes: () => ({ data: [], isLoading: false }),
  useTicketRequesterSearch: () => ({ data: [], isLoading: false, isError: false }),
  useCreateTicket: () => ({ mutate: vi.fn(), isPending: false }),
  uploadTicketAttachment: vi.fn(),
  getTicketAttachmentUrl: vi.fn(),
}));

describe('TicketCenter', () => {
  beforeEach(() => {
    mocks.comment.mockReset();
    mocks.update.mockReset();
    mocks.markRead.mockReset();
    nav.value.capabilities.isHandler = true;
    nav.value.capabilities.handledServiceAreas = [{ code: 'hr', label: 'People & HR' }];
    nav.value.counts.inbox = 1;
  });

  it('renders handler navigation, the category pill (not the queue code), and the selected thread', async () => {
    render(<TicketCenter />);
    // Handler scope tabs (role-aware nav), not the old six-button rows.
    expect(screen.getByRole('button', { name: /Inbox/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Assigned to Me/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /All Tickets/ })).toBeTruthy();
    // Category pill shows the ticket's CATEGORY, never the queueCode 'hr'.
    expect(screen.getAllByText('Employee Document').length).toBeGreaterThan(0);
    expect(screen.queryByText('hr')).toBeNull();
    expect(await screen.findByText('Please prepare a letter for my visa application.')).toBeTruthy();
  });

  it('shows tab badges from server counts, not the loaded page length', () => {
    render(<TicketCenter />);
    // All Tickets badge = counts.all.active (7) even though the page holds 1 active row.
    expect(within(screen.getByRole('button', { name: /All Tickets/ })).getByText('7')).toBeTruthy();
    // Assigned to Me badge = counts.assigned.active (5) though nothing is assigned in the page.
    expect(within(screen.getByRole('button', { name: /Assigned to Me/ })).getByText('5')).toBeTruthy();
  });

  it('a handler with an EMPTY inbox still receives handler navigation', () => {
    nav.value.counts.inbox = 0; // empty inbox
    render(<TicketCenter />);
    // isHandler comes from capabilities, never from returned rows — nav stays.
    expect(screen.getByRole('button', { name: /Inbox/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /All Tickets/ })).toBeTruthy();
  });

  it('a requester (non-handler) sees My Tickets + a status dropdown, no Inbox', async () => {
    nav.value.capabilities.isHandler = false;
    nav.value.capabilities.handledServiceAreas = [];
    render(<TicketCenter />);
    await waitFor(() => expect(screen.getByText('My Tickets')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Inbox/ })).toBeNull();
    // Status dropdown present for My Tickets.
    expect(screen.getByLabelText(/Status/)).toBeTruthy();
  });

  it('Inbox is always active and hides the status dropdown; other scopes show it', async () => {
    render(<TicketCenter />);
    // Default handler scope is Inbox → no status dropdown.
    await waitFor(() => expect((screen.getByRole('button', { name: /Inbox/ })).className).toContain('active'));
    expect(screen.queryByLabelText(/Status/)).toBeNull();
    // Switch to All Tickets → the status dropdown appears.
    fireEvent.click(screen.getByRole('button', { name: /All Tickets/ }));
    expect(await screen.findByLabelText(/Status/)).toBeTruthy();
  });

  it('marks an unread selected ticket through the canonical endpoint', async () => {
    render(<TicketCenter />);
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith({ ticketId: ticket.id, sequence: ticket.activitySequence }));
  });

  it('sends replies and internal notes using the ticket comment mutation', () => {
    const { container } = render(<TicketCenter />);
    const editor = container.querySelector<HTMLElement>('.tc-editor');
    expect(editor).toBeTruthy();
    if (!editor) return;
    // The composer serializes editor.innerHTML (rich-text) — drive it that way.
    editor.innerHTML = 'Your letter is ready.';
    fireEvent.input(editor);
    fireEvent.click(screen.getByText('Send reply'));
    expect(mocks.comment).toHaveBeenCalledWith({ ticketId: ticket.id, body: 'Your letter is ready.', isInternal: false }, expect.any(Object));

    fireEvent.click(screen.getByText('Internal note'));
    editor.innerHTML = 'Salary visibility checked.';
    fireEvent.input(editor);
    fireEvent.click(screen.getByText('Add note'));
    expect(mocks.comment).toHaveBeenCalledWith({ ticketId: ticket.id, body: 'Salary visibility checked.', isInternal: true }, expect.any(Object));
  });

  it('wires lifecycle actions and exposes every ticket detail section directly', async () => {
    render(<TicketCenter />);
    expect(screen.queryByText('Start work')).toBeNull();
    expect(screen.queryByText('Archive ticket')).toBeNull();
    fireEvent.click(await screen.findByText('Assign to me'));
    expect(mocks.update).toHaveBeenCalledWith({ ticketId: ticket.id, action: 'assign', payload: { assigneeId: 'handler-1' } }, expect.any(Object));
    fireEvent.click(screen.getByRole('button', { name: /Ticket details/ }));
    expect(screen.getByText(/Resolution due/)).toBeTruthy();
    expect(screen.getByText('Lifecycle')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Attachments' }));
    expect(screen.getAllByText('employment-letter.pdf').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByText('Sequenced activity (1)')).toBeTruthy();
  });

  it('uses close as the archive action only after a ticket is resolved', async () => {
    render(<TicketCenter />);
    window.dispatchEvent(new CustomEvent('siomac:openTicket', { detail: { ticketId: resolvedTicket.id, status: resolvedTicket.status } }));
    fireEvent.click(await screen.findByText('Archive ticket'));
    expect(mocks.update).toHaveBeenCalledWith({ ticketId: resolvedTicket.id, action: 'close', payload: {} }, expect.any(Object));
  });
});
