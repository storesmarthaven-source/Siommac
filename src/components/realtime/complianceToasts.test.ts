/**
 * complianceToasts.test.ts — id-based (clock-free) watermark + no burst.
 *
 * The historical watermark is the SET OF IDS present at seed time — never a
 * browser↔server timestamp comparison — so clock skew can't misclassify a row.
 * Compliance notifications fire the rich action-toast directly (coalesce:false),
 * never as an "N new" burst. Headline case: four old notifications must not become
 * a burst when one new one arrives.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./notificationToasts', () => ({ maybeToastNotification: vi.fn() }));

import { maybeToastNotification } from './notificationToasts';
import {
  seedComplianceToastWatermark,
  surfaceComplianceToasts,
  needsWatermarkSeed,
  __resetComplianceToastState,
  type ComplianceNotifRow,
} from './complianceToasts';

const mockToast = vi.mocked(maybeToastNotification);

const row = (id: string, over: Partial<ComplianceNotifRow> = {}): ComplianceNotifRow => ({
  id,
  type:       'communications.compliance.access_granted',
  title:      `Compliance ${id}`,
  body:       null,
  is_read:    false,
  link:       's-messages',
  created_at: '2026-07-19T00:00:00.000Z',
  ...over,
});

describe('complianceToasts — id-based watermark + no burst', () => {
  beforeEach(() => {
    mockToast.mockReset();
    __resetComplianceToastState();
  });

  it('four old notifications do NOT become a burst toast when one new one arrives', () => {
    seedComplianceToastWatermark('u1', [row('n1'), row('n2'), row('n3'), row('n4')]);
    surfaceComplianceToasts([row('n1'), row('n2'), row('n3'), row('n4'), row('n5')]);
    expect(mockToast).toHaveBeenCalledTimes(1);
    const arg = mockToast.mock.calls[0]![0];
    expect(arg.notification.id).toBe('n5');
    expect(arg.coalesce).toBe(false);       // fired directly — never a burst
    expect(arg.domain).toBe('notifications');
  });

  it('seeds by ID, not by timestamp — a FUTURE-dated seeded row stays suppressed (skew-safe)', () => {
    // Server clock ahead of the browser → created_at is "in the future". It must
    // STILL be historical because it was in the seed set; no time comparison.
    seedComplianceToastWatermark('u1', [row('future', { created_at: '2099-01-01T00:00:00.000Z' })]);
    surfaceComplianceToasts([row('future', { created_at: '2099-01-01T00:00:00.000Z' })]);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('surfaces any id NOT in the seed, regardless of its timestamp (even an old one)', () => {
    seedComplianceToastWatermark('u1', [row('old')]);
    surfaceComplianceToasts([row('fresh', { created_at: '2000-01-01T00:00:00.000Z' })]);
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast.mock.calls[0]![0].notification.id).toBe('fresh');
  });

  it('does not re-toast a notification it already surfaced (repeat signal)', () => {
    seedComplianceToastWatermark('u1', []);
    surfaceComplianceToasts([row('n5')]);
    surfaceComplianceToasts([row('n5')]);
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('ignores non-compliance notification types', () => {
    seedComplianceToastWatermark('u1', []);
    surfaceComplianceToasts([row('x1', { type: 'workflow.task.assigned' })]);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('maps the notification through the rich shape (route from link, severity from type)', () => {
    seedComplianceToastWatermark('u1', []);
    surfaceComplianceToasts([
      row('g1', { type: 'communications.compliance.access_granted', link: 's-messages' }),
      row('r1', { type: 'communications.compliance.access_revoked' }),
    ]);
    const granted = mockToast.mock.calls[0]![0].notification;
    const revoked = mockToast.mock.calls[1]![0].notification;
    expect(granted.action_route).toBe('s-messages');
    expect(granted.severity).toBe('success');
    expect(revoked.severity).toBe('warning');
  });

  it('re-seeds the watermark for a different user (re-login)', () => {
    seedComplianceToastWatermark('u1', [row('n1')]);
    expect(needsWatermarkSeed('u1')).toBe(false);
    expect(needsWatermarkSeed('u2')).toBe(true);
    seedComplianceToastWatermark('u2', []);
    surfaceComplianceToasts([row('n1')]);
    expect(mockToast).toHaveBeenCalledTimes(1);
  });
});
