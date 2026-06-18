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

import { getHeaderCounts } from './api';
import { setHdrBadge, refreshNavBadges, getUser, getRole } from './navCore';

// All badge element IDs grouped by type
const NOTIF_BADGE_IDS  = ['hdrNotifBadge','empNotifBadge','mgrNotifBadge','admEmpNotifBadge','admDeptNotifBadge','admProjNotifBadge','admAttNotifBadge','admLvNotifBadge','admRatesNotifBadge','admPayNotifBadge','admProfNotifBadge','admStgNotifBadge','admAbtNotifBadge'];
const MSG_BADGE_IDS    = ['hdrMsgBadge','empMsgBadge','mgrMsgBadge','admEmpMsgBadge','admDeptMsgBadge','admProjMsgBadge','admAttMsgBadge','admLvMsgBadge','admRatesMsgBadge','admPayMsgBadge','admProfMsgBadge','admStgMsgBadge','admAbtMsgBadge'];
const TICKET_BADGE_IDS = ['hdrTicketBadge','empTicketBadge','mgrTicketBadge','admEmpTicketBadge','admDeptTicketBadge','admProjTicketBadge','admAttTicketBadge','admLvTicketBadge','admRatesTicketBadge','admPayTicketBadge','admProfTicketBadge','admStgTicketBadge','admAbtTicketBadge'];

let _timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleHdrBadgeSync(): void {
  if (_timer !== null) clearTimeout(_timer);
  _timer = setTimeout(doHdrBadgeSync, 80);
}

export async function doHdrBadgeSync(): Promise<void> {
  const currentUser = getUser();
  const currentRole = getRole();

  let ticketSeenSince: string | null = null;
  try { ticketSeenSince = localStorage.getItem('siomac_ticket_seen_since_' + currentUser); } catch (_) {}

  try {
    const res = await getHeaderCounts({ managerUsername: currentUser, role: currentRole, ticketSeenSince });
    if (!res.success) return;
    const c = res.data ?? {};

    // Notification unread count (cross-referenced with local read/cleared lists)
    let readIds  = new Set<string>();
    let clearedIds = new Set<string>();
    try { readIds    = new Set(JSON.parse(localStorage.getItem('siomac_read_notifs_v1')    ?? '[]') as string[]); } catch (_) {}
    try { clearedIds = new Set(JSON.parse(localStorage.getItem('siomac_cleared_notifs_v1') ?? '[]') as string[]); } catch (_) {}
    const unreadNotifs = (c.notificationIds ?? [])
      .filter(id => !readIds.has(id) && !clearedIds.has(id)).length;

    NOTIF_BADGE_IDS.forEach(id  => setHdrBadge(document.getElementById(id), unreadNotifs));
    MSG_BADGE_IDS.forEach(id    => setHdrBadge(document.getElementById(id), c.messages ?? 0));
    TICKET_BADGE_IDS.forEach(id => setHdrBadge(document.getElementById(id), c.tickets  ?? 0));

    // Reusable <ProfilePill> badges — id-free, matched by data-pill-badge.
    document.querySelectorAll('[data-pill-badge="notif"]').forEach(el  => setHdrBadge(el, unreadNotifs));
    document.querySelectorAll('[data-pill-badge="msg"]').forEach(el    => setHdrBadge(el, c.messages ?? 0));
    document.querySelectorAll('[data-pill-badge="ticket"]').forEach(el => setHdrBadge(el, c.tickets  ?? 0));

    refreshNavBadges(c.pendingLeaves ?? 0);

    // Live map badge
    const liveData = (window as unknown as { AppState?: { get: (k: string) => unknown } }).AppState?.get('liveData') as Array<{ isCheckedOut: boolean; siteId: string }> | undefined;
    const activeSites = c.activeSites != null
      ? c.activeSites
      : (liveData
        ? new Set(liveData.filter(r => !r.isCheckedOut && r.siteId).map(r => String(r.siteId))).size
        : 0);
    (window as unknown as { _setLiveMapBadge?: (n: number) => void })._setLiveMapBadge?.(activeSites);
  } catch (_) {}
}
