/**
 * netlify/functions/lib/messaging/messagingRpc.ts
 *
 * Thin callers for the messaging P0 transactional RPCs.
 * These are the ONLY paths through which thread/post/participant/pin/read
 * mutations reach the database.  Non-atomic JS-level paths in communications.ts
 * have been deleted — this module is the single write authority.
 *
 * Pattern: every function calls sb.rpc → msgRpcHttpError on error → return typed
 * result. Post-commit side-effects (deliverEventNotifications, emitSignal) are
 * the CALLER's responsibility (communications.ts), not this module's.
 *
 * Custom SQLSTATEs: MG400 403 404 409 422 → HTTP 400 403 404 409 422.
 */

import { sb } from '../db';

// ── SQLSTATE → HTTP mapping ────────────────────────────────────────────────────
const MSG_SQLSTATE_HTTP: Record<string, number> = {
  MG400: 400,
  MG403: 403,
  MG404: 404,
  MG409: 409,
  MG422: 422,
};

/** Convert a supabase-js RPC error (MSG* SQLSTATE) into an HTTP-status-tagged Error. */
export function msgRpcHttpError(error: { code?: string | null; message: string }): Error & { status?: number } {
  const status  = error.code ? MSG_SQLSTATE_HTTP[error.code] : undefined;
  // Strip the PL/pgSQL function prefix ('messaging_create_thread: …') for user-facing text.
  const message = error.message.replace(/^messaging_[a-z_]+:\s*/i, '');
  return Object.assign(new Error(message), status ? { status } : {});
}

// ── Result shapes ──────────────────────────────────────────────────────────────

export interface CreateThreadRpcResult {
  threadId:             string;
  postId:               string;
  sequence:             number;
  threadVersion:        number;
  eventId:              string;
  activeParticipantIds: string[];
  /** true = a new thread was created; false = an existing direct thread was reused (get-or-create). */
  created:              boolean;
  /** Only present on an idempotent replay */
  duplicate?:           boolean;
}

export interface SendMessageRpcResult {
  postId:               string;
  sequence:             number;
  threadVersion:        number;
  eventId:              string;
  activeParticipantIds: string[];
  /** Only present on an idempotent replay */
  duplicate?:           boolean;
}

export interface AddParticipantsRpcResult {
  addedUserIds:         string[];
  activeParticipantIds: string[];
  eventId?:             string;
}

export interface RemoveParticipantRpcResult {
  left:                        boolean;
  removedUserId:               string;
  remainingParticipantIds:     string[];
  eventId?:                    string;
  alreadyRemoved?:             boolean;
}

export interface PinRpcResult {
  pinId:         string;
  action:        'pin' | 'unpin';
  threadVersion: number;
  eventId:       string;
}

export interface MarkReadRpcResult {
  lastReadSequence: number;
}

// ── createThreadTx ─────────────────────────────────────────────────────────────

export async function createThreadTx(params: {
  threadType:        'direct' | 'group' | 'record' | 'system';
  subject?:          string | null;
  sourceModule?:     string | null;
  sourceEntityType?: string | null;
  sourceEntityId?:   string | null;
  createdBy:         string;
  participantIds:    string[];   // OTHER users, not including creator
  body?:             string | null;
  priority?:         string;
  attachmentIds?:    string[];
  requestKey?:       string | null;
  clientMsgKey?:     string | null;
}): Promise<CreateThreadRpcResult> {
  const { data, error } = await sb.rpc('messaging_create_thread_tx', {
    p_thread_type:        params.threadType,
    p_subject:            params.subject ?? null,
    p_source_module:      params.sourceModule ?? null,
    p_source_entity_type: params.sourceEntityType ?? null,
    p_source_entity_id:   params.sourceEntityId ?? null,
    p_created_by:         params.createdBy,
    p_participant_ids:    params.participantIds ?? [],
    p_body:               params.body ?? null,
    p_priority:           params.priority ?? 'normal',
    p_attachment_ids:     params.attachmentIds ?? [],
    p_request_key:        params.requestKey ?? null,
    p_client_msg_key:     params.clientMsgKey ?? null,
  });
  if (error) throw msgRpcHttpError(error as { code?: string | null; message: string });
  return data as CreateThreadRpcResult;
}

