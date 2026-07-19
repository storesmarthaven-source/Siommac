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

async function syncHeaderBadges(): Promise<void> {
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
}
