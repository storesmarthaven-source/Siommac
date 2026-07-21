import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTicketArgs } from '@api/communications';
import { TicketCreateDialog } from './TicketCreateDialog';

// Mutable permission set — each test seeds the create_* keys it wants to exercise.
const grants = new Set<string>();

const employeeTypes = [
  { code: 'employment_letter', label: 'Employment letter', description: 'HR letter request', category: 'HR', queueCode: 'hr_service', queueLabel: 'HR service', module: 'HR', defaultPriority: 'low', responseTargetMinutes: 60, resolutionTargetMinutes: 480, systemTags: [], isConfidential: false },
];
const internalTypes = [
  { code: 'finance_admin', label: 'Finance administration', description: 'Internal finance work', category: 'Finance', queueCode: 'finance_service', queueLabel: 'Finance service', module: 'Finance', defaultPriority: 'medium', responseTargetMinutes: 120, resolutionTargetMinutes: 960, systemTags: [], isConfidential: false },
];

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@lib/permissions', () => ({ useCan: (key: string) => grants.has(key) }));
vi.mock('@store/ui', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@api/communications', () => ({
  useTicketRequestTypes: (mode: string) => ({
    data: mode === 'internal' ? internalTypes : employeeTypes,
    isLoading: false,
    isError: false,
  }),
  useTicketRequesterSearch: () => ({
    data: [{ id: 'emp-9', displayName: 'Dwight Schrute', email: 'dwight@example.test' }],
    isLoading: false,
    isError: false,
  }),
  useCreateTicket: () => ({ mutate: mocks.create, isPending: false }),
}));

function grant(...keys: string[]): void {
  grants.clear();
  keys.forEach(key => grants.add(key));
}

describe('TicketCreateDialog', () => {
  beforeEach(() => {
    grants.clear();
    mocks.create.mockReset();
  });

  it('offers only self-service to an ordinary employee and hides the priority control', () => {
    grant('tickets.create_self');
    render(<TicketCreateDialog open onClose={vi.fn()} />);

    // Single mode ⇒ no mode selector, and no handler-only priority control.
    expect(screen.queryByRole('group', { name: 'Ticket creation mode' })).toBeNull();
    expect(screen.queryByLabelText('Priority')).toBeNull();
    // No requester picker / reason for self mode.
    expect(screen.queryByPlaceholderText('Search your team…')).toBeNull();
    expect(screen.queryByLabelText(/Reason for the request/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Request type/), { target: { value: 'employment_letter' } });
    fireEvent.input(screen.getByLabelText(/Subject/), { target: { value: 'Need a letter' } });
    fireEvent.input(screen.getByLabelText(/Description/), { target: { value: 'For my visa application.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const args = mocks.create.mock.calls[0]?.[0] as CreateTicketArgs | undefined;
    expect(args).toMatchObject({
      requestTypeCode: 'employment_letter',
      subject: 'Need a letter',
      description: 'For my visa application.',
      creationMode: 'self',
    });
    expect(args).not.toHaveProperty('priority');
    expect(args).not.toHaveProperty('requesterId');
    expect(args).not.toHaveProperty('creationReason');
  });

  it('blocks on-behalf submission until a requester and reason are supplied, then sends the full contract', async () => {
    grant('tickets.create_self', 'tickets.create_team', 'tickets.create_on_behalf', 'tickets.create_internal');
    render(<TicketCreateDialog open onClose={vi.fn()} />);

    // Admin sees all four modes and the handler priority control.
    const modeGroup = screen.getByRole('group', { name: 'Ticket creation mode' });
    expect(within(modeGroup).getByRole('button', { name: /For myself/ })).toBeTruthy();
    expect(within(modeGroup).getByRole('button', { name: /On behalf/ })).toBeTruthy();
    expect(screen.getByLabelText('Priority')).toBeTruthy();

    fireEvent.click(within(modeGroup).getByRole('button', { name: /On behalf/ }));

    // Fill everything except requester + reason — submit must stay disabled.
    fireEvent.change(screen.getByLabelText(/Request type/), { target: { value: 'employment_letter' } });
    fireEvent.input(screen.getByLabelText(/Subject/), { target: { value: 'Payslip issue' } });
    fireEvent.input(screen.getByLabelText(/Description/), { target: { value: 'Cannot access March payslip.' } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create ticket' }).disabled).toBe(true);

    // Pick a requester from the async picker (typing opens the dropdown).
    fireEvent.input(screen.getByPlaceholderText('Search employees…'), { target: { value: 'Dw' } });
    fireEvent.click(await screen.findByText('Dwight Schrute'));
    // Provide the required reason.
    fireEvent.input(screen.getByLabelText(/Reason for the request/), { target: { value: 'Employee is on site with no laptop.' } });

    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Create ticket' });
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    const args = mocks.create.mock.calls[0]?.[0] as CreateTicketArgs | undefined;
    expect(args).toMatchObject({
      requestTypeCode: 'employment_letter',
      subject: 'Payslip issue',
      description: 'Cannot access March payslip.',
      creationMode: 'on_behalf',
      requesterId: 'emp-9',
      creationReason: 'Employee is on site with no laptop.',
      priority: 'low',
    });
  });

  it('shows only internal request types (no requester) in internal mode', () => {
    grant('tickets.create_self', 'tickets.create_internal');
    render(<TicketCreateDialog open onClose={vi.fn()} />);

    const modeGroup = screen.getByRole('group', { name: 'Ticket creation mode' });
    fireEvent.click(within(modeGroup).getByRole('button', { name: /Internal work/ }));

    // Internal types come from the mode-keyed hook; no requester picker.
    const typeSelect = screen.getByLabelText(/Request type/);
    expect(within(typeSelect).getByText(/Finance administration/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('Search employees…')).toBeNull();
    expect(screen.queryByLabelText(/Reason for the request/)).toBeNull();
  });
});
