/**
 * src/components/nav/badgeSync.ts
 *
 * Header badge sync — polls getHeaderCounts and distributes counts to all
 * pill-badge elements across every role's section.
 * Ported from Nav._doHdrBadgeSync / Nav._scheduleHdrBadgeSync in nav.js.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { apiPost }                        from '@lib/api';
import { setHdrBadge, refreshNavBadges }  from './navCore';
import type { CommsSummary }              from '@api/communications';

let _timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleHdrBadgeSync(): void {
  if (_timer !== null) clearTimeout(_timer);
  _timer = setTimeout(doHdrBadgeSync, 80);
}

export async function doHdrBadgeSync(): Promise<void> {
  try {
    const res = await apiPost<{ success: boolean; data: CommsSummary }>(
      'communications/summary', { args: {} },
    );
    if (!res.success) return;
    const c = res.data;

    // Profile-pill badges — id-free, matched by data-pill-badge on every pill.
    document.querySelectorAll('[data-pill-badge="notif"]').forEach(el =>
      setHdrBadge(el, c.notificationsUnread),
    );
    document.querySelectorAll('[data-pill-badge="msg"]').forEach(el =>
      setHdrBadge(el, c.messagesUnread),
    );
    document.querySelectorAll('[data-pill-badge="ticket"]').forEach(el =>
      setHdrBadge(el, c.ticketsOpen),
    );

    // Leave badge is not part of the comms summary — keep existing nav refresh
    // with 0 as a pass-through until leave counts are added to summary.
    refreshNavBadges(0);
  } catch (_) {}
}
