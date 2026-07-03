/**
 * src/components/realtime/notificationToasts.ts
 *
 * Maps realtime communication signals to toast notifications.
 * Lives OUTSIDE @ui/toast — the toaster is notification-agnostic.
 *
 * Rules (per spec §7 and §0 corrections):
 * - No actor_id guard — self-exclusion is the backend's job.
 * - No-backfill: ignore signals older than the page-load epoch (resetToastSessionClock on mount).
 * - Respect NotificationPreferences mute / quiet-hours.
 * - Coalesce bursts: 2s window → one "N new <domain>" rich toast.
 * - action_route guard: only showSection when route starts with 's-'.
 * - s-notification-center (NOT s-notifications), s-messages (NOT s-notifications).
 * - Tickets: open the shared header ticket modal (data-pill-action="ticket"), not showSection.
 */

import { toast }                                    from '@ui/toast';
import type { CanonicalNotification }               from '@api/communications';
import type { NotificationPreferencesData }         from '@api/communications';

// ── Re-export the canonical notification type for consumers ───────────────────
export type { CanonicalNotification };

// ── Session epoch — set once at page load; used for no-backfill guard ─────────

let _sessionEpoch: number | null = null;

/** Call once when CommsBridge mounts (after login). */
export function resetToastSessionClock(): void {
  _sessionEpoch = Date.now();
}

// ── Quiet-hours / mute guard ──────────────────────────────────────────────────

export function isMutedByPreferences(
  prefs: NotificationPreferencesData | undefined | null,
): boolean {
  if (!prefs) return false;
  const { snooze } = prefs;
  if (!snooze) return false;
  // null mutedUntil = muted indefinitely
  if (snooze.mutedUntil === null) return true;
  return new Date(snooze.mutedUntil).getTime() > Date.now();
}

// ── Burst coalescing ──────────────────────────────────────────────────────────

interface BurstEntry {
  timer:            ReturnType<typeof setTimeout>;
  count:            number;
  domain:           string;
  lastNotification: CanonicalNotification | null;
}

const _bursts = new Map<string, BurstEntry>();
const BURST_WINDOW_MS = 2000;

// ── Navigation (§0.2 + §0.3 guarded) ─────────────────────────────────────────

function openTicketPanel(): void {
  // Trigger the shared header ticket modal via the delegated pill handler
  const btn = document.querySelector<HTMLElement>('[data-pill-action="ticket"]');
  if (btn) {
    btn.click();
  } else {
    // Fallback: navigate to notification center
    window.Nav?.showSection?.('s-notification-center');
  }
}

function navigateToRoute(route?: string | null): void {
  // §0.3 guard: only call showSection for section ids (start with 's-')
  if (route && route.startsWith('s-')) {
    window.Nav?.showSection?.(route);
  } else {
    // §0.2: correct id is 's-notification-center' (NOT 's-notifications')
    window.Nav?.showSection?.('s-notification-center');
  }
}

function navigateToDomain(domain: string): void {
  if (domain === 'messages') {
    // §0.2: correct id is 's-messages'
    window.Nav?.showSection?.('s-messages');
  } else if (domain === 'tickets') {
    // §0.2: tickets open the modal, not showSection
    openTicketPanel();
  } else {
    // §0.2: correct id is 's-notification-center' (NOT 's-notifications')
    window.Nav?.showSection?.('s-notification-center');
  }
}

// ── Severity → ToastVariant map ───────────────────────────────────────────────

type ToastVariant = 'info' | 'warning' | 'error' | 'critical' | 'success' | 'neutral';

function severityToVariant(severity: string): ToastVariant {
  switch (severity) {
    case 'critical': return 'critical';
    case 'warning':  return 'warning';
    case 'error':    return 'error';
    default:         return 'info';
  }
}

// ── Main toast function for a single notification ─────────────────────────────

function fireNotificationToast(notification: CanonicalNotification, domain: string): void {
  const variant = severityToVariant(notification.severity);
  const { action_route } = notification;

  toast.rich({
    title:   notification.title,
    body:    notification.body ?? undefined,
    variant,
    meta:    [notification.module, notification.source_type].filter((x): x is string => Boolean(x)),
    actions: [{
      label:   'View',
      tone:    'primary',
      onClick: () => {
        navigateToRoute(action_route);
        return true;
      },
    }],
    onClick:  () => navigateToRoute(action_route),
    duration: 0,  // rich toasts are sticky
  });
}

// ── Burst "N new <domain>" toast ──────────────────────────────────────────────

function fireBurstToast(count: number, domain: string): void {
  const label = domain === 'messages' ? 'messages'
    : domain === 'tickets' ? 'tickets'
    : 'notifications';

  toast.rich({
    title:   `${count} new ${label}`,
    variant: 'info',
    actions: [{
      label:   'View all',
      tone:    'primary',
      onClick: () => {
        navigateToDomain(domain);
        return true;
      },
    }],
    onClick:  () => navigateToDomain(domain),
    duration: 0,
  });
}

// ── Public entry point ────────────────────────────────────────────────────────

export interface MaybeToastArgs {
  notification: CanonicalNotification;
  domain:       string;
  prefs?:       NotificationPreferencesData | null;
}

export function maybeToastNotification({ notification, domain, prefs }: MaybeToastArgs): void {
  // 1. No-backfill guard: ignore signals that arrived before page-load epoch
  if (_sessionEpoch !== null) {
    const createdMs = new Date(notification.created_at).getTime();
    if (createdMs < _sessionEpoch) return;
  }

  // 2. Mute / quiet-hours guard
  if (isMutedByPreferences(prefs)) return;

  // 3. Burst coalescing
  const existing = _bursts.get(domain);
  if (existing) {
    // Extend the burst window
    clearTimeout(existing.timer);
    existing.count++;
    existing.lastNotification = notification;
    existing.timer = setTimeout(() => {
      _bursts.delete(domain);
      if (existing.count === 1 && existing.lastNotification) {
        fireNotificationToast(existing.lastNotification, domain);
      } else {
        fireBurstToast(existing.count, domain);
      }
    }, BURST_WINDOW_MS);
  } else {
    // Start a new burst window
    const entry: BurstEntry = {
      count:            1,
      domain,
      lastNotification: notification,
      timer:            setTimeout(() => {
        _bursts.delete(domain);
        if (entry.count === 1 && entry.lastNotification) {
          fireNotificationToast(entry.lastNotification, domain);
        } else {
          fireBurstToast(entry.count, domain);
        }
      }, BURST_WINDOW_MS),
    };
    _bursts.set(domain, entry);
  }
}
