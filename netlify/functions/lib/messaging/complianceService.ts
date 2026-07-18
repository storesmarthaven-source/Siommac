/**
 * Messenger Compliance V1 read models.
 *
 * These queries return metadata only. Message bodies are available exclusively
 * through message_compliance_thread_read_tx and the controlled export builder.
 */

import { createHash } from 'node:crypto';
import { sb } from '../db';
import { userCan } from '../auth';
import type {
  ComplianceAccessEvent,
  ComplianceAccessEventsListRequest,
  ComplianceAccessEventsListResponse,
  ComplianceActorRef,
  ComplianceCapabilities,
  ComplianceCaseDetail,
  ComplianceCaseGetRequest,
  ComplianceCasesListRequest,
  ComplianceCasesListResponse,
  ComplianceCaseStatus,
  ComplianceCaseSummary,
  ComplianceCaseThread,
  ComplianceConversationSearchRequest,
  ComplianceConversationSearchResponse,
  ComplianceExport,
  ComplianceExportsListRequest,
  ComplianceExportsListResponse,
  ComplianceGrant,
} from '../../../../types/messagingCompliance';

interface Actor {
  id: string;
  role: string;
}

interface PermissionContext {
  canRead: boolean;
  canExport: boolean;
}

interface CaseRow {
  id: string;
  case_no: string;
  title: string;
  case_type: ComplianceCaseSummary['caseType'];
  reason: string;
  status: ComplianceCaseStatus;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  decision_reason: string | null;
  valid_from: string | null;
  valid_until: string;
  closed_by: string | null;
  closed_at: string | null;
  close_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface GrantRow {
  id: string;
  case_id: string;
  case_thread_id: string;
  thread_id: string;
  user_id: string;
  granted_by: string;
  granted_at: string;
  expires_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  last_accessed_at: string | null;
}

interface CaseThreadRow {
  id: string;
  case_id: string;
  thread_id: string;
  relevance_note: string;
  added_by: string;
  created_at: string;
}

interface ThreadRow {
  id: string;
  subject: string | null;
  thread_type: string;
  source_module: string | null;
  source_entity_type: string | null;
  source_entity_id: string | null;
  created_at: string;
}

interface UserRow {
  id: string;
  username: string;
  full_name: string | null;
}

interface ExportRow {
  id: string;
  export_no: string;
  case_id: string;
  grant_id: string;
  thread_id: string;
  requested_by: string;
  format: ComplianceExport['format'];
  range_from: string | null;
  range_to: string | null;
  purpose: string;
  status: ComplianceExport['status'];
  message_count: number | null;
  file_size: number | null;
  sha256: string | null;
  serializer_version: string | null;
  requested_at: string;
  generated_at: string | null;
  failure_code: string | null;
}

interface DbResult<T> {
  data: T;
  error: { message: string } | null;
}

interface CursorPayload {
  timestamp: string;
  id: string;
  fingerprint: string;
}

const CASE_SELECT = [
  'id', 'case_no', 'title', 'case_type', 'reason', 'status',
  'requested_by', 'requested_at', 'approved_by', 'approved_at',
  'rejected_by', 'rejected_at', 'decision_reason', 'valid_from',
  'valid_until', 'closed_by', 'closed_at', 'close_reason',
  'created_at', 'updated_at',
].join(', ');

const GRANT_SELECT = [
  'id', 'case_id', 'case_thread_id', 'thread_id', 'user_id', 'granted_by',
  'granted_at', 'expires_at', 'revoked_by', 'revoked_at', 'revoke_reason',
  'last_accessed_at',
].join(', ');

function httpError(message: string, status = 500): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function ensureNoError(error: { message: string } | null, operation: string): void {
  if (error) throw httpError(`${operation}: ${error.message}`);
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function encodeCursor(timestamp: string, id: string, filters: unknown): string {
  const payload: CursorPayload = { timestamp, id, fingerprint: fingerprint(filters) };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null | undefined, filters: unknown): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<CursorPayload>;
    if (typeof parsed.timestamp !== 'string'
        || Number.isNaN(Date.parse(parsed.timestamp))
        || typeof parsed.id !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)
        || parsed.fingerprint !== fingerprint(filters)) {
      throw new Error('invalid');
    }
    return parsed as CursorPayload;
  } catch {
    throw httpError('Invalid or mismatched cursor.', 422);
  }
}

