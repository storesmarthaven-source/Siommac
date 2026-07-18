/**
 * scripts/e2e/suites/communicationsCompliance.mjs
 *
 * Slice 1 — Critical-permission acceptance suite for the compliance_read /
 * compliance_export gate on the Communications module.
 *
 * What this suite proves end-to-end (against the live stack):
 *
 *   A. Superadmin WITHOUT compliance_read is DENIED (fail-closed)
 *   B. MAKER requests compliance_read  → pending approval (no effect yet)
 *   C. CHECKER (different superadmin) approves → grant applied
 *   D. Same superadmin is now ALLOWED on compliance endpoints
 *   E. REVOKE → DENIED again
 *   F. Non-critical regression: a regular permission still resolves normally for
 *      superadmin (Slice 1 only strips CRITICAL keys; the rest remain as before)
 *
 * Maker-checker flow uses the REAL API endpoints (not service-role shortcuts):
 *   POST /api/superadmin/setUserPermission   (MAKER → pending)
 *   POST /api/admin/approvals/approve              (CHECKER → applied; step-up required)
 *   POST /api/superadmin/clearUserPermission (REVOKE → immediate)
 *
 * Cleanup: all rows tagged h.TAG or tracked in cleanup closures.
 *
 * Known gap (stated explicitly per delivery contract):
 *   user_permissions has NO expires_at column. Grant expiry is NOT supported at
 *   the permission level. The permission_grant_approvals.expires_at (7 days) is
 *   only the approval-request window, not the resulting grant lifetime. A granted
 *   permission persists until revoked.
 */

