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

import { sb }            from './db';
import { emitAppEvent }  from './appEvents';
import { userCan }       from './auth';
import { emitSignal }    from './communications';
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
    .is('removed_at', null) as { data: Array<{ user_id: string }> | null };
  return (data ?? []).map(r => r.user_id);
}

/** The caller's active role in a thread, or null if not an active participant. */
async function participantRole(threadId: string, userId: string): Promise<string | null> {
  const { data } = await sb
    .from('message_participants')
    .select('role')
    .eq('thread_id', threadId)
    .eq('user_id', userId)
    .is('removed_at', null)
    .maybeSingle<{ role: string }>();
  return data?.role ?? null;
}

async function displayName(userId: string): Promise<string> {
  const { data } = await sb
    .from('app_users')
    .select('full_name, email')
    .eq('id', userId)
    .maybeSingle<{ full_name: string | null; email: string }>();
  return data?.full_name ?? data?.email ?? 'Someone';
}

// ── Pins ───────────────────────────────────────────────────────────────────────

export interface PinMessageInput {
  currentUserId: string;
  currentUserRole: string;
  threadId:      string;
  postId?:       string | null;
  pinType:       'thread' | 'post';
  visibility:    'thread' | 'personal';
  note?:         string | null;
}

export interface PinResult { ok: boolean; message?: string; pin?: MessagePin }

