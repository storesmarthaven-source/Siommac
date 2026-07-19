// permissionPropagation.mjs — live verification of capability-grant propagation.
//
// Verifies the backend half of the Compliance-shield propagation model over HTTP +
// service-role assertions (the browser realtime re-render is out of scope here):
//   1. migration 437 — communication_signals accepts domain='permissions';
//   2. no grant  -> getMyPermissionOverrides has no compliance_read (shield hidden);
//   3. maker-checker approve -> a 'permissions' signal is emitted to the target AND
//      the snapshot returns compliance_read WITH its valid_from/valid_until window;
//   4. revoke -> another 'permissions' signal AND the snapshot no longer grants it.
//
// All actors are synthetic + tagged; every row created here is cleaned up.

import { randomUUID } from 'node:crypto';

export const title = 'Permission Propagation (compliance grant -> permissions signal + snapshot)';

async function pollSignal(sb, channelKey, domain, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const { data } = await sb.from('communication_signals')
      .select('id').eq('channel_key', channelKey).eq('domain', domain).limit(1);
    if (data && data.length) return true;
    await new Promise(r => setTimeout(r, 200));
  } while (Date.now() < deadline);
  return false;
}

async function countNotifications(sb, userId, type) {
  const { data } = await sb.from('notifications').select('id').eq('user_id', userId).eq('type', type);
  return data?.length ?? 0;
}

async function pollNotification(sb, userId, type, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if ((await countNotifications(sb, userId, type)) > 0) return true;
    await new Promise(r => setTimeout(r, 200));
  } while (Date.now() < deadline);
  return false;
}

