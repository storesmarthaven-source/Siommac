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
import { setHdrBadge, refreshNavBadges, setNavSectionBadge } from './navCore';
import { getApprovalCountsApi }           from '@lib/superadminApi';
import type { CommsSummary }              from '@api/communications';

const APPROVALS_SECTION_ID = 's-ac-approvals';

/** Snapshot of the most recently known-good badge counts from communications/summary. */
type BadgeCounts = Pick<CommsSummary, 'notificationsUnread' | 'messagesUnread' | 'ticketsUnread'>;
let _lastGoodCounts: BadgeCounts | null = null;
/** Throttle repeated failure log lines: at most one warning per 30 s. */
let _lastFailureLogAt = 0;

/** For tests: reset module-level state. */
export function __resetBadgeSyncState(): void {
  _lastGoodCounts = null;
  _lastFailureLogAt = 0;
}

/** For tests: read the last successfully fetched badge counts. */
export function getLastGoodBadgeCounts(): BadgeCounts | null { return _lastGoodCounts; }

let _timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Refresh the Approvals nav badge with the count of NEW-since-last-opened
 * actionable grant requests (`unseenActionableCount`) — NOT the full pending
 * backlog. Opening Access Control > Approvals stamps the server watermark, which
 * clears the unseen count (badge → 0) while the backlog is unchanged.
 *
 * Scope + self-exclusion are done server-side (compliance approvers → compliance
 * grants only; full permission managers → the whole queue; a reviewer's own
 * requests never count). Gated on the nav item's presence: only approvers ever
 * have `s-ac-approvals`, so a non-approver session never issues the request.
 */
export async function syncApprovalNavBadge(): Promise<void> {
  const hasNav = document.querySelector(
    `#sidebarMenu button[data-section="${APPROVALS_SECTION_ID}"], ` +
    `#topTabs button[data-section="${APPROVALS_SECTION_ID}"]`,
  );
  if (!hasNav) return;
  try {
    const res = await getApprovalCountsApi();
    if (!res.success) return;
    setNavSectionBadge(APPROVALS_SECTION_ID, res.unseenActionableCount ?? 0);
  } catch (_) { /* empty — badge sync is best-effort, retried on next signal */ }
}

export function scheduleHdrBadgeSync(): void {
  if (_timer !== null) clearTimeout(_timer);
  _timer = setTimeout(() => { void doHdrBadgeSync(); }, 80);
}

export async function doHdrBadgeSync(): Promise<void> {
  // The header/leave badges and the Approvals badge come from INDEPENDENT endpoints.
  // Run them concurrently and settle both — a failing communications/summary must
  // not stop the Approvals badge (or vice-versa) from refreshing.
  await Promise.allSettled([syncHeaderBadges(), syncApprovalNavBadge()]);
}

export async function syncHeaderBadges(): Promise<void> {
  const res = await apiPost<{ success: boolean; data: CommsSummary }>(
    'communications/summary', { args: {} },
  );
  if (!res.success) {
    // Preserve last known counts — do NOT zero the badges on a transient failure.
    // The DOM stays unchanged; badgeSync will retry on the next scheduled call.
    const now = Date.now();
    if (now - _lastFailureLogAt > 30_000) {
      _lastFailureLogAt = now;
      console.warn('[badgeSync] communications/summary failed; retaining last known badge counts');
    }
    return;
  }
  const c = res.data;
  _lastGoodCounts = {
    notificationsUnread: c.notificationsUnread,
    messagesUnread:      c.messagesUnread,
    ticketsUnread:       c.ticketsUnread,
  };

  // Profile-pill badges — id-free, matched by data-pill-badge on every pill.
  document.querySelectorAll('[data-pill-badge="notif"]').forEach(el =>
    setHdrBadge(el, c.notificationsUnread),
  );
  document.querySelectorAll('[data-pill-badge="msg"]').forEach(el =>
    setHdrBadge(el, c.messagesUnread),
  );
  document.querySelectorAll('[data-pill-badge="ticket"]').forEach(el =>
    setHdrBadge(el, c.ticketsUnread),
  );

  // Leave badge is not part of the comms summary — keep existing nav refresh
  // with 0 as a pass-through until leave counts are added to summary.
  refreshNavBadges(0);
}