// ── sendMessageTx ─────────────────────────────────────────────────────────────

export async function sendMessageTx(params: {
  threadId:        string;
  actorId:         string;
  body?:           string | null;
  priority?:       string;
  replyToPostId?:  string | null;
  attachmentIds?:  string[];
  clientMsgKey?:   string | null;
}): Promise<SendMessageRpcResult> {
  const { data, error } = await sb.rpc('messaging_send_message_tx', {
    p_thread_id:         params.threadId,
    p_actor_id:          params.actorId,
    p_body:              params.body ?? null,
    p_priority:          params.priority ?? 'normal',
    p_reply_to_post_id:  params.replyToPostId ?? null,
    p_attachment_ids:    params.attachmentIds ?? [],
    p_client_msg_key:    params.clientMsgKey ?? null,
  });
  if (error) throw msgRpcHttpError(error as { code?: string | null; message: string });
  return data as SendMessageRpcResult;
}

// ── addParticipantsTx ─────────────────────────────────────────────────────────

export async function addParticipantsTx(params: {
  threadId:  string;
  actorId:   string;
  userIds:   string[];
  actorRole?: string;
}): Promise<AddParticipantsRpcResult> {
  const { data, error } = await sb.rpc('messaging_add_participants_tx', {
    p_thread_id:  params.threadId,
    p_actor_id:   params.actorId,
    p_user_ids:   params.userIds,
    p_actor_role: params.actorRole ?? null,
  });
  if (error) throw msgRpcHttpError(error as { code?: string | null; message: string });
  return data as AddParticipantsRpcResult;
}

// ── removeParticipantTx ───────────────────────────────────────────────────────

export async function removeParticipantTx(params: {
  threadId:      string;
  actorId:       string;
  targetUserId:  string;
  actorRole?:    string;
}): Promise<RemoveParticipantRpcResult> {
  const { data, error } = await sb.rpc('messaging_remove_participant_tx', {
    p_thread_id:       params.threadId,
    p_actor_id:        params.actorId,
    p_target_user_id:  params.targetUserId,
    p_actor_role:      params.actorRole ?? null,
  });
  if (error) throw msgRpcHttpError(error as { code?: string | null; message: string });
  return data as RemoveParticipantRpcResult;
}

// ── pinTx ─────────────────────────────────────────────────────────────────────

export async function pinTx(params: {
  action:          'pin' | 'unpin';
  threadId:        string;
  actorId:         string;
  postId?:         string | null;
  pinType:         'thread' | 'post';
  visibility:      'thread' | 'personal';
  note?:           string | null;
  expectedVersion?: number | null;
}): Promise<PinRpcResult> {
  const { data, error } = await sb.rpc('messaging_pin_tx', {
    p_action:           params.action,
    p_thread_id:        params.threadId,
    p_actor_id:         params.actorId,
    p_post_id:          params.postId ?? null,
    p_pin_type:         params.pinType,
    p_visibility:       params.visibility,
    p_note:             params.note ?? null,
    p_expected_version: params.expectedVersion ?? null,
  });
  if (error) throw msgRpcHttpError(error as { code?: string | null; message: string });
  return data as PinRpcResult;
}

// ── markReadTx ────────────────────────────────────────────────────────────────

export async function markReadTx(params: {
  threadId:       string;
  actorId:        string;
  upToSequence:   number;
}): Promise<MarkReadRpcResult> {
  const { data, error } = await sb.rpc('messaging_mark_read_tx', {
    p_thread_id:       params.threadId,
    p_actor_id:        params.actorId,
    p_up_to_sequence:  params.upToSequence,
  });
  if (error) throw msgRpcHttpError(error as { code?: string | null; message: string });
  return data as MarkReadRpcResult;
}
