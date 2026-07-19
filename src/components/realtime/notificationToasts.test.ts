/**
 * notificationToasts.test.ts — action_route navigation contract.
 *
 * The Open action on a notification toast must route IN-APP section ids through
 * the app's section navigator (showSection), and only use window.location.assign
 * for real external URLs. Assigning a section id like 's-messages' as a URL breaks
 * the SPA — this test locks that in.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@components/nav/navCore', () => ({ showSection: vi.fn() }));
vi.mock('@ui/toast', () => {
  const toast = Object.assign(vi.fn(), { rich: vi.fn(), action: vi.fn() });
  return { toast };
});

import { showSection } from '@components/nav/navCore';
import { toast } from '@ui/toast';
import { navigateToRoute, maybeToastNotification, type CanonicalNotification } from './notificationToasts';

describe('navigateToRoute — toast engine navigation', () => {
  let assignMock: ReturnType<typeof vi.fn>;
  let origLocation: Location;

  beforeEach(() => {
    vi.clearAllMocks();
    origLocation = window.location;
    assignMock = vi.fn();
    // jsdom/happy-dom forbid spying on location.assign directly — swap the object.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: Object.assign({}, origLocation, { assign: assignMock }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: origLocation });
  });

  it('routes an s- section id (s-messages) through showSection, not the URL', () => {
    navigateToRoute('s-messages');
    expect(showSection).toHaveBeenCalledWith('s-messages');
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('routes an Access Control section id (s-ac-approvals) through showSection', () => {
    navigateToRoute('s-ac-approvals');
    expect(showSection).toHaveBeenCalledWith('s-ac-approvals');
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('routes a real external URL through location.assign, not section nav', () => {
    navigateToRoute('https://example.com/report');
    expect(assignMock).toHaveBeenCalledWith('https://example.com/report');
    expect(showSection).not.toHaveBeenCalled();
  });
});

describe('maybeToastNotification — compliance direct path (coalesce:false)', () => {
  const richAction = vi.mocked(toast.action);
  const richBurst  = vi.mocked(toast.rich);

  const notif = (id: string): CanonicalNotification => ({
    id, type: 'communications.compliance.access_granted', module: null, severity: 'success',
    title: 'Compliance access granted', body: null, source_type: null, source_id: null,
    action_route: 's-ac-approvals', metadata: null, is_read: false, action_required: false,
    action_status: 'none', due_at: null, created_at: '2026-07-19T00:00:00.000Z',
  });

  beforeEach(() => { vi.clearAllMocks(); });

  it('fires the rich action toast immediately, never a coalesced burst', () => {
    maybeToastNotification({ notification: notif('n1'), domain: 'notifications', coalesce: false });
    expect(richAction).toHaveBeenCalledTimes(1);   // direct rich action toast
    expect(richBurst).not.toHaveBeenCalled();       // NOT the "N new" burst toast
  });

  it('multiple compliance notifications each fire directly — no "N new" burst', () => {
    maybeToastNotification({ notification: notif('n1'), domain: 'notifications', coalesce: false });
    maybeToastNotification({ notification: notif('n2'), domain: 'notifications', coalesce: false });
    maybeToastNotification({ notification: notif('n3'), domain: 'notifications', coalesce: false });
    expect(richAction).toHaveBeenCalledTimes(3);
    expect(richBurst).not.toHaveBeenCalled();
  });
});
