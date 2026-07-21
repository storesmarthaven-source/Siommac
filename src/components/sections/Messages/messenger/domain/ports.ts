// Ported verbatim from the Messenger port bundle (src/domain/ports.ts).
// The three integration boundaries the UI depends on. SIOMAC implementations
// live in adapters/ (siomacRepository / siomacAttachments / siomacRealtime).
import type {
  ActivityEntry,
  Attachment,
  Message,
  MessageDraft,
  MessageId,
  Presence,
  Thread,
  ThreadId,
  UserId,
  WorkspaceSnapshot,
} from "./models";
import type { ChatPreferences } from "./preferences";

export type RealtimeEvent =
  | { type: "snapshot-changed"; sourceId: string }
  | { type: "typing"; sourceId: string; threadId: ThreadId; userId: UserId; active: boolean }
  | { type: "presence"; sourceId: string; userId: UserId; presence: Presence };

export interface MessagingRepository {
  load(currentUserId: UserId): Promise<WorkspaceSnapshot>;
  loadPreferences(userId: UserId): Promise<ChatPreferences>;
  savePreferences(userId: UserId, preferences: ChatPreferences): Promise<void>;
  send(threadId: ThreadId, authorId: UserId, draft: MessageDraft): Promise<Message>;
  /** Author-only internal note (text only). Returns the committed note. */
  addInternalNote(threadId: ThreadId, authorId: UserId, body: string): Promise<Message>;
  createGroup(name: string, participantIds: UserId[], actorId: UserId): Promise<Thread>;
  deleteMessage(messageId: MessageId): Promise<void>;
  togglePin(messageId: MessageId, actorId: UserId): Promise<void>;
  toggleReaction(messageId: MessageId, userId: UserId, emoji: string): Promise<void>;
  markRead(threadId: ThreadId, userId: UserId): Promise<void>;
  setMuted(threadId: ThreadId, muted: boolean, actorId: UserId): Promise<void>;
  setArchived(threadId: ThreadId, archived: boolean): Promise<void>;
  setFavourite(threadId: ThreadId, favourite: boolean, userId: UserId): Promise<void>;
  invite(threadId: ThreadId, participantId: UserId, actorId: UserId): Promise<void>;
  removeParticipant(threadId: ThreadId, participantId: UserId, actorId: UserId): Promise<void>;
  listActivity(threadId: ThreadId): Promise<ActivityEntry[]>;
}

export interface AttachmentService {
  upload(file: File, onProgress: (attachment: Attachment) => void, signal: AbortSignal): Promise<Attachment>;
  download(attachment: Attachment): Promise<void>;
}

export interface RealtimeGateway {
  publish(event: RealtimeEvent): void;
  subscribe(listener: (event: RealtimeEvent) => void): () => void;
  close(): void;
}
