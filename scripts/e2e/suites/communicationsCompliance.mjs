/**
 * Messenger Compliance V1 live E2E suite.
 *
 * Covers the case-based compliance surface:
 *   - fail-closed dated compliance_read / compliance_export permissions
 *   - maker-checker permission grants and case approval
 *   - metadata-only discovery and case/read-model responses
 *   - scoped, audited message reads without ordinary Messenger access
 *   - idempotent retries and divergent-payload conflicts
 *   - immutable access evidence, app_events, and audit_logs
 *   - real JSON/PDF exports, private signed downloads, and SHA-256 integrity
 *   - grant revocation, case closure, and expiry denial
 *
 * Disposable-database requirement:
 * message_compliance_access_events and completed message_compliance_exports are
 * intentionally immutable. This suite therefore refuses to run unless the
 * operator explicitly marks the target as disposable and resets it with
 * database-owner tooling after each run. Production immutability is never
 * weakened for test cleanup.
 */

import { createHash, randomUUID } from 'node:crypto';

export const title = 'Messenger Compliance V1 (Cases, Scoped Read, Evidence, Exports)';

const CASE_DETAIL_KEYS = [
  'approvedAt', 'approvedBy', 'capabilities', 'caseNo', 'caseType', 'closeReason',
  'closedAt', 'closedBy', 'conversationCount', 'decisionReason', 'grants', 'id',
  'lastActivityAt', 'reason', 'rejectedAt', 'rejectedBy', 'requestedAt',
  'requestedBy', 'status', 'threads', 'title', 'validFrom', 'validUntil',
];

const CASE_SUMMARY_KEYS = [
  'approvedAt', 'approvedBy', 'capabilities', 'caseNo', 'caseType',
  'conversationCount', 'id', 'lastActivityAt', 'requestedAt', 'requestedBy',
  'status', 'title', 'validFrom', 'validUntil',
];

const CAPABILITY_KEYS = [
  'canApproveCase', 'canExport', 'canReadConversation', 'canRequestCase',
  'canRevokeGrant', 'canViewAccessLog',
];

const GRANT_KEYS = [
  'capabilities', 'caseId', 'caseThreadId', 'expiresAt', 'grantedAt', 'grantedBy',
  'id', 'lastAccessedAt', 'revokeReason', 'revokedAt', 'revokedBy', 'status',
  'threadId', 'user',
];

const EXPORT_KEYS = [
  'capabilities', 'caseId', 'caseNo', 'exportNo', 'failureCode', 'fileSize',
  'format', 'generatedAt', 'grantId', 'id', 'messageCount', 'purpose', 'rangeFrom',
  'rangeTo', 'requestedAt', 'requestedBy', 'serializerVersion', 'sha256', 'status',
  'threadId', 'threadSubject',
];

const MESSAGE_KEYS = [
  'attachments', 'author', 'body', 'createdAt', 'deletedAt', 'editedAt', 'id',
  'isSystem', 'sequence',
];

function sortedKeys(value) {
  return Object.keys(value ?? {}).sort();
}

function exactKeys(expect, value, keys, label) {
  expect(
    JSON.stringify(sortedKeys(value)) === JSON.stringify([...keys].sort()),
    `${label} keys mismatch: ${JSON.stringify(sortedKeys(value))}`,
  );
}

function assertNoMessagePayload(expect, value, label, path = label) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoMessagePayload(expect, item, label, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    expect(key !== 'body', `${label} leaked a message body at ${path}.${key}`);
    expect(key !== 'messages', `${label} leaked a messages collection at ${path}.${key}`);
    assertNoMessagePayload(expect, nested, label, `${path}.${key}`);
  }
}