async function permissionContext(actor: Actor): Promise<PermissionContext> {
  const [canRead, canExport] = await Promise.all([
    userCan(actor, 'communications.compliance_read'),
    userCan(actor, 'communications.compliance_export'),
  ]);
  return { canRead, canExport };
}

function actorRef(id: string | null, names: Map<string, string>): ComplianceActorRef | null {
  if (!id) return null;
  return { id, displayName: names.get(id) ?? null };
}

function nonEmptyTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

async function loadNames(ids: Iterable<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data, error } = await sb
    .from('app_users')
    .select('id, username, full_name')
    .in('id', unique);
  ensureNoError(error, 'load compliance actors');
  return new Map(((data ?? []) as UserRow[]).map(row => [
    row.id,
    nonEmptyTrimmed(row.full_name) ?? row.username,
  ]));
}

function grantStatus(row: GrantRow, nowMs: number): ComplianceGrant['status'] {
  if (row.revoked_at) return 'revoked';
  if (Date.parse(row.expires_at) <= nowMs) return 'expired';
  return 'active';
}

function caseCapabilities(params: {
  row: CaseRow;
  actor: Actor;
  permissions: PermissionContext;
  hasOwnActiveGrant: boolean;
  hasAnyRevocableGrant: boolean;
}): ComplianceCapabilities {
  const { row, actor, permissions, hasOwnActiveGrant, hasAnyRevocableGrant } = params;
  return {
    canRequestCase: permissions.canRead,
    canApproveCase: permissions.canRead
      && row.status === 'pending_approval'
      && row.requested_by !== actor.id,
    canReadConversation: permissions.canRead
      && row.status === 'approved'
      && Date.parse(row.valid_until) > Date.now()
      && hasOwnActiveGrant,
    canRevokeGrant: permissions.canRead && hasAnyRevocableGrant,
    canExport: permissions.canRead && permissions.canExport && hasOwnActiveGrant,
    canViewAccessLog: permissions.canRead,
  };
}

async function activeGrantsForCases(caseIds: string[], actorId: string): Promise<GrantRow[]> {
  if (caseIds.length === 0) return [];
  const result = ((await sb
    .from('message_thread_access_grants')
    .select(GRANT_SELECT)
    .in('case_id', caseIds)
    .eq('user_id', actorId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())) as unknown) as DbResult<GrantRow[]>;
  const { data, error } = result;
  ensureNoError(error, 'load active compliance grants');
  return data;
}

function applyCaseCursor<T>(query: T, cursor: CursorPayload | null): T {
  if (!cursor) return query;
  return (query as {
    or(value: string): T;
  }).or(
    `requested_at.lt.${cursor.timestamp},and(requested_at.eq.${cursor.timestamp},id.lt.${cursor.id})`,
  );
}

