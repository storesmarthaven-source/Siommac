/**
 * scripts/e2e/suites/communicationsBadges.mjs
 *
 * E2E suite for the badge-sync system:
 *   communications/summary  — the single source of truth for all header badge counts.
 *
 * Validates:
 *   • Response shape matches the CommsSummary contract the frontend consumes.
 *   • All primary badge-count fields (notificationsUnread, messagesUnread, ticketsUnread)
 *     are non-negative integers — never undefined, null, or NaN.
 *   • Secondary counts (workflowTasks, handoffFailures, notificationsTotal, etc.) present.
 *   • Unauthenticated request is rejected with 401.
 *   • Fail-closed contract: summary never returns { success: true } with missing counts.
 */

export const title = 'Communications Badge Sync (summary endpoint)';

export default async function run(h) {
  const { api, test, expect, fails, mint } = h;
  const { admin, b } = h.users;
  const T = { admin: mint(admin), b: mint(b) };

  // No rows are created — this suite reads only.
  h.onCleanup(async () => { /* nothing to clean up */ });

  // ── A. Shape contract ───────────────────────────────────────────────────────

  await test('summary returns success:true with all badge-count fields', async () => {
    const r = await api('communications/summary', {}, T.admin);
    expect(r.success).toBe(true);

    const d = r.data;
    // Primary badge counts — the three fields badgeSync.ts writes to the DOM.
    expect(typeof d.notificationsUnread).toBe('number');
    expect(typeof d.messagesUnread).toBe('number');
    expect(typeof d.ticketsUnread).toBe('number');

    // Secondary counts.
    expect(typeof d.notificationsTotal).toBe('number');
    expect(typeof d.notificationsActionRequired).toBe('number');
    expect(typeof d.notificationsCritical).toBe('number');
    expect(typeof d.notificationsArchived).toBe('number');
    expect(typeof d.ticketsOpen).toBe('number');
    expect(typeof d.workflowTasks).toBe('number');
    expect(typeof d.handoffFailures).toBe('number');

    // Realtime channel fields — may be null when the server is not configured.
    expect('realtimeChannelKey' in d).toBe(true);
    expect('realtimeToken' in d).toBe(true);
    expect('realtimeTokenExpiresAt' in d).toBe(true);
  });

  await test('all primary badge counts are non-negative integers', async () => {
    const r = await api('communications/summary', {}, T.admin);
    expect(r.success).toBe(true);
    const d = r.data;

    expect(Number.isInteger(d.notificationsUnread) && d.notificationsUnread >= 0).toBe(true);
    expect(Number.isInteger(d.messagesUnread) && d.messagesUnread >= 0).toBe(true);
    expect(Number.isInteger(d.ticketsUnread) && d.ticketsUnread >= 0).toBe(true);
  });

  await test('secondary badge counts are non-negative integers', async () => {
    const r = await api('communications/summary', {}, T.admin);
    expect(r.success).toBe(true);
    const d = r.data;

    expect(Number.isInteger(d.notificationsTotal) && d.notificationsTotal >= 0).toBe(true);
    expect(Number.isInteger(d.ticketsOpen) && d.ticketsOpen >= 0).toBe(true);
    expect(Number.isInteger(d.workflowTasks) && d.workflowTasks >= 0).toBe(true);
    expect(Number.isInteger(d.handoffFailures) && d.handoffFailures >= 0).toBe(true);
  });

  await test('summary works for a non-admin user and returns their own counts', async () => {
    const r = await api('communications/summary', {}, T.b);
    expect(r.success).toBe(true);
    // The counts are scoped to user b — we cannot assert specific values, but
    // the shape contract must hold.
    expect(typeof r.data.messagesUnread).toBe('number');
    expect(typeof r.data.notificationsUnread).toBe('number');
  });

  // ── B. Access control ───────────────────────────────────────────────────────

  await test('unauthenticated request returns 401', async () => {
    // Pass an empty / absent token so the request has no valid JWT.
    await fails(
      api('communications/summary', {}, null),
      401,
    );
  });
}
