/**
 * netlify/functions/lib/messagingRich.ts
 *
 * Rich Message Center add-on services that sit ALONGSIDE the core messaging lib
 * (communications.ts) — pins, per-thread drafts, and presence. Kept in their own
 * module so the 68 KB core stays focused; all three are new, self-contained
 * surfaces that never touch the working thread/post/attachment flow.
 *
 * Conventions mirror communications.ts exactly:
 *   • `sb` service-role client; snake_case columns mapped to the camelCase
 *     contract (types/messaging.ts) once, here.
 *   • Every mutation: write the record → emitSignal(participants,'messages') for
 *     realtime → emitAppEvent(...) for the audit_logs trail (§14).
 *   • Result shape: { ok: boolean; message?: string; ... }.
 */

import { sb }                              from './db';
import { emitSignal, resolveThreadReadAccess } from './communications';
import { pinTx, deleteMessageTx, toggleReactionTx } from './messaging/messagingRpc';
import type { MessagePin, PresenceStatus } from '../../../types/messaging';

// Online if the user pinged presence within this window (covers tab-away gaps).
const PRESENCE_ONLINE_WINDOW_MS = 90_000;

// ── helpers ──────────────────────────────────────────────────────────────────

/** Active (non-removed) participant user-ids for a thread. */
async function threadParticipantIds(threadId: string): Promise<string[]> {
  const { data } = await sb
    .from('message_participants')
    .select('user_id')
    .eq('thread_id', threadId)
    .is('removed_at', null) as { data: { user_id: string }[] | null };
  return (data ?? []).map(r => r.user_id);
}

// ── Pins ───────────────────────────────────────────────────────────────────────

export interface PinMessageInput {
  currentUserId:   string;
  threadId:        string;
  postId?:         string | null;
  pinType:         'thread' | 'post';
  visibility:      'thread' | 'personal';
  note?:           string | null;
  expectedVersion?: number | null;
}

export interface PinResult { ok: boolean; message?: string; pin?: MessagePin; status?: number }

interface PinRow {
  id: string; thread_id: string; post_id: string | null;
  pin_type: 'thread' | 'post'; visibility: 'thread' | 'personal';
  pinned_by: string; pinned_at: string; note: string | null;
}

function mapPin(row: PinRow, pinnerName: string, postPreview?: MessagePin['postPreview']): MessagePin {
  return {
    id:         row.id,
    threadId:   row.thread_id,
    postId:     row.post_id,
    pinType:    row.pin_type,
    visibility: row.visibility,
    pinnedBy:   { userId: row.pinned_by, displayName: pinnerName },
    pinnedAt:   row.pinned_at,
    note:       row.note,
    postPreview: postPreview ?? null,
  };
}

export async function pinMessage(input: PinMessageInput): Promise<PinResult> {
  // ── Atomic RPC path ──
  // The RPC: locks thread → participant check → post-belongs-to-thread check →
  // visibility auth (owner/pin_thread perm) → duplicate-pin guard → INSERT message_pins
  // → bump thread.version → INSERT app_events. All in one transaction.
  // Post-commit: deliverEventNotifications + emitSignal to active participants.
  try {
    const result = await pinTx({
      action:          'pin',
      pinId:           null,
      threadId:        input.threadId,
      actorId:         input.currentUserId,
      postId:          input.postId ?? null,
      pinType:         input.pinType,
      visibility:      input.visibility,
      note:            input.note ?? null,
      expectedVersion: input.expectedVersion ?? null,
    });

    // Post-commit: signal active participants so the UI can refresh the pin list.
    // (The RPC already inserted the app_events row in-txn; pin events have no
    //  notification rule so deliverEventNotifications would be a no-op.)
    if (input.visibility === 'thread') {
      void emitSignal(await threadParticipantIds(input.threadId), 'messages');
    }

    if (!result.pin) {
      return { ok: false, message: 'Pin transaction returned no pin payload', status: 500 };
    }
    return { ok: true, pin: result.pin };
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    console.error('[messagingRich] pinMessage RPC failed:', err.message ?? e);
    // Surface the HTTP status from MSG* SQLSTATEs so the route can set it.
    return { ok: false, message: err.message ?? 'Internal error', status: err.status };
  }
}

export async function unpinMessage(pinId: string, userId: string): Promise<{ ok: boolean; message?: string; status?: number }> {
  try {
    const result = await pinTx({
      action:   'unpin',
      pinId,
      actorId:  userId,
    });
    if (result.visibility === 'thread') {
      void emitSignal(await threadParticipantIds(result.threadId), 'messages');
    }
    return { ok: true };
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    console.error('[messagingRich] unpinMessage failed:', err.message ?? e);
    return { ok: false, message: err.message ?? 'Internal error', status: err.status };
  }
}