export const title = 'Communications — Compliance Critical-Grant (Slice 1)';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  // ── Setup: a thread that the compliance endpoint can be called against ─────
  // We need TWO participant users plus the superadmin actors.
  const { admin, b } = h.users;
  const T = { admin: mint(admin) };

  const ctx = {
    threadId:    null,
    threadIds:   [],
    grantIds:    [],  // message_thread_access_grants rows to clean
  };

  // Upstream cleanup: threads + access grants
  h.onCleanup(async () => {
    if (ctx.grantIds.length) {
      await h.mustDelete('message_thread_access_grants', q => q.in('id', ctx.grantIds));
    }
    if (ctx.threadIds.length) {
      const posts = (await sb.from('message_posts').select('id').in('thread_id', ctx.threadIds)).data ?? [];
      if (posts.length) await h.mustDelete('message_attachments', q => q.in('post_id', posts.map(p => p.id)));
      await h.mustDelete('message_posts',              q => q.in('thread_id', ctx.threadIds));
      await h.mustDelete('message_participants',       q => q.in('thread_id', ctx.threadIds));
      await h.mustDelete('message_thread_access_grants', q => q.in('thread_id', ctx.threadIds));
      await h.mustDelete('message_threads',            q => q.in('id', ctx.threadIds));
    }
  });

  // ── Superadmin actors ──────────────────────────────────────────────────────
  // Both must be distinct users (server enforces maker ≠ checker on SoD).
  // Compliance tests mutate critical grants, so they must never borrow real
  // superadmins from the roster.
  const { actors: [sadmin, sadmin2], createdIds: sadminCreatedIds } = await h.acquireActors(
    'superadmin', 2, {}, {}, { forceSynthetic: true },
  );
  h.onCleanup(async () => {
    if (sadminCreatedIds.length) {
      await h.mustDelete('app_users', q => q.in('id', sadminCreatedIds));
    }
  });

  // Post-Slice-1 narrowing: permissions.manage is back in the superadmin default set
  // (only COMPLIANCE_GATED_KEYS are excluded). Synthetic superadmins auto-hold
  // permissions.manage via loadRolePermissions('superadmin') — no seeding needed.
  // The only key that still requires an explicit grant for superadmin is compliance_read
  // (and compliance_export), which is granted below via grantCriticalPerm.

  // ── Create a test thread ───────────────────────────────────────────────────
  h.section('Compliance › Setup: seed thread');

  let threadId;
  await test('create a group thread for compliance tests', async () => {
    const r = await api('communications/messages/createThread', T.admin, {
      threadType: 'group',
      subject:    `${TAG} compliance-test thread`,
      participantUserIds: [b.id],
      body:       `${TAG} seed message`,
    });
    ok(r, `createThread failed: ${r.body.message}`);
    expect(r.body.threadId, 'no threadId');
    threadId = r.body.threadId;
    ctx.threadId  = threadId;
    ctx.threadIds.push(threadId);
  });

  // ── A. Fail-closed: superadmin DENIED before any grant ────────────────────
  h.section('Compliance › A. Fail-closed (no grant)');

  await test('A1. superadmin WITHOUT compliance_read is denied requestThreadAccess (403)', async () => {
    // Post-Slice-1: superadmin does NOT auto-hold compliance_read.
    const token = mint(sadmin);
    const r = await api('communications/messages/requestThreadAccess', token, {
      threadId, reason: 'investigation', caseRef: `${TAG}`, durationHours: 1,
    });
    fails(r, 'superadmin without compliance_read should have been denied but was allowed');
  });

  // ── B. MAKER requests the grant — approval is PENDING, no effect yet ──────
  h.section('Compliance › B. Maker requests grant (pending)');

  let approvalId;
  await test('B1. setUserPermission returns pending:true with an approvalId', async () => {
    const makerToken = mint(sadmin);
    const r = await api('superadmin/setUserPermission', makerToken, {
      userId:     sadmin.id,
      permission: 'communications.compliance_read',
      granted:    true,
      reason:     `${TAG} compliance audit`,
    });
    ok(r, `setUserPermission failed: ${r.body.message}`);
    expect(r.body.pending === true, `expected pending:true, got: ${JSON.stringify(r.body)}`);
    expect(r.body.approvalId, 'no approvalId returned');
    approvalId = r.body.approvalId;
  });

  await test('B2. pending approval row exists in permission_grant_approvals', async () => {
    expect(approvalId, 'approvalId not set (B1 must pass first)');
    const { data } = await sb.from('permission_grant_approvals')
      .select('status, permission_key, target_user_id, requested_by')
      .eq('id', approvalId)
      .maybeSingle();
    expect(data, 'permission_grant_approvals row not found');
    expect(data.status === 'pending',          `expected status=pending, got ${data.status}`);
    expect(data.permission_key === 'communications.compliance_read', 'wrong permission_key');
    expect(data.target_user_id === sadmin.id,  'target_user_id mismatch');
    expect(data.requested_by  === sadmin.id,   'requested_by mismatch');
  });

  await test('B3. compliance_read is NOT yet in user_permissions (grant not applied while pending)', async () => {
    const { data } = await sb.from('user_permissions')
      .select('granted')
      .eq('user_id', sadmin.id)
      .eq('permission', 'communications.compliance_read')
      .maybeSingle();
    expect(!data, `user_permissions row must not exist yet; found: ${JSON.stringify(data)}`);
  });

  await test('B4. superadmin is STILL denied while approval is pending (no effect yet)', async () => {
    const token = mint(sadmin);
    const r = await api('communications/messages/requestThreadAccess', token, {
      threadId, reason: 'investigation', caseRef: `${TAG}`, durationHours: 1,
    });
    fails(r, 'superadmin should still be denied while approval is only pending');
  });

  await test('B5. duplicate request is rejected with already_pending (409)', async () => {
    const makerToken = mint(sadmin);
    const r = await api('superadmin/setUserPermission', makerToken, {
      userId: sadmin.id, permission: 'communications.compliance_read', granted: true, reason: `${TAG} dup`,
    });
    expect(r.status === 409 || r.body.code === 'already_pending',
      `expected 409/already_pending, got ${r.status} ${JSON.stringify(r.body)}`);
  });

  // ── C. CHECKER approves — grant is applied atomically ─────────────────────
  h.section('Compliance › C. Checker approves (grant applied)');

  await test('C1. self-approval is rejected by the RPC (SoD enforced)', async () => {
    const selfStepUp = h.mintStepUp(sadmin);  // maker tries to approve their own request
    const r = await api('admin/approvals/approve', selfStepUp, { approvalId });
    expect(r.status === 403 || r.body.code === 'self_approval',
      `expected 403/self_approval, got ${r.status} ${JSON.stringify(r.body)}`);
  });

  await test('C2. checker approves with step-up token → success', async () => {
    const checkerStepUp = h.mintStepUp(sadmin2);
    const r = await api('admin/approvals/approve', checkerStepUp, { approvalId });
    ok(r, `approve failed: ${r.body.message}`);
  });

  await test('C3. approval row is now approved (not pending)', async () => {
    const { data } = await sb.from('permission_grant_approvals')
      .select('status, decided_by, applied_at')
      .eq('id', approvalId)
      .maybeSingle();
    expect(data, 'approval row vanished after approve');
    expect(data.status === 'approved',    `expected approved, got ${data.status}`);
    expect(data.decided_by === sadmin2.id, 'decided_by should be the checker');
    expect(data.applied_at,               'applied_at must be set');
  });

  await test('C4. user_permissions row now exists (grant was applied)', async () => {
    const { data } = await sb.from('user_permissions')
      .select('granted')
      .eq('user_id', sadmin.id)
      .eq('permission', 'communications.compliance_read')
      .maybeSingle();
    expect(data,            'user_permissions row not written after approval');
    expect(data.granted,    'granted must be true');
  });

  await test('C5. approve again is rejected with not_pending (400)', async () => {
    const checkerStepUp = h.mintStepUp(sadmin2);
    const r = await api('admin/approvals/approve', checkerStepUp, { approvalId });
    expect(r.status === 400, `expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
  });

  // ── D. ALLOWED after approval ──────────────────────────────────────────────
  h.section('Compliance › D. Allowed after approval');

  let accessGrantId;
  await test('D1. requestThreadAccess now succeeds for the approved superadmin', async () => {
    const token = mint(sadmin);
    const r = await api('communications/messages/requestThreadAccess', token, {
      threadId, reason: 'investigation', caseRef: `${TAG}`, durationHours: 4,
    });
    ok(r, `requestThreadAccess failed after grant: ${r.body.message}`);
    expect(r.body.data?.grantId,   'no grantId in response');
    expect(r.body.data?.expiresAt, 'no expiresAt in response');
    accessGrantId = r.body.data.grantId;
    ctx.grantIds.push(accessGrantId);
  });

  await test('D2. message_thread_access_grants row written with correct metadata', async () => {
    expect(accessGrantId, 'accessGrantId not set (D1 must pass first)');
    const { data } = await sb.from('message_thread_access_grants')
      .select('id, thread_id, user_id, reason, case_ref, expires_at, revoked_at')
      .eq('id', accessGrantId)
      .maybeSingle();
    expect(data,                              'access grant row not found');
    expect(data.thread_id  === threadId,      'thread_id mismatch');
    expect(data.user_id    === sadmin.id,     'user_id (grantee) mismatch');
    expect(data.case_ref   === TAG,           'caseRef/tag not stored');
    expect(data.expires_at,                   'no expires_at');
    expect(!data.revoked_at,                  'revoked_at should be null on a live grant');
  });

  await test('D3. active grant + active compliance_read permits the non-participant read', async () => {
    const r = await api('communications/messages/posts', mint(sadmin), {
      threadId,
      limit: 10,
    });
    ok(r, `approved compliance read failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data), 'compliance read must return a posts array');
  });

  await test('D4. app_events side-effect: iam.permission.grant_approved event emitted', async () => {
    const { data } = await sb.from('app_events')
      .select('event_type, source_entity_id')
      .eq('event_type', 'iam.permission.grant_approved')
      .eq('source_entity_id', approvalId)
      .maybeSingle();
    expect(data, 'iam.permission.grant_approved event not found in app_events');
  });

  // ── E. REVOKE → DENIED ────────────────────────────────────────────────────
  h.section('Compliance › E. Revoke → denied');

  await test('E1. clearUserPermission removes the grant (immediate, no maker-checker)', async () => {
    // Either superadmin with permissions.manage can revoke
    const revokerToken = mint(sadmin2);
    const r = await api('superadmin/clearUserPermission', revokerToken, {
      userId: sadmin.id, permission: 'communications.compliance_read',
    });
    ok(r, `clearUserPermission failed: ${r.body.message}`);
  });

  await test('E2. user_permissions row is gone after revoke', async () => {
    const { data } = await sb.from('user_permissions')
      .select('granted')
      .eq('user_id', sadmin.id)
      .eq('permission', 'communications.compliance_read')
      .maybeSingle();
    expect(!data, `user_permissions row still exists after revoke: ${JSON.stringify(data)}`);
  });

  await test('E3. superadmin is denied again after revoke', async () => {
    const token = mint(sadmin);
    const r = await api('communications/messages/requestThreadAccess', token, {
      threadId, reason: 'investigation', caseRef: `${TAG}`, durationHours: 1,
    });
    fails(r, 'superadmin should be denied after compliance_read was revoked');
  });

  await test('E4. the still-live thread grant cannot bypass revoked compliance_read', async () => {
    const r = await api('communications/messages/posts', mint(sadmin), {
      threadId,
      limit: 10,
    });
    expect(r.status === 403, `expected 403 after permission revoke, got ${r.status}`);
    expect(r.body.code === 'forbidden', `expected forbidden, got ${r.body.code}`);
  });

  // Clean up the approval row (it's approved, so the approval-request cleanup handles
  // this; also remove the access grant manually since revocation doesn't delete it).
  h.onCleanup(async () => {
    if (approvalId) {
      await h.mustDelete('permission_grant_approvals', q => q.eq('id', approvalId));
    }
    if (accessGrantId) {
      await h.mustDelete('message_thread_access_grants', q => q.eq('id', accessGrantId));
    }
  });

  // ── F. Non-critical regression ────────────────────────────────────────────
  h.section('Compliance › F. Non-critical regression (superadmin allow-all intact)');

  await test('F1. superadmin still resolves a non-critical permission without explicit grant', async () => {
    // communications.view is NOT in CRITICAL_GRANT_KEYS — superadmin should still
    // auto-pass it from the role set (Slice 1 only strips CRITICAL keys).
    // We test this indirectly: the thread-list endpoint requires communications.view;
    // a superadmin token without any user_permissions entry for it should still pass.
    const token = mint(sadmin);
    const r = await api('communications/messages/threads', token, { tab: 'inbox', limit: 1 });
    ok(r, `threads list failed for superadmin (non-critical key should still pass): ${r.body.message}`);
  });

  await test('F2. list approvals (permissions.manage) still works for seeded superadmin', async () => {
    // permissions.manage WAS bootstrapped via seedCriticalPermViaServiceRole, so sadmin
    // holds it in user_permissions. This confirms the full resolution path works.
    const token = mint(sadmin);
    const r = await api('admin/approvals/list', token, { status: 'approved' });
    ok(r, `approvals/list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.approvals), 'approvals must be an array');
  });

  // ── Grant-expiry gap declaration ──────────────────────────────────────────
  // user_permissions has no expires_at column. Grant expiry is NOT supported.
  // The permission_grant_approvals.expires_at (7-day window) governs only how long
  // the APPROVAL REQUEST can be accepted — it does not limit the resulting grant.
  // A granted permission persists until clearUserPermission() removes the row.
  // This is a known gap explicitly declared in the Slice-1 deliverable.
}
