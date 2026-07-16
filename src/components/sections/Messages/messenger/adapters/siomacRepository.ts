// adapters/siomacRepository.ts — the MessagingRepository port implemented against
// the SIOMAC canonical `/communications/messages/*` API (auth JWT via apiPost, the
// shared types/messaging.ts DTO). Replaces the port bundle's stubbed
// SiomacMessagingRepository (which targeted a hypothetical /messaging/* API).
//
// HIDDEN features (no backend yet — the UI renders no control, so these should
// never be called; they throw to surface any accidental call): reactions,
// favourites, typing. Each is its own future backend slice.
//
// Phase-3 note: load() returns threads + users with an EMPTY message list; the app
// layer lazy-loads a thread's messages via loadThread(threadId) on select and
// replaces the eager fixture snapshot with cursor queries (per PORTING_MANIFEST).
import { apiPost } from '@lib/api';
import type {
  MessageThread as ThreadDTO, MessagePost as PostDTO,
  MessageParticipant as ParticipantDTO, MessagePin as PinDTO,
} from '../../../../../../types/messaging';
import type { OnlineUser } from '@api/communications';
import type { MessagingRepository } from '../domain/ports';
import type {
  ActivityEntry, Message, MessageDraft, Thread, User, WorkspaceSnapshot,
} from '../domain/models';
import type { ChatPreferences } from '../domain/preferences';
import { defaultChatPreferences } from '../domain/preferences';
import { mapAttachment, mapOnlineToUser, mapParticipantToUser, mapPost, mapThread } from './mappers';

const PREFS_KEY = (userId: string): string => `siomac.messenger.prefs.${userId}`;

async function post<T>(path: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data?: T; message?: string }>(path, args, { retryable: false });
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data as T;
}

export class SiomacMessagingRepository implements MessagingRepository {
  // Post → thread + pin lookups, populated by load()/loadThread(), so the port's
  // context-free togglePin(messageId) can resolve threadId + an existing pinId.
  private readonly threadOfPost = new Map<string, string>();
  private readonly pinOfPost    = new Map<string, string>();

  async load(currentUserId: string): Promise<WorkspaceSnapshot> {
    const [threadDtos, online] = await Promise.all([
      post<ThreadDTO[]>('communications/messages/threads', { limit: 50 }),
      apiPost<{ success: boolean; data: OnlineUser[] }>('communications/messages/online', {}).then(r => (r.success ? r.data : [])),
    ]);
    const users = new Map<string, User>();
    for (const t of threadDtos) {
      for (const p of t.participants ?? []) users.set(p.userId, mapParticipantToUser(p as ParticipantDTO));
    }
    for (const o of online) users.set(o.userId, { ...mapOnlineToUser(o), ...(users.has(o.userId) ? { title: users.get(o.userId)!.title } : {}) });

    return {
      currentUserId,
      users: Array.from(users.values()),
      threads: threadDtos.map(t => mapThread(t, currentUserId)),
      messages: [],   // lazy per-thread; see loadThread()
      activity: [],
    };
  }

  /** Load one thread's messages (called by the app layer on thread select). */
  async loadThread(threadId: string): Promise<Message[]> {
    const [posts, pins] = await Promise.all([
      post<PostDTO[]>('communications/messages/posts', { threadId, limit: 100 }),
      apiPost<{ success: boolean; data: PinDTO[] }>('communications/messages/pins/list', { threadId }).then(r => (r.success ? r.data : [])),
    ]);
    for (const pin of pins) { if (pin.postId) this.pinOfPost.set(pin.postId, pin.id); }
    for (const p of posts) this.threadOfPost.set(p.id, threadId);
    return posts.map(mapPost);
  }

  async loadPreferences(userId: string): Promise<ChatPreferences> {
    try {
      const raw = localStorage.getItem(PREFS_KEY(userId));
      return raw ? { ...defaultChatPreferences, ...JSON.parse(raw) as Partial<ChatPreferences> } : defaultChatPreferences;
    } catch { return defaultChatPreferences; }
  }

