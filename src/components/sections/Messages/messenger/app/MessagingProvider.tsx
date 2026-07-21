// app/MessagingProvider.tsx — the Messenger application layer, ported from the
// bundle and reworked for the SIOMAC adapters:
//   • LAZY message loading — load() returns threads + users with NO messages;
//     selectThread() fetches a thread's messages via repository.loadThread()
//     on demand and caches them for the session of the snapshot.
//   • Realtime is refetch-only — a `snapshot-changed` event reloads the base
//     snapshot and refreshes the ACTIVE thread's messages; other cached threads
//     are dropped so reopening them refetches fresh data.
//   • Typing/presence are LIVE (their slice): typing events feed a TTL-pruned
//     per-thread map exposed as `typingByThread`; presence events override the
//     roster's presence once the shared channel has synced.
//   • markRead is optimistic (clears the unread badge locally) — the periodic
//     realtime signal reconciles the authoritative count.
import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { toast } from "@store";
import type { ActivityEntry, Attachment, Message, MessageDraft, MessageId, Thread, ThreadId, User, UserId, WorkspaceSnapshot } from "../domain/models";
import type { AttachmentService } from "../domain/ports";
import type { SiomacRepository, SiomacRealtimeGateway } from "../adapters";
import { TYPING_TTL_MS } from "../adapters/siomacRealtime";
import { defaultChatPreferences, type ChatPreferences } from "../domain/preferences";
import { applyTyping, emptyTypingState, hasTyping, pruneTyping, typingUserIds, type TypingState } from "./typingState";

interface MessagingActions {
  reload(): Promise<void>;
  /** Make a thread active: lazy-load its messages (cached until invalidated). */
  selectThread(threadId: ThreadId): Promise<void>;
  send(threadId: ThreadId, draft: MessageDraft): Promise<void>;
  createGroup(name: string, participantIds: UserId[], firstMessage: string): Promise<Thread>;
  remove(messageId: MessageId): Promise<void>;
  togglePin(messageId: MessageId): Promise<void>;
  toggleReaction(messageId: MessageId, emoji: string): Promise<void>;
  markRead(threadId: ThreadId): Promise<void>;
  setMuted(threadId: ThreadId, muted: boolean): Promise<void>;
  setArchived(threadId: ThreadId, archived: boolean): Promise<void>;
  setFavourite(threadId: ThreadId, favourite: boolean): Promise<void>;
  invite(threadId: ThreadId, participantId: UserId): Promise<void>;
  removeParticipant(threadId: ThreadId, participantId: UserId): Promise<void>;
  listRecipients(query?: string): Promise<User[]>;
  /** Uncached read for the compliance surface (threads outside the snapshot). */
  loadThreadDetail(threadId: ThreadId): Promise<{ messages: Message[]; authors: User[] }>;
  /** Server-derived thread activity history (posts/pins/membership/reads). */
  listActivity(threadId: ThreadId): Promise<ActivityEntry[]>;
  /** Prepend the previous (older) history page of a thread. */
  loadOlderMessages(threadId: ThreadId): Promise<void>;
  /** Append the next thread-list page (all+sent cursors advance in step). */
  loadMoreThreads(): Promise<void>;
  /** Server-side message-CONTENT search (first page of hits). */
  searchMessages(query: string): Promise<{ postId: string; threadId: string; subject: string; snippet: string; createdAt: string }[]>;
  /** Per-user/thread composer draft persistence (last-write-wins). */
  saveDraft(threadId: ThreadId, body: string | null, replyToPostId: string | null): Promise<void>;
  getDraft(threadId: ThreadId): Promise<{ body: string | null; replyToPostId: string | null } | null>;
  upload(file: File, onProgress: (attachment: Attachment) => void, signal: AbortSignal): Promise<Attachment>;
  download(attachment: Attachment): Promise<void>;
  savePreferences(preferences: ChatPreferences): Promise<void>;
  /** Broadcast the signed-in user's typing state on the ACTIVE thread
   *  (ephemeral — nothing persisted; participant-gated by realtime RLS). */
  setTyping(threadId: ThreadId, active: boolean): void;
}

