import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { type CanonicalNotification } from '@api/communications';

vi.mock('@untitledui/file-icons', () => ({
  FileIcon: ({ type }: { type: string }) => <svg data-upstream-file-icon={type} />,
}));

import { NotificationItem } from './NotificationItem';
import { NotificationDropdownItem } from './NotificationDropdownItem';

function notification(overrides: Partial<CanonicalNotification> = {}): CanonicalNotification {
  return {
    id: 'notification-1',
    type: 'finance.expense.attachment_added',
    module: 'finance',
    severity: 'info',
    title: 'Receipt Added',
    body: 'A supporting receipt was added to the expense claim.',
    source_type: 'expense_claim',
    source_id: 'claim-1',
    action_route: 's-finance-expenses',
    metadata: { claimNo: 'EXP-2041', fileName: 'receipt.pdf', fileSize: 2048 },
    is_read: false,
    action_required: false,
    action_status: 'none',
    due_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('NotificationItem rich presentation', () => {
  it('renders structured file and record metadata only when supplied by the event', () => {
    render(<NotificationItem n={notification()} onOpen={vi.fn()} onArchive={vi.fn()} />);

    expect(screen.getByText('receipt.pdf')).toBeTruthy();
    expect(screen.getByText('2 KB')).toBeTruthy();
    expect(screen.getByText('EXP-2041')).toBeTruthy();
  });

  it('keeps row, review, and archive actions independent', () => {
    const open = vi.fn();
    const archive = vi.fn();
    const n = notification({ action_required: true, action_status: 'pending' });
    render(<NotificationItem n={n} onOpen={open} onArchive={archive} />);

    fireEvent.click(screen.getByRole('button', { name: 'Review Details' }));
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Archive Receipt Added' }));
    expect(archive).toHaveBeenCalledWith(n);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shows the same rich file metadata in the compact dropdown treatment', () => {
    const { container } = render(<NotificationDropdownItem n={notification()} onOpen={vi.fn()} />);

    expect(screen.getByText('receipt.pdf')).toBeTruthy();
    expect(screen.getByText('2 KB')).toBeTruthy();
    expect(container.querySelector('.nc-rich-file--compact')).toBeTruthy();
    expect(container.querySelector('.ui-file-type-icon')).toBeTruthy();
  });
});
