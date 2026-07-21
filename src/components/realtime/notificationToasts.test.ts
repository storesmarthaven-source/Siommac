import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalNotification,
  NotificationPreferencesData,
} from '@api/communications';

const toastMocks = vi.hoisted(() => {
  const base = vi.fn();
  return Object.assign(base, {
    action: vi.fn(),
    rich: vi.fn(),
  });
});

vi.mock('@ui/toast', () => ({ toast: toastMocks }));
vi.mock('@sections/NotificationCenter/notifAction', () => ({
  openNotificationTarget: vi.fn(() => true),
}));

import {
  isMutedByPreferences,
  maybeToastNotification,
  resetToastSessionClock,
  surfaceGenericNotificationToasts,
  __resetGenericToastState,
  COMPLIANCE_TOAST_TYPES,
  type NotifToastRow,
} from './notificationToasts';

function notification(
  overrides: Partial<CanonicalNotification> = {},
): CanonicalNotification {
  return {
    id: crypto.randomUUID(),
    type: 'ticket.updated',
    module: 'platform',
    severity: 'info',
    title: 'Ticket updated',
    body: 'A ticket needs your attention.',
    source_type: 'ticket',
    source_id: 'TKT-2026-000001',
    action_route: null,
    metadata: null,
    is_read: false,
    action_required: false,
    action_status: 'pending',
    due_at: null,
    created_at: new Date(Date.now() + 1).toISOString(),
    ...overrides,
  };
}

function preferences(mutedUntil: string | null): NotificationPreferencesData {
  return {
    defaults: {
      event_type: '*',
      in_app: true,
      email: false,
      whatsapp: false,
    },
    preferences: [],
    snooze: { mutedUntil },
  };
}

describe('notification toast bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
    toastMocks.mockClear();
    toastMocks.action.mockClear();
    toastMocks.rich.mockClear();
    resetToastSessionClock();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('shows a standard toast for a new plain notification', () => {
    maybeToastNotification({
      notification: notification({ source_type: 'announcement' }),
      domain: 'notifications',
    });
    vi.advanceTimersByTime(2_000);

    expect(toastMocks).toHaveBeenCalledWith('Ticket updated', {
      description: 'A ticket needs your attention.',
      variant: 'info',
    });
  });

  it('shows an action toast when a notification has a target', () => {
    maybeToastNotification({
      notification: notification({ action_route: 's-notification-center' }),
      domain: 'tickets',
    });
    vi.advanceTimersByTime(2_000);

    expect(toastMocks.action).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Ticket updated',
    }));
    const actionCall = toastMocks.action.mock.calls[0]?.[0] as unknown as {
      actions?: { label: string }[];
    };
    expect(actionCall.actions?.some(action => action.label === 'Open')).toBe(true);
  });

  it('shows a rich toast for generated reports', () => {
    maybeToastNotification({
      notification: notification({
        source_type: 'report',
        action_route: 'reports/downloads',
      }),
      domain: 'notifications',
    });
    vi.advanceTimersByTime(2_000);

    expect(toastMocks.rich).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Ticket updated',
      statusLabel: 'Report',
    }));
    const richCall = toastMocks.rich.mock.calls[0]?.[0] as unknown as {
      file?: { type: string };
    };
    expect(richCall.file?.type).toBe('file');
  });

  it('coalesces same-domain bursts into one rich toast', () => {
    maybeToastNotification({ notification: notification(), domain: 'tickets' });
    maybeToastNotification({ notification: notification(), domain: 'tickets' });
    vi.advanceTimersByTime(2_000);

    expect(toastMocks.rich).toHaveBeenCalledWith(expect.objectContaining({
      title: '2 new tickets',
    }));
    expect(toastMocks.action).not.toHaveBeenCalled();
  });

  it('does not backfill notifications created before the session clock', () => {
    maybeToastNotification({
      notification: notification({ created_at: '2026-07-20T11:59:59.000Z' }),
      domain: 'tickets',
    });
    vi.advanceTimersByTime(2_000);

    expect(toastMocks).not.toHaveBeenCalled();
    expect(toastMocks.action).not.toHaveBeenCalled();
    expect(toastMocks.rich).not.toHaveBeenCalled();
  });

  it('honours indefinite and future snooze preferences', () => {
    expect(isMutedByPreferences(preferences(null))).toBe(true);
    expect(isMutedByPreferences(preferences('2026-07-20T13:00:00.000Z'))).toBe(true);
    expect(isMutedByPreferences(preferences('2026-07-20T11:00:00.000Z'))).toBe(false);

    maybeToastNotification({
      notification: notification(),
      domain: 'tickets',
      prefs: preferences(null),
    });
    vi.advanceTimersByTime(2_000);

    expect(toastMocks.action).not.toHaveBeenCalled();
    expect(toastMocks.rich).not.toHaveBeenCalled();
  });
});