  async savePreferences(userId: string, preferences: ChatPreferences): Promise<void> {
    try { localStorage.setItem(PREFS_KEY(userId), JSON.stringify(preferences)); } catch { /* storage disabled — ignore */ }
  }

  async send(threadId: string, authorId: string, draft: MessageDraft): Promise<Message> {
    const res = await apiPost<{ success: boolean; postId?: string; message?: string }>(
      'communications/messages/post',
      {
        threadId,
        body: draft.body,
        attachmentIds: draft.attachments.map(a => a.id),
        replyToPostId: draft.replyToId ?? null,
      },
      { retryable: false },
    );
    if (!res.success || !res.postId) throw new Error(res.message ?? 'Failed to send message.');
    this.threadOfPost.set(res.postId, threadId);
    // Optimistic echo — realtime refetch reconciles the authoritative row.
    return {
      id: res.postId, threadId, authorId,
      body: draft.body, html: draft.html, createdAt: new Date().toISOString(),
      ...(draft.replyToId ? { replyToId: draft.replyToId } : {}),
      attachments: draft.attachments, reactions: [], delivery: 'sent', pinned: false, deleted: false,
    };
  }

  async createGroup(name: string, participantIds: string[], actorId: string): Promise<Thread> {
    // NOTE: createThread requires a body or an attachment; an empty named-group
    // create sends an empty body and relies on the backend body-or-attachment
    // guard. Phase 3 decides whether group creation requires a first message.
    const res = await apiPost<{ success: boolean; threadId?: string; message?: string }>(
      'communications/messages/createThread',
      { threadType: 'group', subject: name, participantUserIds: participantIds, body: '' },
      { retryable: false },
    );
    if (!res.success || !res.threadId) throw new Error(res.message ?? 'Failed to create group.');
    return {
      id: res.threadId, kind: 'group', name, avatarUrl: '',
      participantIds: Array.from(new Set([actorId, ...participantIds])),
      queue: 'inbox', unreadCount: 0, muted: false, favourite: false,
      complianceControlled: false, lastActivityAt: new Date().toISOString(),
    };
  }

  async deleteMessage(messageId: string): Promise<void> {
    await post('communications/messages/delete', { postId: messageId, reason: null });
  }

  async togglePin(messageId: string, _actorId: string): Promise<void> {
    const pinId = this.pinOfPost.get(messageId);
    if (pinId) {
      await post('communications/messages/pins/unpin', { pinId });
      this.pinOfPost.delete(messageId);
      return;
    }
    const threadId = this.threadOfPost.get(messageId);
    if (!threadId) throw new Error('Cannot pin: the message thread is not loaded.');
    await post('communications/messages/pins/pin', { threadId, postId: messageId, pinType: 'post', visibility: 'thread' });
  }

  async markRead(threadId: string, _userId: string): Promise<void> {
    await apiPost('communications/messages/markRead', { threadId }, { retryable: false });
  }

  async setMuted(threadId: string, muted: boolean, _actorId: string): Promise<void> {
    await apiPost('communications/messages/mute', { threadId, muted }, { retryable: false });
  }

  async setArchived(threadId: string, archived: boolean): Promise<void> {
    await apiPost('communications/messages/archive', { threadId, archived }, { retryable: false });
  }

  async invite(threadId: string, participantId: string, _actorId: string): Promise<void> {
    await post('communications/messages/participants/add', { threadId, userIds: [participantId] });
  }

  async removeParticipant(threadId: string, participantId: string, _actorId: string): Promise<void> {
    await post('communications/messages/participants/remove', { threadId, userId: participantId });
  }

  // No dedicated activity-log endpoint yet; the details panel derives history from
  // posts/pins for now. Returns [] rather than a fake row.
  async listActivity(_threadId: string): Promise<ActivityEntry[]> {
    return [];
  }

  // ── Hidden features (no control rendered → never called; throw if they are) ──
  async toggleReaction(): Promise<void> {
    throw new Error('Reactions are not enabled yet.');
  }
  async setFavourite(): Promise<void> {
    throw new Error('Favourites are not enabled yet.');
  }
}

// Re-export the attachment mapper so the app layer can hydrate optimistic
// attachments without reaching into ./mappers directly.
export { mapAttachment };
