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
 * - action_route navigation (navigateToRoute): external urls → location.assign;
 *   every in-app route (section ids AND internal paths) → showSection. Section
 *   ids are never location.assign'd (that would break the SPA).
 * - s-notification-center (NOT s-notifications), s-messages (NOT s-notifications).
 * - Tickets: open the shared header ticket modal (data-pill-action="ticket"), not showSection.
 */

import { toast }                                    from "@ui/toast";
import { showSection }                              from "@components/nav/navCore";
import type { CanonicalNotification }               from "@api/communications";
import type { NotificationPreferencesData }         from "@api/communications";

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
    showSection("s-notification-center");
  }
}

function navigateToDomain(domain: string): void {
  if (domain === "messages") {
    // §0.2: correct id is 's-messages'
    showSection("s-messages");
  } else if (domain === "tickets") {
    // §0.2: tickets open the modal, not showSection
    openTicketPanel();
  } else {
    // §0.2: correct id is 's-notification-center' (NOT 's-notifications')
    showSection("s-notification-center");
  }
}

/** True for a real external URL — a scheme (http:, mailto:, …) or protocol-relative. */
function isExternalUrl(route: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(route) || route.startsWith("//");
}

/**
 * Open a notification's action_route (centralized here — no per-type duplication):
 *  - a real EXTERNAL url (scheme / protocol-relative) → window.location.assign;
 *  - everything else is IN-APP — section ids ('s-…') and any internal path go
 *    through the canonical section navigator `showSection` (which switches the
 *    panel + dispatches 'siomac:section'). We never location.assign an in-app
 *    route, since assigning a section id like 's-messages' as a URL breaks the SPA.
 * The Open button uses onClick → this, NOT a raw href (ToastCard resolves href via
 * location.assign, which is only correct for external urls).
 */
export function navigateToRoute(route: string): void {
  if (isExternalUrl(route)) {
    window.location.assign(route);
    return;
  }
  showSection(route);
}

// ── Severity → ToastVariant map ───────────────────────────────────────────────

function mapSeverityToVariant(severity?: string) {
  if (severity === "success") return "success" as const;
  if (severity === "error" || severity === "critical" || severity === "blocker") return "error" as const;
  if (severity === "warning") return "warning" as const;
  return "info" as const;
}

// ── Main toast function for a single notification ─────────────────────────────

function fireNotificationToast(notification: CanonicalNotification, domain: string): void {
  const variant = mapSeverityToVariant(notification.severity);
  const { action_route } = notification;

  if (notification.source_type === "report" || notification.source_type === "export") {
    toast.rich({
      variant,
      title: notification.title,
      description: notification.body ?? undefined,
      moduleLabel: notification.module ?? "SIOMAC",
      statusLabel: "Report",
      file: {
        name: notification.title,
        type: "file",
        subtitle: notification.body ?? undefined
      },
      actions: action_route
        ? [{ label: "Open", onClick: () => navigateToRoute(action_route), dismissOnClick: true }]
        : undefined
    });
    return;
  }

  if (action_route) {
    toast.action({
      variant,
      title: notification.title,
      description: notification.body ?? undefined,
      moduleLabel: notification.module ?? "SIOMAC",
      statusLabel: notification.source_type ?? "Workflow",
      details: [
        { label: "Module", value: notification.module ?? "SIOMAC" },
        { label: "Source", value: notification.source_type ?? "Notification" }
      ],
      actions: [
        { label: "Dismiss", dismissOnClick: true },
        { label: "Open", onClick: () => navigateToRoute(action_route), dismissOnClick: true }
      ]
    });
    return;
  }

  // Plain notification without route
  void domain; // domain used only for burst toast label below
  toast(notification.title, {
    description: notification.body ?? undefined,
    variant
  });
}

// ── Burst "N new <domain>" toast ──────────────────────────────────────────────

function fireBurstToast(count: number, domain: string): void {
  const label = domain === "messages" ? "messages"
    : domain === "tickets" ? "tickets"
    : "notifications";

  toast.rich({
    title: `${count} new ${label}`,
    variant: "info",
    actions: [{
      label: "View all",
      onClick: () => { navigateToDomain(domain); },
      dismissOnClick: true
    }]
  });
}

// ── Public entry point ────────────────────────────────────────────────────────

export interface MaybeToastArgs {
  notification: CanonicalNotification;
  domain:       string;
  prefs?:       NotificationPreferencesData | null;
  /**
   * When false, bypass burst coalescing and fire the rich action-toast
   * IMMEDIATELY. Compliance/security notifications are individually important and
   * must never be collapsed into an "N new" burst. The caller owns the mount
   * watermark that keeps historical/unread rows out (see complianceToasts.ts).
   * The no-backfill + mute guards still apply. Default true (coalesced).
   */
  coalesce?:    boolean;
}

export function maybeToastNotification({ notification, domain, prefs, coalesce = true }: MaybeToastArgs): void {
  // Direct path — compliance/security notifications fire the rich action-toast
  // IMMEDIATELY. It is deliberately BEFORE the guards below: those compare the
  // browser epoch (Date.now at page-load) with the server-assigned created_at, and
  // that cross-machine comparison can misjudge under clock skew. The compliance
  // caller owns a clock-free, id-based historical watermark instead, and these are
  // security events, so mute/quiet-hours are bypassed too. Never coalesced.
  if (!coalesce) { fireNotificationToast(notification, domain); return; }

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
