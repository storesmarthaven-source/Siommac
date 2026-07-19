/**
 * complianceToasts.test.ts — mount watermark + no-burst behaviour.
 *
 * Compliance notifications must (1) never replay historical rows present at mount,
 * (2) NOT swallow a genuinely-new notification that arrives while the initial seed
 * fetch is in flight (seed only rows older than the session boundary), and (3) fire
 * the rich action-toast DIRECTLY (coalesce:false), never as an "N new" burst.
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

// Session boundary; "historical" rows are created before it, "new" rows at/after.
const BOUNDARY = Date.parse('2026-07-19T12:00:00.000Z');
const BEFORE   = '2026-07-19T00:00:00.000Z';
const AFTER    = '2026-07-19T18:00:00.000Z';

const row = (id: string, over: Partial<ComplianceNotifRow> = {}): ComplianceNotifRow => ({
  id,
  type:       'communications.compliance.access_granted',
  title:      `Compliance ${id}`,
  body:       null,
  is_read:    false,
  link:       's-messages',
  created_at: BEFORE,
  ...over,
});

describe('complianceToasts — mount watermark + no burst', () => {
  beforeEach(() => {
    mockToast.mockReset();
    __resetComplianceToastState();
  });

  it('four old notifications do NOT become a burst toast when one new one arrives', () => {
    // Watermark: four historical notifications already present at mount.
    seedComplianceToastWatermark('u1', [row('n1'), row('n2'), row('n3'), row('n4')], BOUNDARY);
    // A signal fires; the fetch returns the 4 old rows + 1 genuinely-new compliance row.
    surfaceComplianceToasts([row('n1'), row('n2'), row('n3'), row('n4'), row('n5', { created_at: AFTER })]);
    // Only the NEW one toasts. The 4 historical rows never reach the toast engine,
    // so they can never coalesce into an "N new" burst.
    expect(mockToast).toHaveBeenCalledTimes(1);
    const arg = mockToast.mock.calls[0]![0];
    expect(arg.notification.id).toBe('n5');
    expect(arg.coalesce).toBe(false);       // fired directly — never a burst
    expect(arg.domain).toBe('notifications');
  });

  it('does NOT swallow a compliance notification created after the session boundary', () => {
    // The seed fetch returns an old row AND one that landed while the fetch was in
    // flight (created at/after the boundary). Only the old one is historical.
    const rows = [row('old', { created_at: BEFORE }), row('duringSeed', { created_at: AFTER })];
    seedComplianceToastWatermark('u1', rows, BOUNDARY);
    surfaceComplianceToasts(rows);
    // The row created during seeding is treated as new and still toasts.
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast.mock.calls[0]![0].notification.id).toBe('duringSeed');
  });

  it('does not re-toast a notification it already surfaced (repeat signal)', () => {
    seedComplianceToastWatermark('u1', [], BOUNDARY);
    surfaceComplianceToasts([row('n5', { created_at: AFTER })]);
    surfaceComplianceToasts([row('n5', { created_at: AFTER })]);
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('ignores non-compliance notification types', () => {
    seedComplianceToastWatermark('u1', [], BOUNDARY);
    surfaceComplianceToasts([row('x1', { type: 'workflow.task.assigned' })]);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('maps the notification through the rich shape (route from link, severity from type)', () => {
    seedComplianceToastWatermark('u1', [], BOUNDARY);
    surfaceComplianceToasts([
      row('g1', { type: 'communications.compliance.access_granted', link: 's-messages', created_at: AFTER }),
      row('r1', { type: 'communications.compliance.access_revoked', created_at: AFTER }),
    ]);
    const granted = mockToast.mock.calls[0]![0].notification;
    const revoked = mockToast.mock.calls[1]![0].notification;
    expect(granted.action_route).toBe('s-messages');
    expect(granted.severity).toBe('success');
    expect(revoked.severity).toBe('warning');
  });

  it('re-seeds the watermark for a different user (re-login)', () => {
    seedComplianceToastWatermark('u1', [row('n1')], BOUNDARY);
    expect(needsWatermarkSeed('u1')).toBe(false);
    expect(needsWatermarkSeed('u2')).toBe(true);
    // Re-login as u2 clears u1's watermark, so u1's old id is no longer suppressed.
    seedComplianceToastWatermark('u2', [], BOUNDARY);
    surfaceComplianceToasts([row('n1')]);
    expect(mockToast).toHaveBeenCalledTimes(1);
  });
});
