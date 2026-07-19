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

import { showSection } from '@components/nav/navCore';
import { navigateToRoute } from './notificationToasts';

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
