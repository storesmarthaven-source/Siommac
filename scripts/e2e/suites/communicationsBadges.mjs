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
 *
 * NB: uses the SHARED custom harness API — api(path, token, args), expect(cond, msg),
 * ok(awaitedResponse)/fails(awaitedResponse), and reads r.body.{success,data}. (The
 * prior version used jest-style expect().toBe()/fails(promise) and the wrong api()
 * arg order, which is why all five cases failed.)
 */

export const title = 'Communications Badge Sync (summary endpoint)';

const PRIMARY = ['notificationsUnread', 'messagesUnread', 'ticketsUnread'];
const SECONDARY = [
  'notificationsTotal', 'notificationsActionRequired', 'notificationsCritical',
  'notificationsArchived', 'ticketsOpen', 'workflowTasks', 'handoffFailures',
];

export default async function run(h) {
  const { api, test, expect, ok, fails, mint } = h;
  const { admin, b } = h.users;
  const T = { admin: mint(admin), b: mint(b) };

  // No rows are created — this suite reads only.
  h.onCleanup(async () => { /* nothing to clean up */ });

  // ── A. Shape contract ───────────────────────────────────────────────────────

  await test('summary returns success:true with all badge-count fields', async () => {
    const r = await api('communications/summary', T.admin);
    ok(r, `summary failed: ${r.body.message}`);
    const d = r.body.data;
    for (const k of [...PRIMARY, ...SECONDARY]) {
      expect(typeof d[k] === 'number', `${k} must be a number, got ${typeof d[k]} (${JSON.stringify(d[k])})`);
    }
    // Realtime channel fields — present in the shape (may be null when unconfigured).
    for (const k of ['realtimeChannelKey', 'realtimeToken', 'realtimeTokenExpiresAt']) {
      expect(k in d, `missing "${k}" in summary`);
    }
  });

  await test('all primary badge counts are non-negative integers', async () => {
    const r = await api('communications/summary', T.admin);
    ok(r, `summary failed: ${r.body.message}`);
    const d = r.body.data;
    for (const k of PRIMARY) {
      expect(Number.isInteger(d[k]) && d[k] >= 0, `${k} must be a non-negative integer, got ${JSON.stringify(d[k])}`);
    }
  });

  await test('secondary badge counts are non-negative integers', async () => {
    const r = await api('communications/summary', T.admin);
    ok(r, `summary failed: ${r.body.message}`);
    const d = r.body.data;
    for (const k of ['notificationsTotal', 'ticketsOpen', 'workflowTasks', 'handoffFailures']) {
      expect(Number.isInteger(d[k]) && d[k] >= 0, `${k} must be a non-negative integer, got ${JSON.stringify(d[k])}`);
    }
  });

  await test('summary works for a non-admin user and returns their own counts', async () => {
    const r = await api('communications/summary', T.b);
    ok(r, `summary (user b) failed: ${r.body.message}`);
    // Counts are scoped to user b — assert only the shape, not specific values.
    expect(typeof r.body.data.messagesUnread === 'number', 'messagesUnread must be a number');
    expect(typeof r.body.data.notificationsUnread === 'number', 'notificationsUnread must be a number');
  });

  // ── B. Access control ───────────────────────────────────────────────────────

  await test('unauthenticated request returns 401', async () => {
    const r = await api('communications/summary', null);
    fails(r, 'unauthenticated summary should be rejected');
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });
}
