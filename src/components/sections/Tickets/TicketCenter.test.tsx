import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  queueCode: 'hr_service',
  category: 'HR',
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

const detail = {
  ticket: { ...ticket, description: 'Please prepare a letter for my visa application.' },
  canHandle: true,
  comments: [{
    id: 'comment-1',
    authorUserId: handler.id,
    body: 'I will prepare this today.',
    isInternal: false,
    isSystem: false,
    sequence: 2,
    createdAt: '2026-07-20T10:00:00Z',
    author: handler,
  }],
  tags: [{ key: 'job-letter', label: 'Job letter', kind: 'system' as const, createdAt: '2026-07-20T09:00:00Z' }],
  attachments: [{ id: 'attachment-1', fileName: 'employment-letter.pdf', contentType: 'application/pdf', sizeBytes: 2048, uploadedBy: handler.id, createdAt: '2026-07-20T10:00:00Z', uploadedAt: '2026-07-20T10:00:00Z' }],
  participants: [{ userId: requester.id, role: 'requester', notificationsMuted: false, user: requester }],
  events: [{ id: 'event-1', eventType: 'created', sequence: 1, actorUserId: requester.id, actor: requester, createdAt: '2026-07-20T09:00:00Z' }],
  lastReadSequence: 0,
  unreadCount: 2,
};

vi.mock('@store/session', () => ({
  useSessionStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    userId: 'handler-1',
    fullName: 'Michael Reyes',
    profileImage: null,
  }),
}));

vi.mock('@store/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@api/communications', () => ({
  useMyTickets: () => ({ data: [ticket], isLoading: false, isError: false, refetch: mocks.refetch }),
  useTicket: (id: string) => ({ data: id ? detail : undefined, isLoading: false, isError: false, refetch: mocks.refetch }),
  useCommsSummary: () => ({ data: { ticketsOpen: 1, ticketsUnread: 2 } }),
  useCommentTicket: () => ({ mutate: mocks.comment, isPending: false }),
  useUpdateTicket: () => ({ mutate: mocks.update, isPending: false }),
  useMarkTicketRead: () => ({ mutate: mocks.markRead }),
  useTicketRequestTypes: () => ({ data: [], isLoading: false }),
  useCreateTicket: () => ({ mutate: vi.fn(), isPending: false }),
  uploadTicketAttachment: vi.fn(),
  getTicketAttachmentUrl: vi.fn(),
}));

describe('TicketCenter', () => {
  beforeEach(() => {
    mocks.comment.mockReset();
    mocks.update.mockReset();
    mocks.markRead.mockReset();
  });

  it('renders the approved ticket list, filters, KPIs and selected thread', async () => {
    render(<TicketCenter />);
    expect(screen.getByText('Ticket Center')).toBeTruthy();
    expect(screen.getAllByText('Angela Martin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Employment letter').length).toBeGreaterThan(0);
    expect(await screen.findByText('Please prepare a letter for my visa application.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Filters'));
    expect(screen.getAllByText('Waiting on requester').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Request type')).toBeTruthy();
    expect(screen.getByLabelText('Tag')).toBeTruthy();
    expect(screen.getByLabelText('Paragraph style')).toBeTruthy();
    expect(screen.getByLabelText('Align left')).toBeTruthy();
  });

  it('marks an unread selected ticket through the canonical endpoint', async () => {
    render(<TicketCenter />);
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith({
      ticketId: ticket.id,
      sequence: ticket.activitySequence,
    }));
  });

  it('sends replies and internal notes using the ticket comment mutation', () => {
    const { container } = render(<TicketCenter />);
    const editor = container.querySelector<HTMLElement>('.tc-editor');
    expect(editor).toBeTruthy();
    if (!editor) return;
    editor.innerText = 'Your letter is ready.';
    fireEvent.input(editor);
    fireEvent.click(screen.getByText('Send reply'));
    expect(mocks.comment).toHaveBeenCalledWith(
      { ticketId: ticket.id, body: 'Your letter is ready.', isInternal: false },
      expect.any(Object),
    );

    fireEvent.click(screen.getByText('Internal note'));
    editor.innerText = 'Salary visibility checked.';
    fireEvent.input(editor);
    fireEvent.click(screen.getByText('Add note'));
    expect(mocks.comment).toHaveBeenCalledWith(
      { ticketId: ticket.id, body: 'Salary visibility checked.', isInternal: true },
      expect.any(Object),
    );
  });

  it('serializes rich composer formatting into durable ticket text', () => {
    const { container } = render(<TicketCenter />);
    const editor = container.querySelector<HTMLElement>('.tc-editor');
    expect(editor).toBeTruthy();
    if (!editor) return;
    editor.innerHTML = '<div><strong>Important</strong> update</div><ul><li>Bring ID</li><li>Sign copy</li></ul>';
    fireEvent.input(editor);
    fireEvent.click(screen.getByText('Send reply'));
    expect(mocks.comment).toHaveBeenCalledWith(
      { ticketId: ticket.id, body: '**Important** update\n- Bring ID\n- Sign copy', isInternal: false },
      expect.any(Object),
    );
  });

  it('wires lifecycle actions and exposes every ticket detail section directly', async () => {
    render(<TicketCenter />);
    fireEvent.click(await screen.findByText('Assign to me'));
    expect(mocks.update).toHaveBeenCalledWith(
      { ticketId: ticket.id, action: 'assign', payload: { assigneeId: 'handler-1' } },
      expect.any(Object),
    );
    fireEvent.click(screen.getByRole('button', { name: /Ticket details/ }));
    expect(screen.getByText(/Resolution due/)).toBeTruthy();
    expect(screen.getByText('Lifecycle')).toBeTruthy();
    expect(screen.getByText('Ownership and source')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Attachments' }));
    expect(screen.getAllByText('employment-letter.pdf').length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'Participants' }));
    expect(screen.getByText('Ticket participants (1)')).toBeTruthy();
    expect(screen.getByText('Notifications on')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByText('Sequenced activity (1)')).toBeTruthy();
    expect(screen.getByText(/Sequence 1/)).toBeTruthy();
  });
});