// ── surfaceGenericNotificationToasts + COMPLIANCE_TOAST_TYPES tests ───────────

function notifRow(overrides: Partial<NotifToastRow> = {}): NotifToastRow {
  return {
    id:         crypto.randomUUID(),
    type:       'ticket.created',
    title:      'New ticket',
    body:       null,
    is_read:    false,
    link:       null,
    created_at: new Date(Date.now() + 1).toISOString(),
    ...overrides,
  };
}

describe('surfaceGenericNotificationToasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
    toastMocks.mockClear();
    toastMocks.action.mockClear();
    toastMocks.rich.mockClear();
    resetToastSessionClock();
    __resetGenericToastState();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('COMPLIANCE_TOAST_TYPES contains the three expected compliance types', () => {
    expect(COMPLIANCE_TOAST_TYPES.has('communications.compliance.access_granted')).toBe(true);
    expect(COMPLIANCE_TOAST_TYPES.has('communications.compliance.access_revoked')).toBe(true);
    expect(COMPLIANCE_TOAST_TYPES.has('iam.permission.compliance_grant_requested')).toBe(true);
    expect(COMPLIANCE_TOAST_TYPES.size).toBe(3);
  });

  it('does NOT toast compliance notification types (skips them)', () => {
    surfaceGenericNotificationToasts([
      notifRow({ type: 'communications.compliance.access_granted' }),
      notifRow({ type: 'communications.compliance.access_revoked' }),
      notifRow({ type: 'iam.permission.compliance_grant_requested' }),
    ]);
    vi.advanceTimersByTime(2_000);
    expect(toastMocks).not.toHaveBeenCalled();
    expect(toastMocks.action).not.toHaveBeenCalled();
    expect(toastMocks.rich).not.toHaveBeenCalled();
  });

  it('toasts generic notification types', () => {
    surfaceGenericNotificationToasts([notifRow({ type: 'ticket.created', title: 'A new ticket' })]);
    vi.advanceTimersByTime(2_000);
    // Burst window fired — one notification → individual toast, not burst.
    expect(toastMocks).toHaveBeenCalledWith('A new ticket', expect.any(Object));
  });

  it('coalesces generic burst into one rich toast', () => {
    surfaceGenericNotificationToasts([
      notifRow({ type: 'ticket.created' }),
      notifRow({ type: 'ticket.created' }),
    ]);
    vi.advanceTimersByTime(2_000);
    // Two items in the same domain → burst toast.
    expect(toastMocks.rich).toHaveBeenCalledWith(expect.objectContaining({
      title: '2 new notifications',
    }));
  });

  it('does not double-toast the same notification id (seen-set dedupe)', () => {
    const row = notifRow({ type: 'ticket.updated' });
    surfaceGenericNotificationToasts([row]);
    surfaceGenericNotificationToasts([row]);  // same row, second fetch
    vi.advanceTimersByTime(2_000);
    // Only one toast, not two.
    const totalCalls = toastMocks.mock.calls.length
      + toastMocks.action.mock.calls.length
      + toastMocks.rich.mock.calls.length;
    expect(totalCalls).toBe(1);
  });
});
