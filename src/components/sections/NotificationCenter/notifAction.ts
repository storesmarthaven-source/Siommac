/**
 * src/components/sections/NotificationCenter/notifAction.ts
 *
 * Resolves a notification's `action_route` to a real section and navigates to it,
 * then broadcasts a `siomac:openRecord` event so the target module can deep-link
 * to the specific record (source_type + source_id). Shared by the bell dropdown
 * and the Notification Center so "click a notification → go to the thing" works
 * the same everywhere.
 *
 * action_route is a logical path emitted by the backend, e.g. "hse/incidents",
 * "hse/permits", "hse/risk-jsa". The default mapping is  s-<route with / → ->;
 * a small override table covers the cases where the section id differs.
 */

import { showSection } from '@components/nav/navCore';
import type { CanonicalNotification } from '@api/communications';

const ROUTE_OVERRIDES: Record<string, string> = {
  'hse/risk-jsa': 's-hse-risk',
  'hse/ptw':      's-hse-permits',
};

/** Map an action_route to a section id that actually exists in the DOM, or null.
 *  action_route comes in two shapes:
 *    • a bare section id already   — e.g. "s-messages"  (use as-is)
 *    • a logical path              — e.g. "hse/incidents" → "s-hse-incidents" */
export function notificationSectionId(route: string | null | undefined): string | null {
  if (!route) return null;
  const key = route.replace(/^\/+/, '');
  const id  = key.startsWith('s-')
    ? key
    : (ROUTE_OVERRIDES[key] ?? `s-${key.replace(/\//g, '-')}`);
  return (typeof document !== 'undefined' && document.getElementById(id)) ? id : null;
}

/**
 * Navigate to the notification's target. Returns true if it navigated.
 * Emits `siomac:openRecord` with the record identity so the destination section
 * can open the exact record (drawer/detail) when it supports it.
 */
export function openNotificationTarget(n: CanonicalNotification): boolean {
  const sectionId = notificationSectionId(n.action_route);
  if (!sectionId) return false;
  showSection(sectionId);
  window.dispatchEvent(new CustomEvent('siomac:openRecord', {
    detail: {
      sectionId,
      module:     n.module,
      sourceType: n.source_type,
      sourceId:   n.source_id,
      route:      n.action_route,
    },
  }));
  return true;
}

/** Open a canonical ticket notification in the full Ticket Center. */
export function openTicketNotification(n: CanonicalNotification): boolean {
  if (n.source_type !== 'ticket') return false;
  showSection('s-tickets');
  window.dispatchEvent(new CustomEvent('siomac:openTicket', {
    detail: { ticketNumber: n.source_id },
  }));
  return true;
}