export default async function run(h) {
  const { api, test, expect, ok, fails, sb, mint, mintStepUp, TAG } = h;
  const KEY = 'communications.compliance_read';
  const REQUESTED = 'iam.permission.compliance_grant_requested';

  // Two distinct superadmins (maker != checker for SoD) + clean targets (target2
  // is used only by the acknowledgement-race test below).
  const { actors: [maker, checker], createdIds: adminIds } =
    await h.acquireActors('superadmin', 2, {}, {}, { forceSynthetic: true });
  const { actors: [target, target2, target3], createdIds: targetIds } =
    await h.acquireActors('employee', 3, {}, {}, { forceSynthetic: true });

  // Valid compliance grant window (start within now-5m..now+30d; span <=90d). A
  // future start is fine — the race requests only need to be created as pending.
  const raceValidFrom  = new Date(Date.now() + 60_000).toISOString();
  const raceValidUntil = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();

  // Superadmins auto-hold permissions.manage (allow-all, non-compliance), but seed
  // the rows to satisfy the maker-checker helper's documented precondition.
  await h.seedCriticalPermViaServiceRole(maker.id, 'permissions.manage');
  await h.seedCriticalPermViaServiceRole(checker.id, 'permissions.manage');

  // Seed a realtime channel for the target so emitSignal has somewhere to write.
  const channelKey = randomUUID();
  await sb.from('user_realtime_channels').upsert(
    { user_id: target.id, channel_key: channelKey,
      expires_at: new Date(Date.now() + 3_600_000).toISOString() },
    { onConflict: 'user_id' },
  );

  // Approval ids — captured in the tests, swept at cleanup (the request notifies
  // every eligible approver, including real superadmins, so delete by source_id).
  let approvalId = null;
  const raceApprovalIds = [];

  h.onCleanup(async () => {
    await h.mustDelete('communication_signals', q => q.eq('channel_key', channelKey));
    await h.mustDelete('user_realtime_channels', q => q.eq('user_id', target.id));
    await h.mustDelete('notifications', q => q.eq('user_id', target.id));
    if (approvalId) await h.mustDelete('notifications', q => q.eq('source_id', approvalId));
    for (const id of raceApprovalIds) {
      await h.mustDelete('notifications', q => q.eq('source_id', id));
      await h.mustDelete('permission_grant_approvals', q => q.eq('id', id));
    }
    await h.mustDelete('user_permissions', q => q.in('user_id', [target.id, maker.id, checker.id]));
    // approval_seen_receipts rows (written by markSeen) are removed by the app_users
    // delete below via ON DELETE CASCADE on user_id, and by the approval deletes above
    // via ON DELETE CASCADE on approval_id.
    await h.mustDelete('app_users', q => q.in('id', [...adminIds, ...targetIds]));
  });

  const GRANTED = 'communications.compliance.access_granted';
  const REVOKED = 'communications.compliance.access_revoked';

  const targetToken = mint(target);

  h.section('Permission Propagation > baseline');

  await test('migration 437: communication_signals accepts domain=permissions', async () => {
    const { error } = await sb.from('communication_signals')
      .insert({ channel_key: channelKey, domain: 'permissions' });
    expect(!error, `insert domain=permissions rejected (migration 437 not applied?): ${error?.message}`);
  });

  await test('target holds NO compliance_read before grant (shield hidden)', async () => {
    const r = await api('getMyPermissionOverrides', targetToken, {});
    ok(r, 'getMyPermissionOverrides');
    const has = (r.body.data ?? []).some(o => o.permission === KEY);
    expect(!has, `target already holds ${KEY} before any grant`);
  });

  h.section('Permission Propagation > compliance approver availability (maker-checker preflight)');

  await test('availability endpoint reports an independent approver is available', async () => {
    // The DB has real superadmins (+ the synthetic maker), all independent of the
    // checker/target here → an eligible approver exists.
    const r = await api('superadmin/complianceApproverAvailability', mint(checker), { userId: target.id });
    ok(r, 'complianceApproverAvailability');
    expect(r.body.eligible === true, `expected eligible=true, got ${JSON.stringify(r.body)}`);
    expect(typeof r.body.approverCount === 'number' && r.body.approverCount > 0,
      `approverCount not positive: ${r.body.approverCount}`);
  });

  await test('availability endpoint denies a non-permission-manager (negative path)', async () => {
    const r = await api('superadmin/complianceApproverAvailability', targetToken, { userId: target.id });
    fails(r, 'employee must not access complianceApproverAvailability');
  });

  h.section('Permission Propagation > approvals seen-receipts (counts + markSeen + race)');

  await test('counts returns numeric pending + unseen (unseen <= pending)', async () => {
    const r = await api('admin/approvals/counts', mint(checker), {});
    ok(r, 'approvals/counts');
    expect(typeof r.body.pendingActionableCount === 'number', 'pendingActionableCount missing/not a number');
    expect(typeof r.body.unseenActionableCount === 'number', 'unseenActionableCount missing/not a number');
    expect(r.body.unseenActionableCount <= r.body.pendingActionableCount,
      `unseen (${r.body.unseenActionableCount}) must be <= pending (${r.body.pendingActionableCount})`);
  });

  await test('acknowledging rendered ids writes receipts and clears unseen; a LATER request stays unseen', async () => {
    // 1. A first actionable request is committed and appears in the checker's queue.
    const first = await api('superadmin/setUserPermission', mint(maker), {
      userId: target2.id, permission: KEY, granted: true,
      reason: `${TAG} race first`, validFrom: raceValidFrom, validUntil: raceValidUntil,
    });
    ok(first, 'first compliance request (maker)');
    expect(first.body.pending === true, `expected a pending request, got ${JSON.stringify(first.body)}`);
    const firstApprovalId = first.body.approvalId;
    raceApprovalIds.push(firstApprovalId);

    const list = await api('admin/approvals/list', mint(checker), { status: 'pending' });
    ok(list, 'approvals/list');
    const ids = (list.body.approvals ?? []).map(a => a.id);
    expect(ids.includes(firstApprovalId), 'first approval is not in the checker list before acknowledging');
    const c0 = await api('admin/approvals/counts', mint(checker), {});
    ok(c0, 'approvals/counts before ack');
    expect(c0.body.pendingActionableCount > 0, `expected pendingActionableCount > 0, got ${c0.body.pendingActionableCount}`);

    // 2. Acknowledge EXACTLY the rendered ids → receipts written; unseen clears.
    const seen = await api('admin/approvals/markSeen', mint(checker), { approvalIds: ids });
    ok(seen, 'approvals/markSeen');
    const { data: r1 } = await sb.from('approval_seen_receipts')
      .select('approval_id').eq('user_id', checker.id).eq('approval_id', firstApprovalId);
    expect((r1 ?? []).length === 1, 'no seen receipt written for (checker, firstApprovalId)');
    const c1 = await api('admin/approvals/counts', mint(checker), {});
    ok(c1, 'approvals/counts after ack');
    expect(c1.body.unseenActionableCount === 0, `unseen not cleared after receipting: ${c1.body.unseenActionableCount}`);
    expect(c1.body.pendingActionableCount === c0.body.pendingActionableCount,
      `pending backlog changed by markSeen: ${c0.body.pendingActionableCount} -> ${c1.body.pendingActionableCount}`);

    // 3. A SECOND request is committed AFTER acknowledgement — it was never in the
    //    rendered list, so no receipt exists for it and it is exactly 1 unseen.
    const second = await api('superadmin/setUserPermission', mint(maker), {
      userId: target3.id, permission: KEY, granted: true,
      reason: `${TAG} race second`, validFrom: raceValidFrom, validUntil: raceValidUntil,
    });
    ok(second, 'second compliance request (maker)');
    expect(second.body.pending === true, `expected a pending request, got ${JSON.stringify(second.body)}`);
    const secondApprovalId = second.body.approvalId;
    raceApprovalIds.push(secondApprovalId);

    const { data: r2 } = await sb.from('approval_seen_receipts')
      .select('approval_id').eq('user_id', checker.id).eq('approval_id', secondApprovalId);
    expect((r2 ?? []).length === 0, 'second approval was wrongly receipted (acknowledgement race not fixed)');
    const c2 = await api('admin/approvals/counts', mint(checker), {});
    ok(c2, 'approvals/counts after second request');
    expect(c2.body.unseenActionableCount === 1,
      `expected exactly 1 unseen (the later request), got ${c2.body.unseenActionableCount}`);
  });

  await test('markSeen only receipts ids that are actionable for the reviewer (revalidation)', async () => {
    // A random / non-existent id is silently ignored (never receipted).
    const bogus = `PGA-${randomUUID()}`;
    const res = await api('admin/approvals/markSeen', mint(checker), { approvalIds: [bogus] });
    ok(res, 'approvals/markSeen bogus');
    expect(res.body.receiptCount === 0, `bogus id should receipt nothing, got ${res.body.receiptCount}`);
    const { data } = await sb.from('approval_seen_receipts')
      .select('approval_id').eq('user_id', checker.id).eq('approval_id', bogus);
    expect((data ?? []).length === 0, 'a non-actionable id must not produce a receipt');
  });

  await test('approvals/counts denies a non-approver (negative path)', async () => {
    const r = await api('admin/approvals/counts', targetToken, {});
    fails(r, 'employee must not access approvals/counts');
  });

  h.section('Permission Propagation > grant emits signal + updates snapshot');

  await test('maker-checker approve applies compliance_read', async () => {
    // clear any pre-existing signals so we detect the NEW one from the approval
    await sb.from('communication_signals').delete().eq('channel_key', channelKey);
    approvalId = await h.grantCriticalPerm(maker, checker, target.id, KEY, `${TAG} verify grant`);
    expect(!!approvalId, 'grantCriticalPerm returned no approvalId');
  });

  await test('the compliance request notifies an eligible approver (nav bubble)', async () => {
    // grantCriticalPerm ran the request (maker step) → approvers were notified.
    const got = await pollNotification(sb, checker.id, REQUESTED, 4000);
    expect(got, 'no compliance-request notification delivered to the approver (checker)');
    const n = (await sb.from('notifications').select('title, action_route')
      .eq('user_id', checker.id).eq('type', REQUESTED).limit(1)).data?.[0];
    expect(n?.action_route === 's-ac-approvals', `request notification route: ${n?.action_route}`);
  });

  await test('a permissions signal is emitted to the target on approval', async () => {
    const got = await pollSignal(sb, channelKey, 'permissions', 4000);
    expect(got, 'no communication_signals(domain=permissions) row for the target channel after approval');
  });

  await test('snapshot now returns compliance_read WITH its approved validity window', async () => {
    const r = await api('getMyPermissionOverrides', targetToken, {});
    ok(r, 'getMyPermissionOverrides');
    const row = (r.body.data ?? []).find(o => o.permission === KEY);
    expect(row, `target does not hold ${KEY} after grant`);
    expect(row.granted === true, `${KEY} not granted=true`);
    expect(!!row.valid_from && !!row.valid_until, 'valid_from/valid_until missing from the snapshot');
    expect(!row.revoked_at, 'grant unexpectedly carries revoked_at');
    // Compare the applied window to the APPROVED window read from the DB (both
    // DB-sourced) so the DB↔runner clock skew can't flake this. The RPC sets
    // valid_from = greatest(requested_from, approval_time) and valid_until =
    // approved grant_valid_until, so: applied valid_until == approved grant_valid_until,
    // valid_from >= the approved grant_valid_from, and the window is well-formed.
    const { data: appr } = await sb.from('permission_grant_approvals')
      .select('grant_valid_from, grant_valid_until').eq('id', approvalId).maybeSingle();
    expect(appr, 'approval row not found for the applied grant');
    expect(Date.parse(row.valid_until) === Date.parse(appr.grant_valid_until),
      `applied valid_until (${row.valid_until}) != approved grant_valid_until (${appr.grant_valid_until})`);
    expect(Date.parse(row.valid_from) >= Date.parse(appr.grant_valid_from),
      `applied valid_from (${row.valid_from}) precedes approved grant_valid_from (${appr.grant_valid_from})`);
    expect(Date.parse(row.valid_until) > Date.parse(row.valid_from), 'valid_until must be after valid_from');
  });

  h.section('Permission Propagation > grant/revoke notify the grantee (nav bubble)');

  await test('grant approval creates a notification for the grantee', async () => {
    const got = await pollNotification(sb, target.id, GRANTED, 4000);
    expect(got, 'no "Compliance access granted" notification created for the grantee');
    const n = (await sb.from('notifications').select('title, action_route, is_read')
      .eq('user_id', target.id).eq('type', GRANTED).limit(1)).data?.[0];
    expect(n?.title === 'Compliance access granted', `unexpected notification title: ${n?.title}`);
    expect(n?.action_route === 's-messages', `unexpected route: ${n?.action_route}`);
  });

  await test('retrying the same approval does NOT create a duplicate notification', async () => {
    const before = await countNotifications(sb, target.id, GRANTED);
    // Re-approve the already-approved request → RPC returns not_pending (no-op).
    const retry = await api('admin/approvals/approve', mintStepUp(checker), { approvalId });
    expect(retry.body.success === false, `retry unexpectedly succeeded: ${JSON.stringify(retry.body)}`);
    await new Promise(r => setTimeout(r, 1200)); // give any stray async notify time to land
    const after = await countNotifications(sb, target.id, GRANTED);
    expect(after === before, `duplicate notification created on retry (${before} -> ${after})`);
  });

  h.section('Permission Propagation > revoke requires reason + step-up');

  await test('compliance revoke WITHOUT step-up is rejected', async () => {
    // requireStepUp runs first in the compliance branch → a plain token fails.
    const r = await api('superadmin/clearUserPermission', mint(checker), {
      userId: target.id, permission: KEY, reason: `${TAG} no stepup`,
    });
    fails(r, 'revoke without step-up should be rejected');
  });

  await test('compliance revoke WITHOUT a reason is rejected', async () => {
    const r = await api('superadmin/clearUserPermission', mintStepUp(checker), {
      userId: target.id, permission: KEY,
    });
    fails(r, 'revoke without a reason should be rejected');
    expect(r.body.code === 'reason_required', `expected reason_required, got ${r.body.code}`);
  });

  await test('grant is still active after the rejected revokes', async () => {
    const r = await api('getMyPermissionOverrides', targetToken, {});
    ok(r, 'getMyPermissionOverrides');
    const row = (r.body.data ?? []).find(o => o.permission === KEY);
    expect(row && row.granted === true && !row.revoked_at, 'grant was unexpectedly revoked by a rejected call');
  });

  h.section('Permission Propagation > revoke emits signal + clears snapshot');

  await test('compliance revoke emits a permissions signal', async () => {
    await sb.from('communication_signals').delete().eq('channel_key', channelKey);
    const rev = await api('superadmin/clearUserPermission', mintStepUp(checker), {
      userId: target.id, permission: KEY, reason: `${TAG} verify revoke`,
    });
    ok(rev, 'clearUserPermission (compliance revoke)');
    const got = await pollSignal(sb, channelKey, 'permissions', 4000);
    expect(got, 'no permissions signal after revoke');
  });

  await test('snapshot no longer grants compliance_read after revoke', async () => {
    const r = await api('getMyPermissionOverrides', targetToken, {});
    ok(r, 'getMyPermissionOverrides');
    const row = (r.body.data ?? []).find(o => o.permission === KEY);
    // The resolver denies if the row is gone, revoked, or outside its window.
    const effective = !!row && row.granted === true && !row.revoked_at
      && !!row.valid_from && !!row.valid_until
      && Date.parse(row.valid_from) <= Date.now() && Date.parse(row.valid_until) > Date.now();
    expect(!effective, `compliance_read still effective after revoke: ${JSON.stringify(row)}`);
  });

  await test('revoke creates a notification for the grantee', async () => {
    const got = await pollNotification(sb, target.id, REVOKED, 4000);
    expect(got, 'no "Compliance access revoked" notification created for the grantee');
    const n = (await sb.from('notifications').select('title, action_route')
      .eq('user_id', target.id).eq('type', REVOKED).limit(1)).data?.[0];
    expect(n?.title === 'Compliance access revoked', `unexpected notification title: ${n?.title}`);
    expect(n?.action_route === 's-messages', `unexpected route: ${n?.action_route}`);
  });
}
