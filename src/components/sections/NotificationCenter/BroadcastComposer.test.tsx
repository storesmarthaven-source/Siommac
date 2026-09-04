import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutateAsync = vi.fn();
const reset = vi.fn();

vi.mock('@api/communications', () => ({
  useBroadcastNotification: () => ({
    mutateAsync,
    reset,
    isPending: false,
  }),
}));

vi.mock('@store/session', () => ({
  useSessionStore: (selector: (state: { role: string }) => unknown) => selector({ role: 'admin' }),
}));

vi.mock('@components/nav/navCore', () => ({
  navGlobalCatalog: () => ({
    groups: [{
      id: 'communications',
      label: 'Communications',
      items: [
        {
          id: 's-notification-center',
          label: 'Notification Center',
          visible: true,
          isGroup: false,
          children: null,
        },
        {
          id: 's-messages',
          label: 'Messages',
          visible: true,
          isGroup: false,
          children: null,
        },
      ],
    }],
  }),
}));

import { BroadcastComposer } from './BroadcastComposer';

describe('BroadcastComposer', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    reset.mockReset();
  });

  it('uses the canonical UI Kit dialog, fields, and buttons', () => {
    render(<BroadcastComposer open onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Send Broadcast' });
    expect(dialog.classList.contains('ui-dialog')).toBe(true);
    expect(dialog.classList.contains('ui-dialog--layout-sidebar-left')).toBe(true);
    expect(document.querySelector('.ui-modal')).toBeNull();
    expect(dialog.querySelector('.ui-dialog-sidebar')).toBeTruthy();
    expect(screen.getByText('Broadcast Summary')).toBeTruthy();
    expect(screen.getAllByText('All Active Users').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.ui-field2').length).toBeGreaterThan(0);

    for (const name of ['Cancel', 'Send Broadcast']) {
      const button = screen.getByRole('button', { name });
      expect(button.classList.contains('ui-btn')).toBe(true);
      expect(button.classList.contains('ui-btn--sm')).toBe(false);
    }
  });

  it('keeps recipient controls aligned and uses a constrained role selector', () => {
    render(<BroadcastComposer open onClose={vi.fn()} />);

    const audience = screen.getByRole('combobox', { name: /^Audience/ });
    fireEvent.click(audience);
    fireEvent.pointerDown(screen.getByRole('option', { name: 'A Specific Role' }));

    const role = screen.getByRole('combobox', { name: /^Role/ });
    expect(audience.classList.contains('ui-ctrl')).toBe(true);
    expect(role.classList.contains('ui-ctrl')).toBe(true);
    expect(audience.closest('.nc-broadcast-recipient-grid')).toBe(role.closest('.nc-broadcast-recipient-grid'));

    fireEvent.click(role);
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Manager' }));
    expect(screen.getByText('A Specific Role · Manager')).toBeTruthy();
  });

  it('uses real SIOMAC destinations instead of accepting internal route text', () => {
    render(<BroadcastComposer open onClose={vi.fn()} />);

    const destination = screen.getByRole('combobox', { name: /^Destination/ });
    expect(destination.textContent).toContain('Notification Center');

    fireEvent.click(destination);
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Messages' }));
    expect(destination.textContent).toContain('Messages');
  });

  it('validates required content before sending', () => {
    render(<BroadcastComposer open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send Broadcast' }));

    expect(screen.getByText('Title is required.')).toBeTruthy();
    expect(screen.getByText('Message is required.')).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('sends a broadcast and reports its recipient count', async () => {
    mutateAsync.mockResolvedValue({ recipientCount: 3 });
    render(<BroadcastComposer open onClose={vi.fn()} />);

    fireEvent.input(screen.getByPlaceholderText('Notification headline'), {
      target: { value: 'Operations Update' },
    });
    fireEvent.input(screen.getByPlaceholderText('What should recipients know or do?'), {
      target: { value: 'Review the updated operating instructions.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send Broadcast' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      audience: { type: 'all', value: undefined, userIds: undefined },
      severity: 'info',
      title: 'Operations Update',
      body: 'Review the updated operating instructions.',
      actionRoute: 's-notification-center',
    })));
    expect(await screen.findByText('Broadcast Sent')).toBeTruthy();
    expect(screen.getByText('Delivered to 3 recipients.')).toBeTruthy();
  });
});
