/**
 * scripts/e2e/suites/serviceRequests.mjs
 *
 * End-to-end coverage for the capability-routed Account Support Service Requests
 * and the evolved support_tickets backend.
 *
 * Covers:
 *   Standard Ticket Center (createTicket, getTickets, replyTicket, updateTicketStatus,
 *     deleteTicket, clearClosedTickets) — access control + backbone side-effects
 *   Account Support Request queue (createAccountSupportRequest, getAccountSupportRequests,
 *     updateAccountSupportRequest)
 *   requestAccountAssistance (was requestPasswordReset) — real ticket creation,
 *     receiver resolution, handoff dispatch, notifications
 *   Org account support config (getAccountSupportConfig, updateAccountSupportConfig)
 *   Access control — authorized passes AND unauthorized denied with correct code;
 *     REAL provisioned users of each role (not the superadmin harness, which is allow-all)
 *   Response shape — exact fields the frontend consumes
 *   Side-effects — app_events + audit_logs written after each mutation
 *   Workflow/handoff — handoff_outbox row written by createAccountSupportRequest
 *   Failure path — createAccountSupportRequest / requestAccountAssistance fail when
 *     no authorised receiver is configured
 *
 * NOTE: requestPasswordReset was renamed to requestAccountAssistance (2026-07-26).
 *
 * NOTE: The elevated action routes behind requireStepUp accept tokens minted by
 * mintStepUp() (includes mfaVerifiedAt). Negative-path tests use regular mint()
 * (no mfaVerifiedAt) and assert step_up_required.
 *
 * All rows are tagged with h.TAG and cleaned up in h.onCleanup().
 */