function expectStatus(expect, response, status, label) {
  expect(
    response.status === status,
    `${label}: expected HTTP ${status}, got ${response.status} ${JSON.stringify(response.body)}`,
  );
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function rows(sb, table, build, label) {
  const { data, error } = await build(sb.from(table).select('id'));
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

async function countRows(sb, table, build, label) {
  return (await rows(sb, table, build, label)).length;
}

async function fetchArtifact(signedUrl, supabaseUrl) {
  const url = new URL(signedUrl, supabaseUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`signed artifact download failed: ${response.status} ${await response.text()}`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? '',
    url,
  };
}

export default async function run(h) {
  if (process.env.E2E_DISPOSABLE_DB !== '1') {
    throw new Error(
      'communicationsCompliance requires E2E_DISPOSABLE_DB=1 and a database-owner reset after each run.',
    );
  }

  const { api, test, expect, ok, fails, mint, mintStepUp, sb, TAG } = h;
  const { admin: threadOwner, b: participant, c: plainEmployee } = h.users;
  const ownerToken = mint(threadOwner);
  const participantToken = mint(participant);
  const plainToken = mint(plainEmployee);

  const {
    actors: [grantMaker, checker, investigator],
    createdIds: complianceActorIds,
  } = await h.acquireActors(
    'superadmin',
    3,
    {},
    {},
    { forceSynthetic: true },
  );
  const makerToken = mint(grantMaker);
  const checkerToken = mint(checker);
  const investigatorToken = mint(investigator);
  const checkerStepUp = mintStepUp(checker);
  const investigatorStepUp = mintStepUp(investigator);

  const state = {
    threadId: null,
    postIds: [],
    messageBodies: [
      `${TAG} confidential payroll exception alpha`,
      `${TAG} investigation response beta`,
      `${TAG} final evidence note gamma`,
    ],
    permissionApprovalIds: [],
    caseId: null,
    caseNo: null,
    grantId: null,
    firstRead: null,
    jsonExport: null,
    pdfExport: null,
    expiryCaseId: null,
  };

  // The operator-owned disposable-database reset is the cleanup mechanism.
  // Service-role cleanup cannot and must not bypass immutable evidence.
  h.onCleanup(async () => {
    console.warn(
      `\n[communicationsCompliance] disposable DB reset required for ${TAG}; `
      + `actors=${complianceActorIds.join(',')} thread=${state.threadId ?? 'not-created'} `
      + '(database-owner reset only).',
    );
  });

  async function requestDatedPermission(target, permission, reason) {
    const validFrom = new Date(Date.now() - 60_000).toISOString();
    const validUntil = new Date(Date.now() + 45 * 60_000).toISOString();
    const response = await api('superadmin/setUserPermission', makerToken, {
      userId: target.id,
      permission,
      granted: true,
      reason,
      validFrom,
      validUntil,
    });
    ok(response, `request ${permission} failed`);
    expect(response.body.pending === true, `${permission} did not enter maker-checker`);
    expect(response.body.approvalId, `${permission} approvalId missing`);
    state.permissionApprovalIds.push(response.body.approvalId);
    return {
      approvalId: response.body.approvalId,
      validFrom,
      validUntil,
    };
  }

  async function approveDatedPermission(approvalId) {
    const response = await api('admin/approvals/approve', checkerStepUp, { approvalId });
    ok(response, `approve permission ${approvalId} failed`);
  }

  async function assertEvidenceTriplet({
    caseId,
    eventType,
    requestId,
    requestIdPrefix,
    entityId,
    expected = 1,
  }) {
    const fullType = `communications.compliance.${eventType}`;
    const accessRows = await rows(
      sb,
      'message_compliance_access_events',
      query => {
        let scoped = query.eq('case_id', caseId).eq('event_type', eventType);
        if (requestIdPrefix) scoped = scoped.like('request_id', `${requestIdPrefix}%`);
        else scoped = scoped.eq('request_id', requestId);
        return scoped;
      },
      `${eventType} access evidence`,
    );
    const [accessCount, eventCount, auditCount] = await Promise.all([
      Promise.resolve(accessRows.length),
      countRows(
        sb,
        'app_events',
        query => query.eq('event_type', fullType).eq('source_entity_id', entityId),
        `${eventType} app_event`,
      ),
      countRows(
        sb,
        'audit_logs',
        query => query.eq('action', fullType).eq('record_id', entityId),
        `${eventType} audit`,
      ),
    ]);
    expect(accessCount === expected, `${eventType}: access evidence=${accessCount}, expected ${expected}`);
    expect(eventCount === expected, `${eventType}: app_events=${eventCount}, expected ${expected}`);
    expect(auditCount === expected, `${eventType}: audit_logs=${auditCount}, expected ${expected}`);
  }

  function requestId(actorId, operation, key) {
    return `${actorId}|compliance.${operation}|${key}`;
  }

  h.section('Compliance V1 - Setup and Fail-Closed Permissions');

  await test('creates a tagged three-message conversation through the real HTTP API', async () => {
    const create = await api('communications/messages/createThread', ownerToken, {
      threadType: 'group',
      subject: `${TAG} compliance evidence conversation`,
      participantUserIds: [participant.id],
      body: state.messageBodies[0],
      idempotencyKey: randomUUID(),
    });
    ok(create, 'create compliance source thread failed');
    expect(create.body.threadId && create.body.postId, 'thread/post identity missing');
    state.threadId = create.body.threadId;
    state.postIds.push(create.body.postId);

    const second = await api('communications/messages/post', participantToken, {
      threadId: state.threadId,
      body: state.messageBodies[1],
      clientIdempotencyKey: randomUUID(),
    });
    ok(second, 'second source message failed');
    state.postIds.push(second.body.postId);

    const third = await api('communications/messages/post', ownerToken, {
      threadId: state.threadId,
      body: state.messageBodies[2],
      clientIdempotencyKey: randomUUID(),
    });
    ok(third, 'third source message failed');
    state.postIds.push(third.body.postId);
    expect(new Set(state.postIds).size === 3, 'source messages were not distinct');
  });

  await test('unauthenticated and ordinary employees are denied compliance APIs', async () => {
    const noAuth = await api('communications/compliance/cases/list', null, {});
    expectStatus(expect, noAuth, 401, 'unauthenticated cases/list');
    const plain = await api('communications/compliance/conversations/search', plainToken, {
      search: TAG,
    });
    expectStatus(expect, plain, 403, 'plain employee search');
  });

  await test('superadmin is fail-closed without an explicit dated compliance_read grant', async () => {
    const response = await api('communications/compliance/cases/list', investigatorToken, {});
    fails(response, 'ungated superadmin unexpectedly read compliance cases');
    expectStatus(expect, response, 403, 'ungranted superadmin');
  });

  let investigatorReadApproval;
  await test('maker requests a dated per-user compliance_read grant', async () => {
    investigatorReadApproval = await requestDatedPermission(
      investigator,
      'communications.compliance_read',
      `${TAG} investigator read authority`,
    );
    const { data, error } = await sb.from('permission_grant_approvals')
      .select('status, requested_by, target_user_id, permission_key, grant_valid_from, grant_valid_until')
      .eq('id', investigatorReadApproval.approvalId)
      .maybeSingle();
    expect(!error && data, `permission approval row missing: ${error?.message ?? ''}`);
    expect(data.status === 'pending', `permission approval status=${data.status}`);
    expect(data.requested_by === grantMaker.id, 'permission maker mismatch');
    expect(data.target_user_id === investigator.id, 'permission target mismatch');
    expect(data.permission_key === 'communications.compliance_read', 'permission key mismatch');
    expect(
      Date.parse(data.grant_valid_from) === Date.parse(investigatorReadApproval.validFrom),
      'grant validFrom drifted',
    );
    expect(
      Date.parse(data.grant_valid_until) === Date.parse(investigatorReadApproval.validUntil),
      'grant validUntil drifted',
    );
  });

  await test('permission maker cannot approve their own grant request', async () => {
    const response = await api(
      'admin/approvals/approve',
      mintStepUp(grantMaker),
      { approvalId: investigatorReadApproval.approvalId },
    );
    expectStatus(expect, response, 403, 'permission self-approval');
    expect(response.body.code === 'self_approval', `unexpected code ${response.body.code}`);
  });

  await test('independent checker approves investigator compliance_read', async () => {
    await approveDatedPermission(investigatorReadApproval.approvalId);
    const { data, error } = await sb.from('user_permissions')
      .select('granted, valid_from, valid_until, approved_by, revoked_at')
      .eq('user_id', investigator.id)
      .eq('permission', 'communications.compliance_read')
      .maybeSingle();
    expect(!error && data, `dated read permission missing: ${error?.message ?? ''}`);
    expect(data.granted === true, 'compliance_read is not allowed');
    expect(data.approved_by === checker.id, 'compliance_read checker mismatch');
    expect(data.revoked_at === null, 'new compliance_read grant is revoked');
    expect(Date.parse(data.valid_from) <= Date.now(), 'compliance_read is not active yet');
    expect(Date.parse(data.valid_until) > Date.now(), 'compliance_read already expired');
  });

  await test('independent checker approves investigator compliance_export', async () => {
    const grant = await requestDatedPermission(
      investigator,
      'communications.compliance_export',
      `${TAG} investigator export authority`,
    );
    await approveDatedPermission(grant.approvalId);
    const { data, error } = await sb.from('user_permissions')
      .select('granted, approved_by, valid_until')
      .eq('user_id', investigator.id)
      .eq('permission', 'communications.compliance_export')
      .maybeSingle();
    expect(!error && data?.granted === true, `dated export permission missing: ${error?.message ?? ''}`);
    expect(data.approved_by === checker.id, 'compliance_export checker mismatch');
    expect(Date.parse(data.valid_until) > Date.now(), 'compliance_export already expired');
  });

  await test('independent checker receives their own dated compliance_read authority', async () => {
    const grant = await requestDatedPermission(
      checker,
      'communications.compliance_read',
      `${TAG} independent case decision authority`,
    );
    await approveDatedPermission(grant.approvalId);
    const allowed = await api('communications/compliance/cases/list', checkerToken, { limit: 1 });
    ok(allowed, 'checker compliance_read did not become active');
  });

  h.section('Compliance V1 - Metadata Discovery and Case Request');

  await test('conversation search is metadata-only and returns the tagged thread', async () => {
    const response = await api(
      'communications/compliance/conversations/search',
      investigatorToken,
      { search: TAG, participantUserId: participant.id, limit: 10 },
    );
    ok(response, 'metadata conversation search failed');
    exactKeys(expect, response.body.data, ['items', 'nextCursor'], 'search response');
    const item = response.body.data.items.find(value => value.threadId === state.threadId);
    expect(item, 'tagged source conversation missing from compliance search');
    exactKeys(expect, item, [
      'createdAt', 'sourceEntityId', 'sourceEntityType', 'sourceModule', 'subject',
      'threadId', 'threadType',
    ], 'search item');
    assertNoMessagePayload(expect, response.body.data, 'conversation search');
    expect(JSON.stringify(response.body.data).includes(state.messageBodies[0]) === false,
      'conversation search leaked source text');
  });

  const caseKey = randomUUID();
  const casePayload = {
    title: `${TAG} payroll access investigation`,
    caseType: 'security_investigation',
    reason: `${TAG} formally investigate access to a payroll conversation.`,
    validUntil: new Date(Date.now() + 20 * 60_000).toISOString(),
    threads: [{
      threadId: null,
      relevanceNote: `${TAG} selected because it contains the approved evidence scope.`,
    }],
    idempotencyKey: caseKey,
  };

  await test('requesting a case creates a pending metadata-only case', async () => {
    casePayload.threads[0].threadId = state.threadId;
    const response = await api(
      'communications/compliance/cases/request',
      investigatorToken,
      casePayload,
    );
    ok(response, 'case request failed');
    exactKeys(expect, response.body.data, CASE_DETAIL_KEYS, 'case detail');
    exactKeys(expect, response.body.data.capabilities, CAPABILITY_KEYS, 'case capabilities');
    assertNoMessagePayload(expect, response.body.data, 'case request response');
    expect(response.body.data.status === 'pending_approval', 'case did not enter pending approval');
    expect(response.body.data.requestedBy.id === investigator.id, 'case requester mismatch');
    expect(response.body.data.threads.length === 1, 'case thread scope mismatch');
    expect(response.body.data.grants.length === 0, 'pending case created access grants');
    state.caseId = response.body.data.id;
    state.caseNo = response.body.data.caseNo;
  });

  await test('same-key same-payload case retry returns the original case and writes nothing new', async () => {
    const response = await api(
      'communications/compliance/cases/request',
      investigatorToken,
      casePayload,
    );
    ok(response, 'case retry failed');
    expect(response.body.data.id === state.caseId, 'case retry created a new case');
    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'case_requested',
      requestId: requestId(investigator.id, 'case_request', caseKey),
      entityId: state.caseId,
    });
  });

  await test('same case key with a divergent payload is rejected with 409', async () => {
    const response = await api(
      'communications/compliance/cases/request',
      investigatorToken,
      { ...casePayload, title: `${casePayload.title} changed` },
    );
    expectStatus(expect, response, 409, 'divergent case retry');
  });

  await test('case list/get shapes are metadata-only', async () => {
    const list = await api('communications/compliance/cases/list', investigatorToken, {
      status: 'pending_approval',
      search: state.caseNo,
      limit: 10,
    });
    ok(list, 'cases/list failed');
    exactKeys(expect, list.body.data, ['capabilities', 'items', 'nextCursor'], 'cases list');
    const item = list.body.data.items.find(value => value.id === state.caseId);
    expect(item, 'requested case absent from list');
    exactKeys(expect, item, CASE_SUMMARY_KEYS, 'case summary');
    assertNoMessagePayload(expect, list.body.data, 'cases/list');

    const detail = await api('communications/compliance/cases/get', investigatorToken, {
      caseId: state.caseId,
    });
    ok(detail, 'cases/get failed');
    exactKeys(expect, detail.body.data, CASE_DETAIL_KEYS, 'cases/get detail');
    assertNoMessagePayload(expect, detail.body.data, 'cases/get');
  });

  await test('message read is denied before independent case approval', async () => {
    const response = await api(
      'communications/compliance/conversations/read',
      investigatorToken,
      {
        caseId: state.caseId,
        threadId: state.threadId,
        limit: 2,
        idempotencyKey: randomUUID(),
      },
    );
    expectStatus(expect, response, 403, 'pre-approval compliance read');
  });

  h.section('Compliance V1 - Maker-Checker Case Approval');

  const decisionKey = randomUUID();
  const decisionPayload = {
    caseId: null,
    decision: 'approve',
    reason: `${TAG} scope and duration independently verified.`,
    idempotencyKey: decisionKey,
  };

  await test('case requester cannot approve their own case', async () => {
    decisionPayload.caseId = state.caseId;
    const response = await api(
      'communications/compliance/cases/decide',
      investigatorStepUp,
      decisionPayload,
    );
    expectStatus(expect, response, 403, 'case self-approval');
  });

  await test('independent checker cannot decide a case without fresh step-up', async () => {
    const response = await api(
      'communications/compliance/cases/decide',
      checkerToken,
      decisionPayload,
    );
    expectStatus(expect, response, 403, 'case decision without step-up');
  });

  await test('independent checker approves and creates one scoped grant', async () => {
    const response = await api(
      'communications/compliance/cases/decide',
      checkerStepUp,
      decisionPayload,
    );
    ok(response, 'independent case approval failed');
    exactKeys(expect, response.body.data, CASE_DETAIL_KEYS, 'approved case detail');
    assertNoMessagePayload(expect, response.body.data, 'case decision response');
    expect(response.body.data.status === 'approved', 'case was not approved');
    expect(response.body.data.approvedBy.id === checker.id, 'case checker mismatch');
    expect(response.body.data.grants.length === 1, 'approval did not create one scoped grant');
    const grant = response.body.data.grants[0];
    exactKeys(expect, grant, GRANT_KEYS, 'compliance grant');
    expect(grant.user.id === investigator.id, 'grant was not issued to requester');
    expect(grant.threadId === state.threadId, 'grant scope does not match selected thread');
    expect(grant.status === 'active', 'approved grant is not active');
    state.grantId = grant.id;
  });

  await test('case decision retry is idempotent and divergent reuse is 409', async () => {
    const retry = await api(
      'communications/compliance/cases/decide',
      checkerStepUp,
      decisionPayload,
    );
    ok(retry, 'case decision retry failed');
    expect(retry.body.data.id === state.caseId, 'case decision retry changed identity');
    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'case_approved',
      requestId: requestId(checker.id, 'case_decide', decisionKey),
      entityId: state.caseId,
    });

    const divergent = await api(
      'communications/compliance/cases/decide',
      checkerStepUp,
      { ...decisionPayload, reason: `${decisionPayload.reason} changed` },
    );
    expectStatus(expect, divergent, 409, 'divergent decision retry');
  });

  h.section('Compliance V1 - Scoped Read and Messenger Isolation');

  await test('ordinary Messenger thread and posts remain denied despite scoped compliance grant', async () => {
    const detail = await api('communications/messages/thread', investigatorToken, {
      threadId: state.threadId,
    });
    expectStatus(expect, detail, 403, 'ordinary thread detail');
    const posts = await api('communications/messages/posts', investigatorToken, {
      threadId: state.threadId,
      limit: 100,
    });
    expectStatus(expect, posts, 403, 'ordinary posts');
  });

  const firstReadKey = randomUUID();
  const firstReadPayload = {
    caseId: null,
    threadId: null,
    limit: 2,
    cursor: null,
    idempotencyKey: firstReadKey,
  };

  await test('approved scoped read returns only the first exact message page', async () => {
    firstReadPayload.caseId = state.caseId;
    firstReadPayload.threadId = state.threadId;
    const response = await api(
      'communications/compliance/conversations/read',
      investigatorToken,
      firstReadPayload,
    );
    ok(response, 'scoped conversation read failed');
    exactKeys(expect, response.body.data, [
      'capabilities', 'case', 'grant', 'messages', 'nextCursor', 'thread',
    ], 'message page');
    expect(response.body.data.case.id === state.caseId, 'message page case mismatch');
    expect(response.body.data.grant.id === state.grantId, 'message page grant mismatch');
    expect(response.body.data.thread.threadId === state.threadId, 'message page thread mismatch');
    expect(response.body.data.messages.length === 2, 'first page size mismatch');
    response.body.data.messages.forEach((message, index) =>
      exactKeys(expect, message, MESSAGE_KEYS, `message[${index}]`));
    expect(response.body.data.nextCursor, 'first page did not return a cursor');
    state.firstRead = response.body.data;
  });

  await test('same-key read retry returns the same page and records each disclosure', async () => {
    const retry = await api(
      'communications/compliance/conversations/read',
      investigatorToken,
      firstReadPayload,
    );
    ok(retry, 'scoped read retry failed');
    expect(
      JSON.stringify(retry.body.data.messages) === JSON.stringify(state.firstRead.messages),
      'scoped read retry changed message content',
    );
    expect(retry.body.data.nextCursor === state.firstRead.nextCursor, 'read retry changed cursor');
    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'conversation_opened',
      requestIdPrefix: `${requestId(investigator.id, 'thread_read', firstReadKey)}|delivery|`,
      entityId: state.threadId,
      expected: 2,
    });
  });

  await test('same read key with a divergent limit is rejected with 409', async () => {
    const response = await api(
      'communications/compliance/conversations/read',
      investigatorToken,
      { ...firstReadPayload, limit: 3 },
    );
    expectStatus(expect, response, 409, 'divergent read retry');
  });

  const nextReadKey = randomUUID();
  await test('next scoped page completes the exact body set and records page_read', async () => {
    const response = await api(
      'communications/compliance/conversations/read',
      investigatorToken,
      {
        caseId: state.caseId,
        threadId: state.threadId,
        limit: 2,
        cursor: state.firstRead.nextCursor,
        idempotencyKey: nextReadKey,
      },
    );
    ok(response, 'second scoped page failed');
    expect(response.body.data.messages.length === 1, 'second page size mismatch');
    expect(response.body.data.nextCursor === null, 'second page unexpectedly has a cursor');
    const actualBodies = [
      ...state.firstRead.messages.map(message => message.body),
      ...response.body.data.messages.map(message => message.body),
    ].sort();
    expect(
      JSON.stringify(actualBodies) === JSON.stringify([...state.messageBodies].sort()),
      `scoped read body mismatch: ${JSON.stringify(actualBodies)}`,
    );
    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'page_read',
      requestIdPrefix: `${requestId(investigator.id, 'thread_read', nextReadKey)}|delivery|`,
      entityId: state.threadId,
    });
  });

  await test('access log is metadata-only and exposes the expected response shape', async () => {
    const response = await api(
      'communications/compliance/access-events/list',
      investigatorToken,
      { caseId: state.caseId, limit: 100 },
    );
    ok(response, 'access-events/list failed');
    exactKeys(expect, response.body.data, ['items', 'nextCursor'], 'access log response');
    expect(response.body.data.items.length >= 4, 'access log is missing lifecycle evidence');
    const opened = response.body.data.items.find(value =>
      value.eventType === 'conversation_opened' && value.actor.id === investigator.id);
    expect(opened, 'conversation_opened evidence missing from API');
    exactKeys(expect, opened, [
      'actor', 'caseId', 'caseNo', 'details', 'eventType', 'grantId', 'id',
      'occurredAt', 'requestId', 'threadId', 'threadSubject',
    ], 'access event');
    assertNoMessagePayload(expect, response.body.data, 'access-events/list');
  });

  await test('access evidence rejects service-role UPDATE and DELETE', async () => {
    const { data: event, error: loadError } = await sb
      .from('message_compliance_access_events')
      .select('id')
      .eq('case_id', state.caseId)
      .limit(1)
      .maybeSingle();
    expect(!loadError && event, `access event missing: ${loadError?.message ?? ''}`);
    const update = await sb.from('message_compliance_access_events')
      .update({ details: { tampered: true } })
      .eq('id', event.id);
    expect(update.error, 'immutable access event UPDATE unexpectedly succeeded');
    const deletion = await sb.from('message_compliance_access_events')
      .delete()
      .eq('id', event.id);
    expect(deletion.error, 'immutable access event DELETE unexpectedly succeeded');
  });

  h.section('Compliance V1 - Real JSON and PDF Exports');

  const jsonExportKey = randomUUID();
  const jsonExportPayload = {
    caseId: null,
    threadId: null,
    format: 'json',
    purpose: `${TAG} preserve the approved investigation evidence.`,
    acknowledgement: true,
    idempotencyKey: jsonExportKey,
  };

  await test('export creation is denied without fresh step-up', async () => {
    jsonExportPayload.caseId = state.caseId;
    jsonExportPayload.threadId = state.threadId;
    const response = await api(
      'communications/compliance/exports/create',
      investigatorToken,
      jsonExportPayload,
    );
    expectStatus(expect, response, 403, 'export without step-up');
  });

  await test('export requires explicit compliance_export authority', async () => {
    const response = await api(
      'communications/compliance/exports/create',
      checkerStepUp,
      {
        caseId: state.caseId,
        threadId: state.threadId,
        format: 'json',
        purpose: `${TAG} checker has no scoped export grant.`,
        acknowledgement: true,
        idempotencyKey: randomUUID(),
      },
    );
    expectStatus(expect, response, 403, 'unscoped export');
  });

  await test('creates and finalizes a real JSON export with metadata-only response', async () => {
    const response = await api(
      'communications/compliance/exports/create',
      investigatorStepUp,
      jsonExportPayload,
    );
    ok(response, 'JSON export creation failed');
    exactKeys(expect, response.body.data, EXPORT_KEYS, 'JSON export');
    assertNoMessagePayload(expect, response.body.data, 'JSON export response');
    expect(response.body.data.status === 'ready', 'JSON export is not ready');
    expect(response.body.data.format === 'json', 'JSON export format mismatch');
    expect(response.body.data.messageCount === state.messageBodies.length, 'JSON message count mismatch');
    expect(/^[0-9a-f]{64}$/.test(response.body.data.sha256), 'JSON SHA-256 missing/invalid');
    expect(response.body.data.serializerVersion === 'messaging-compliance-v1',
      'JSON serializer version mismatch');
    state.jsonExport = response.body.data;
  });

  await test('JSON export retry is idempotent and divergent purpose is 409', async () => {
    const retry = await api(
      'communications/compliance/exports/create',
      investigatorStepUp,
      jsonExportPayload,
    );
    ok(retry, 'JSON export retry failed');
    expect(retry.body.data.id === state.jsonExport.id, 'JSON export retry created another export');

    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'export_requested',
      requestId: requestId(investigator.id, 'export_request', jsonExportKey),
      entityId: state.jsonExport.id,
    });
    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'export_generated',
      requestId: requestId(investigator.id, 'export_finalize', `${jsonExportKey}:finalize`),
      entityId: state.jsonExport.id,
    });

    const divergent = await api(
      'communications/compliance/exports/create',
      investigatorStepUp,
      { ...jsonExportPayload, purpose: `${jsonExportPayload.purpose} changed` },
    );
    expectStatus(expect, divergent, 409, 'divergent JSON export retry');
  });

  const jsonDownloadKey = randomUUID();
  await test('export download requires a current step-up token', async () => {
    const response = await api(
      'communications/compliance/exports/download',
      investigatorToken,
      { exportId: state.jsonExport.id, idempotencyKey: randomUUID() },
    );
    expectStatus(expect, response, 403, 'download without step-up');
  });

  await test('downloads JSON through a five-minute private signed URL and verifies checksum/body set', async () => {
    const response = await api(
      'communications/compliance/exports/download',
      investigatorStepUp,
      { exportId: state.jsonExport.id, idempotencyKey: jsonDownloadKey },
    );
    ok(response, 'JSON export download authorization failed');
    exactKeys(expect, response.body.data, ['expiresInSeconds', 'export', 'signedUrl'], 'download response');
    expect(response.body.data.expiresInSeconds === 300, 'signed URL lifetime is not 300 seconds');
    expect(response.body.data.export.id === state.jsonExport.id, 'download export identity mismatch');
    expect(response.body.data.signedUrl.includes('message-compliance-exports'),
      'signed URL does not target the private compliance bucket');
    const artifact = await fetchArtifact(response.body.data.signedUrl, h.env.SUPABASE_URL);
    expect(artifact.url.searchParams.has('token'), 'download URL is not signed');
    expect(artifact.contentType.includes('application/json'), `JSON content-type=${artifact.contentType}`);
    expect(sha256(artifact.bytes) === state.jsonExport.sha256, 'JSON download checksum mismatch');
    expect(artifact.bytes.length === state.jsonExport.fileSize, 'JSON fileSize mismatch');
    const parsed = JSON.parse(artifact.bytes.toString('utf8'));
    expect(parsed.schemaVersion === 'messenger-compliance-v1', 'JSON schemaVersion mismatch');
    expect(parsed.messageCount === state.messageBodies.length, 'JSON artifact messageCount mismatch');
    expect(
      JSON.stringify(parsed.messages.map(message => message.body).sort())
        === JSON.stringify([...state.messageBodies].sort()),
      'JSON artifact bodies do not match the approved conversation',
    );
  });

  await test('JSON download retry records each signed-URL disclosure', async () => {
    const retry = await api(
      'communications/compliance/exports/download',
      investigatorStepUp,
      { exportId: state.jsonExport.id, idempotencyKey: jsonDownloadKey },
    );
    ok(retry, 'JSON download retry failed');
    expect(retry.body.data.export.id === state.jsonExport.id, 'download retry changed export');
    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'export_downloaded',
      requestIdPrefix: `${requestId(investigator.id, 'export_download', jsonDownloadKey)}|delivery|`,
      entityId: state.jsonExport.id,
      expected: 2,
    });
  });

  const pdfExportKey = randomUUID();
  const pdfDownloadKey = randomUUID();
  await test('creates and downloads a valid PDF export with matching SHA-256', async () => {
    const created = await api(
      'communications/compliance/exports/create',
      investigatorStepUp,
      {
        caseId: state.caseId,
        threadId: state.threadId,
        format: 'pdf',
        purpose: `${TAG} provide immutable reviewed evidence in PDF form.`,
        acknowledgement: true,
        idempotencyKey: pdfExportKey,
      },
    );
    ok(created, 'PDF export creation failed');
    exactKeys(expect, created.body.data, EXPORT_KEYS, 'PDF export');
    expect(created.body.data.status === 'ready', 'PDF export is not ready');
    expect(created.body.data.format === 'pdf', 'PDF export format mismatch');
    state.pdfExport = created.body.data;

    const downloaded = await api(
      'communications/compliance/exports/download',
      investigatorStepUp,
      { exportId: state.pdfExport.id, idempotencyKey: pdfDownloadKey },
    );
    ok(downloaded, 'PDF export download authorization failed');
    const artifact = await fetchArtifact(downloaded.body.data.signedUrl, h.env.SUPABASE_URL);
    expect(artifact.contentType.includes('application/pdf'), `PDF content-type=${artifact.contentType}`);
    expect(artifact.bytes.subarray(0, 5).toString('latin1') === '%PDF-', 'PDF header invalid');
    expect(artifact.bytes.toString('latin1').includes('%%EOF'), 'PDF EOF marker missing');
    expect(sha256(artifact.bytes) === state.pdfExport.sha256, 'PDF checksum mismatch');
    expect(artifact.bytes.length === state.pdfExport.fileSize, 'PDF fileSize mismatch');

    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'export_requested',
      requestId: requestId(investigator.id, 'export_request', pdfExportKey),
      entityId: state.pdfExport.id,
    });
    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'export_generated',
      requestId: requestId(investigator.id, 'export_finalize', `${pdfExportKey}:finalize`),
      entityId: state.pdfExport.id,
    });
    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'export_downloaded',
      requestIdPrefix: `${requestId(investigator.id, 'export_download', pdfDownloadKey)}|delivery|`,
      entityId: state.pdfExport.id,
    });
  });

  await test('export list is metadata-only and the storage bucket is private', async () => {
    const response = await api(
      'communications/compliance/exports/list',
      investigatorToken,
      { caseId: state.caseId, limit: 10 },
    );
    ok(response, 'exports/list failed');
    exactKeys(expect, response.body.data, ['items', 'nextCursor'], 'exports list response');
    expect(response.body.data.items.some(item => item.id === state.jsonExport.id),
      'JSON export absent from list');
    expect(response.body.data.items.some(item => item.id === state.pdfExport.id),
      'PDF export absent from list');
    response.body.data.items.forEach((item, index) =>
      exactKeys(expect, item, EXPORT_KEYS, `export list item[${index}]`));
    assertNoMessagePayload(expect, response.body.data, 'exports/list');

    const { data: bucket, error } = await sb.storage
      .getBucket('message-compliance-exports');
    expect(!error && bucket, `compliance storage bucket missing: ${error?.message ?? ''}`);
    expect(bucket.public === false, 'compliance export bucket is public');
  });

  h.section('Compliance V1 - Revocation and Closure');

  const revokeKey = randomUUID();
  const revokePayload = {
    grantId: null,
    reason: `${TAG} investigation access is no longer required.`,
    idempotencyKey: revokeKey,
  };

  await test('grantee revokes their own scoped grant', async () => {
    revokePayload.grantId = state.grantId;
    const response = await api(
      'communications/compliance/grants/revoke',
      investigatorToken,
      revokePayload,
    );
    ok(response, 'self-revoke failed');
    const grant = response.body.data.grants.find(value => value.id === state.grantId);
    expect(grant?.status === 'revoked', 'grant is not revoked');
    expect(grant.revokedBy.id === investigator.id, 'grant revoker mismatch');
    assertNoMessagePayload(expect, response.body.data, 'grant revoke response');
  });

  await test('grant revoke retry is idempotent and divergent reason is 409', async () => {
    const retry = await api(
      'communications/compliance/grants/revoke',
      investigatorToken,
      revokePayload,
    );
    ok(retry, 'grant revoke retry failed');
    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'grant_revoked',
      requestId: requestId(investigator.id, 'grant_revoke', revokeKey),
      entityId: state.grantId,
    });
    const divergent = await api(
      'communications/compliance/grants/revoke',
      investigatorToken,
      { ...revokePayload, reason: `${revokePayload.reason} changed` },
    );
    expectStatus(expect, divergent, 409, 'divergent revoke retry');
  });

  await test('revocation immediately denies scoped read and export download', async () => {
    const read = await api(
      'communications/compliance/conversations/read',
      investigatorToken,
      {
        caseId: state.caseId,
        threadId: state.threadId,
        limit: 1,
        idempotencyKey: randomUUID(),
      },
    );
    expectStatus(expect, read, 403, 'read after revoke');
    const download = await api(
      'communications/compliance/exports/download',
      investigatorStepUp,
      { exportId: state.jsonExport.id, idempotencyKey: randomUUID() },
    );
    expectStatus(expect, download, 403, 'download after revoke');
  });

  const closeKey = randomUUID();
  const closePayload = {
    caseId: null,
    reason: `${TAG} investigation completed and evidence preserved.`,
    idempotencyKey: closeKey,
  };

  await test('requester closes the approved case with step-up', async () => {
    closePayload.caseId = state.caseId;
    const response = await api(
      'communications/compliance/cases/close',
      investigatorStepUp,
      closePayload,
    );
    ok(response, 'case close failed');
    expect(response.body.data.status === 'closed', 'case status is not closed');
    expect(response.body.data.closedBy.id === investigator.id, 'case closer mismatch');
    assertNoMessagePayload(expect, response.body.data, 'case close response');
  });

  await test('case close retry is idempotent and divergent reason is 409', async () => {
    const retry = await api(
      'communications/compliance/cases/close',
      investigatorStepUp,
      closePayload,
    );
    ok(retry, 'case close retry failed');
    await assertEvidenceTriplet({
      caseId: state.caseId,
      eventType: 'case_closed',
      requestId: requestId(investigator.id, 'case_close', closeKey),
      entityId: state.caseId,
    });
    const divergent = await api(
      'communications/compliance/cases/close',
      investigatorStepUp,
      { ...closePayload, reason: `${closePayload.reason} changed` },
    );
    expectStatus(expect, divergent, 409, 'divergent close retry');
  });

  await test('closed case remains metadata-visible but denies message reads', async () => {
    const detail = await api('communications/compliance/cases/get', investigatorToken, {
      caseId: state.caseId,
    });
    ok(detail, 'closed case detail failed');
    expect(detail.body.data.status === 'closed', 'closed case did not remain visible');
    assertNoMessagePayload(expect, detail.body.data, 'closed case detail');
    const read = await api(
      'communications/compliance/conversations/read',
      investigatorToken,
      {
        caseId: state.caseId,
        threadId: state.threadId,
        limit: 1,
        idempotencyKey: randomUUID(),
      },
    );
    expectStatus(expect, read, 403, 'closed case read');
  });

  h.section('Compliance V1 - Expiry Enforcement');

  const expiryCaseKey = randomUUID();
  const expiryDecisionKey = randomUUID();
  let expiryValidUntil;

  await test('creates and approves a short-lived independent case', async () => {
    expiryValidUntil = new Date(Date.now() + 8_000).toISOString();
    const requested = await api(
      'communications/compliance/cases/request',
      investigatorToken,
      {
        title: `${TAG} short-lived expiry verification`,
        caseType: 'other_formal_investigation',
        reason: `${TAG} verify automatic denial after the approved validity window.`,
        validUntil: expiryValidUntil,
        threads: [{
          threadId: state.threadId,
          relevanceNote: `${TAG} same tagged thread used only to verify expiry enforcement.`,
        }],
        idempotencyKey: expiryCaseKey,
      },
    );
    ok(requested, 'short-lived case request failed');
    state.expiryCaseId = requested.body.data.id;
    const approved = await api(
      'communications/compliance/cases/decide',
      checkerStepUp,
      {
        caseId: state.expiryCaseId,
        decision: 'approve',
        reason: `${TAG} short validity accepted for expiry verification.`,
        idempotencyKey: expiryDecisionKey,
      },
    );
    ok(approved, 'short-lived case approval failed');
    expect(approved.body.data.status === 'approved', 'short-lived case was not approved');
  });

  await test('case validity expiry denies a new scoped read without changing case evidence', async () => {
    const waitMs = Math.max(0, Date.parse(expiryValidUntil) - Date.now() + 250);
    await new Promise(resolve => setTimeout(resolve, waitMs));
    const response = await api(
      'communications/compliance/conversations/read',
      investigatorToken,
      {
        caseId: state.expiryCaseId,
        threadId: state.threadId,
        limit: 1,
        idempotencyKey: randomUUID(),
      },
    );
    expectStatus(expect, response, 403, 'expired case read');
    const detail = await api('communications/compliance/cases/get', investigatorToken, {
      caseId: state.expiryCaseId,
    });
    ok(detail, 'expired case metadata failed');
    expect(detail.body.data.capabilities.canReadConversation === false,
      'expired case still advertises read capability');
    expect(detail.body.data.grants.every(grant => grant.status === 'expired'),
      'expired grants are not classified as expired');
  });
}
