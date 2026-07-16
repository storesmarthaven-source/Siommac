// app/MessagingProvider.tsx — the Messenger application layer, ported from the
// bundle and reworked for the SIOMAC adapters:
//   • LAZY message loading — load() returns threads + users with NO messages;
//     selectThread() fetches a thread's messages via repository.loadThread()
//     on demand and caches them for the session of the snapshot.
//   • Realtime is refetch-only — a `snapshot-changed` event reloads the base
//     snapshot and refreshes the ACTIVE thread's messages; other cached threads
//     are dropped so reopening them refetches fresh data.
//   • Hidden features removed, not stubbed: reactions, favourites, typing and
//     presence publishing render no controls and have no actions here.
//   • markRead is optimistic (clears the unread badge locally) — the periodic
//     realtime signal reconciles the authoritative count.
import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Attachment, Message, MessageDraft, MessageId, Thread, ThreadId, User, UserId, WorkspaceSnapshot } from "../domain/models";
import type { AttachmentService } from "../domain/ports";
import type { SiomacRepository, SiomacRealtimeGateway } from "../adapters";
import { defaultChatPreferences, type ChatPreferences } from "../domain/preferences";

interface MessagingActions {
  reload(): Promise<void>;
  /** Make a thread active: lazy-load its messages (cached until invalidated). */
  selectThread(threadId: ThreadId): Promise<void>;
  send(threadId: ThreadId, draft: MessageDraft): Promise<void>;
  createGroup(name: string, participantIds: UserId[], firstMessage: string): Promise<Thread>;
  remove(messageId: MessageId): Promise<void>;
  togglePin(messageId: MessageId): Promise<void>;
  markRead(threadId: ThreadId): Promise<void>;
  setMuted(threadId: ThreadId, muted: boolean): Promise<void>;
  setArchived(threadId: ThreadId, archived: boolean): Promise<void>;
  invite(threadId: ThreadId, participantId: UserId): Promise<void>;
  removeParticipant(threadId: ThreadId, participantId: UserId): Promise<void>;
  listRecipients(query?: string): Promise<User[]>;
  upload(file: File, onProgress: (attachment: Attachment) => void, signal: AbortSignal): Promise<Attachment>;
  download(attachment: Attachment): Promise<void>;
  savePreferences(preferences: ChatPreferences): Promise<void>;
}

interface MessagingContextValue {
  snapshot: WorkspaceSnapshot | null;
  loading: boolean;
  error: string | null;
  preferences: ChatPreferences;
  actions: MessagingActions;
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
    const messages = await repository.loadThread(threadId);
    setMessagesByThread((current) => {
      const next = new Map(current);
      next.set(threadId, messages);
      return next;
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

  useEffect(() => realtime.subscribe((event) => {
    if (event.sourceId === sourceId.current) return;
    if (event.type === "snapshot-changed") void reload();
  }), [realtime, reload]);

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
    markRead: async (threadId) => {
      // Optimistic: clear the local badge; realtime reconciles the true count.
      const thread = base?.threads.find((item) => item.id === threadId);
      if (!thread || thread.unreadCount === 0) return;
      setBase((current) => current ? {
        ...current,
        threads: current.threads.map((item) => item.id === threadId ? { ...item, unreadCount: 0 } : item),
      } : current);
      try { await repository.markRead(threadId, currentUserId); }
      catch { /* non-fatal — the badge re-appears on the next authoritative reload */ }
    },
    setMuted: (threadId, muted) => mutate(() => repository.setMuted(threadId, muted, currentUserId)),
    setArchived: (threadId, archived) => mutate(() => repository.setArchived(threadId, archived)),
    invite: (threadId, participantId) => mutate(() => repository.invite(threadId, participantId, currentUserId)),
    removeParticipant: (threadId, participantId) => mutate(() => repository.removeParticipant(threadId, participantId, currentUserId)),
    listRecipients: (query) => repository.listRecipients(query),
    upload: (file, onProgress, signal) => attachments.upload(file, onProgress, signal),
    download: (attachment) => attachments.download(attachment),
    savePreferences: async (nextPreferences) => {
      setPreferences(nextPreferences);
      try { await repository.savePreferences(currentUserId, nextPreferences); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save chat preferences"); throw cause; }
    },
  }), [attachments, base, currentUserId, loadThreadMessages, messagesByThread, mutate, realtime, reload, repository]);

  // The UI consumes the port's WorkspaceSnapshot shape; messages are the union
  // of the lazily-loaded threads.
  const snapshot = useMemo<WorkspaceSnapshot | null>(() => {
    if (!base) return null;
    return { ...base, messages: Array.from(messagesByThread.values()).flat() };
  }, [base, messagesByThread]);

  const value = useMemo(() => ({ snapshot, loading, error, preferences, actions }), [actions, error, loading, preferences, snapshot]);
  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

export function useMessaging(): MessagingContextValue {
  const value = useContext(MessagingContext);
  if (!value) throw new Error("useMessaging must be used within MessagingProvider");
  return value;
}