type PinRow = {
  id: string; thread_id: string; post_id: string | null;
  pin_type: 'thread' | 'post'; visibility: 'thread' | 'personal';
  pinned_by: string; pinned_at: string; note: string | null;
};

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
  try {
    const role = await participantRole(input.threadId, input.currentUserId);
    if (!role) return { ok: false, message: 'Not an active participant in this thread' };

    if (input.pinType === 'post') {
      if (!input.postId) return { ok: false, message: 'postId is required to pin a post' };
      const { data: post } = await sb
        .from('message_posts')
        .select('id')
        .eq('id', input.postId)
        .eq('thread_id', input.threadId)
        .maybeSingle<{ id: string }>();
      if (!post) return { ok: false, message: 'Post does not belong to this thread' };
    }

    // Thread-visible pins are a shared act → owner or a moderator/admin only.
    if (input.visibility === 'thread') {
      const canPinForThread = role === 'owner'
        || await userCan({ id: input.currentUserId, role: input.currentUserRole }, 'communications.messages.pin_thread');
      if (!canPinForThread) return { ok: false, message: 'Only the thread owner can pin for everyone' };
    }

    const { data: row, error } = await sb
      .from('message_pins')
      .insert({
        thread_id:  input.threadId,
        post_id:    input.pinType === 'post' ? input.postId : null,
        pin_type:   input.pinType,
        visibility: input.visibility,
        pinned_by:  input.currentUserId,
        note:       input.note ?? null,
      })
      .select('id, thread_id, post_id, pin_type, visibility, pinned_by, pinned_at, note')
      .single<PinRow>();

    if (error || !row) return { ok: false, message: error?.message ?? 'Failed to pin' };

    const reason = input.pinType === 'thread' ? 'thread_pinned' : 'post_pinned';
    if (input.visibility === 'thread') void emitSignal(await threadParticipantIds(input.threadId), 'messages');
    void emitAppEvent({
      eventType:        'communications.message_pinned',
      sourceModule:     'communications',
      sourceEntityType: 'message_pin',
      sourceEntityId:   row.id,
      actorUserId:      input.currentUserId,
      severity:         'info',
      payload: { threadId: input.threadId, postId: row.post_id, pinType: row.pin_type, visibility: row.visibility, reason },
    });

    return { ok: true, pin: mapPin(row, await displayName(input.currentUserId)) };
  } catch (e) {
    console.error('[messagingRich] pinMessage failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

export async function unpinMessage(pinId: string, userId: string, userRole: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const { data: pin } = await sb
      .from('message_pins')
      .select('id, thread_id, visibility, pinned_by')
      .eq('id', pinId)
      .is('unpinned_at', null)
      .maybeSingle<{ id: string; thread_id: string; visibility: string; pinned_by: string }>();
    if (!pin) return { ok: false, message: 'Pin not found' };

    // You may remove your own pin; thread pins also removable by owner/admin.
    if (pin.pinned_by !== userId) {
      const role = await participantRole(pin.thread_id, userId);
      const canUnpinAny = role === 'owner' || await userCan({ id: userId, role: userRole }, 'communications.messages.unpin_any');
      if (!canUnpinAny) return { ok: false, message: 'You can only unpin your own pins' };
    }

    const { error } = await sb
      .from('message_pins')
      .update({ unpinned_at: new Date().toISOString(), unpinned_by: userId })
      .eq('id', pinId);
    if (error) return { ok: false, message: error.message };

    if (pin.visibility === 'thread') void emitSignal(await threadParticipantIds(pin.thread_id), 'messages');
    void emitAppEvent({
      eventType:        'communications.message_unpinned',
      sourceModule:     'communications',
      sourceEntityType: 'message_pin',
      sourceEntityId:   pinId,
      actorUserId:      userId,
      severity:         'info',
      payload: { threadId: pin.thread_id },
    });
    return { ok: true };
  } catch (e) {
    console.error('[messagingRich] unpinMessage failed:', e);
    return { ok: false, message: 'Internal error' };
  }
}

/** Active pins visible to the user in a thread (thread-visible + own personal). */
export async function listPins(threadId: string, userId: string): Promise<MessagePin[]> {
  const { data: pins } = await sb
    .from('message_pins')
    .select('id, thread_id, post_id, pin_type, visibility, pinned_by, pinned_at, note')
    .eq('thread_id', threadId)
    .is('unpinned_at', null)
    .order('pinned_at', { ascending: false }) as { data: PinRow[] | null };

  const visible = (pins ?? []).filter(p => p.visibility === 'thread' || p.pinned_by === userId);
  if (visible.length === 0) return [];

  // Resolve pinner names + post previews in batch.
  const pinnerIds = [...new Set(visible.map(p => p.pinned_by))];
  const postIds   = visible.map(p => p.post_id).filter((id): id is string => !!id);

  const [usersRes, postsRes] = await Promise.all([
    sb.from('app_users').select('id, full_name, email').in('id', pinnerIds),
    postIds.length > 0
      ? sb.from('message_posts').select('id, body, author_user_id, created_at').in('id', postIds)
      : Promise.resolve({ data: null }),
  ]);
  const users = (usersRes as { data: Array<{ id: string; full_name: string | null; email: string }> | null }).data;
  const posts = (postsRes as { data: Array<{ id: string; body: string | null; author_user_id: string | null; created_at: string }> | null }).data;

  const nameMap = new Map((users ?? []).map(u => [u.id, u.full_name ?? u.email]));
  const postMap = new Map((posts ?? []).map(p => [p.id, p]));

  return visible.map(p => {
    const post = p.post_id ? postMap.get(p.post_id) : undefined;
    const preview = post
      ? { body: post.body, authorName: post.author_user_id ? (nameMap.get(post.author_user_id) ?? null) : null, createdAt: post.created_at }
      : null;
    return mapPin(p, nameMap.get(p.pinned_by) ?? 'Someone', preview);
  });
}

/** Pinned THREADS for the sidebar "Pinned Conversations" section (user-scoped). */
export async function pinnedThreadSummary(userId: string): Promise<Array<{ threadId: string; subject: string | null; note: string | null; pinnedAt: string }>> {
  // The user's own thread-pins + any thread-visible pin on a thread they're in.
  const myThreadIds = await (async () => {
    const { data } = await sb.from('message_participants').select('thread_id').eq('user_id', userId).is('removed_at', null) as { data: Array<{ thread_id: string }> | null };
    return new Set((data ?? []).map(r => r.thread_id));
  })();

  const { data: pins } = await sb
    .from('message_pins')
    .select('thread_id, visibility, pinned_by, pinned_at, note, message_threads!inner(subject)')
    .eq('pin_type', 'thread')
    .is('unpinned_at', null)
    .order('pinned_at', { ascending: false }) as {
      data: Array<{ thread_id: string; visibility: string; pinned_by: string; pinned_at: string; note: string | null; message_threads: { subject: string | null } }> | null;
    };

  const seen = new Set<string>();
  const out: Array<{ threadId: string; subject: string | null; note: string | null; pinnedAt: string }> = [];
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
  if (!body || !body.trim()) return deleteDraft(threadId, userId);
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
      data: Array<{ user_id: string; status: PresenceStatus; last_seen_at: string; app_users: { full_name: string | null; email: string; signed_url: string | null; signed_url_expires_at: string | null } }> | null;
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