// ── Soft-delete a message ─────────────────────────────────────────────────────
// Atomic via messaging_delete_message_tx: 15-minute window for the author; a
// moderation delete (isModerator = communications.messages.delete_any) needs a
// reason. Blocked on system posts / legal-hold / system threads. Post-commit,
// signal the thread's participants so their UI drops the message.
export async function softDeleteMessage(input: {
  postId:      string;
  actorId:     string;
  reason?:     string | null;
  isModerator: boolean;
}): Promise<{ ok: boolean; message?: string; status?: number; postId?: string; deletedAt?: string }> {
  try {
    const result = await deleteMessageTx({
      postId:      input.postId,
      actorId:     input.actorId,
      reason:      input.reason ?? null,
      isModerator: input.isModerator,
    });
    const { data: post } = await sb.from('message_posts').select('thread_id')
      .eq('id', input.postId).maybeSingle<{ thread_id: string }>();
    if (post?.thread_id) void emitSignal(await threadParticipantIds(post.thread_id), 'messages');
    return { ok: true, postId: result.postId, deletedAt: result.deletedAt };
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    console.error('[messagingRich] softDeleteMessage failed:', err.message ?? e);
    return Object.assign({ ok: false, message: err.message ?? 'Internal error' }, err.status ? { status: err.status } : {});
  }
}

export type ListPinsResult =
  | { ok: true; pins: MessagePin[] }
  | { ok: false; status: number; message: string };

