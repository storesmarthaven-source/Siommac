/**
 * src/components/realtime/complianceToasts.ts
 *
 * Compliance access/request notifications drive a rich, individually-important
 * security toast. Two rules the generic notification path does not give us:
 *
 *   1. MOUNT WATERMARK — every notification that already exists when a session
 *      starts is "historical" and must NEVER surface as a realtime toast (even if
 *      unread). We seed those ids once at mount; only genuinely-new rows toast.
 *      The watermark is keyed on the user id so a re-login (different user) re-seeds
 *      rather than replaying the previous session's rows.
 *   2. NO BURST COALESCING — each compliance notification fires the global rich
 *      action-toast directly (coalesce:false); they are never collapsed into an
 *      "N new" burst.
 *
 * The seen-set below IS the watermark: it holds every id present at mount plus
 * every id already surfaced this session, so a fetch that returns a mix of old
 * rows + one new row toasts only the new one.
 */

import { maybeToastNotification } from './notificationToasts';
import type { CanonicalNotification } from '@api/communications';

/** The minimal notification shape the compliance-toast path consumes. */
export interface ComplianceNotifRow {
  id:         string;
  type:       string;
  title:      string;
  body:       string | null;
  is_read:    boolean;
  link:       string | null;
  created_at: string | null;
}

/** Compliance access notification types that warrant a live rich toast. */
export const COMPLIANCE_TOAST_TYPES = new Set<string>([
  'iam.permission.compliance_grant_requested',
  'communications.compliance.access_granted',
  'communications.compliance.access_revoked',
]);

// Ids present at mount (the watermark) OR already surfaced this session — never
// re-toast these. Keyed on the seeded user so a re-login clears + re-seeds.
const _seen = new Set<string>();
let _seededForUser: string | null = null;

/** True when the watermark has not yet been seeded for this user (login/re-login). */
export function needsWatermarkSeed(userId: string): boolean {
  return _seededForUser !== userId;
}

/**
 * Seed the mount watermark from the rows present when the session initializes: every
 * fetched notification id is marked historical (already-seen). The boundary is the
 * SERVER's own result set (an id cursor), NOT a browser timestamp — we never compare
 * `Date.now()` with a server `created_at`, so clock skew can't misclassify a new
 * notification as historical.
 *
 * The caller drives ordering (subscribe → queue signals → seed here → drain queue),
 * so anything that arrives after this seed surfaces via the drained/subsequent
 * signals rather than being (mis)judged by time. Re-seeding for a different user
 * clears the previous session's watermark first.
 */
export function seedComplianceToastWatermark(
  userId: string,
  rows: readonly ComplianceNotifRow[],
): void {
  if (_seededForUser !== userId) _seen.clear();
  for (const r of rows) _seen.add(r.id);
  _seededForUser = userId;
}

const severityFor = (type: string): string =>
  type === 'communications.compliance.access_granted' ? 'success'
    : type === 'communications.compliance.access_revoked' ? 'warning'
      : 'info';

/**
 * Surface any NEW compliance notifications as direct rich toasts (no burst).
 * Rows already in the watermark/seen-set are skipped, so a fetch that returns a
 * mix of historical rows + one new row toasts only the new one. Non-compliance
 * types are ignored here (the generic path handles them).
 */
export function surfaceComplianceToasts(rows: readonly ComplianceNotifRow[]): void {
  for (const n of rows) {
    if (!COMPLIANCE_TOAST_TYPES.has(n.type) || _seen.has(n.id)) continue;
    _seen.add(n.id);
    const notification: CanonicalNotification = {
      id:              n.id,
      type:            n.type,
      title:           n.title,
      body:            n.body ?? null,
      created_at:      n.created_at ?? new Date().toISOString(),
      is_read:         n.is_read,
      action_route:    n.link ?? null,          // the read carries the route in `link`
      severity:        severityFor(n.type),
      module:          null,
      source_type:     null,
      source_id:       null,
      metadata:        null,
      action_required: false,
      action_status:   'none',
      due_at:          null,
    };
    // coalesce:false → compliance security events fire directly, never a burst.
    maybeToastNotification({ notification, domain: 'notifications', coalesce: false });
  }
}

/** Test-only: clear the watermark + seen-set + seeded user. */
export function __resetComplianceToastState(): void {
  _seen.clear();
  _seededForUser = null;
}