interface MessagingContextValue {
  snapshot: WorkspaceSnapshot | null;
  loading: boolean;
  error: string | null;
  preferences: ChatPreferences;
  actions: MessagingActions;
  /** Users currently typing per thread (self excluded, TTL-pruned). */
  typingByThread: ReadonlyMap<ThreadId, UserId[]>;
  /** Threads with MORE (older) history available to load. */
  hasOlderByThread: ReadonlyMap<ThreadId, boolean>;
  /** Threads whose newest message page is currently loading. */
  loadingThreadIds: ReadonlySet<ThreadId>;
  /** True while the thread LIST has further pages. */
  threadsHaveMore: boolean;
}

const MessagingContext = createContext<MessagingContextValue | null>(null);

export interface MessagingProviderProps {
  repository: SiomacRepository;
  realtime: SiomacRealtimeGateway;
  attachments: AttachmentService;
  currentUserId: UserId;
  children: ComponentChildren;
}

export function MessagingProvider({ repository, realtime, attachments, currentUserId, children }: MessagingProviderProps) {
  const [base, setBase] = useState<WorkspaceSnapshot | null>(null);
  const [messagesByThread, setMessagesByThread] = useState<ReadonlyMap<ThreadId, Message[]>>(new Map());
  const [hasOlderByThread, setHasOlderByThread] = useState<ReadonlyMap<ThreadId, boolean>>(new Map());
  const [loadingThreadIds, setLoadingThreadIds] = useState<ReadonlySet<ThreadId>>(new Set());
  const [threadsHaveMore, setThreadsHaveMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<ChatPreferences>(defaultChatPreferences);
  const sourceId = useRef(crypto.randomUUID());
  const activeThreadId = useRef<ThreadId | null>(null);
  // Message ids with a pin/unpin currently in flight (double-fire guard).
  const pinsInFlight = useRef(new Set<MessageId>());
  // Render-independent mirror of messagesByThread: lets `actions` read the
  // cache WITHOUT depending on its identity — with base/messagesByThread in
  // the useMemo deps, every state change minted a NEW actions object and
  // re-ran every [actions]-dependent effect (draft/get churn, markRead spam).
  const messagesRef = useRef<ReadonlyMap<ThreadId, Message[]>>(new Map());
  const threadLoadsInFlight = useRef(new Map<ThreadId, Promise<void>>());
  useEffect(() => { messagesRef.current = messagesByThread; }, [messagesByThread]);
  // Same render-independence for the base snapshot: `base` is NOT in the
  // actions useMemo deps (deliberately — see above), so any action reading the
  // `base` closure sees the snapshot from whenever actions LAST recomputed.
  // markRead read a stale unreadCount of 0 through that closure and silently
  // no-opped; actions must read the current snapshot through this ref instead.
  const baseRef = useRef<WorkspaceSnapshot | null>(null);
  useEffect(() => { baseRef.current = base; }, [base]);

  // Server refreshes replace a thread's messages wholesale — carry each
  // message's clientKey (the optimistic render key) over by id, or the
  // refresh remounts freshly-sent bubbles and replays their entry animation.
  const preserveClientKeys = (incoming: Message[], previous: Message[] | undefined): Message[] => {
    if (!previous?.some((message) => message.clientKey)) return incoming;
    const keyById = new Map(previous.filter((message) => message.clientKey).map((message) => [message.id, message.clientKey] as const));
    return incoming.map((message) => {
      const clientKey = keyById.get(message.id);
      return clientKey ? { ...message, clientKey } : message;
    });
  };

  const loadThreadMessages = useCallback(async (threadId: ThreadId) => {
    const existing = threadLoadsInFlight.current.get(threadId);
    if (existing) return existing;
    const task = (async () => {
      setLoadingThreadIds((current) => new Set(current).add(threadId));
      try {
        const { messages, authors, hasMore } = await repository.loadThreadDetail(threadId);
        setHasOlderByThread((current) => new Map(current).set(threadId, hasMore));
        setMessagesByThread((current) => {
          const next = new Map(current);
          next.set(threadId, preserveClientKeys(messages, current.get(threadId)));
          return next;
        });
        // Merge post authors the roster does not know (departed participants).
        setBase((current) => {
          if (!current) return current;
          const known = new Set(current.users.map((user) => user.id));
          const missing = authors.filter((author) => !known.has(author.id));
          return missing.length ? { ...current, users: [...current.users, ...missing] } : current;
        });
      } finally {
        threadLoadsInFlight.current.delete(threadId);
        setLoadingThreadIds((current) => {
          const next = new Set(current);
          next.delete(threadId);
          return next;
        });
      }
    })();
    threadLoadsInFlight.current.set(threadId, task);
    return task;
  }, [repository]);

  /** Merge a freshly-fetched NEWEST page into a thread's cached messages:
   *  older loaded pages and in-flight pending bubbles survive (a plain
   *  replace wiped both — every realtime signal reset a paged-back reader
   *  to 50 messages and could kill a pending send's bubble). */
  const mergeThreadMessages = (existing: Message[] | undefined, incoming: Message[]): Message[] => {
    const prior = existing ?? [];
    const merged = preserveClientKeys(incoming, prior);
    const incomingIds = new Set(merged.map((message) => message.id));
    const olderPages = prior.filter((message) => !incomingIds.has(message.id) && !message.id.startsWith("pending-"));
    const pending = prior.filter((message) => !incomingIds.has(message.id) && message.id.startsWith("pending-"));
    return [...olderPages, ...merged, ...pending];
  };

  /** Reload the base snapshot; refresh the active thread's messages and drop
   *  the other cached threads (they refetch on next open). */
  const reload = useCallback(async () => {
    try {
      const active = activeThreadId.current;
      const [nextBase, nextPreferences, activeMessages] = await Promise.all([
        repository.load(currentUserId),
        repository.loadPreferences(currentUserId),
        active ? repository.loadThread(active) : Promise.resolve(null),
      ]);
      setBase(nextBase);
      setPreferences(nextPreferences);
      setMessagesByThread((current) => active && activeMessages
        ? new Map([[active, mergeThreadMessages(current.get(active), activeMessages)]])
        : new Map());
      setError(null);
      setThreadsHaveMore(repository.threadListHasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load messages");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, repository]);

  /** NARROW refresh (slice 5) — what a realtime signal triggers: page 1 of the
   *  thread list MERGED into the known set (threads paged beyond page 1 and
   *  users learned from history are retained), plus a newest-page MERGE for
   *  the active thread. No preference fetch, no cache drops, no full reload. */
  const refreshNarrow = useCallback(async () => {
    try {
      const active = activeThreadId.current;
      const [nextBase, activeDetail] = await Promise.all([
        repository.load(currentUserId),
        active ? repository.loadThreadDetail(active) : Promise.resolve(null),
      ]);
      setThreadsHaveMore(repository.threadListHasMore);
      setBase((current) => {
        if (!current) return nextBase;
        const incoming = new Set(nextBase.threads.map((thread) => thread.id));
        const retainedThreads = current.threads.filter((thread) => !incoming.has(thread.id));
        const knownUsers = new Set(nextBase.users.map((user) => user.id));
        const retainedUsers = current.users.filter((user) => !knownUsers.has(user.id));
        return { ...nextBase, threads: [...nextBase.threads, ...retainedThreads], users: [...nextBase.users, ...retainedUsers] };
      });
      if (active && activeDetail) {
        setMessagesByThread((current) => {
          const next = new Map(current);
          next.set(active, mergeThreadMessages(current.get(active), activeDetail.messages));
          return next;
        });
        if (activeDetail.authors.length) {
          setBase((current) => {
            if (!current) return current;
            const known = new Set(current.users.map((user) => user.id));
            const missing = activeDetail.authors.filter((author) => !known.has(author.id));
            return missing.length ? { ...current, users: [...current.users, ...missing] } : current;
          });
        }
      }
      setError(null);
    } catch (cause) {
      console.warn('[messenger] narrow refresh failed:', cause);
    }
  }, [currentUserId, repository]);

  useEffect(() => { void reload(); }, [reload]);

  // Live typing (per-thread broadcast) + presence (shared channel) state.
  const [typing, setTyping] = useState<TypingState>(emptyTypingState);
  const [online, setOnline] = useState<ReadonlySet<UserId>>(new Set());

  const refreshTimerRef = useRef<number | null>(null);
  // Trailing coalescer for realtime bursts: long enough to fold a rapid flurry
  // of signals into one refetch, short enough that a single incoming message
  // renders promptly (the authenticated refetch itself is the latency floor).
  const NARROW_REFRESH_COALESCE_MS = 120;
  const scheduleNarrowRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refreshNarrow();
    }, NARROW_REFRESH_COALESCE_MS);
  }, [refreshNarrow]);
  useEffect(() => () => { if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current); }, []);

  useEffect(() => realtime.subscribe((event) => {
    if (event.sourceId === sourceId.current) return;
    if (event.type === "snapshot-changed") { scheduleNarrowRefresh(); return; }
    if (event.type === "typing") {
      setTyping((current) => applyTyping(current, event.threadId, event.userId, event.active, Date.now(), TYPING_TTL_MS));
      return;
    }
    // presence
    setOnline((current) => {
      if (event.presence === "online" ? current.has(event.userId) : !current.has(event.userId)) return current;
      const next = new Set(current);
      if (event.presence === "online") next.add(event.userId); else next.delete(event.userId);
      return next;
    });
  }), [realtime, scheduleNarrowRefresh]);

  // TTL sweep — a dropped stop-broadcast must not strand a stuck indicator.
  useEffect(() => {
    if (!hasTyping(typing)) return;
    const timer = setInterval(() => setTyping((current) => pruneTyping(current, Date.now())), 1000);
    return () => clearInterval(timer);
  }, [typing]);

  const mutate = useCallback(async (operation: () => Promise<void>) => {
    try {
      await operation();
      await refreshNarrow();
      realtime.publish({ type: "snapshot-changed", sourceId: sourceId.current });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "The messaging action failed");
      throw cause;
    }
  }, [realtime, refreshNarrow]);

  const actions = useMemo<MessagingActions>(() => ({
    reload,
    selectThread: async (threadId) => {
      activeThreadId.current = threadId;
      realtime.setActiveThread(threadId);   // follow the thread's typing channel
      if (!messagesRef.current.has(threadId)) {
        try { await loadThreadMessages(threadId); }
        catch (cause) { toast.error(cause instanceof Error ? cause.message : "Unable to load the conversation"); }
      }
    },
    send: async (threadId, draft) => {
      // Optimistic bubble: render IMMEDIATELY with a 'sending' tick, swap in the
      // server's committed message on success. On failure the pending bubble is
      // REMOVED (the composer keeps the draft — the throw prevents its clear),
      // so nothing pretends to be sent.
      const pendingId = `pending-${crypto.randomUUID()}`;
      const pending: Message = {
        id: pendingId, clientKey: pendingId, threadId, authorId: currentUserId,
        body: draft.body, html: draft.html || draft.body, createdAt: new Date().toISOString(),
        ...(draft.replyToId ? { replyToId: draft.replyToId } : {}),
        ...(draft.link ? { link: draft.link } : {}),
        attachments: draft.attachments, reactions: [], delivery: "sending", pinned: false, pinActions: ["pin"], deleted: false,
      };
      setMessagesByThread((current) => {
        const next = new Map(current);
        next.set(threadId, [...(next.get(threadId) ?? []), pending]);
        return next;
      });
      try {
        const message = await repository.send(threadId, currentUserId, draft);
        // The message is committed — its draft is obsolete. Fire-and-forget:
        // a failed cleanup only leaves a stale draft, never blocks the send.
        void repository.deleteDraft(threadId).catch(() => { /* best-effort */ });
        setMessagesByThread((current) => {
          const next = new Map(current);
          // Carry the pending id as the RENDER key — same key, no remount, no
          // replayed entry animation on the pending→committed swap.
          next.set(threadId, (next.get(threadId) ?? []).map((item) => item.id === pendingId ? { ...message, clientKey: pendingId } : item));
          return next;
        });
        // The send RESPONSE already updated the message cache (swap above) —
        // no server round-trips here. Bump the thread locally: newest
        // activity, Sent membership, front of the list.
        setBase((current) => {
          if (!current) return current;
          const target = current.threads.find((thread) => thread.id === threadId);
          if (!target) return current;
          const bumped = { ...target, lastActivityAt: message.createdAt, authoredByMe: true };
          return { ...current, threads: [bumped, ...current.threads.filter((thread) => thread.id !== threadId)] };
        });
        realtime.publish({ type: "snapshot-changed", sourceId: sourceId.current });
      } catch (cause) {
        setMessagesByThread((current) => {
          const next = new Map(current);
          next.set(threadId, (next.get(threadId) ?? []).filter((item) => item.id !== pendingId));
          return next;
        });
        toast.error(cause instanceof Error ? cause.message : "The message could not be sent");
        throw cause;
      }
    },
    createGroup: async (name, participantIds, firstMessage) => {
      const thread = await repository.createGroup(name, participantIds, currentUserId, firstMessage);
      activeThreadId.current = thread.id;
      await reload();
      realtime.publish({ type: "snapshot-changed", sourceId: sourceId.current });
      return thread;
    },
    remove: async (messageId) => {
      // Optimistic tombstone ("This message was deleted") with revert on failure.
      const patch = (deleted: boolean) => setMessagesByThread((current) => {
        const next = new Map(current);
        for (const [threadId, messages] of next) {
          next.set(threadId, messages.map((message) => message.id === messageId ? { ...message, deleted } : message));
        }
        return next;
      });
      patch(true);
      try { await repository.deleteMessage(messageId); }
      catch (cause) {
        console.warn('[messenger] delete failed, restoring message:', cause);
        patch(false);
        toast.error(cause instanceof Error ? cause.message : "The message could not be deleted");
      }
    },
    togglePin: async (messageId) => {
      // One toggle in flight per message: a double-click must not race two
      // identical actions to the server (the second one always 409s).
      if (pinsInFlight.current.has(messageId)) return;
      pinsInFlight.current.add(messageId);
      // Optimistic pin flip (bubble + pinned banner) with revert on failure.
      const flip = () => setMessagesByThread((current) => {
        const next = new Map(current);
        for (const [threadId, messages] of next) {
          next.set(threadId, messages.map((message) => message.id === messageId ? { ...message, pinned: !message.pinned } : message));
        }
        return next;
      });
      flip();
      try { await repository.togglePin(messageId, currentUserId); }
      catch (cause) {
        console.warn('[messenger] togglePin failed, reverting:', cause);
        flip();
        toast.error(cause instanceof Error ? cause.message : "The pin could not be saved");
      } finally {
        pinsInFlight.current.delete(messageId);
      }
    },
    toggleReaction: async (messageId, emoji) => {
      // Optimistic: paint the toggle immediately (no server round-trip + full
      // reload before feedback); revert on failure. The realtime signal
      // reconciles the authoritative counts.
      const toggle = (messages: Message[]): Message[] => messages.map((message) => {
        if (message.id !== messageId) return message;
        const existing = message.reactions.find((reaction) => reaction.emoji === emoji);
        const mine = existing?.userIds.includes(currentUserId) ?? false;
        const reactions = mine
          ? message.reactions
              .map((reaction) => reaction.emoji === emoji ? { ...reaction, userIds: reaction.userIds.filter((id) => id !== currentUserId) } : reaction)
              .filter((reaction) => reaction.userIds.length > 0)
          : existing
            ? message.reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, userIds: [...reaction.userIds, currentUserId] } : reaction)
            : [...message.reactions, { emoji, userIds: [currentUserId] }];
        return { ...message, reactions };
      });
      const previous = messagesRef.current;
      setMessagesByThread((current) => {
        const next = new Map(current);
        for (const [threadId, messages] of next) next.set(threadId, toggle(messages));
        return next;
      });
      try { await repository.toggleReaction(messageId, currentUserId, emoji); }
      catch (cause) {
        console.warn('[messenger] toggleReaction failed, reverting:', cause);
        setMessagesByThread(previous);
        toast.error(cause instanceof Error ? cause.message : "The reaction could not be saved");
      }
    },
    markRead: async (threadId) => {
      // Optimistic: clear the local badge; realtime reconciles the true count.
      const thread = baseRef.current?.threads.find((item) => item.id === threadId);
      if (!thread || thread.unreadCount === 0) return;
      const previousUnread = thread.unreadCount;
      setBase((current) => current ? {
        ...current,
        threads: current.threads.map((item) => item.id === threadId ? { ...item, unreadCount: 0 } : item),
      } : current);
      try { await repository.markRead(threadId, currentUserId); }
      catch (error) {
        // Revert — the server still counts these unread, so the badge must too.
        console.warn('[messenger] markRead failed, restoring unread badge:', error);
        setBase((current) => current ? {
          ...current,
          threads: current.threads.map((item) => item.id === threadId ? { ...item, unreadCount: previousUnread } : item),
        } : current);
      }
    },
    setMuted: async (threadId, muted) => {
      // Optimistic bell flip (personal notification state) with revert.
      setBase((current) => current ? {
        ...current,
        threads: current.threads.map((item) => item.id === threadId ? { ...item, muted } : item),
      } : current);
      try { await repository.setMuted(threadId, muted, currentUserId); }
      catch (cause) {
        console.warn('[messenger] setMuted failed, reverting:', cause);
        setBase((current) => current ? {
          ...current,
          threads: current.threads.map((item) => item.id === threadId ? { ...item, muted: !muted } : item),
        } : current);
        toast.error(cause instanceof Error ? cause.message : "The mute setting could not be saved");
      }
    },
    setArchived: async (threadId, archived) => {
      // Optimistic queue move (archive is per-participant state); revert restores
      // the thread's PREVIOUS queue (a sent/inbox thread must not land in inbox).
      const previousQueue = baseRef.current?.threads.find((item) => item.id === threadId)?.queue;
      setBase((current) => current ? {
        ...current,
        threads: current.threads.map((item) => item.id === threadId ? { ...item, queue: archived ? "archived" as const : "inbox" as const } : item),
      } : current);
      try {
        await repository.setArchived(threadId, archived);
        // Reconcile the authoritative queue derivation (sent vs inbox) quietly.
        await reload();
      } catch (cause) {
        console.warn('[messenger] setArchived failed, reverting:', cause);
        setBase((current) => current && previousQueue ? {
          ...current,
          threads: current.threads.map((item) => item.id === threadId ? { ...item, queue: previousQueue } : item),
        } : current);
        toast.error(cause instanceof Error ? cause.message : "The archive change could not be saved");
      }
    },
    setFavourite: async (threadId, favourite) => {
      // Optimistic star flip; revert on failure (personal UI state — no §2
      // side-effects to wait on, so instant feedback is safe).
      setBase((current) => current ? {
        ...current,
        threads: current.threads.map((item) => item.id === threadId ? { ...item, favourite } : item),
      } : current);
      try { await repository.setFavourite(threadId, favourite, currentUserId); }
      catch (cause) {
        console.warn('[messenger] setFavourite failed, reverting:', cause);
        setBase((current) => current ? {
          ...current,
          threads: current.threads.map((item) => item.id === threadId ? { ...item, favourite: !favourite } : item),
        } : current);
        toast.error(cause instanceof Error ? cause.message : "The favourite could not be saved");
      }
    },
    invite: (threadId, participantId) => mutate(() => repository.invite(threadId, participantId, currentUserId)),
    removeParticipant: (threadId, participantId) => mutate(() => repository.removeParticipant(threadId, participantId, currentUserId)),
    listRecipients: (query) => repository.listRecipients(query),
    loadThreadDetail: (threadId) => repository.loadThreadDetail(threadId),
    listActivity: (threadId) => repository.listActivity(threadId),
    loadOlderMessages: async (threadId) => {
      const { messages, authors, hasMore } = await repository.loadOlderMessages(threadId);
      setHasOlderByThread((current) => new Map(current).set(threadId, hasMore));
      if (messages.length) {
        setMessagesByThread((current) => {
          const next = new Map(current);
          const existing = next.get(threadId) ?? [];
          const known = new Set(existing.map((m) => m.id));
          next.set(threadId, [...messages.filter((m) => !known.has(m.id)), ...existing]);
          return next;
        });
      }
      if (authors.length) {
        setBase((current) => {
          if (!current) return current;
          const known = new Set(current.users.map((user) => user.id));
          const missing = authors.filter((author) => !known.has(author.id));
          return missing.length ? { ...current, users: [...current.users, ...missing] } : current;
        });
      }
    },
    loadMoreThreads: async () => {
      const { threads, hasMore } = await repository.loadMoreThreads(currentUserId);
      setThreadsHaveMore(hasMore);
      if (threads.length) {
        setBase((current) => {
          if (!current) return current;
          const known = new Set(current.threads.map((t) => t.id));
          const fresh = threads.filter((t) => !known.has(t.id));
          return fresh.length ? { ...current, threads: [...current.threads, ...fresh] } : current;
        });
      }
    },
    searchMessages: (query) => repository.searchMessages(query),
    saveDraft: (threadId, body, replyToPostId) => repository.saveDraft(threadId, body, replyToPostId),
    getDraft: (threadId) => repository.getDraft(threadId),
    upload: (file, onProgress, signal) => attachments.upload(file, onProgress, signal),
    download: (attachment) => attachments.download(attachment),
    savePreferences: async (nextPreferences) => {
      setPreferences(nextPreferences);
      try { await repository.savePreferences(currentUserId, nextPreferences); }
      catch (cause) { toast.error(cause instanceof Error ? cause.message : "Unable to save chat preferences"); throw cause; }
    },
    setTyping: (threadId, active) => {
      realtime.publish({ type: "typing", sourceId: sourceId.current, threadId, userId: currentUserId, active });
    },
  }), [attachments, currentUserId, loadThreadMessages, mutate, realtime, reload, repository]);

  // The UI consumes the port's WorkspaceSnapshot shape; messages are the union
  // of the lazily-loaded threads.
  const snapshot = useMemo<WorkspaceSnapshot | null>(() => {
    if (!base) return null;
    // Live presence override: once the presence channel has synced (the set
    // then contains at least the signed-in user), presence is authoritative —
    // online means "has the app open", not "account is active". Before the
    // first sync (or with realtime-auth unconfigured) the roster value stands.
    const users = online.size
      ? base.users.map((user) => {
          const presence = online.has(user.id) ? "online" as const : "offline" as const;
          return user.presence === presence ? user : { ...user, presence };
        })
      : base.users;
    return { ...base, users, messages: Array.from(messagesByThread.values()).flat() };
  }, [base, messagesByThread, online]);

  // Typing users per thread (self excluded) for the UI indicator.
  const typingByThread = useMemo(() => {
    const now = Date.now();
    const next = new Map<ThreadId, UserId[]>();
    for (const [threadId] of typing) {
      const ids = typingUserIds(typing, threadId, now, currentUserId);
      if (ids.length) next.set(threadId, ids);
    }
    return next;
  }, [currentUserId, typing]);

  const value = useMemo(() => ({ snapshot, loading, error, preferences, actions, typingByThread, hasOlderByThread, loadingThreadIds, threadsHaveMore }), [actions, error, loading, preferences, snapshot, typingByThread, hasOlderByThread, loadingThreadIds, threadsHaveMore]);
  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

export function useMessaging(): MessagingContextValue {
  const value = useContext(MessagingContext);
  if (!value) throw new Error("useMessaging must be used within MessagingProvider");
  return value;
}
