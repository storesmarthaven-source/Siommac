import { describe, expect, it } from 'vitest';
import {
  archiveAllReadPreviewNotifications, archivePreviewNotification, countPreviewNotifications,
  createPreviewNotifications, markAllPreviewNotificationsRead, markPreviewNotificationRead,
} from './previewNotifications';

describe('notification feature preview catalog', () => {
  it('demonstrates the supported rich notification treatments without live ids', () => {
    const rows = createPreviewNotifications();

    expect(rows.every(row => row.id.startsWith('preview-'))).toBe(true);
    expect(rows.some(row => row.severity === 'critical' && row.action_required)).toBe(true);
    expect(rows.some(row => typeof row.metadata?.actorPhotoUrl === 'string')).toBe(true);
    expect(rows.some(row => typeof row.metadata?.fileName === 'string')).toBe(true);
    expect(rows.some(row => row.type === 'finance.payroll.finding.comment')).toBe(true);
    expect(countPreviewNotifications(rows)).toEqual({ total: 8, unread: 4, actionRequired: 2, archived: 1 });
  });

  it('returns fresh records and updates preview state immutably', () => {
    const original = createPreviewNotifications();
    const firstId = original[0]?.id ?? '';
    const read = markPreviewNotificationRead(original, firstId);
    const allRead = markAllPreviewNotificationsRead(original);
    const archived = archivePreviewNotification(original, firstId);
    const archivedRead = archiveAllReadPreviewNotifications(allRead);

    expect(original[0]?.is_read).toBe(false);
    expect(read[0]?.is_read).toBe(true);
    expect(countPreviewNotifications(allRead).unread).toBe(0);
    expect(archived[0]?.action_status).toBe('dismissed');
    expect(countPreviewNotifications(archivedRead).total).toBe(0);
    expect(createPreviewNotifications()).not.toBe(original);
  });
});
