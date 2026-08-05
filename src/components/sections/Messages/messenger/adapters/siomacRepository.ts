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
  MessagePin as PinDTO,
  MessageRecipient as RecipientDTO, MessageSearchHit,
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

interface MessageSearchResponse {
  success:     boolean;
  data?:       MessageSearchHit[];
  nextCursor?: string | null;
  message?:    string;
}

export class SiomacMessagingRepository implements MessagingRepository {
  // Post → thread + pin lookups, populated by load()/loadThread(), so the port's
  // context-free togglePin(messageId) can resolve threadId + an existing pinId.
  private readonly threadOfPost = new Map<string, string>();
  private readonly pinOfPost    = new Map<string, string>();
  /** Older-history cursor per thread (null = history exhausted). */
  private readonly olderCursor  = new Map<string, string | null>();
  /** Thread-list keyset cursor; each row carries its own Sent membership. */
  private threadCursor: string | null = null;

  async load(currentUserId: string): Promise<WorkspaceSnapshot> {
    // Load the canonical page once; authoredByMe is server-derived per row.
    const [threadsRes, online] = await Promise.all([
      apiPost<{ success: boolean; data?: ThreadDTO[]; nextCursor?: string | null; message?: string }>('communications/messages/threads', { tab: 'all', limit: 30 }),
      apiPost<{ success: boolean; data: OnlineUser[] }>('communications/messages/online', {}).then(r => (r.success ? r.data : [])),
    ]);
    if (!threadsRes.success) throw new Error(threadsRes.message ?? 'Failed to load conversations');
    const threadDtos = threadsRes.data ?? [];
    this.threadCursor = threadsRes.nextCursor ?? null;
    const users = new Map<string, User>();
    for (const t of threadDtos) {
      for (const p of t.participants) users.set(p.userId, mapParticipantToUser(p));
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

  /** Load one thread's messages + the post AUTHORS (who may not be current
   *  participants — departed members, compliance reads). */
  async loadThreadDetail(threadId: string): Promise<{ messages: Message[]; authors: User[]; hasMore: boolean }> {
    // BACKWARD = the newest page. The old ascending limit:100 call showed the
    // OLDEST 100 posts and silently hid the newest messages of long threads.
    const [postsRes, pins] = await Promise.all([
      apiPost<{ success: boolean; data?: PostDTO[]; nextCursor?: string | null; message?: string }>('communications/messages/posts', { threadId, limit: 50, direction: 'backward' }),
      apiPost<{ success: boolean; data: PinDTO[] }>('communications/messages/pins/list', { threadId }).then(r => (r.success ? r.data : [])),
    ]);
    if (!postsRes.success) throw new Error(postsRes.message ?? 'Failed to load messages');
    const posts = postsRes.data ?? [];
    this.olderCursor.set(threadId, postsRes.nextCursor ?? null);
    for (const pin of pins) { if (pin.postId) this.pinOfPost.set(pin.postId, pin.id); }
    const authors = new Map<string, User>();
    for (const p of posts) {
      this.threadOfPost.set(p.id, threadId);
      if (p.authorUserId) {
        authors.set(p.authorUserId, {
          id: p.authorUserId,
          name: p.authorName ?? p.authorUserId,
          title: p.authorRoleKey ?? '',
          avatarUrl: p.authorProfileImage ?? '',
          presence: 'offline',
        });
      }
    }
    return { messages: posts.map(mapPost), authors: Array.from(authors.values()), hasMore: (postsRes.nextCursor ?? null) !== null };
  }

  /** Load one thread's messages (called by the app layer on thread select). */
  async loadThread(threadId: string): Promise<Message[]> {
    return (await this.loadThreadDetail(threadId)).messages;
  }

  /** Previous (older) history page for a thread — the provider prepends it. */
  async loadOlderMessages(threadId: string): Promise<{ messages: Message[]; authors: User[]; hasMore: boolean }> {
    const cursor = this.olderCursor.get(threadId) ?? null;
    if (!cursor) return { messages: [], authors: [], hasMore: false };
    const res = await apiPost<{ success: boolean; data?: PostDTO[]; nextCursor?: string | null; message?: string }>(
      'communications/messages/posts', { threadId, limit: 50, direction: 'backward', cursor });
    if (!res.success) throw new Error(res.message ?? 'Failed to load earlier messages');
    const posts = res.data ?? [];
    this.olderCursor.set(threadId, res.nextCursor ?? null);
    const authors = new Map<string, User>();
    for (const p of posts) {
      this.threadOfPost.set(p.id, threadId);
      if (p.authorUserId) {
        authors.set(p.authorUserId, { id: p.authorUserId, name: p.authorName ?? p.authorUserId, title: p.authorRoleKey ?? '', avatarUrl: p.authorProfileImage ?? '', presence: 'offline' });
      }
    }
    return { messages: posts.map(mapPost), authors: Array.from(authors.values()), hasMore: (res.nextCursor ?? null) !== null };
  }

  /** True while a further canonical thread-list page exists. */
  get threadListHasMore(): boolean {
    return this.threadCursor !== null;
  }

  /** Next canonical thread-list page. */
  async loadMoreThreads(currentUserId: string): Promise<{ threads: Thread[]; hasMore: boolean }> {
    const cursor = this.threadCursor;
    if (!cursor) return { threads: [], hasMore: false };
    const result = await apiPost<{ success: boolean; data?: ThreadDTO[]; nextCursor?: string | null; message?: string }>(
      'communications/messages/threads', { tab: 'all', limit: 30, cursor });
    if (!result.success) throw new Error(result.message ?? 'Failed to load more conversations');
    this.threadCursor = result.nextCursor ?? null;
    const dtos = result.data ?? [];
    return {
      threads: dtos.map(t => mapThread(t, currentUserId)),
      hasMore: this.threadCursor !== null,
    };
  }

  /** Per-user/thread composer draft (slice 3). Empty body deletes server-side. */
  async saveDraft(threadId: string, body: string | null, replyToPostId: string | null): Promise<void> {
    await post('communications/messages/draft/save', { threadId, body, replyToPostId });
  }

  async getDraft(threadId: string): Promise<{ body: string | null; replyToPostId: string | null } | null> {
    const res = await apiPost<{ success: boolean; data?: { body: string | null; replyToPostId: string | null } | null }>(
      'communications/messages/draft/get', { threadId });
    return res.success ? (res.data ?? null) : null;
  }

  async deleteDraft(threadId: string): Promise<void> {
    await post('communications/messages/draft/delete', { threadId });
  }

  /** Server-side message-CONTENT search over the caller's threads (first page). */
  async searchMessages(query: string): Promise<MessageSearchHit[]> {
    // Guarded here as well as server-side: the endpoint rejects a one-character query
    // with 400, and firing a request we know will fail just to render an error is noise.
    const normalized = query.trim();
    if (normalized.length < 2) return [];

    // `nextCursor` is part of the transport contract even though this caller only consumes
    // the first page — dropping it from the type would make adding pagination a contract
    // change rather than a UI change.
    const res = await apiPost<MessageSearchResponse>(
      'communications/messages/search', { query: normalized, limit: 20, cursor: null });
    if (!res.success) throw new Error(res.message ?? 'Search failed');
    return res.data ?? [];
  }

  loadPreferences(userId: string): Promise<ChatPreferences> {
    try {
      const raw = localStorage.getItem(PREFS_KEY(userId));
      const stored = raw ? { ...defaultChatPreferences, ...JSON.parse(raw) as Partial<ChatPreferences> } : defaultChatPreferences;
      // Legacy migration: #001f3f was the old default AND the swatch mislabelled
      // "SIOMAC Navy" — both intents map to the real brand navy.
      if (stored.accent === "#001f3f") stored.accent = "#1b2d54";
      return Promise.resolve(stored);
    } catch { return Promise.resolve(defaultChatPreferences); }
  }

  savePreferences(userId: string, preferences: ChatPreferences): Promise<void> {
    try { localStorage.setItem(PREFS_KEY(userId), JSON.stringify(preferences)); } catch { /* storage disabled — ignore */ }
    return Promise.resolve();
  }

  async send(threadId: string, authorId: string, draft: MessageDraft): Promise<Message> {
    // A composer-attached link that is not already in the text is appended to the
    // body so it is actually persisted (the backend has no separate link field).
    const body = draft.link && !draft.body.includes(draft.link.url)
      ? (draft.body ? `${draft.body}\n${draft.link.url}` : draft.link.url)
      : draft.body;
    const res = await apiPost<{ success: boolean; postId?: string; message?: string }>(
      'communications/messages/post',
      {
        threadId,
        body,
        attachmentIds: draft.attachments.map(a => a.id),
        replyToPostId: draft.replyToId ?? null,
        // One key per send attempt — the server dedupes a retried delivery of
        // the SAME attempt (messages_send_message_tx client_msg_key).
        clientIdempotencyKey: crypto.randomUUID(),
      },
      { retryable: false },
    );
    if (!res.success || !res.postId) throw new Error(res.message ?? 'Failed to send message.');
    this.threadOfPost.set(res.postId, threadId);
    // Optimistic echo — realtime refetch reconciles the authoritative row.
    return {
      id: res.postId, threadId, authorId,
      body, html: draft.html || body, createdAt: new Date().toISOString(),
      ...(draft.replyToId ? { replyToId: draft.replyToId } : {}),
      ...(draft.link ? { link: draft.link } : {}),
      attachments: draft.attachments, reactions: [], delivery: 'sent', readByCount: 0, pinned: false, pinActions: ['pin'], deleted: false,
    };
  }

  // Author-only internal note — text only (no attachments / reply / link / priority).
  async addInternalNote(threadId: string, _authorId: string, body: string): Promise<Message> {
    const res = await apiPost<{ success: boolean; post?: PostDTO; message?: string }>(
      'communications/messages/internal-note',
      { threadId, body, clientMessageKey: crypto.randomUUID() },
      { retryable: false },
    );
    if (!res.success || !res.post) throw new Error(res.message ?? 'Failed to add internal note.');
    this.threadOfPost.set(res.post.id, threadId);
    return mapPost(res.post);
  }

  async createGroup(name: string, participantIds: string[], actorId: string, firstMessage?: string): Promise<Thread> {
    // createThread requires a body or an attachment, so group creation carries a
    // REQUIRED first message (the group form enforces it — no fabricated body).
    const body = (firstMessage ?? '').trim();
    if (!body) throw new Error('A group conversation starts with a first message.');
    const res = await apiPost<{ success: boolean; threadId?: string; message?: string }>(
      'communications/messages/createThread',
      {
        threadType: 'group', subject: name, participantUserIds: participantIds,
        body, idempotencyKey: crypto.randomUUID(),
      },
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
      // Clear the cache BEFORE the round-trip: a re-toggle while the unpin is
      // in flight must send 'pin', not a second unpin of the same id.
      // Restored on failure so the state stays truthful.
      this.pinOfPost.delete(messageId);
      try { await post('communications/messages/pins/unpin', { pinId }); }
      catch (cause) { this.pinOfPost.set(messageId, pinId); throw cause; }
      return;
    }
    const threadId = this.threadOfPost.get(messageId);
    if (!threadId) throw new Error('Cannot pin: the message thread is not loaded.');
    const pin = await post<{ id: string }>('communications/messages/pins/pin', { threadId, postId: messageId, pinType: 'post', visibility: 'thread' });
    // Record the new pin id NOW — the next toggle must send unpin. Without
    // this, a pin→toggle sequence re-sent 'pin' and the server (correctly)
    // rejected it with "an active pin for this post+visibility already exists".
    if (pin.id) this.pinOfPost.set(messageId, pin.id);
  }

  async markRead(threadId: string, _userId: string): Promise<void> {
    // apiPost resolves { success:false } WITHOUT throwing — throw so the
    // provider's optimistic unread-clear reverts when the backend rejects.
    const res = await apiPost<{ success: boolean; message?: string }>(
      'communications/messages/markRead', { threadId }, { retryable: false },
    );
    if (!res.success) throw new Error(res.message ?? 'Failed to mark thread read');
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

  /** Thread activity history — server-derived from posts/pins/membership/read
   *  state (communications/messages/activity, posts-equivalent read gate). */
  async listActivity(threadId: string): Promise<ActivityEntry[]> {
    const rows = await post<ActivityEntry[]>('communications/messages/activity', { threadId });
    return rows;   // the DTO IS the domain shape (id/threadId/actorId/type/description/createdAt)
  }

  /** Employee directory for invites / group creation (server-side search). */
  async listRecipients(query?: string): Promise<User[]> {
    const rows = await post<RecipientDTO[]>('communications/messages/recipients', { query: query?.length ? query : undefined });
    return rows.map(r => ({
      id: r.userId,
      name: r.displayName ?? r.username ?? r.userId,
      title: r.role ?? r.department ?? '',
      avatarUrl: r.profileImage ?? '',
      presence: 'offline' as const,
    }));
  }

  /** Toggle an emoji reaction (reactions slice — atomic RPC server-side). */
  async toggleReaction(messageId: string, _userId: string, emoji: string): Promise<void> {
    await post('communications/messages/reactions/toggle', { postId: messageId, emoji });
  }

  /** Per-user thread favourite (favourites slice — personal UI state). */
  async setFavourite(threadId: string, favourite: boolean, _userId: string): Promise<void> {
    await apiPost('communications/messages/favourites/set', { threadId, favourite }, { retryable: false });
  }
}

// Re-export the attachment mapper so the app layer can hydrate optimistic
// attachments without reaching into ./mappers directly.
export { mapAttachment };
