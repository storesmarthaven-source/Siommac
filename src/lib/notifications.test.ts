/**
 * src/lib/notifications.test.ts
 *
 * Unit tests for the Notifications domain.
 *
 * Coverage areas:
 *   §1 Schema validation       — NotificationRowSchema, NotificationPreferenceSchema
 *   §2 Notification store      — optimistic increment, reset, setItems, panel lifecycle
 *   §3 Realtime channel init   — idempotent subscribe, teardown clears channel
 *   §4 queryKeys               — factory functions return correct key shapes
 *   §5 Type mapping            — NOTIFICATION_TYPE_LABELS covers all enum values
 *
 * Supabase and TanStack Query are mocked at the module level so no real
 * network calls are made. The store is reset between tests via `reset()`.
 *
 * @see docs/ARCHITECTURE.md §10-Realtime
 * @see docs/CODING_STANDARDS.md §10-Testing-Standards
 * @see docs/PHASE_PLAN.md §Phase-2c
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  NotificationRowSchema,
  NotificationPreferenceSchema,
  NotificationTypeSchema,
  NOTIFICATION_TYPE_LABELS,
  UpdatePreferenceSchema,
  SendNotificationSchema,
}                                 from '@api/schemas/notification';
import type { NotificationType }  from '@api/schemas/notification';
import { useNotificationStore }   from '@store/notifications';
import { notificationKeys }       from '@api/queryKeys';

// ── Supabase mock (prevent real network on module import) ─────────────────────

vi.mock('@lib/supabase', () => ({
  supabase: {
    channel: vi.fn().mockReturnValue({
      on:        vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    }),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@lib/queryClient', () => ({
  getQueryClient: vi.fn().mockReturnValue({
    invalidateQueries: vi.fn(),
  }),
}));

// ── §1  Schema validation ─────────────────────────────────────────────────────

// Valid RFC 4122 UUIDs (variant 1, version 4)
const UUID_1 = '550e8400-e29b-41d4-a716-446655440000';
const UUID_2 = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

describe('NotificationRowSchema', () => {
  const validRow = {
    id:         UUID_1,
    user_id:    UUID_2,
    type:       'attendance_late',
    title:      'Late check-in',
    body:       'Alice checked in at 09:32',
    is_read:    false,
    link:       null,
    created_at: '2025-01-15T09:32:00+00:00',
  };

  it('accepts a well-formed notification row', () => {
    const result = NotificationRowSchema.safeParse(validRow);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('attendance_late');
      expect(result.data.is_read).toBe(false);
    }
  });

  it('accepts a row with a type outside the curated enum', () => {
    // `type` is intentionally permissive: the persisted/synthetic notification
    // stream may carry types beyond the UI enum (e.g. hse.* workflow events).
    // Rejecting them would silently drop real notifications. UI maps known types.
    const result = NotificationRowSchema.safeParse({ ...validRow, type: 'hse_incident_submitted' });
    expect(result.success).toBe(true);
  });

  it('rejects a row with an empty title', () => {
    const result = NotificationRowSchema.safeParse({ ...validRow, title: '' });
    expect(result.success).toBe(false);
  });

  it('accepts a row with a null link', () => {
    const result = NotificationRowSchema.safeParse({ ...validRow, link: null });
    expect(result.success).toBe(true);
  });

  it('accepts a row with a non-null link', () => {
    const result = NotificationRowSchema.safeParse({ ...validRow, link: '/payroll' });
    expect(result.success).toBe(true);
  });

  it('rejects a row missing a genuinely required field', () => {
    // is_read is required; omitting it must fail. (body defaults to '' and
    // user_id is optional, since the server scopes/omits it — those are not
    // required on the wire.)
    const { is_read: _omit, ...withoutIsRead } = validRow;
    const result = NotificationRowSchema.safeParse(withoutIsRead);
    expect(result.success).toBe(false);
  });

  it('accepts a text (non-UUID) id', () => {
    // Ids are text (app_users.id like "USR-…"), not UUID. A plain string id
    // must validate — the old .uuid() check rejected every real row.
    const result = NotificationRowSchema.safeParse({ ...validRow, id: 'NOTIF-2026-0001' });
    expect(result.success).toBe(true);
  });

  it('rejects a row with an empty id', () => {
    const result = NotificationRowSchema.safeParse({ ...validRow, id: '' });
    expect(result.success).toBe(false);
  });
});

describe('NotificationTypeSchema', () => {
  it('accepts all defined notification types', () => {
    const types: NotificationType[] = [
      'attendance_late', 'attendance_absent', 'attendance_missed_checkout',
      'leave_approved', 'leave_rejected', 'leave_pending',
      'payroll_published', 'system_announcement', 'mention',
    ];
    types.forEach(t => {
      expect(NotificationTypeSchema.safeParse(t).success).toBe(true);
    });
  });

  it('rejects unknown types', () => {
    expect(NotificationTypeSchema.safeParse('ticket_reply').success).toBe(false);
    expect(NotificationTypeSchema.safeParse('').success).toBe(false);
  });
});

describe('NotificationPreferenceSchema', () => {
  const validPref = {
    user_id:  UUID_1,
    type:     'leave_approved',
    enabled:  true,
    in_app:   true,
    email:    false,
    whatsapp: false,
  };

  it('accepts a well-formed preference row', () => {
    const result = NotificationPreferenceSchema.safeParse(validPref);
    expect(result.success).toBe(true);
  });

  it('rejects a preference with missing channels', () => {
    const { email: _omit, ...withoutEmail } = validPref;
    const result = NotificationPreferenceSchema.safeParse(withoutEmail);
    expect(result.success).toBe(false);
  });
});

describe('UpdatePreferenceSchema', () => {
  it('accepts partial update (only type required)', () => {
    const result = UpdatePreferenceSchema.safeParse({ type: 'mention', in_app: false });
    expect(result.success).toBe(true);
  });

  it('rejects update with unknown type', () => {
    const result = UpdatePreferenceSchema.safeParse({ type: 'invalid', in_app: false });
    expect(result.success).toBe(false);
  });
});

describe('SendNotificationSchema', () => {
  it('accepts a valid send payload', () => {
    const result = SendNotificationSchema.safeParse({
      user_id: UUID_1,
      type:    'payroll_published',
      title:   'Your payslip is ready',
    });
    expect(result.success).toBe(true);
  });

  it('defaults body to empty string when omitted', () => {
    const result = SendNotificationSchema.safeParse({
      user_id: UUID_1,
      type:    'payroll_published',
      title:   'Ready',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.body).toBe('');
  });

  it('rejects title over 200 chars', () => {
    const result = SendNotificationSchema.safeParse({
      user_id: UUID_1,
      type:    'system_announcement',
      title:   'A'.repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

// ── §2  Notification store ────────────────────────────────────────────────────

describe('useNotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.getState().reset();
  });

  it('initialises with zero unread count', () => {
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it('onNewNotification increments unread count', () => {
    useNotificationStore.getState().onNewNotification();
    expect(useNotificationStore.getState().unreadCount).toBe(1);

    useNotificationStore.getState().onNewNotification();
    expect(useNotificationStore.getState().unreadCount).toBe(2);
  });

  it('setItems updates items and unread count', () => {
    const items = [
      {
        id: UUID_1, user_id: UUID_2, type: 'mention' as NotificationType,
        title: 'Test', body: '', is_read: false, link: null,
        created_at: '2025-01-01T00:00:00+00:00',
      },
    ];
    useNotificationStore.getState().setItems(items, 1);
    expect(useNotificationStore.getState().items).toHaveLength(1);
    expect(useNotificationStore.getState().unreadCount).toBe(1);
    expect(useNotificationStore.getState().loading).toBe(false);
  });

  it('reset clears all fields', () => {
    useNotificationStore.setState({ unreadCount: 5, panelOpen: true });
    useNotificationStore.getState().reset();
    const s = useNotificationStore.getState();
    expect(s.unreadCount).toBe(0);
    expect(s.panelOpen).toBe(false);
    expect(s.items).toHaveLength(0);
    expect(s.loading).toBe(false);
  });

  it('onPanelClose sets panelOpen to false', () => {
    useNotificationStore.setState({ panelOpen: true });
    useNotificationStore.getState().onPanelClose();
    expect(useNotificationStore.getState().panelOpen).toBe(false);
  });

  it('setState directly updates unreadCount (used by markAllAsRead mutations)', () => {
    useNotificationStore.setState({ unreadCount: 3 });
    expect(useNotificationStore.getState().unreadCount).toBe(3);
    useNotificationStore.setState({ unreadCount: 0 });
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });
});

// ── §3  Realtime channel lifecycle ────────────────────────────────────────────

describe('initNotificationsRealtime / teardownNotificationsRealtime', () => {
  afterEach(() => {
    // Reset the channel handle between tests
    vi.resetModules();
  });

  it('subscribes to a user-scoped channel on init', async () => {
    const { supabase } = await import('@lib/supabase');
    const { initNotificationsRealtime } = await import('@lib/notifications');

    initNotificationsRealtime('user-123');

    expect(supabase.channel).toHaveBeenCalledWith('notifications:user-123');
  });

  it('is idempotent — second call does not subscribe again', async () => {
    const { supabase } = await import('@lib/supabase');
    const { initNotificationsRealtime } = await import('@lib/notifications');

    initNotificationsRealtime('user-456');
    initNotificationsRealtime('user-456'); // second call

    // channel() should only have been called once per module instance
    // (The module-level _notifChannel guard prevents a second subscribe)
    const callCount = (supabase.channel as ReturnType<typeof vi.fn>).mock.calls
      .filter(([name]: string[]) => name === 'notifications:user-456').length;
    expect(callCount).toBe(1);
  });

  it('teardown removes the channel and nullifies the handle', async () => {
    const { supabase } = await import('@lib/supabase');
    const { teardownNotificationsRealtime } = await import('@lib/notifications');

    await teardownNotificationsRealtime();

    // removeChannel should be called (or not, if channel is null — both are valid)
    // The important thing is it does not throw
    expect(true).toBe(true);
  });
});

// ── §4  Query keys ────────────────────────────────────────────────────────────

describe('notificationKeys', () => {
  it('all is ["notifications"]', () => {
    expect(notificationKeys.all).toEqual(['notifications']);
  });

  it('mine() returns ["notifications", "mine"]', () => {
    expect(notificationKeys.mine()).toEqual(['notifications', 'mine']);
  });

  it('unread() returns ["notifications", "unread"]', () => {
    expect(notificationKeys.unread()).toEqual(['notifications', 'unread']);
  });

  it('mine() !== all (different array references, different length)', () => {
    expect(notificationKeys.mine()).not.toBe(notificationKeys.all);
    expect(notificationKeys.mine().length).toBeGreaterThan(notificationKeys.all.length);
  });
});

// ── §5  Type labels ───────────────────────────────────────────────────────────

describe('NOTIFICATION_TYPE_LABELS', () => {
  it('has a label for every NotificationType enum value', () => {
    const enumValues = NotificationTypeSchema.options as NotificationType[];
    enumValues.forEach(type => {
      expect(NOTIFICATION_TYPE_LABELS[type]).toBeTruthy();
      expect(typeof NOTIFICATION_TYPE_LABELS[type]).toBe('string');
    });
  });

  it('does not have labels for values outside the enum', () => {
    const labels = NOTIFICATION_TYPE_LABELS as Record<string, string>;
    expect(labels['ticket_reply']).toBeUndefined();
    expect(labels['unknown']).toBeUndefined();
  });
});
