import { sb } from '../db';

export interface TicketMutationResult {
  ticketId: string;
  ticketNumber?: string;
  commentId?: string;
  status?: string;
  priority?: string;
  assigneeUserId?: string | null;
  sequence?: number;
  version?: number;
  recipientIds: string[];
  notificationRecipientIds: string[];
  replayed: boolean;
}

export interface TicketListResult {
  items: Record<string, unknown>[];
  nextCursor: string | null;
}

export interface TicketUserProfile {
  id: string;
  displayName: string;
  email: string | null;
  role: string | null;
  photoUrl: string | null;
}

export interface TicketOverdueSweepResult {
  processed: number;
  recipientIds: string[];
}

interface RpcError {
  code?: string;
  message?: string;
  details?: string;
}

interface RpcResponse {
  data: unknown;
  error: RpcError | null;
}

const STATUS_BY_SQLSTATE: Record<string, number> = {
  TK400: 400,
  TK403: 403,
  TK404: 404,
  TK409: 409,
  TK422: 422,
};

function throwRpcError(error: RpcError): never {
  const status = STATUS_BY_SQLSTATE[error.code ?? ''] ?? 500;
  const message = status === 500
    ? 'Ticket service is unavailable.'
    : (error.message ?? 'Ticket request failed.');
  throw Object.assign(new Error(message), {
    status,
    code: error.code ?? 'ticket_service_error',
    details: error.details,
  });
}