async function queryCasePage(params: {
  status: ComplianceCasesListRequest['status'];
  searchField?: 'case_no' | 'title';
  search?: string;
  cursor: CursorPayload | null;
  limit: number;
}): Promise<CaseRow[]> {
  let query = sb
    .from('message_compliance_cases')
    .select(CASE_SELECT)
    .order('requested_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(params.limit + 1);
  if (params.status && params.status !== 'all') query = query.eq('status', params.status);
  if (params.searchField && params.search) {
    query = query.ilike(params.searchField, `%${params.search}%`);
  }
  query = applyCaseCursor(query, params.cursor);
  const { data, error } = await query as unknown as DbResult<CaseRow[]>;
  ensureNoError(error, 'list compliance cases');
  return data;
}

export async function listComplianceCases(
  actor: Actor,
  input: ComplianceCasesListRequest,
): Promise<ComplianceCasesListResponse> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const search = nonEmptyTrimmed(input.search) ?? undefined;
  const filters = { status: input.status ?? 'all', search: search ?? null };
  const cursor = decodeCursor(input.cursor, filters);
  const permissions = await permissionContext(actor);

  const rows = search
    ? await Promise.all([
        queryCasePage({ status: input.status, searchField: 'case_no', search, cursor, limit }),
        queryCasePage({ status: input.status, searchField: 'title', search, cursor, limit }),
      ]).then(groups => {
        const deduped = new Map<string, CaseRow>();
        for (const row of groups.flat()) deduped.set(row.id, row);
        return [...deduped.values()].sort((a, b) =>
          b.requested_at.localeCompare(a.requested_at) || b.id.localeCompare(a.id));
      })
    : await queryCasePage({ status: input.status, cursor, limit });

  const page = rows.slice(0, limit);
  const caseIds = page.map(row => row.id);
  const now = new Date().toISOString();
  const [names, ownGrants, activeGrantCasesResult, eventsResult, threadCountsResult] = await Promise.all([
    loadNames(page.flatMap(row => [row.requested_by, row.approved_by])),
    activeGrantsForCases(caseIds, actor.id),
    caseIds.length
      ? sb.from('message_thread_access_grants')
          .select('case_id')
          .in('case_id', caseIds)
          .is('revoked_at', null)
          .gt('expires_at', now)
      : Promise.resolve({ data: [], error: null }),
    caseIds.length
      ? sb.from('message_compliance_access_events')
          .select('case_id, occurred_at')
          .in('case_id', caseIds)
          .order('occurred_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    caseIds.length
      ? sb.from('message_compliance_case_threads').select('case_id').in('case_id', caseIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  ensureNoError(activeGrantCasesResult.error, 'load revocable compliance grants');
  ensureNoError(eventsResult.error, 'load compliance activity');
  ensureNoError(threadCountsResult.error, 'count case conversations');

  const latestActivity = new Map<string, string>();
  for (const row of (eventsResult.data ?? []) as { case_id: string; occurred_at: string }[]) {
    if (!latestActivity.has(row.case_id)) latestActivity.set(row.case_id, row.occurred_at);
  }
  const threadCounts = new Map<string, number>();
  for (const row of (threadCountsResult.data ?? []) as { case_id: string }[]) {
    threadCounts.set(row.case_id, (threadCounts.get(row.case_id) ?? 0) + 1);
  }
  const grantsByCase = new Map<string, GrantRow[]>();
  for (const grant of ownGrants) {
    const group = grantsByCase.get(grant.case_id) ?? [];
    group.push(grant);
    grantsByCase.set(grant.case_id, group);
  }
  const casesWithActiveGrants = new Set(
    ((activeGrantCasesResult.data ?? []) as { case_id: string }[])
      .map(row => row.case_id),
  );

  const items: ComplianceCaseSummary[] = page.map(row => {
    const active = grantsByCase.get(row.id) ?? [];
    return {
      id: row.id,
      caseNo: row.case_no,
      title: row.title,
      caseType: row.case_type,
      status: row.status,
      requestedBy: actorRef(row.requested_by, names)!,
      requestedAt: row.requested_at,
      approvedBy: actorRef(row.approved_by, names),
      approvedAt: row.approved_at,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      conversationCount: threadCounts.get(row.id) ?? 0,
      lastActivityAt: latestActivity.get(row.id) ?? row.updated_at,
      capabilities: caseCapabilities({
        row,
        actor,
        permissions,
        hasOwnActiveGrant: active.length > 0,
        hasAnyRevocableGrant: active.length > 0
          || (row.approved_by === actor.id && casesWithActiveGrants.has(row.id)),
      }),
    };
  });

  const edge = page.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && edge
      ? encodeCursor(edge.requested_at, edge.id, filters)
      : null,
    capabilities: {
      canRequestCase: permissions.canRead,
      canApproveCase: permissions.canRead,
      canReadConversation: false,
      canRevokeGrant: false,
      canExport: permissions.canExport,
      canViewAccessLog: permissions.canRead,
    },
  };
}

export async function getComplianceCase(
  actor: Actor,
  input: ComplianceCaseGetRequest,
): Promise<ComplianceCaseDetail> {
  const permissions = await permissionContext(actor);
  const { data: caseData, error: caseError } = await sb
    .from('message_compliance_cases')
    .select(CASE_SELECT)
    .eq('id', input.caseId)
    .maybeSingle() as unknown as DbResult<CaseRow | null>;
  ensureNoError(caseError, 'get compliance case');
  if (!caseData) throw httpError('Compliance case not found.', 404);
  const row = caseData;
  const grantsQuery = (sb.from('message_thread_access_grants')
    .select(GRANT_SELECT)
    .eq('case_id', row.id)
    .order('granted_at', { ascending: true })) as unknown as Promise<DbResult<GrantRow[]>>;

  const [caseThreadsResult, grantsResult, eventsResult] = await Promise.all([
    sb.from('message_compliance_case_threads')
      .select('id, case_id, thread_id, relevance_note, added_by, created_at')
      .eq('case_id', row.id)
      .order('created_at', { ascending: true }),
    grantsQuery,
    sb.from('message_compliance_access_events')
      .select('occurred_at')
      .eq('case_id', row.id)
      .order('occurred_at', { ascending: false })
      .limit(1),
  ]);
  ensureNoError(caseThreadsResult.error, 'load case conversations');
  ensureNoError(grantsResult.error, 'load case grants');
  ensureNoError(eventsResult.error, 'load case activity');

  const caseThreads = (caseThreadsResult.data ?? []) as CaseThreadRow[];
  const grants = grantsResult.data;
  const threadIds = [...new Set(caseThreads.map(value => value.thread_id))];
  const { data: threadData, error: threadError } = threadIds.length
    ? await sb.from('message_threads')
        .select('id, subject, thread_type, source_module, source_entity_type, source_entity_id, created_at')
        .in('id', threadIds)
    : { data: [], error: null };
  ensureNoError(threadError, 'load compliance conversation metadata');
  const threads = new Map(((threadData ?? []) as ThreadRow[]).map(value => [value.id, value]));
  const names = await loadNames([
    row.requested_by, row.approved_by, row.rejected_by, row.closed_by,
    ...caseThreads.map(value => value.added_by),
    ...grants.flatMap(value => [value.user_id, value.granted_by, value.revoked_by]),
  ]);
  const nowMs = Date.now();

  const threadDtos: ComplianceCaseThread[] = caseThreads.map(value => {
    const thread = threads.get(value.thread_id);
    if (!thread) throw httpError('A case conversation no longer exists.', 409);
    return {
      id: value.id,
      caseId: value.case_id,
      threadId: value.thread_id,
      subject: thread.subject,
      threadType: thread.thread_type,
      sourceModule: thread.source_module,
      sourceEntityType: thread.source_entity_type,
      sourceEntityId: thread.source_entity_id,
      relevanceNote: value.relevance_note,
      addedBy: actorRef(value.added_by, names)!,
      createdAt: value.created_at,
    };
  });

  const grantDtos: ComplianceGrant[] = grants.map(value => {
    const status = grantStatus(value, nowMs);
    const active = status === 'active';
    const ownGrant = value.user_id === actor.id;
    return {
      id: value.id,
      caseId: value.case_id,
      caseThreadId: value.case_thread_id,
      threadId: value.thread_id,
      user: actorRef(value.user_id, names)!,
      grantedBy: actorRef(value.granted_by, names)!,
      grantedAt: value.granted_at,
      expiresAt: value.expires_at,
      revokedBy: actorRef(value.revoked_by, names),
      revokedAt: value.revoked_at,
      revokeReason: value.revoke_reason,
      lastAccessedAt: value.last_accessed_at,
      status,
      capabilities: {
        canReadConversation: permissions.canRead && active && ownGrant,
        canRevokeGrant: permissions.canRead && active
          && (ownGrant || row.approved_by === actor.id),
        canExport: permissions.canRead && permissions.canExport && active && ownGrant,
      },
    };
  });
  const ownActive = grantDtos.some(value =>
    value.user.id === actor.id && value.status === 'active');
  const revocable = grantDtos.some(value => value.capabilities.canRevokeGrant);

  return {
    id: row.id,
    caseNo: row.case_no,
    title: row.title,
    caseType: row.case_type,
    status: row.status,
    reason: row.reason,
    requestedBy: actorRef(row.requested_by, names)!,
    requestedAt: row.requested_at,
    approvedBy: actorRef(row.approved_by, names),
    approvedAt: row.approved_at,
    rejectedBy: actorRef(row.rejected_by, names),
    rejectedAt: row.rejected_at,
    decisionReason: row.decision_reason,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    closedBy: actorRef(row.closed_by, names),
    closedAt: row.closed_at,
    closeReason: row.close_reason,
    conversationCount: threadDtos.length,
    lastActivityAt: ((eventsResult.data ?? [])[0] as { occurred_at?: string } | undefined)
      ?.occurred_at ?? row.updated_at,
    threads: threadDtos,
    grants: grantDtos,
    capabilities: caseCapabilities({
      row,
      actor,
      permissions,
      hasOwnActiveGrant: ownActive,
      hasAnyRevocableGrant: revocable,
    }),
  };
}

export async function searchComplianceConversations(
  input: ComplianceConversationSearchRequest,
): Promise<ComplianceConversationSearchResponse> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const filters = {
    search: nonEmptyTrimmed(input.search),
    participantUserId: input.participantUserId ?? null,
    sourceModule: input.sourceModule ?? null,
    sourceEntityType: input.sourceEntityType ?? null,
    createdFrom: input.createdFrom ?? null,
    createdTo: input.createdTo ?? null,
  };
  const cursor = decodeCursor(input.cursor, filters);

  let participantThreadIds: string[] | null = null;
  if (input.participantUserId) {
    const { data, error } = await sb.from('message_participants')
      .select('thread_id')
      .eq('user_id', input.participantUserId)
      .is('removed_at', null)
      .limit(1001);
    ensureNoError(error, 'find participant conversations');
    if ((data ?? []).length > 1000) {
      throw httpError(
        'Participant conversation scope exceeds the V1 search limit. Narrow the date or source filters.',
        422,
      );
    }
    participantThreadIds = ((data ?? []) as { thread_id: string }[])
      .map(value => value.thread_id);
    if (participantThreadIds.length === 0) return { items: [], nextCursor: null };
  }

  let query = sb.from('message_threads')
    .select('id, subject, thread_type, source_module, source_entity_type, source_entity_id, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (filters.search) query = query.ilike('subject', `%${filters.search}%`);
  if (filters.sourceModule) query = query.eq('source_module', filters.sourceModule);
  if (filters.sourceEntityType) query = query.eq('source_entity_type', filters.sourceEntityType);
  if (filters.createdFrom) query = query.gte('created_at', filters.createdFrom);
  if (filters.createdTo) query = query.lte('created_at', filters.createdTo);
  if (participantThreadIds) query = query.in('id', participantThreadIds);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.timestamp},and(created_at.eq.${cursor.timestamp},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await query;
  ensureNoError(error, 'search compliance conversations');
  const rows = (data ?? []) as ThreadRow[];
  const page = rows.slice(0, limit);
  const edge = page.at(-1);
  return {
    items: page.map(row => ({
      threadId: row.id,
      subject: row.subject,
      threadType: row.thread_type,
      sourceModule: row.source_module,
      sourceEntityType: row.source_entity_type,
      sourceEntityId: row.source_entity_id,
      createdAt: row.created_at,
    })),
    nextCursor: rows.length > limit && edge
      ? encodeCursor(edge.created_at, edge.id, filters)
      : null,
  };
}

export async function listComplianceAccessEvents(
  input: ComplianceAccessEventsListRequest,
): Promise<ComplianceAccessEventsListResponse> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const filters = {
    caseId: input.caseId ?? null,
    actorUserId: input.actorUserId ?? null,
    eventType: input.eventType ?? null,
    threadId: input.threadId ?? null,
    from: input.from ?? null,
    to: input.to ?? null,
  };
  const cursor = decodeCursor(input.cursor, filters);
  let query = sb.from('message_compliance_access_events')
    .select('id, case_id, grant_id, thread_id, actor_user_id, event_type, occurred_at, request_id, details')
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (filters.caseId) query = query.eq('case_id', filters.caseId);
  if (filters.actorUserId) query = query.eq('actor_user_id', filters.actorUserId);
  if (filters.eventType) query = query.eq('event_type', filters.eventType);
  if (filters.threadId) query = query.eq('thread_id', filters.threadId);
  if (filters.from) query = query.gte('occurred_at', filters.from);
  if (filters.to) query = query.lte('occurred_at', filters.to);
  if (cursor) {
    query = query.or(
      `occurred_at.lt.${cursor.timestamp},and(occurred_at.eq.${cursor.timestamp},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await query;
  ensureNoError(error, 'list compliance access events');
  const rows = (data ?? []) as {
    id: string;
    case_id: string;
    grant_id: string | null;
    thread_id: string | null;
    actor_user_id: string;
    event_type: ComplianceAccessEvent['eventType'];
    occurred_at: string;
    request_id: string;
    details: Record<string, unknown>;
  }[];
  const page = rows.slice(0, limit);
  const caseIds = [...new Set(page.map(row => row.case_id))];
  const threadIds = [...new Set(page.map(row => row.thread_id).filter((id): id is string => Boolean(id)))];
  const [casesResult, threadsResult, names] = await Promise.all([
    caseIds.length
      ? sb.from('message_compliance_cases').select('id, case_no').in('id', caseIds)
      : Promise.resolve({ data: [], error: null }),
    threadIds.length
      ? sb.from('message_threads').select('id, subject').in('id', threadIds)
      : Promise.resolve({ data: [], error: null }),
    loadNames(page.map(row => row.actor_user_id)),
  ]);
  ensureNoError(casesResult.error, 'load access event cases');
  ensureNoError(threadsResult.error, 'load access event conversations');
  const caseNos = new Map(((casesResult.data ?? []) as { id: string; case_no: string }[])
    .map(row => [row.id, row.case_no]));
  const subjects = new Map(((threadsResult.data ?? []) as { id: string; subject: string | null }[])
    .map(row => [row.id, row.subject]));

  const edge = page.at(-1);
  return {
    items: page.map(row => ({
      id: row.id,
      caseId: row.case_id,
      caseNo: caseNos.get(row.case_id) ?? row.case_id,
      grantId: row.grant_id,
      threadId: row.thread_id,
      threadSubject: row.thread_id ? (subjects.get(row.thread_id) ?? null) : null,
      actor: actorRef(row.actor_user_id, names)!,
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      requestId: row.request_id,
      details: row.details,
    })),
    nextCursor: rows.length > limit && edge
      ? encodeCursor(edge.occurred_at, edge.id, filters)
      : null,
  };
}

export async function listComplianceExports(
  actor: Actor,
  input: ComplianceExportsListRequest,
): Promise<ComplianceExportsListResponse> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 50);
  const filters = { caseId: input.caseId };
  const cursor = decodeCursor(input.cursor, filters);
  let query = sb.from('message_compliance_exports')
    .select([
      'id', 'export_no', 'case_id', 'grant_id', 'thread_id', 'requested_by',
      'format', 'range_from', 'range_to', 'purpose', 'status', 'message_count',
      'file_size', 'sha256', 'serializer_version', 'requested_at',
      'generated_at', 'failure_code',
    ].join(', '))
    .eq('case_id', input.caseId)
    .order('requested_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (cursor) {
    query = query.or(
      `requested_at.lt.${cursor.timestamp},and(requested_at.eq.${cursor.timestamp},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await query as unknown as DbResult<ExportRow[]>;
  ensureNoError(error, 'list compliance exports');
  const rows = data;
  const page = rows.slice(0, limit);
  const permissions = await permissionContext(actor);
  const [caseResult, threadsResult, names, ownGrants] = await Promise.all([
    sb.from('message_compliance_cases').select('id, case_no').eq('id', input.caseId).maybeSingle(),
    page.length
      ? sb.from('message_threads').select('id, subject').in('id', [...new Set(page.map(row => row.thread_id))])
      : Promise.resolve({ data: [], error: null }),
    loadNames(page.map(row => row.requested_by)),
    activeGrantsForCases([input.caseId], actor.id),
  ]);
  ensureNoError(caseResult.error, 'load export case');
  ensureNoError(threadsResult.error, 'load export conversations');
  if (!caseResult.data) throw httpError('Compliance case not found.', 404);
  const caseNo = (caseResult.data as { case_no: string }).case_no;
  const subjects = new Map(((threadsResult.data ?? []) as { id: string; subject: string | null }[])
    .map(row => [row.id, row.subject]));
  const activeThreadIds = new Set(ownGrants.map(value => value.thread_id));
  const edge = page.at(-1);

  return {
    items: page.map(row => ({
      id: row.id,
      exportNo: row.export_no,
      caseId: row.case_id,
      caseNo,
      grantId: row.grant_id,
      threadId: row.thread_id,
      threadSubject: subjects.get(row.thread_id) ?? null,
      requestedBy: actorRef(row.requested_by, names)!,
      format: row.format,
      rangeFrom: row.range_from,
      rangeTo: row.range_to,
      purpose: row.purpose,
      status: row.status,
      messageCount: row.message_count,
      fileSize: row.file_size,
      sha256: row.sha256,
      serializerVersion: row.serializer_version,
      requestedAt: row.requested_at,
      generatedAt: row.generated_at,
      failureCode: row.failure_code,
      capabilities: {
        canExport: permissions.canRead
          && permissions.canExport
          && activeThreadIds.has(row.thread_id),
      },
    })),
    nextCursor: rows.length > limit && edge
      ? encodeCursor(edge.requested_at, edge.id, filters)
      : null,
  };
}

export async function getComplianceExportById(
  actor: Actor,
  exportId: string,
): Promise<ComplianceExport> {
  const { data: row, error } = await sb.from('message_compliance_exports')
    .select([
      'id', 'export_no', 'case_id', 'grant_id', 'thread_id', 'requested_by',
      'format', 'range_from', 'range_to', 'purpose', 'status', 'message_count',
      'file_size', 'sha256', 'serializer_version', 'requested_at',
      'generated_at', 'failure_code',
    ].join(', '))
    .eq('id', exportId)
    .maybeSingle() as unknown as DbResult<ExportRow | null>;
  ensureNoError(error, 'get compliance export');
  if (!row) throw httpError('Compliance export not found.', 404);

  const [caseResult, threadResult, names, permissions, ownGrants] = await Promise.all([
    sb.from('message_compliance_cases')
      .select('id, case_no')
      .eq('id', row.case_id)
      .maybeSingle<{ id: string; case_no: string }>(),
    sb.from('message_threads')
      .select('id, subject')
      .eq('id', row.thread_id)
      .maybeSingle<{ id: string; subject: string | null }>(),
    loadNames([row.requested_by]),
    permissionContext(actor),
    activeGrantsForCases([row.case_id], actor.id),
  ]);
  ensureNoError(caseResult.error, 'load compliance export case');
  ensureNoError(threadResult.error, 'load compliance export conversation');
  if (!caseResult.data || !threadResult.data) {
    throw httpError('Compliance export scope no longer exists.', 409);
  }
  const activeThreadIds = new Set(ownGrants.map(value => value.thread_id));
  return {
    id: row.id,
    exportNo: row.export_no,
    caseId: row.case_id,
    caseNo: caseResult.data.case_no,
    grantId: row.grant_id,
    threadId: row.thread_id,
    threadSubject: threadResult.data.subject,
    requestedBy: actorRef(row.requested_by, names)!,
    format: row.format,
    rangeFrom: row.range_from,
    rangeTo: row.range_to,
    purpose: row.purpose,
    status: row.status,
    messageCount: row.message_count,
    fileSize: row.file_size,
    sha256: row.sha256,
    serializerVersion: row.serializer_version,
    requestedAt: row.requested_at,
    generatedAt: row.generated_at,
    failureCode: row.failure_code,
    capabilities: {
      canExport: permissions.canRead
        && permissions.canExport
        && activeThreadIds.has(row.thread_id),
    },
  };
}

export async function listActiveCompliancePermissionHolders(
  permission: 'communications.compliance_read' | 'communications.compliance_export',
): Promise<string[]> {
  const now = new Date().toISOString();
  const { data, error } = await sb.from('user_permissions')
    .select('user_id')
    .eq('permission', permission)
    .eq('granted', true)
    .is('revoked_at', null)
    .lte('valid_from', now)
    .gt('valid_until', now);
  ensureNoError(error, 'load compliance permission holders');
  const holderIds = [...new Set(
    ((data ?? []) as { user_id: string }[]).map(row => row.user_id),
  )];
  if (holderIds.length === 0) return [];
  const { data: activeUsers, error: usersError } = await sb.from('app_users')
    .select('id')
    .in('id', holderIds)
    .eq('status', 'active');
  ensureNoError(usersError, 'validate compliance permission holders');
  return ((activeUsers ?? []) as { id: string }[]).map(row => row.id);
}
