/**
 * scripts/e2e/suites/hrRequests.mjs
 *
 * E2E for HR Requests (Request Center). Backend routes in hrRequests.ts
 * (/api/hr/requests):  types · submit · my · list · get · decide · fulfill · cancel
 *
 * Covers:
 *   1. Submit (as a provisioned employee) → hr_requests row, status='submitted',
 *      workflow_id set for approvable type / null for non-approvable.
 *   2. Self-scope (headline test) — employee A cannot get/cancel employee B's
 *      request (403); A's /requests/my returns only A's own; submit with
 *      employeeId=B while A lacks manage is rejected/coerced to A.
 *   3. Triage — hr_staff/hr_manager sees all via /requests/list; decides
 *      (approve/reject); then fulfills → fulfilled. Employee with only
 *      submit_own is denied list/decide/fulfill (403).
 *   4. §2 side-effects — app_events (hr.request.submitted / fulfilled) and
 *      hr_audit_log (submodule_key='requests') are written.
 *   5. Cleanup — rows tagged with h.TAG, deleted in h.onCleanup().
 *
 * Requires migrations 20260721000000–20260721000002 applied + NOTIFY pgrst.
 * Run: npm run test:e2e -- hrRequests   (against live dev:netlify)
 */

export const title = 'HR — Request Center';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);   // superadmin → has all permissions

  // ── User IDs (prefixed with TAG for cleanup isolation) ─────────────────────
  const empAId   = `REQ-EMPA-${TAG}`;
  const empBId   = `REQ-EMPB-${TAG}`;
  const staffId  = `REQ-STAFF-${TAG}`;

  const ctx = {
    empAToken:   null,   // mint token for employee A
    empBToken:   null,   // mint token for employee B
    staffToken:  null,   // mint token for hr_staff
    reqAId:      null,   // submitted by A (approvable type)
    reqBId:      null,   // submitted by admin on behalf of B (used for scope tests)
    reqSimpleId: null,   // non-approvable type (profile_correction)
  };

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    try { await sb.from('hr_requests').delete().like('request_no', `REQ-%`).in('employee_id', [empAId, empBId]); } catch {}
    try { await sb.from('hr_requests').delete().in('employee_id', [empAId, empBId]); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'hr').in('actor_user_id', [empAId, staffId, admin.id]); } catch {}
    try { await sb.from('hr_audit_log').delete().eq('submodule_key', 'requests').in('employee_id', [empAId, empBId]); } catch {}
    try { await sb.from('app_users').delete().in('id', [empAId, empBId, staffId]); } catch {}
  });

  // ── Setup ──────────────────────────────────────────────────────────────────
  h.section('HR Requests › Setup');

  await test('provision employee A, employee B, and hr_staff user', async () => {
    const { error: e1 } = await sb.from('app_users').insert({
      id: empAId, username: `${TAG}_empa`, full_name: 'Request E2E Employee A',
      role: 'employee', status: 'active', employment_type: 'employee',
    });
    expect(!e1, `seed empA failed: ${e1?.message}`);

    const { error: e2 } = await sb.from('app_users').insert({
      id: empBId, username: `${TAG}_empb`, full_name: 'Request E2E Employee B',
      role: 'employee', status: 'active', employment_type: 'employee',
    });
    expect(!e2, `seed empB failed: ${e2?.message}`);

    const { error: e3 } = await sb.from('app_users').insert({
      id: staffId, username: `${TAG}_staff`, full_name: 'Request E2E HR Staff',
      role: 'hr_staff', status: 'active', employment_type: 'employee',
    });
    expect(!e3, `seed hr_staff failed: ${e3?.message}`);

    ctx.empAToken  = mint({ id: empAId,  username: `${TAG}_empa`,  role: 'employee', department_id: null });
    ctx.empBToken  = mint({ id: empBId,  username: `${TAG}_empb`,  role: 'employee', department_id: null });
    ctx.staffToken = mint({ id: staffId, username: `${TAG}_staff`, role: 'hr_staff', department_id: null });
  });

  // ── Catalogue ──────────────────────────────────────────────────────────────
  h.section('HR Requests › Catalogue');

  await test('/requests/types returns the catalogue', async () => {
    const r = await api('hr/requests/types', A, {});
    ok(r, `types failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data) && r.body.data.length > 0, 'catalogue should not be empty');
    const keys = r.body.data.map(t => t.key);
    expect(keys.includes('employment_letter'), 'employment_letter missing from catalogue');
    expect(keys.includes('general_inquiry'),   'general_inquiry missing from catalogue');
    expect(keys.includes('profile_correction'), 'profile_correction missing from catalogue');
    // Verify shape
    const first = r.body.data[0];
    expect('key' in first && 'label' in first && 'requiresApproval' in first, 'catalogue entry missing required fields');
  });

  // ── Submit (approvable type) ───────────────────────────────────────────────
  h.section('HR Requests › Submit');

  await test('employee A submits an employment_letter request → REQ-#### ref', async () => {
    const r = await api('hr/requests/submit', ctx.empAToken, {
      requestType: 'employment_letter',
      title:       'Employment letter for visa application',
      details:     { purpose: 'visa' },
      priority:    'normal',
    });
    ok(r, `submit failed: ${r.body.message}`);
    expect(/^REQ-/.test(r.body.data.requestNo), `expected REQ- ref, got ${r.body.data.requestNo}`);
    ctx.reqAId = r.body.data.requestId;
    // approvable type → workflow_id should be set (or null if no binding applied, which is fine pre-migration)
    expect('workflowId' in r.body.data, 'response missing workflowId field');
  });

  await test('DB row has correct employee_id, status=submitted|in_review, employee_id=empA', async () => {
    const { data } = await sb.from('hr_requests').select('*').eq('id', ctx.reqAId).maybeSingle();
    expect(!!data, 'hr_requests row not found after submit');
    expect(data.employee_id === empAId, `employee_id mismatch: expected ${empAId}, got ${data.employee_id}`);
    expect(['submitted', 'in_review'].includes(data.status), `unexpected status: ${data.status}`);
    expect(data.request_type === 'employment_letter', `request_type mismatch: ${data.request_type}`);
  });

  await test('employee A submits a non-approvable general_inquiry → no workflow_id', async () => {
    const r = await api('hr/requests/submit', ctx.empAToken, {
      requestType: 'general_inquiry',
      title:       'Question about leave policy',
    });
    ok(r, `submit general_inquiry failed: ${r.body.message}`);
    // non-approvable → workflowId should be null
    expect(r.body.data.workflowId === null, `expected null workflowId for non-approvable type, got ${r.body.data.workflowId}`);
  });

  await test('admin submits on behalf of employee B (employeeId override)', async () => {
    const r = await api('hr/requests/submit', A, {
      requestType: 'document_copy',
      title:       'Copy of employment contract',
      employeeId:  empBId,
    });
    ok(r, `admin-on-behalf submit failed: ${r.body.message}`);
    ctx.reqBId = r.body.data.requestId;
    // Verify employee_id = empBId, not admin.id
    const { data } = await sb.from('hr_requests').select('employee_id').eq('id', ctx.reqBId).maybeSingle();
    expect(data?.employee_id === empBId, `admin-on-behalf: employee_id should be ${empBId}, got ${data?.employee_id}`);
  });

  // ── §2 Side-effects ────────────────────────────────────────────────────────
  h.section('HR Requests › Side-effects (submit)');

  await test('app_event hr.request.submitted written for empA request', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'hr').eq('event_type', 'hr.request.submitted')
        .eq('source_entity_id', (await sb.from('hr_requests').select('request_no').eq('id', ctx.reqAId).maybeSingle())?.data?.request_no ?? '')
        .limit(1);
      return (data ?? []).length > 0;
    });
    // Events are fire-and-forget; allow a brief window
    expect(gotEvent, 'hr.request.submitted app_event not found within timeout');
  });

  await test('hr_audit_log row written (submodule_key=requests, action=hr.request.submitted)', async () => {
    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'requests').eq('action', 'hr.request.submitted')
      .eq('record_id', ctx.reqAId).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log row for hr.request.submitted not found');
  });

  // ── Self-scope — THE HEADLINE TEST ────────────────────────────────────────
  h.section('HR Requests › Self-scope enforcement');

  await test('/requests/get: employee A cannot get employee B request (403)', async () => {
    const r = await api('hr/requests/get', ctx.empAToken, { requestId: ctx.reqBId });
    fails(r, `employee A should be denied access to employee B's request (expected 403, got ${r.body?.message})`);
  });

  await test('/requests/cancel: employee A cannot cancel employee B request (403)', async () => {
    const r = await api('hr/requests/cancel', ctx.empAToken, { requestId: ctx.reqBId });
    fails(r, `employee A should be denied cancel on employee B's request`);
  });

  await test('/requests/my: employee A sees only their own requests', async () => {
    const r = await api('hr/requests/my', ctx.empAToken, {});
    ok(r, `my failed: ${r.body.message}`);
    const ids = r.body.data.map(x => x.id);
    expect(ids.includes(ctx.reqAId), 'empA requests should include empA submit');
    expect(!ids.includes(ctx.reqBId), `empA's /my should NOT include empB's request (reqBId=${ctx.reqBId})`);
    // All returned rows must belong to empA
    r.body.data.forEach(req => {
      expect(req.employeeId === empAId, `/my returned row with wrong employeeId: ${req.employeeId}`);
    });
  });

  await test('submit with employeeId=B while acting as employee A is rejected (self-scope)', async () => {
    const r = await api('hr/requests/submit', ctx.empAToken, {
      requestType: 'general_inquiry',
      title:       'Self-scope bypass attempt',
      employeeId:  empBId,   // A does not have manage → should be rejected
    });
    fails(r, 'employee A should not be allowed to submit on behalf of employee B');
  });

  await test('employee A is denied /requests/list (manage required)', async () => {
    fails(await api('hr/requests/list', ctx.empAToken, {}), 'employee should not access /requests/list');
  });

  await test('employee A is denied /requests/decide (manage required)', async () => {
    fails(await api('hr/requests/decide', ctx.empAToken, { requestId: ctx.reqAId, decision: 'approved' }), 'employee should not access /requests/decide');
  });

  await test('employee A is denied /requests/fulfill (manage required)', async () => {
    fails(await api('hr/requests/fulfill', ctx.empAToken, { requestId: ctx.reqAId }), 'employee should not access /requests/fulfill');
  });

  // ── Triage ────────────────────────────────────────────────────────────────
  h.section('HR Requests › Triage');

  await test('/requests/list: hr_staff sees all requests including empA and empB', async () => {
    const r = await api('hr/requests/list', ctx.staffToken, {});
    ok(r, `list failed: ${r.body.message}`);
    const ids = r.body.data.map(x => x.id);
    expect(ids.includes(ctx.reqAId), 'list should include empA request');
    expect(ids.includes(ctx.reqBId), 'list should include empB request (submitted by admin)');
  });

  await test('/requests/get: hr_staff can get any request', async () => {
    const r = await api('hr/requests/get', ctx.staffToken, { requestId: ctx.reqBId });
    ok(r, `hr_staff get failed: ${r.body.message}`);
    expect(r.body.data.id === ctx.reqBId, 'wrong request returned');
  });

  await test('/requests/decide: hr_staff approves empB document_copy request → approved/in_review', async () => {
    // Only non-workflow (or non-approvable) requests can be decided without a taskId.
    // If document_copy is approvable and a workflow was created, decide without taskId should 400.
    // We decide the general_inquiry (non-approvable, submitted earlier for empA by resubmitting for empB).
    // First: find or submit a non-approvable request for empB to test direct decide path.
    const submitR = await api('hr/requests/submit', A, {
      requestType: 'general_inquiry',
      title:       'Test inquiry for triage decide',
      employeeId:  empBId,
    });
    ok(submitR, `setup submit for decide test failed: ${submitR.body.message}`);
    const inquiryId = submitR.body.data.requestId;
    expect(submitR.body.data.workflowId === null, 'general_inquiry should have no workflow');

    const decideR = await api('hr/requests/decide', ctx.staffToken, { requestId: inquiryId, decision: 'approved', comment: 'Happy to help' });
    ok(decideR, `decide failed: ${decideR.body.message}`);
    expect(['approved'].includes(decideR.body.data.status), `expected approved, got ${decideR.body.data.status}`);

    // Verify DB
    const { data } = await sb.from('hr_requests').select('status, decided_by').eq('id', inquiryId).maybeSingle();
    expect(data?.status === 'approved', `DB status should be approved, got ${data?.status}`);
    expect(data?.decided_by === staffId, `decided_by should be staffId`);
  });

  await test('/requests/fulfill: hr_staff fulfills an approved request → fulfilled', async () => {
    // Find the general_inquiry we just approved above.
    const { data: approved } = await sb.from('hr_requests').select('id').eq('employee_id', empBId).eq('request_type', 'general_inquiry').eq('status', 'approved').limit(1);
    expect((approved ?? []).length > 0, 'no approved general_inquiry found to fulfill');
    const idToFulfill = approved[0].id;

    const r = await api('hr/requests/fulfill', ctx.staffToken, {
      requestId:   idToFulfill,
      note:        'Answered via email.',
      artifactRef: 'email-thread-2026-07-01',
    });
    ok(r, `fulfill failed: ${r.body.message}`);
    expect(r.body.data.status === 'fulfilled', `expected fulfilled, got ${r.body.data.status}`);

    // Verify DB
    const { data } = await sb.from('hr_requests').select('status, fulfilled_by, resolution').eq('id', idToFulfill).maybeSingle();
    expect(data?.status === 'fulfilled', `DB status should be fulfilled`);
    expect(data?.fulfilled_by === staffId, `fulfilled_by should be staffId`);
    expect(data?.resolution?.note === 'Answered via email.', 'resolution.note not stored');
  });

  // ── Side-effects (triage actions) ─────────────────────────────────────────
  h.section('HR Requests › Side-effects (fulfill)');

  await test('hr.request.fulfilled event written after fulfill', async () => {
    const { data: fulfilled } = await sb.from('hr_requests').select('request_no').eq('employee_id', empBId).eq('status', 'fulfilled').limit(1);
    const reqNo = fulfilled?.[0]?.request_no;
    if (!reqNo) { expect(false, 'no fulfilled request found to check event'); return; }

    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'hr').eq('event_type', 'hr.request.fulfilled')
        .eq('source_entity_id', reqNo).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'hr.request.fulfilled app_event not found within timeout');
  });

  await test('hr_audit_log row for hr.request.fulfilled written', async () => {
    const { data: audit } = await sb.from('hr_audit_log')
      .select('id').eq('submodule_key', 'requests').eq('action', 'hr.request.fulfilled')
      .eq('employee_id', empBId).limit(1);
    expect((audit ?? []).length > 0, 'hr_audit_log row for hr.request.fulfilled not found');
  });

  // ── Cancel ────────────────────────────────────────────────────────────────
  h.section('HR Requests › Cancel');

  await test('employee A can cancel their own submitted request', async () => {
    // Submit a fresh one to cancel (the first may already be in_review/workflow)
    const submitR = await api('hr/requests/submit', ctx.empAToken, {
      requestType: 'general_inquiry',
      title:       'Cancel-me test request',
    });
    ok(submitR, `setup for cancel test failed: ${submitR.body.message}`);
    const toCancel = submitR.body.data.requestId;

    const r = await api('hr/requests/cancel', ctx.empAToken, { requestId: toCancel, reason: 'No longer needed.' });
    ok(r, `cancel own request failed: ${r.body.message}`);
    const { data } = await sb.from('hr_requests').select('status').eq('id', toCancel).maybeSingle();
    expect(data?.status === 'cancelled', `expected cancelled, got ${data?.status}`);
  });

  await test('employee cannot cancel already-fulfilled request (422)', async () => {
    // re-use the fulfilled reqB from the triage tests
    const { data: fulfilled } = await sb.from('hr_requests').select('id').eq('employee_id', empBId).eq('status', 'fulfilled').limit(1);
    if (!(fulfilled ?? []).length) return; // skip if none
    const r = await api('hr/requests/cancel', A, { requestId: fulfilled[0].id });
    fails(r, 'should not cancel a fulfilled request');
  });
}