/** Active pins visible to an authorized thread reader. */
export async function listPins(threadId: string, userId: string, userRole?: string): Promise<ListPinsResult> {
  const access = await resolveThreadReadAccess(threadId, { id: userId, role: userRole });
  if (!access.allowed) {
    return {
      ok: false,
      status: 403,
      message: access.needsCompliance
        ? 'Compliance access required to view thread pins'
        : 'Not authorized to view thread pins',
    };
  }

  const pinsRes = await sb
    .from('message_pins')
    .select('id, thread_id, post_id, pin_type, visibility, pinned_by, pinned_at, note')
    .eq('thread_id', threadId)
    .is('unpinned_at', null)
    .order('pinned_at', { ascending: false });
  if (pinsRes.error) {
    console.error('[messagingRich] listPins query failed:', pinsRes.error.message);
    return { ok: false, status: 500, message: 'Could not load thread pins' };
  }
  const pins = pinsRes.data as PinRow[] | null;

  const visible = (pins ?? []).filter(p => p.visibility === 'thread' || p.pinned_by === userId);
  if (visible.length === 0) return { ok: true, pins: [] };

  // Resolve pinner names + post previews in batch.
  const pinnerIds = [...new Set(visible.map(p => p.pinned_by))];
  const postIds   = visible.map(p => p.post_id).filter((id): id is string => !!id);

  const [usersRes, postsRes] = await Promise.all([
    sb.from('app_users').select('id, full_name, email').in('id', pinnerIds),
    postIds.length > 0
      ? sb.from('message_posts').select('id, body, author_user_id, created_at').in('id', postIds)
          // Author-only internal notes are never surfaced through pin previews.
          .or(`is_internal.eq.false,author_user_id.eq.${userId}`)
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (usersRes.error || postsRes.error) {
    console.error('[messagingRich] listPins detail lookup failed:', usersRes.error?.message ?? postsRes.error?.message);
    return { ok: false, status: 500, message: 'Could not load pin details' };
  }
  const users = (usersRes as { data: { id: string; full_name: string | null; email: string }[] | null }).data;
  const posts = (postsRes as { data: { id: string; body: string | null; author_user_id: string | null; created_at: string }[] | null }).data;

  const nameMap = new Map((users ?? []).map(u => [u.id, u.full_name ?? u.email]));
  const postMap = new Map((posts ?? []).map(p => [p.id, p]));

  const mapped = visible.map(p => {
    const post = p.post_id ? postMap.get(p.post_id) : undefined;
    const preview = post
      ? { body: post.body, authorName: post.author_user_id ? (nameMap.get(post.author_user_id) ?? null) : null, createdAt: post.created_at }
      : null;
    return mapPin(p, nameMap.get(p.pinned_by) ?? 'Someone', preview);
  });
  return { ok: true, pins: mapped };
}

/** Pinned THREADS for the sidebar "Pinned Conversations" section (user-scoped). */
export async function pinnedThreadSummary(userId: string): Promise<{ threadId: string; subject: string | null; note: string | null; pinnedAt: string }[]> {
  // The user's own thread-pins + any thread-visible pin on a thread they're in.
  const myThreadIds = await (async () => {
    const { data } = await sb.from('message_participants').select('thread_id').eq('user_id', userId).is('removed_at', null) as { data: { thread_id: string }[] | null };
    return new Set((data ?? []).map(r => r.thread_id));
  })();

  const { data: pins } = await sb
    .from('message_pins')
    .select('thread_id, visibility, pinned_by, pinned_at, note, message_threads!inner(subject)')
    .eq('pin_type', 'thread')
    .is('unpinned_at', null)
    .order('pinned_at', { ascending: false }) as {
      data: { thread_id: string; visibility: string; pinned_by: string; pinned_at: string; note: string | null; message_threads: { subject: string | null } }[] | null;
    };

  const seen = new Set<string>();
  const out: { threadId: string; subject: string | null; note: string | null; pinnedAt: string }[] = [];
  for (const p of pins ?? []) {
    if (!myThreadIds.has(p.thread_id)) continue;
    if (p.visibility === 'personal' && p.pinned_by !== userId) continue;
    if (seen.has(p.thread_id)) continue;
    seen.add(p.thread_id);
    out.push({ threadId: p.thread_id, subject: p.message_threads.subject, note: p.note, pinnedAt: p.pinned_at });
  }
  return out;
}

// ── Drafts ───────────────────────────────────────────────────────────────────

export async function saveDraft(threadId: string, userId: string, body: string | null, replyToPostId: string | null): Promise<{ ok: boolean; message?: string }> {
  // Empty draft → delete (don't leave a ghost "Draft:" chip on the thread row).
  if (!body?.trim()) return deleteDraft(threadId, userId);
  const { error } = await sb.from('message_thread_drafts').upsert({
    thread_id:        threadId,
    user_id:          userId,
    body,
    reply_to_post_id: replyToPostId,
    updated_at:       new Date().toISOString(),
  }, { onConflict: 'thread_id,user_id' });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function getDraft(threadId: string, userId: string): Promise<{ body: string | null; replyToPostId: string | null } | null> {
  const { data } = await sb
    .from('message_thread_drafts')
    .select('body, reply_to_post_id')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .maybeSingle<{ body: string | null; reply_to_post_id: string | null }>();
  return data ? { body: data.body, replyToPostId: data.reply_to_post_id } : null;
}

export async function deleteDraft(threadId: string, userId: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await sb.from('message_thread_drafts').delete().eq('thread_id', threadId).eq('user_id', userId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ── Presence ─────────────────────────────────────────────────────────────────

export async function updatePresence(userId: string, status: PresenceStatus, activeThreadId: string | null): Promise<{ ok: boolean; message?: string }> {
  const { error } = await sb.from('user_presence').upsert({
    user_id:          userId,
    status,
    last_seen_at:     new Date().toISOString(),
    active_thread_id: activeThreadId,
  }, { onConflict: 'user_id' });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export interface OnlineUser { userId: string; displayName: string | null; initials: string; status: PresenceStatus; profileImage: string | null }

/** Users currently online/away (within the presence window), excluding the caller. */
export async function listOnlineUsers(excludeUserId: string): Promise<OnlineUser[]> {
  const cutoff = new Date(Date.now() - PRESENCE_ONLINE_WINDOW_MS).toISOString();
  const { data } = await sb
    .from('user_presence')
    .select('user_id, status, last_seen_at, app_users!inner(full_name, email, signed_url, signed_url_expires_at)')
    .neq('status', 'offline')
    .gt('last_seen_at', cutoff)
    .neq('user_id', excludeUserId)
    .order('last_seen_at', { ascending: false })
    .limit(50) as {
      data: { user_id: string; status: PresenceStatus; last_seen_at: string; app_users: { full_name: string | null; email: string; signed_url: string | null; signed_url_expires_at: string | null } }[] | null;
    };

  return (data ?? []).map(r => {
    const name = r.app_users.full_name ?? r.app_users.email;
    const valid = r.app_users.signed_url && r.app_users.signed_url_expires_at && new Date(r.app_users.signed_url_expires_at).getTime() > Date.now();
    return {
      userId:       r.user_id,
      displayName:  r.app_users.full_name,
      initials:     initialsOf(name),
      status:       r.status,
      profileImage: valid ? r.app_users.signed_url : null,
    };
  });
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Toggle a reaction on a post (reactions slice) — RPC-atomic + realtime signal. */
export async function toggleReaction(input: {
  postId:  string;
  actorId: string;
  emoji:   string;
}): Promise<{ ok: boolean; message?: string; status?: number; action?: 'added' | 'removed'; count?: number }> {
  try {
    const result = await toggleReactionTx(input);
    const { data: post } = await sb.from('message_posts').select('thread_id')
      .eq('id', input.postId).maybeSingle<{ thread_id: string }>();
    if (post?.thread_id) void emitSignal(await threadParticipantIds(post.thread_id), 'messages');
    return { ok: true, action: result.action, count: result.count };
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    console.error('[messagingRich] toggleReaction failed:', err.message ?? e);
    return Object.assign({ ok: false, message: err.message ?? 'Internal error' }, err.status ? { status: err.status } : {});
  }
}
