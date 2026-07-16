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
import type { Attachment, Message, MessageDraft, MessageId, Thread, ThreadId, User, UserId, WorkspaceSnapshot } from "../domain/models";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<ChatPreferences>(defaultChatPreferences);
  const sourceId = useRef(crypto.randomUUID());
  const activeThreadId = useRef<ThreadId | null>(null);

  const loadThreadMessages = useCallback(async (threadId: ThreadId) => {
    const { messages, authors } = await repository.loadThreadDetail(threadId);
    setMessagesByThread((current) => {
      const next = new Map(current);
      next.set(threadId, messages);
      return next;
    });
    // Merge post authors the roster does not know (departed participants) so
    // names/avatars render instead of raw ids. Known users keep their entry
    // (participant/online data carries live presence).
    setBase((current) => {
      if (!current) return current;
      const known = new Set(current.users.map((user) => user.id));
      const missing = authors.filter((author) => !known.has(author.id));
      return missing.length ? { ...current, users: [...current.users, ...missing] } : current;
    });
  }, [repository]);

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
      setMessagesByThread(active && activeMessages ? new Map([[active, activeMessages]]) : new Map());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load messages");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, repository]);

  useEffect(() => { void reload(); }, [reload]);

  // Live typing (per-thread broadcast) + presence (shared channel) state.
  const [typing, setTyping] = useState<TypingState>(emptyTypingState);
  const [online, setOnline] = useState<ReadonlySet<UserId>>(new Set());

  useEffect(() => realtime.subscribe((event) => {
    if (event.sourceId === sourceId.current) return;
    if (event.type === "snapshot-changed") { void reload(); return; }
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
  }), [realtime, reload]);

  // TTL sweep — a dropped stop-broadcast must not strand a stuck indicator.
  useEffect(() => {
    if (!hasTyping(typing)) return;
    const timer = setInterval(() => setTyping((current) => pruneTyping(current, Date.now())), 1000);
    return () => clearInterval(timer);
  }, [typing]);

  const mutate = useCallback(async (operation: () => Promise<void>) => {
    try {
      await operation();
      await reload();
      realtime.publish({ type: "snapshot-changed", sourceId: sourceId.current });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The messaging action failed");
      throw cause;
    }
  }, [realtime, reload]);

  const actions = useMemo<MessagingActions>(() => ({
    reload,
    selectThread: async (threadId) => {
      activeThreadId.current = threadId;
      realtime.setActiveThread(threadId);   // follow the thread's typing channel
      if (!messagesByThread.has(threadId)) {
        try { await loadThreadMessages(threadId); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load the conversation"); }
      }
    },
    send: async (threadId, draft) => {
      try {
        const message = await repository.send(threadId, currentUserId, draft);
        // Optimistic append so the thread updates in one paint; reload reconciles.
        setMessagesByThread((current) => {
          const next = new Map(current);
          next.set(threadId, [...(next.get(threadId) ?? []), message]);
          return next;
        });
        await reload();
        realtime.publish({ type: "snapshot-changed", sourceId: sourceId.current });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The message could not be sent");
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
    remove: (messageId) => mutate(() => repository.deleteMessage(messageId)),
    togglePin: (messageId) => mutate(() => repository.togglePin(messageId, currentUserId)),
    toggleReaction: (messageId, emoji) => mutate(() => repository.toggleReaction(messageId, currentUserId, emoji)),
    markRead: async (threadId) => {
      // Optimistic: clear the local badge; realtime reconciles the true count.
      const thread = base?.threads.find((item) => item.id === threadId);
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
    setMuted: (threadId, muted) => mutate(() => repository.setMuted(threadId, muted, currentUserId)),
    setArchived: (threadId, archived) => mutate(() => repository.setArchived(threadId, archived)),
    setFavourite: (threadId, favourite) => mutate(() => repository.setFavourite(threadId, favourite, currentUserId)),
    invite: (threadId, participantId) => mutate(() => repository.invite(threadId, participantId, currentUserId)),
    removeParticipant: (threadId, participantId) => mutate(() => repository.removeParticipant(threadId, participantId, currentUserId)),
    listRecipients: (query) => repository.listRecipients(query),
    loadThreadDetail: (threadId) => repository.loadThreadDetail(threadId),
    upload: (file, onProgress, signal) => attachments.upload(file, onProgress, signal),
    download: (attachment) => attachments.download(attachment),
    savePreferences: async (nextPreferences) => {
      setPreferences(nextPreferences);
      try { await repository.savePreferences(currentUserId, nextPreferences); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save chat preferences"); throw cause; }
    },
    setTyping: (threadId, active) => {
      realtime.publish({ type: "typing", sourceId: sourceId.current, threadId, userId: currentUserId, active });
    },
  }), [attachments, base, currentUserId, loadThreadMessages, messagesByThread, mutate, realtime, reload, repository]);

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
    return next as ReadonlyMap<ThreadId, UserId[]>;
  }, [currentUserId, typing]);

  const value = useMemo(() => ({ snapshot, loading, error, preferences, actions, typingByThread }), [actions, error, loading, preferences, snapshot, typingByThread]);
  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

export function useMessaging(): MessagingContextValue {
  const value = useContext(MessagingContext);
  if (!value) throw new Error("useMessaging must be used within MessagingProvider");
  return value;
}
