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

import { toast }                                    from "@ui/toast";
import type { CanonicalNotification }               from "@api/communications";
import type { NotificationPreferencesData }         from "@api/communications";
import { openNotificationTarget }                   from "@sections/NotificationCenter/notifAction";
import { showSection }                              from "@components/nav/navCore";

// ── Re-export the canonical notification type for consumers ───────────────────
export type { CanonicalNotification };

// ── COMPLIANCE_TOAST_TYPES — canonical definition (moved here from
// complianceToasts.ts to avoid a circular dependency: complianceToasts.ts
// imports from notificationToasts.ts, so the reverse must not exist).
// complianceToasts.ts re-imports this set from here.
export const COMPLIANCE_TOAST_TYPES = new Set<string>([
  'iam.permission.compliance_grant_requested',
  'communications.compliance.access_granted',
  'communications.compliance.access_revoked',
]);

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

function openTicketPanel(ticketNumber?: string | null): void {
  showSection("s-tickets");
  if (ticketNumber) {
    window.dispatchEvent(new CustomEvent("siomac:openTicket", { detail: { ticketNumber } }));
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

function openNotification(notification: CanonicalNotification, domain: string): void {
  if (notification.source_type === "ticket") {
    openTicketPanel(notification.source_id);
    return;
  }
  if (openNotificationTarget(notification)) return;
  const route = notification.action_route;
  if (route && /^https?:\/\//i.test(route)) window.location.assign(route);
  else navigateToDomain(domain);
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
        ? [{
            label: "Open",
            onClick: () => openNotification(notification, domain),
            dismissOnClick: true,
          }]
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
        {
          label: "Open",
          onClick: () => openNotification(notification, domain),
          dismissOnClick: true,
        }
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

// ── Generic notification surface ──────────────────────────────────────────────
//
// surfaceGenericNotificationToasts() is driven by the same realtime-signal path
// that surfaceComplianceToasts() uses, but handles all NON-compliance types.
// Compliance types are explicitly skipped here — complianceToasts.ts handles them
// with a special id-based watermark + coalesce:false policy.

/** Minimal notification row shape shared by NotificationRow (getMyNotifications)
 *  and CanonicalNotification (useNotifications).  The `link` field maps to
 *  `action_route` in the canonical form. */
export interface NotifToastRow {
  id:         string;
  type:       string;
  title:      string;
  body:       string | null;
  is_read:    boolean;
  link:       string | null;
  created_at: string | null;
}

/** Ids of notifications already surfaced as generic toasts this session —
 *  prevents a double-toast when both a realtime signal AND a query invalidation
 *  both cause a fetch that returns the same row. */
const _seenGenericIds = new Set<string>();

/**
 * Surface new GENERIC (non-compliance) notifications as coalesced toasts.
 * Compliance types are explicitly skipped — their dedicated path in
 * complianceToasts.ts applies a stricter id-watermark and forces coalesce:false.
 *
 * Rows already surfaced this session (tracked by id) are silently skipped so
 * a signal + query-invalidation arriving close together don't double-toast.
 * The maybeToastNotification no-backfill guard still filters historical rows.
 */
export function surfaceGenericNotificationToasts(rows: readonly NotifToastRow[]): void {
  for (const n of rows) {
    // Compliance notifications are handled exclusively by surfaceComplianceToasts.
    if (COMPLIANCE_TOAST_TYPES.has(n.type)) continue;
    // Already surfaced this session — skip without re-toasting.
    if (_seenGenericIds.has(n.id)) continue;
    _seenGenericIds.add(n.id);

    const notification: CanonicalNotification = {
      id:              n.id,
      type:            n.type,
      title:           n.title,
      body:            n.body ?? null,
      created_at:      n.created_at ?? new Date().toISOString(),
      is_read:         n.is_read,
      action_route:    n.link ?? null,
      severity:        'info',
      module:          null,
      source_type:     null,
      source_id:       null,
      metadata:        null,
      action_required: false,
      action_status:   'none',
      due_at:          null,
    };
    // Standard coalesced path — burst window and no-backfill guard apply.
    maybeToastNotification({ notification, domain: 'notifications', coalesce: true });
  }
}

/** Test-only: clear the generic seen-set. */
export function __resetGenericToastState(): void {
  _seenGenericIds.clear();
}

// ── ─────────────────────────────────────────────────────────────────────────────

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