export const title = 'Service Requests — Account Support Queue';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, mintStepUp, sb, TAG } = h;
  const { admin, b, c } = h.users;
  const T = { admin: mint(admin), b: mint(b), c: mint(c) };
  // Step-up tokens (mfaVerifiedAt present) — required for elevated-action routes
  const T_stepup = { admin: mintStepUp(admin) };

  // Acquire REAL provisioned users for role-specific negative-path tests.
  const { actors: [hrStaffUser],   createdIds: hrCreated }   = await h.acquireActors('hr_staff',   1);
  const { actors: [hrManagerUser], createdIds: hrMgrCreated } = await h.acquireActors('hr_manager', 1);
  const T_hr = {
    staff:   mint(hrStaffUser),
    manager: mint(hrManagerUser),
  };

  // Tracking IDs for cleanup
  const ctx = {
    ticketIds:                   [],
    ticketNumbers:               [],
    accountSupportTicketIds:     [],
    accountSupportTicketNumbers: [],
  };

  h.onCleanup(async () => {
    const allIds     = [...ctx.ticketIds, ...ctx.accountSupportTicketIds];
    const allNumbers = [...ctx.ticketNumbers, ...ctx.accountSupportTicketNumbers];
    if (allIds.length) {
      await sb.from('ticket_replies').delete().in('ticket_id', allIds);
      await sb.from('handoff_outbox').delete().in('source_entity_id', allNumbers);
      await sb.from('notifications').delete().in('source_id', allNumbers);
      await sb.from('audit_logs').delete().in('record_id', allNumbers);
      await sb.from('app_events').delete().in('source_entity_id', allNumbers);
      await sb.from('support_tickets').delete().in('id', allIds);
    }
    await sb.from('org_account_support_config').delete().ilike('notes', `${TAG}%`);
    if (hrCreated.length)    await sb.from('app_users').delete().in('id', hrCreated);
    if (hrMgrCreated.length) await sb.from('app_users').delete().in('id', hrMgrCreated);
    // Clean app_events + audit_logs keyed on subject user IDs (account access action routes)
    const accountAccessEventTypes = [
      'account_access.activation_resent',
      'account_access.assistance_requested',
      'account_access.account_suspended',
      'account_access.account_restored',
      'account_access.sessions_revoked',
      'account_access.devices_revoked',
      'account_access.mfa_required',
    ];
    const accountAccessAuditActions = [
      'account_access.activation_resent',
      'account_access.assistance_requested',
      'account_access.account_suspended',
      'account_access.account_restored',
      'account_access.sessions_revoked',
      'account_access.devices_revoked',
      'account_access.mfa_required',
    ];
    await sb.from('app_events').delete()
      .in('event_type', accountAccessEventTypes)
      .in('source_entity_id', [admin.id, b.id, c.id]);
    await sb.from('audit_logs').delete()
      .in('action', accountAccessAuditActions)
      .in('record_id', [admin.id, b.id, c.id]);
    // Clean config audit_logs (record_id is config UUID or 'new'; delete by action)
    await sb.from('audit_logs').delete().eq('action', 'account_support.config_updated');
    await sb.from('app_events').delete()
      .eq('event_type', 'account_support.config_updated')
      .eq('source_entity_id', 'account_support_config');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 1 — Org Config must exist before account-support requests can route.
  // Set hr_managed so all request tests pass.
  // ─────────────────────────────────────────────────────────────────────────────
  h.section('Service Requests › Pre-test setup');

  await test('admin sets org config to hr_managed (baseline for all routing tests)', async () => {
    const r = await api('updateAccountSupportConfig', T.admin, {
      ownershipModel: 'hr_managed',
      notes: `${TAG} pre-test baseline config`,
    });
    ok(r);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 2 — Standard Ticket Center
  // ─────────────────────────────────────────────────────────────────────────────
  h.section('Service Requests › Standard Ticket Center');

  let standardTicketId, standardTicketNumber;

  await test('employee (user b) can create a support ticket', async () => {
    const r = await api('createTicket', T.b, {
      subject: `${TAG} support request`,
      body: 'I need help with something.',
      priority: 'medium',
    });
    ok(r);
    expect(typeof r.body.id === 'string', 'missing id');
    expect(typeof r.body.ticketNumber === 'string', 'missing ticketNumber');
    expect(r.body.ticketNumber.startsWith('TKT-'), `ticketNumber malformed: ${r.body.ticketNumber}`);
    standardTicketId     = r.body.id;
    standardTicketNumber = r.body.ticketNumber;
    ctx.ticketIds.push(standardTicketId);
    ctx.ticketNumbers.push(standardTicketNumber);
  });

  await test('admin (was previously role-blocked) can also create a ticket — role gate removed', async () => {
    const r = await api('createTicket', T.admin, {
      subject: `${TAG} admin support request`,
      body: 'Admin creating a ticket — hard-coded role gate is gone.',
      priority: 'low',
    });
    ok(r);
    ctx.ticketIds.push(r.body.id);
    ctx.ticketNumbers.push(r.body.ticketNumber);
  });

  await test('SIDE-EFFECT: createTicket wrote app_events row', async () => {
    const { data } = await sb.from('app_events')
      .select('id').eq('event_type', 'ticket.created').eq('source_entity_id', standardTicketNumber).limit(1);
    expect(data && data.length === 1, `app_events missing for ${standardTicketNumber}`);
  });

  await test('SIDE-EFFECT: createTicket wrote audit_logs row (via emitAppEvent step 6)', async () => {
    const { data } = await sb.from('audit_logs')
      .select('id, action, record_id, user_id')
      .eq('action', 'ticket.created').eq('record_id', standardTicketNumber).limit(1);
    expect(data && data.length === 1, `audit_logs missing for ${standardTicketNumber}`);
    expect(data[0].user_id === b.id, `audit_logs user_id wrong: ${data[0].user_id}`);
  });

  await test('unauthenticated request is rejected (401/403)', async () => {
    const r = await api('createTicket', null, { subject: 'no auth', body: 'fail' });
    fails(r, 'unauthenticated should fail');
    expect(r.status === 401 || r.status === 403, `expected 401/403 got ${r.status}`);
  });

  await test('createTicket rejects missing subject', async () => {
    const r = await api('createTicket', T.b, { body: 'no subject' });
    expect(r.body.success === false, 'should reject missing subject');
  });

  // ── getTickets ─────────────────────────────────────────────────────────────

  await test('employee (user b) sees only own tickets (no tickets.view_all)', async () => {
    const r = await api('getTickets', T.b);
    ok(r);
    const mine = (r.body.data || []).find(t => t.id === standardTicketId);
    expect(mine, 'created ticket not visible to creator');
    // Response shape
    expect(typeof mine.id === 'string', 'missing id');
    expect(typeof mine.ticketNumber === 'string', 'missing ticketNumber');
    expect(typeof mine.subject === 'string', 'missing subject');
    expect(typeof mine.body === 'string', 'missing body');
    expect(typeof mine.status === 'string', 'missing status');
    expect(Array.isArray(mine.replies), 'missing replies array');
  });

  await test('hr_staff (tickets.view_all) sees all tickets', async () => {
    const r = await api('getTickets', T_hr.staff);
    ok(r);
    const found = (r.body.data || []).find(t => t.id === standardTicketId);
    expect(found, 'hr_staff cannot see employee ticket — tickets.view_all gate broken');
  });

  await test('hr_manager (tickets.view_all) sees all tickets', async () => {
    const r = await api('getTickets', T_hr.manager);
    ok(r);
    const found = (r.body.data || []).find(t => t.id === standardTicketId);
    expect(found, 'hr_manager cannot see employee ticket — tickets.view_all gate broken');
  });

  // ── replyTicket ──────────────────────────────────────────────────────────────

  await test('admin (tickets.reply_internal) can post internal note', async () => {
    const r = await api('replyTicket', T.admin, {
      ticketId: standardTicketId,
      body: `${TAG} admin internal note`,
      isInternal: true,
    });
    ok(r);
  });

  await test('hr_staff (tickets.reply_internal) can post internal note', async () => {
    const r = await api('replyTicket', T_hr.staff, {
      ticketId: standardTicketId,
      body: `${TAG} hr_staff internal note`,
      isInternal: true,
    });
    ok(r);
  });

  await test('employee (no tickets.reply_internal) denied posting internal note — 403', async () => {
    const r = await api('replyTicket', T.b, {
      ticketId: standardTicketId,
      body: `${TAG} employee internal note attempt`,
      isInternal: true,
    });
    expect(r.status === 403 || r.body.success === false,
      `employee should be denied internal notes (got ${r.status})`);
  });

  await test('employee can post a regular (non-internal) reply to own ticket', async () => {
    const r = await api('replyTicket', T.b, {
      ticketId: standardTicketId,
      body: `${TAG} employee follow-up`,
    });
    ok(r);
  });

  await test('getTickets: employee does NOT see internal notes', async () => {
    const r = await api('getTickets', T.b);
    ok(r);
    const t = (r.body.data || []).find(x => x.id === standardTicketId);
    expect(t, 'ticket not found in employee view');
    const internalReplies = (t.replies || []).filter(rep => rep.isInternal === true);
    expect(internalReplies.length === 0,
      `employee sees ${internalReplies.length} internal note(s) — filter broken`);
  });

  await test('getTickets: hr_staff (tickets.reply_internal) DOES see internal notes', async () => {
    const r = await api('getTickets', T_hr.staff);
    ok(r);
    const t = (r.body.data || []).find(x => x.id === standardTicketId);
    expect(t, 'hr_staff cannot find ticket in list');
    const internalReplies = (t.replies || []).filter(rep => rep.isInternal === true);
    expect(internalReplies.length >= 2,
      `hr_staff sees only ${internalReplies.length} internal notes, expected >=2`);
  });

  // ── updateTicketStatus ───────────────────────────────────────────────────────

  await test('admin (tickets.manage) can update status', async () => {
    const r = await api('updateTicketStatus', T.admin, {
      ticketId: standardTicketId, status: 'in_progress',
    });
    ok(r);
  });

  await test('employee (no tickets.manage) denied updateTicketStatus — 403', async () => {
    const r = await api('updateTicketStatus', T.b, {
      ticketId: standardTicketId, status: 'resolved',
    });
    expect(r.status === 403 || r.body.success === false,
      `employee should be denied (got ${r.status})`);
  });

  await test('hr_staff (no tickets.manage) denied updateTicketStatus — 403', async () => {
    const r = await api('updateTicketStatus', T_hr.staff, {
      ticketId: standardTicketId, status: 'resolved',
    });
    expect(r.status === 403 || r.body.success === false,
      `hr_staff should be denied (got ${r.status})`);
  });

  await test('admin closes ticket — system closure reply written', async () => {
    const r = await api('updateTicketStatus', T.admin, {
      ticketId: standardTicketId, status: 'closed',
    });
    ok(r);
    const { data: sysReplies } = await sb.from('ticket_replies')
      .select('body').eq('ticket_id', standardTicketId).eq('from_username', '__system__');
    expect(sysReplies && sysReplies.length > 0, 'system closure reply not written');
  });

  await test('SIDE-EFFECT: updateTicketStatus wrote app_events + audit_logs', async () => {
    const { data: evts } = await sb.from('app_events')
      .select('id').eq('event_type', 'ticket.status_changed').eq('source_entity_id', standardTicketNumber).limit(1);
    expect(evts && evts.length >= 1, `app_events missing for status_changed on ${standardTicketNumber}`);
    const { data: logs } = await sb.from('audit_logs')
      .select('id').eq('action', 'ticket.status_changed').eq('record_id', standardTicketNumber).limit(1);
    expect(logs && logs.length >= 1, `audit_logs missing for status_changed on ${standardTicketNumber}`);
  });

  // ── deleteTicket ─────────────────────────────────────────────────────────────

  await test('employee can delete their own open ticket (record-scope only)', async () => {
    const fresh = await api('createTicket', T.c, {
      subject: `${TAG} delete test ticket`, body: 'Will be deleted.',
    });
    ok(fresh);
    ctx.ticketIds.push(fresh.body.id);
    ctx.ticketNumbers.push(fresh.body.ticketNumber);
    const del = await api('deleteTicket', T.c, { ticketId: fresh.body.id });
    ok(del);
  });

  await test('employee cannot delete another user\'s ticket — 403', async () => {
    const fresh = await api('createTicket', T.b, {
      subject: `${TAG} cross-user delete test`, body: 'Not deletable by c.',
    });
    ok(fresh);
    ctx.ticketIds.push(fresh.body.id);
    ctx.ticketNumbers.push(fresh.body.ticketNumber);
    const del = await api('deleteTicket', T.c, { ticketId: fresh.body.id });
    expect(del.status === 403 || del.body.success === false,
      `user c should not delete user b's ticket (got ${del.status})`);
  });

  // ── clearClosedTickets ───────────────────────────────────────────────────────

  await test('admin clears closed tickets', async () => {
    const r = await api('clearClosedTickets', T.admin);
    ok(r);
    expect(typeof r.body.count === 'number', 'missing count');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 3 — Account Support Queue
  // ─────────────────────────────────────────────────────────────────────────────
  h.section('Service Requests › Account Support Queue');

  let asSrId, asSrNumber;

  await test('employee (user b) can create an account support request for themselves', async () => {
    const r = await api('createAccountSupportRequest', T.b, {
      subjectId:       b.id,
      serviceDomain:   'password_reset',
      requestedAction: 'Reset my forgotten password',
      subject:         `${TAG} password reset request`,
      body:            'I forgot my password and need it reset.',
      priority:        'medium',
    });
    ok(r);
    expect(typeof r.body.id === 'string', 'missing id');
    expect(typeof r.body.ticketNumber === 'string', 'missing ticketNumber');
    expect('assignedTo' in r.body, 'missing assignedTo field (honest receiver envelope)');
    asSrId     = r.body.id;
    asSrNumber = r.body.ticketNumber;
    ctx.accountSupportTicketIds.push(asSrId);
    ctx.accountSupportTicketNumbers.push(asSrNumber);
  });

  await test('SIDE-EFFECT: createAccountSupportRequest wrote app_events with actor metadata', async () => {
    const { data } = await sb.from('app_events')
      .select('id, payload')
      .eq('event_type', 'ticket.account_support.created')
      .eq('source_entity_id', asSrNumber).limit(1);
    expect(data && data.length === 1, `app_events missing for ${asSrNumber}`);
    const payload = data[0].payload;
    expect(payload.actorId === b.id, `payload.actorId wrong: ${payload.actorId}`);
    expect(typeof payload.actorUsername === 'string', 'payload.actorUsername missing');
    expect(typeof payload.handoffId === 'string', 'payload.handoffId missing — handoff not dispatched');
  });

  await test('SIDE-EFFECT: createAccountSupportRequest wrote audit_logs', async () => {
    const { data } = await sb.from('audit_logs')
      .select('id, user_id').eq('action', 'ticket.account_support.created').eq('record_id', asSrNumber).limit(1);
    expect(data && data.length === 1, `audit_logs missing for ${asSrNumber}`);
    expect(data[0].user_id === b.id, `audit_logs user_id wrong: ${data[0].user_id}`);
  });

  await test('SIDE-EFFECT: createAccountSupportRequest wrote handoff_outbox row to hr', async () => {
    const { data } = await sb.from('handoff_outbox')
      .select('id, target_module, status').eq('source_entity_id', asSrNumber).limit(1);
    expect(data && data.length >= 1, `handoff_outbox row missing for ${asSrNumber}`);
    expect(data[0].target_module === 'hr', `wrong target_module: ${data[0].target_module}`);
    expect(['pending', 'processing', 'completed'].includes(data[0].status),
      `unexpected handoff status: ${data[0].status}`);
  });

  await test('SIDE-EFFECT: createAccountSupportRequest notified actor (user b)', async () => {
    const { data } = await sb.from('notifications')
      .select('id').eq('user_id', b.id).ilike('title', '%Account support request submitted%')
      .order('created_at', { ascending: false }).limit(1);
    expect(data && data.length >= 1, 'notification to actor (user b) missing');
  });

  await test('DB: account support ticket has correct metadata', async () => {
    const { data } = await sb.from('support_tickets')
      .select('category, subject_type, subject_id, service_domain').eq('id', asSrId).single();
    expect(data.category === 'account_support',   `wrong category: ${data.category}`);
    expect(data.subject_type === 'app_user',       `wrong subject_type: ${data.subject_type}`);
    expect(data.subject_id === b.id,               `wrong subject_id: ${data.subject_id}`);
    expect(data.service_domain === 'password_reset', `wrong service_domain: ${data.service_domain}`);
  });

  await test('employee cannot create request for different user (no employees.access.view) — 403', async () => {
    const r = await api('createAccountSupportRequest', T.b, {
      subjectId: admin.id, serviceDomain: 'account_access',
      requestedAction: 'View admin access', subject: `${TAG} cross-user attempt`, body: 'Should be denied.',
    });
    expect(r.status === 403 || !r.body.success,
      `employee should be denied for non-self subject (got ${r.status})`);
  });

  await test('admin (employees.access.view) can create request for another employee', async () => {
    const r = await api('createAccountSupportRequest', T.admin, {
      subjectId: b.id, serviceDomain: 'mfa',
      requestedAction: 'Enable MFA', subject: `${TAG} admin AS request for b`, body: 'Setting up MFA.',
    });
    ok(r);
    expect('assignedTo' in r.body, 'missing assignedTo field');
    ctx.accountSupportTicketIds.push(r.body.id);
    ctx.accountSupportTicketNumbers.push(r.body.ticketNumber);
  });

  await test('createAccountSupportRequest rejects unknown subjectId (404)', async () => {
    const r = await api('createAccountSupportRequest', T.admin, {
      subjectId: 'usr_nonexistent_9999', serviceDomain: 'general',
      requestedAction: 'X', subject: `${TAG} bad`, body: 'Should fail.',
    });
    expect(r.status === 404 || !r.body.success, 'should reject unknown subjectId');
  });

  await test('createAccountSupportRequest validates serviceDomain enum', async () => {
    const r = await api('createAccountSupportRequest', T.admin, {
      subjectId: admin.id, serviceDomain: 'invalid_xyz',
      requestedAction: 'x', subject: `${TAG} bad domain`, body: 'Should fail.',
    });
    expect(r.body.success === false, 'should reject invalid serviceDomain');
  });

  // ── getAccountSupportRequests ─────────────────────────────────────────────────

  await test('employee (user b) sees only own account support requests', async () => {
    const r = await api('getAccountSupportRequests', T.b);
    ok(r);
    const found = (r.body.data || []).find(t => t.id === asSrId);
    expect(found, 'employee cannot see own request');
    // Response shape
    const t = found;
    expect(typeof t.id === 'string',              'missing id');
    expect(typeof t.ticketNumber === 'string',    'missing ticketNumber');
    expect(typeof t.subjectType === 'string',     'missing subjectType');
    expect(typeof t.subjectId === 'string',       'missing subjectId');
    expect(typeof t.serviceDomain === 'string',   'missing serviceDomain');
    expect(typeof t.requestedAction === 'string', 'missing requestedAction');
    expect(typeof t.status === 'string',          'missing status');
  });

  await test('admin (employees.access.view) sees all account support requests', async () => {
    const r = await api('getAccountSupportRequests', T.admin);
    ok(r);
    expect((r.body.data || []).find(t => t.id === asSrId), 'admin cannot see employee request');
  });

  await test('hr_staff (employees.access.view) sees all account support requests', async () => {
    const r = await api('getAccountSupportRequests', T_hr.staff);
    ok(r);
    expect((r.body.data || []).find(t => t.id === asSrId),
      'hr_staff cannot see request — employees.access.view broken');
  });

  await test('hr_manager (employees.access.view) sees all account support requests', async () => {
    const r = await api('getAccountSupportRequests', T_hr.manager);
    ok(r);
    expect((r.body.data || []).find(t => t.id === asSrId), 'hr_manager cannot see request');
  });

  await test('user c (base employee) sees only own requests (none in this suite)', async () => {
    const r = await api('getAccountSupportRequests', T.c);
    ok(r);
    const others = (r.body.data || []).filter(t => t.fromUsername !== c.username);
    expect(others.length === 0,
      `user c sees ${others.length} other users' requests — scope filter broken`);
  });

  // ── updateAccountSupportRequest ─────────────────────────────────────────────

  await test('admin can update status, assignedUserId, resolutionNotes', async () => {
    const r = await api('updateAccountSupportRequest', T.admin, {
      ticketId: asSrId, status: 'in_progress',
      assignedUserId: admin.id, resolutionNotes: `${TAG} assigned`,
    });
    ok(r);
    const { data } = await sb.from('support_tickets')
      .select('assigned_user_id, resolution_notes, status').eq('id', asSrId).single();
    expect(data.assigned_user_id === admin.id,       `assigned_user_id wrong: ${data.assigned_user_id}`);
    expect((data.resolution_notes || '').includes(TAG), 'resolution_notes not set');
    expect(data.status === 'in_progress',            `status not updated: ${data.status}`);
  });

  await test('SIDE-EFFECT: updateAccountSupportRequest wrote app_events + audit_logs', async () => {
    const { data: evts } = await sb.from('app_events').select('id')
      .eq('event_type', 'ticket.account_support.updated').eq('source_entity_id', asSrNumber).limit(1);
    expect(evts && evts.length >= 1, 'app_events missing for account support update');
    const { data: logs } = await sb.from('audit_logs').select('id')
      .eq('action', 'ticket.account_support.updated').eq('record_id', asSrNumber).limit(1);
    expect(logs && logs.length >= 1, 'audit_logs missing for account support update');
  });

  await test('employee denied updateAccountSupportRequest (no tickets.manage) — 403', async () => {
    const r = await api('updateAccountSupportRequest', T.b, { ticketId: asSrId, status: 'closed' });
    expect(r.status === 403 || !r.body.success, `employee should be denied (got ${r.status})`);
  });

  await test('hr_manager (no tickets.manage) denied updateAccountSupportRequest — 403', async () => {
    const r = await api('updateAccountSupportRequest', T_hr.manager, {
      ticketId: asSrId, status: 'closed',
    });
    expect(r.status === 403 || !r.body.success, `hr_manager should be denied (got ${r.status})`);
  });

  await test('updateAccountSupportRequest rejects non-account-support ticket', async () => {
    const fresh = await api('createTicket', T.b, {
      subject: `${TAG} scope-check ticket`, body: 'Not an account support request.',
    });
    ok(fresh);
    ctx.ticketIds.push(fresh.body.id);
    ctx.ticketNumbers.push(fresh.body.ticketNumber);
    const r = await api('updateAccountSupportRequest', T.admin, {
      ticketId: fresh.body.id, status: 'in_progress',
    });
    expect(!r.body.success, 'should reject non-account-support ticket');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 4 — requestAccountAssistance (renamed from requestPasswordReset)
  // ─────────────────────────────────────────────────────────────────────────────
  h.section('Service Requests › requestAccountAssistance');

  await test('old requestPasswordReset route no longer exists (renamed)', async () => {
    const r = await api('requestPasswordReset', T_stepup.admin, {
      subjectId: b.id, reason: `${TAG} old route should 404`,
    });
    expect(r.status === 404 || r.body.success === false,
      `old requestPasswordReset route should not exist (got ${r.status})`);
  });

  await test('admin (step-up + employees.access.reset_password) can call requestAccountAssistance', async () => {
    const r = await api('requestAccountAssistance', T_stepup.admin, {
      subjectId: b.id,
      reason:    `${TAG} E2E: account assistance request`,
    });
    ok(r);
    // Truthful envelope — real ticket must exist
    expect(typeof r.body.id === 'string',           'missing id — false success; no real ticket created');
    expect(typeof r.body.ticketNumber === 'string', 'missing ticketNumber');
    expect(r.body.ticketNumber.startsWith('TKT-'),  `malformed ticketNumber: ${r.body.ticketNumber}`);
    expect('assignedTo' in r.body,                 'missing assignedTo field');
    ctx.accountSupportTicketIds.push(r.body.id);
    ctx.accountSupportTicketNumbers.push(r.body.ticketNumber);
  });

  await test('requestAccountAssistance created a REAL account-support ticket in DB (not a false success)', async () => {
    const lastId = ctx.accountSupportTicketIds[ctx.accountSupportTicketIds.length - 1];
    const { data } = await sb.from('support_tickets')
      .select('id, category, service_domain, requested_action, subject_id').eq('id', lastId).single();
    expect(data,                                'support_tickets row not found — false success was returned');
    expect(data.category === 'account_support', `wrong category: ${data.category}`);
    expect(data.service_domain === 'password_reset', `wrong service_domain: ${data.service_domain}`);
    expect(data.subject_id === b.id,            `wrong subject_id: ${data.subject_id}`);
  });

  await test('SIDE-EFFECT: requestAccountAssistance wrote handoff_outbox row to hr', async () => {
    const lastNum = ctx.accountSupportTicketNumbers[ctx.accountSupportTicketNumbers.length - 1];
    const { data } = await sb.from('handoff_outbox')
      .select('id, target_module, status').eq('source_entity_id', lastNum).limit(1);
    expect(data && data.length >= 1, `handoff_outbox missing for ${lastNum}`);
    expect(data[0].target_module === 'hr', `wrong target_module: ${data[0].target_module}`);
  });

  await test('SIDE-EFFECT: requestAccountAssistance wrote app_events with full audit metadata', async () => {
    const { data } = await sb.from('app_events')
      .select('id, event_type, payload')
      .eq('event_type', 'account_access.assistance_requested')
      .eq('source_entity_id', b.id)
      .order('created_at', { ascending: false }).limit(1);
    expect(data && data.length >= 1, 'app_events missing for assistance_requested');
    const p = data[0].payload;
    expect(p.actorId === admin.id,           `payload.actorId wrong: ${p.actorId}`);
    expect(typeof p.actorUsername === 'string', 'payload.actorUsername missing');
    expect(typeof p.ticketNumber === 'string',  'payload.ticketNumber missing');
    expect(typeof p.handoffId === 'string',     'payload.handoffId missing — handoff not dispatched');
  });

  await test('SIDE-EFFECT: requestAccountAssistance wrote audit_logs with actor + subject', async () => {
    const { data } = await sb.from('audit_logs')
      .select('id, user_id').eq('action', 'account_access.assistance_requested').eq('record_id', b.id).limit(1);
    expect(data && data.length >= 1, 'audit_logs missing for assistance_requested');
    expect(data[0].user_id === admin.id, `audit_logs user_id wrong: ${data[0].user_id}`);
  });

  await test('SIDE-EFFECT: requestAccountAssistance notified the subject employee (user b)', async () => {
    const { data } = await sb.from('notifications')
      .select('id').eq('user_id', b.id).ilike('title', '%Account assistance request submitted%')
      .order('created_at', { ascending: false }).limit(1);
    expect(data && data.length >= 1, 'notification to subject employee (user b) missing');
  });

  await test('requestAccountAssistance: regular token (no step-up) → step_up_required', async () => {
    const r = await api('requestAccountAssistance', T.admin, {
      subjectId: b.id, reason: `${TAG} step-up gate`,
    });
    expect(
      r.status === 401 || (r.body && (r.body.code === 'step_up_required' || r.body.message === 'step_up_required')),
      `expected step_up_required, got ${r.status}: ${JSON.stringify(r.body)}`,
    );
  });

  await test('hr_manager (employees.access.reset_password REMOVED) denied with step-up token — 403', async () => {
    const stepUpHrMgr = mintStepUp(hrManagerUser);
    const r = await api('requestAccountAssistance', stepUpHrMgr, {
      subjectId: b.id, reason: `${TAG} hr_manager should be denied`,
    });
    // hr_manager no longer has employees.access.reset_password
    expect(r.status === 403 || !r.body.success,
      `hr_manager should be denied requestAccountAssistance (got ${r.status})`);
  });

  await test('requestAccountAssistance rejects unknown subjectId (404)', async () => {
    const r = await api('requestAccountAssistance', T_stepup.admin, {
      subjectId: 'usr_fake_nonexistent_xyz', reason: 'should fail',
    });
    expect(r.status === 404 || !r.body.success, 'should return 404 for unknown subject');
  });

  await test('unauthenticated user denied requestAccountAssistance (401/403)', async () => {
    const r = await api('requestAccountAssistance', null, { subjectId: b.id, reason: 'unauth' });
    fails(r, 'unauthenticated should fail');
    expect(r.status === 401 || r.status === 403, `expected 401/403 got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 5 — resendActivation
  // ─────────────────────────────────────────────────────────────────────────────
  h.section('Service Requests › resendActivation');

  await test('admin can call resendActivation', async () => {
    const r = await api('resendActivation', T.admin, {
      subjectId: b.id, reason: `${TAG} verify activation resend audit log`,
    });
    ok(r);
    expect(typeof r.body.message === 'string', 'missing message');
  });

  await test('SIDE-EFFECT: resendActivation wrote app_events with full actor metadata', async () => {
    const { data } = await sb.from('app_events')
      .select('id, payload').eq('event_type', 'account_access.activation_resent').eq('source_entity_id', b.id)
      .order('created_at', { ascending: false }).limit(1);
    expect(data && data.length >= 1, 'app_events missing for resendActivation');
    expect(data[0].payload.actorId === admin.id,           'payload.actorId wrong');
    expect(typeof data[0].payload.actorUsername === 'string', 'payload.actorUsername missing');
    expect(typeof data[0].payload.reason === 'string',     'payload.reason missing');
  });

  await test('SIDE-EFFECT: resendActivation wrote audit_logs', async () => {
    const { data } = await sb.from('audit_logs')
      .select('id, user_id').eq('action', 'account_access.activation_resent').eq('record_id', b.id).limit(1);
    expect(data && data.length >= 1, 'audit_logs missing for resendActivation');
    expect(data[0].user_id === admin.id, `audit_logs user_id wrong: ${data[0].user_id}`);
  });

  await test('hr_staff (employees.access.resend_activation) can call resendActivation', async () => {
    const r = await api('resendActivation', T_hr.staff, {
      subjectId: c.id, reason: `${TAG} hr_staff resend test`,
    });
    ok(r);
  });

  await test('employee (no employees.access.resend_activation) denied resendActivation — 403', async () => {
    const r = await api('resendActivation', T.b, {
      subjectId: b.id, reason: 'should be denied',
    });
    expect(r.status === 403 || !r.body.success,
      `employee should be denied resendActivation (got ${r.status})`);
  });

  await test('resendActivation rejects unknown subjectId (404)', async () => {
    const r = await api('resendActivation', T.admin, {
      subjectId: 'usr_nonexistent_fake_id', reason: 'should fail',
    });
    expect(r.status === 404 || !r.body.success, 'should return 404 for unknown subject');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 6 — Step-up gate verification (all 5 remaining elevated routes)
  // ─────────────────────────────────────────────────────────────────────────────
  h.section('Service Requests › Step-Up Gate Verification');

  const stepUpRoutes = [
    'suspendAccount',
    'restoreAccount',
    'revokeUserSessions',
    'revokeUserDevices',
    'requireMfa',
  ];

  for (const route of stepUpRoutes) {
    await test(`${route}: regular token (no mfaVerifiedAt) → step_up_required`, async () => {
      const r = await api(route, T.admin, { subjectId: b.id, reason: `${TAG} gate test` });
      expect(
        r.status === 401 ||
        (r.body && (r.body.code === 'step_up_required' || r.body.message === 'step_up_required')),
        `${route}: expected step_up_required, got ${r.status}: ${JSON.stringify(r.body)}`,
      );
    });
  }

  await test('unauthenticated user denied on suspendAccount (401/403)', async () => {
    const r = await api('suspendAccount', null, { subjectId: b.id, reason: 'unauth' });
    fails(r, 'unauthenticated suspendAccount should fail');
    expect(r.status === 401 || r.status === 403, `expected 401/403 got ${r.status}`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 7 — Org Account Support Config
  // ─────────────────────────────────────────────────────────────────────────────
  h.section('Service Requests › Org Account Support Config');

  await test('admin (employees.access.view) can read config', async () => {
    const r = await api('getAccountSupportConfig', T.admin);
    ok(r);
    expect('config' in r.body, 'missing config key');
  });

  await test('hr_staff (employees.access.view) can read config', async () => {
    const r = await api('getAccountSupportConfig', T_hr.staff);
    ok(r);
    expect('config' in r.body, 'missing config key for hr_staff');
  });

  await test('employee (no employees.access.view) denied getAccountSupportConfig — 403', async () => {
    const r = await api('getAccountSupportConfig', T.b);
    expect(r.status === 403 || !r.body.success,
      `employee should be denied getAccountSupportConfig (got ${r.status})`);
  });

  await test('user c (base employee) denied getAccountSupportConfig — 403', async () => {
    const r = await api('getAccountSupportConfig', T.c);
    expect(r.status === 403 || !r.body.success,
      `user c should be denied (got ${r.status})`);
  });

  await test('admin can update to shared ownership model', async () => {
    const r = await api('updateAccountSupportConfig', T.admin, {
      ownershipModel: 'shared', notes: `${TAG} shared model`,
    });
    ok(r);
  });

  await test('updateAccountSupportConfig dedicated_team without assignedUserId → 400', async () => {
    const r = await api('updateAccountSupportConfig', T.admin, { ownershipModel: 'dedicated_team' });
    expect(!r.body.success, 'should require assignedUserId for dedicated_team');
  });

  await test('SIDE-EFFECT: updateAccountSupportConfig wrote app_events + audit_logs', async () => {
    const { data: evts } = await sb.from('app_events').select('id')
      .eq('event_type', 'account_support.config_updated').eq('source_entity_id', 'account_support_config')
      .order('created_at', { ascending: false }).limit(1);
    expect(evts && evts.length >= 1, 'app_events missing for account_support.config_updated');
    const { data: logs } = await sb.from('audit_logs').select('id')
      .eq('action', 'account_support.config_updated').eq('record_id', 'account_support_config').limit(1);
    expect(logs && logs.length >= 1, 'audit_logs missing for account_support.config_updated');
  });

  await test('employee denied updateAccountSupportConfig (no tickets.manage) — 403', async () => {
    const r = await api('updateAccountSupportConfig', T.b, { ownershipModel: 'hr_managed' });
    expect(r.status === 403 || !r.body.success,
      `employee should be denied (got ${r.status})`);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 8 — Ownership-model dispatch paths
  //   hr_managed   → routes to hr module (handoff target_module === 'hr')
  //   shared       → routes to hr module (primary intake; ownership context in payload)
  //   dedicated_team → routes to hr module; handoff payload carries assignedUserId
  //   external_admin → fails closed BEFORE any DB write; no ticket created
  // ─────────────────────────────────────────────────────────────────────────────
  h.section('Service Requests › Ownership-model dispatch');

  // Section 7 (Config) leaves the config at 'shared'. Restore hr_managed explicitly
  // so each ownership-model test starts from a known baseline.
  await test('pre-dispatch: restore config to hr_managed', async () => {
    const r = await api('updateAccountSupportConfig', T.admin, {
      ownershipModel: 'hr_managed', notes: `${TAG} dispatch-section baseline`,
    });
    ok(r);
  });

  await test('hr_managed: createAccountSupportRequest routes handoff to hr', async () => {
    // Config restored to hr_managed by the pre-dispatch test above.
    const r = await api('createAccountSupportRequest', T.admin, {
      subjectId: b.id, serviceDomain: 'account_access',
      requestedAction: 'Verify access',
      subject: `${TAG} hr_managed dispatch`, body: 'Ownership: hr_managed.',
    });
    ok(r);
    ctx.accountSupportTicketIds.push(r.body.id);
    ctx.accountSupportTicketNumbers.push(r.body.ticketNumber);
    const { data: ho } = await sb.from('handoff_outbox')
      .select('target_module, payload').eq('source_entity_id', r.body.ticketNumber).limit(1);
    expect(ho && ho.length >= 1, 'hr_managed: handoff_outbox row missing');
    expect(ho[0].target_module === 'hr', `hr_managed: wrong target_module: ${ho[0].target_module}`);
    expect(ho[0].payload?.ownershipModel === 'hr_managed',
      `hr_managed: payload.ownershipModel wrong: ${ho[0].payload?.ownershipModel}`);
  });

  await test('shared: createAccountSupportRequest routes handoff to hr (primary intake)', async () => {
    const cfg = await api('updateAccountSupportConfig', T.admin, {
      ownershipModel: 'shared', notes: `${TAG} shared dispatch test`,
    });
    ok(cfg);
    const r = await api('createAccountSupportRequest', T.admin, {
      subjectId: b.id, serviceDomain: 'general',
      requestedAction: 'General inquiry',
      subject: `${TAG} shared dispatch`, body: 'Ownership: shared.',
    });
    ok(r);
    ctx.accountSupportTicketIds.push(r.body.id);
    ctx.accountSupportTicketNumbers.push(r.body.ticketNumber);
    const { data: ho } = await sb.from('handoff_outbox')
      .select('target_module, payload').eq('source_entity_id', r.body.ticketNumber).limit(1);
    expect(ho && ho.length >= 1, 'shared: handoff_outbox row missing');
    expect(ho[0].target_module === 'hr', `shared: wrong target_module: ${ho[0].target_module}`);
    expect(ho[0].payload?.ownershipModel === 'shared',
      `shared: payload.ownershipModel wrong: ${ho[0].payload?.ownershipModel}`);
  });

  await test('dedicated_team: createAccountSupportRequest routes handoff to hr with assignedUserId', async () => {
    // Use admin as the dedicated assignee (active user).
    const cfg = await api('updateAccountSupportConfig', T.admin, {
      ownershipModel: 'dedicated_team', assignedUserId: admin.id,
      notes: `${TAG} dedicated_team dispatch test`,
    });
    ok(cfg);
    const r = await api('createAccountSupportRequest', T.admin, {
      subjectId: b.id, serviceDomain: 'password_reset',
      requestedAction: 'Reset via dedicated team',
      subject: `${TAG} dedicated_team dispatch`, body: 'Ownership: dedicated_team.',
    });
    ok(r);
    expect(r.body.assignedTo === admin.id,
      `dedicated_team: assignedTo should be admin.id, got: ${r.body.assignedTo}`);
    ctx.accountSupportTicketIds.push(r.body.id);
    ctx.accountSupportTicketNumbers.push(r.body.ticketNumber);
    const { data: ho } = await sb.from('handoff_outbox')
      .select('target_module, payload').eq('source_entity_id', r.body.ticketNumber).limit(1);
    expect(ho && ho.length >= 1, 'dedicated_team: handoff_outbox row missing');
    expect(ho[0].target_module === 'hr', `dedicated_team: wrong target_module: ${ho[0].target_module}`);
    expect(ho[0].payload?.ownershipModel === 'dedicated_team',
      `dedicated_team: payload.ownershipModel wrong: ${ho[0].payload?.ownershipModel}`);
    expect(ho[0].payload?.assignedUserId === admin.id,
      `dedicated_team: payload.assignedUserId wrong: ${ho[0].payload?.assignedUserId}`);
  });

  await test('external_admin: createAccountSupportRequest fails closed — no ticket created', async () => {
    // external_admin has no registered module receiver; _resolveAccountSupportAssignee returns ok:false.
    // The config upsert requires assignedUserId for external_admin.
    const cfg = await api('updateAccountSupportConfig', T.admin, {
      ownershipModel: 'external_admin', assignedUserId: admin.id,
      notes: `${TAG} external_admin dispatch test`,
    });
    ok(cfg);

    // Count existing tickets before the attempt
    const { count: before } = await sb.from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('category', 'account_support').eq('from_user_id', admin.id);

    const r = await api('createAccountSupportRequest', T.admin, {
      subjectId: b.id, serviceDomain: 'account_access',
      requestedAction: 'This should fail',
      subject: `${TAG} external_admin fail-closed`, body: 'Should fail before any write.',
    });
    expect(!r.body.success, `external_admin: expected failure, got success`);
    expect(r.status === 422, `external_admin: expected 422, got ${r.status}`);
    expect(
      (r.body.message || '').includes('external_admin') ||
      (r.body.message || '').includes('no registered automated dispatch'),
      `external_admin: missing descriptive error message: ${r.body.message}`,
    );

    // Verify no ticket was created (fail-closed: the check is BEFORE any DB write)
    const { count: after } = await sb.from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('category', 'account_support').eq('from_user_id', admin.id);
    expect(after === before,
      `external_admin: ticket was created despite fail-closed check (before=${before}, after=${after})`);
  });

  await test('external_admin: requestAccountAssistance also fails closed — 422 before write', async () => {
    // Config is still external_admin from previous test.
    const { count: before } = await sb.from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('category', 'account_support').eq('from_user_id', admin.id);

    const r = await api('requestAccountAssistance', T_stepup.admin, {
      subjectId: b.id, reason: `${TAG} external_admin fail-closed via requestAccountAssistance`,
    });
    expect(!r.body.success, `external_admin via requestAccountAssistance: expected failure, got success`);
    expect(r.status === 422, `expected 422, got ${r.status}`);

    const { count: after } = await sb.from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('category', 'account_support').eq('from_user_id', admin.id);
    expect(after === before,
      `external_admin via requestAccountAssistance: ticket was created despite fail-closed (before=${before}, after=${after})`);
  });

  // Restore hr_managed so other suites that run after this one can route requests.
  await test('suite teardown: restore config to hr_managed', async () => {
    const r = await api('updateAccountSupportConfig', T.admin, {
      ownershipModel: 'hr_managed', notes: `${TAG} restored`,
    });
    ok(r);
  });
}