async function ticketRpc(
  functionName: string,
  args: Record<string, unknown>,
): Promise<RpcResponse> {
  return await sb.rpc(functionName, args) as RpcResponse;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function ticketUserProfiles(ids: unknown[]): Promise<Map<string, TicketUserProfile>> {
  const userIds = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (userIds.length === 0) return new Map();
  const { data, error } = await sb.from('app_users')
    .select('id, full_name, email, role, profile_image_url, profile_image_thumb_url, profile_image')
    .in('id', userIds) as {
      data: {
        id: string;
        full_name: string | null;
        email: string | null;
        role: string | null;
        profile_image_url: string | null;
        profile_image_thumb_url: string | null;
        profile_image: string | null;
      }[] | null;
      error: { message: string } | null;
    };
  if (error) {
    throw Object.assign(new Error(`Ticket user profile lookup failed: ${error.message}`), {
      status: 500,
      code: 'ticket_profile_lookup_failed',
    });
  }
  return new Map((data ?? []).map(user => [
    user.id,
    {
      id: user.id,
      displayName: user.full_name ?? user.email ?? 'SIOMAC user',
      email: user.email,
      role: user.role,
      photoUrl: user.profile_image_thumb_url
        ?? user.profile_image_url
        ?? (user.profile_image && /^https?:\/\//.test(user.profile_image) ? user.profile_image : null),
    },
  ]));
}

function withProfile(
  row: Record<string, unknown>,
  idKey: string,
  profileKey: string,
  profiles: Map<string, TicketUserProfile>,
): Record<string, unknown> {
  const id = row[idKey];
  return {
    ...row,
    [profileKey]: typeof id === 'string' ? (profiles.get(id) ?? null) : null,
  };
}

function mutationResult(data: unknown): TicketMutationResult {
  const row = (data ?? {}) as Record<string, unknown>;
  const ticketId = optionalString(row.ticketId);
  if (!ticketId) {
    throw Object.assign(new Error('Ticket service returned an invalid mutation result.'), {
      status: 500,
      code: 'ticket_service_invalid_response',
    });
  }
  const ticketNumber = optionalString(row.ticketNumber);
  const commentId = optionalString(row.commentId);
  const status = optionalString(row.status);
  const priority = optionalString(row.priority);
  return {
    ticketId,
    ...(ticketNumber ? { ticketNumber } : {}),
    ...(commentId ? { commentId } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    assigneeUserId: typeof row.assigneeUserId === 'string' ? row.assigneeUserId : null,
    ...(typeof row.sequence === 'number' ? { sequence: row.sequence } : {}),
    ...(typeof row.version === 'number' ? { version: row.version } : {}),
    recipientIds: Array.isArray(row.recipientIds) ? row.recipientIds.map(String) : [],
    notificationRecipientIds: Array.isArray(row.notificationRecipientIds)
      ? row.notificationRecipientIds.map(String)
      : [],
    replayed: row.replayed === true,
  };
}

export async function createTicketTx(input: {
  actorId: string;
  requesterId?: string | null;
  requestTypeCode: string;
  subject: string;
  description: string;
  priority?: 'low' | 'medium' | 'high' | 'critical' | null;
  sourceModule?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  idempotencyKey: string;
}): Promise<TicketMutationResult> {
  const { data, error } = await ticketRpc('ticket_create_tx', {
    p_actor_id: input.actorId,
    p_request_type_code: input.requestTypeCode,
    p_subject: input.subject,
    p_description: input.description,
    p_priority: input.priority ?? null,
    p_source_module: input.sourceModule ?? null,
    p_source_entity_type: input.sourceEntityType ?? null,
    p_source_entity_id: input.sourceEntityId ?? null,
    p_requester_id: input.requesterId ?? null,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throwRpcError(error);
  return mutationResult(data);
}

export async function commentTicketTx(input: {
  actorId: string;
  ticketId: string;
  body: string;
  isInternal: boolean;
  idempotencyKey: string;
}): Promise<TicketMutationResult> {
  const { data, error } = await ticketRpc('ticket_comment_tx', {
    p_actor_id: input.actorId,
    p_ticket_id: input.ticketId,
    p_body: input.body,
    p_is_internal: input.isInternal,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throwRpcError(error);
  return mutationResult(data);
}

export async function commandTicketTx(input: {
  actorId: string;
  ticketId: string;
  action: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<TicketMutationResult> {
  const { data, error } = await ticketRpc('ticket_command_tx', {
    p_actor_id: input.actorId,
    p_ticket_id: input.ticketId,
    p_action: input.action,
    p_payload: input.payload ?? {},
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throwRpcError(error);
  return mutationResult(data);
}

export async function markTicketReadTx(input: {
  actorId: string;
  ticketId: string;
  sequence?: number | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await ticketRpc('ticket_mark_read_tx', {
    p_actor_id: input.actorId,
    p_ticket_id: input.ticketId,
    p_sequence: input.sequence ?? null,
  });
  if (error) throwRpcError(error);
  return (data ?? {}) as Record<string, unknown>;
}

export async function completeTicketAttachmentTx(input: {
  actorId: string;
  attachmentId: string;
  idempotencyKey: string;
}): Promise<TicketMutationResult> {
  const { data, error } = await ticketRpc('ticket_attachment_complete_tx', {
    p_actor_id: input.actorId,
    p_attachment_id: input.attachmentId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throwRpcError(error);
  return mutationResult(data);
}

export async function listTicketRequestTypes(actorId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await ticketRpc('ticket_request_types_for_actor', {
    p_actor_id: actorId,
  });
  if (error) throwRpcError(error);
  return Array.isArray(data) ? data as Record<string, unknown>[] : [];
}

export async function listTicketsForActor(input: {
  actorId: string;
  scope: 'mine' | 'assigned' | 'queue' | 'all';
  status?: string | null;
  queueCode?: string | null;
  priority?: string | null;
  requestTypeCode?: string | null;
  tagKey?: string | null;
  search?: string | null;
  limit: number;
  before?: string | null;
}): Promise<TicketListResult> {
  const { data, error } = await ticketRpc('ticket_list_for_actor', {
    p_actor_id: input.actorId,
    p_scope: input.scope,
    p_status: input.status ?? null,
    p_queue_code: input.queueCode ?? null,
    p_priority: input.priority ?? null,
    p_request_type_code: input.requestTypeCode ?? null,
    p_tag_key: input.tagKey ?? null,
    p_search: input.search ?? null,
    p_limit: input.limit,
    p_before: input.before ?? null,
  });
  if (error) throwRpcError(error);
  const row = (data ?? {}) as Record<string, unknown>;
  const items = Array.isArray(row.items) ? row.items as Record<string, unknown>[] : [];
  const profiles = await ticketUserProfiles(items.flatMap(item => [
    item.requesterUserId,
    item.assigneeUserId,
  ]));
  return {
    items: items.map(item =>
      withProfile(
        withProfile(item, 'requesterUserId', 'requester', profiles),
        'assigneeUserId',
        'assignee',
        profiles,
      ),
    ),
    nextCursor: typeof row.nextCursor === 'string' ? row.nextCursor : null,
  };
}

export async function getTicketForActor(
  actorId: string,
  ticketId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await ticketRpc('ticket_get_for_actor', {
    p_actor_id: actorId,
    p_ticket_id: ticketId,
  });
  if (error) throwRpcError(error);
  const detail = (data ?? {}) as Record<string, unknown>;
  const ticket = (detail.ticket ?? {}) as Record<string, unknown>;
  const comments = Array.isArray(detail.comments) ? detail.comments as Record<string, unknown>[] : [];
  const participants = Array.isArray(detail.participants) ? detail.participants as Record<string, unknown>[] : [];
  const events = Array.isArray(detail.events) ? detail.events as Record<string, unknown>[] : [];
  const profiles = await ticketUserProfiles([
    ticket.requesterUserId,
    ticket.assigneeUserId,
    ...comments.map(comment => comment.authorUserId),
    ...participants.map(participant => participant.userId),
    ...events.map(event => event.actorUserId),
  ]);
  return {
    ...detail,
    ticket: withProfile(
      withProfile(ticket, 'requesterUserId', 'requester', profiles),
      'assigneeUserId',
      'assignee',
      profiles,
    ),
    comments: comments.map(comment => withProfile(comment, 'authorUserId', 'author', profiles)),
    participants: participants.map(participant => withProfile(participant, 'userId', 'user', profiles)),
    events: events.map(event => withProfile(event, 'actorUserId', 'actor', profiles)),
  };
}

export async function runTicketOverdueSweep(limit = 100): Promise<TicketOverdueSweepResult> {
  const { data, error } = await ticketRpc('ticket_overdue_sweep_tx', {
    p_limit: limit,
  });
  if (error) throwRpcError(error);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    processed: typeof row.processed === 'number' ? row.processed : 0,
    recipientIds: Array.isArray(row.recipientIds) ? row.recipientIds.map(String) : [],
  };
}

export async function cleanupStaleTicketAttachments(
  olderThan = new Date(Date.now() - 24 * 60 * 60 * 1000),
): Promise<number> {
  const { data, error } = await sb.from('ticket_attachments')
    .select('id, file_path')
    .eq('upload_status', 'pending')
    .lt('created_at', olderThan.toISOString())
    .order('created_at', { ascending: true })
    .limit(500) as {
      data: { id: string; file_path: string }[] | null;
      error: { message: string } | null;
    };
  if (error) throw new Error(`Stale ticket attachment lookup failed: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return 0;

  const { error: storageError } = await sb.storage
    .from('ticket-attachments')
    .remove(rows.map(row => row.file_path));
  if (storageError) {
    throw new Error(`Stale ticket attachment storage cleanup failed: ${storageError.message}`);
  }
  const { error: deleteError } = await sb.from('ticket_attachments')
    .delete()
    .in('id', rows.map(row => row.id));
  if (deleteError) {
    throw new Error(`Stale ticket attachment metadata cleanup failed: ${deleteError.message}`);
  }
  return rows.length;
}
