// Ported verbatim from the Messenger port bundle (src/domain/models.ts).
// Pure domain types — the stable contract the UI + adapters share. Reconciled
// with the SIOMAC messaging DTO (types/messaging.ts) via adapters/mappers.ts.
export type UserId = string;
export type ThreadId = string;
export type MessageId = string;

export type Presence = "online" | "offline";
export type ThreadKind = "direct" | "group";
export type Queue = "inbox" | "sent" | "archived" | "compliance";
export type DeliveryState = "sending" | "sent" | "delivered" | "read" | "failed";
export type AttachmentKind = "pdf" | "zip" | "word" | "excel" | "powerpoint" | "image" | "video" | "audio" | "html" | "css" | "json" | "text" | "generic";
export type TransferState = "queued" | "uploading" | "available" | "failed";

export interface User {
  id: UserId;
  name: string;
  title: string;
  avatarUrl: string;
  presence: Presence;
}

export interface RelatedRecord {
  id: string;                 // human ref (claim no / permit no / version label)
  type: string;               // source entity type (expense_claim, permit, …)
  title: string;
  /** FE section id for drill-through (dispatched as a `siomac:section` event);
   *  '' when the source module has no registered resolver. */
  href: string;
  /** Live status of the source record (resolved server-side). */
  status?: string;
}

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url?: string;
  previewUrl?: string;
  transferState: TransferState;
  progress: number;
}

export interface LinkPreview {
  url: string;
  hostname: string;
  title: string;
  description: string;
}

export interface CollaborationCard {
  id: string;
  /** REAL SIOMAC record-thread entity types (source_entity_type), plus a
   *  generic fallback for modules without a specific presentation. */
  type: "expense_claim" | "budget_line" | "payroll_run" | "remittance" | "statutory_version" | "permit" | "record";
  title: string;
  subtitle: string;
  status: string;
  ownerId: UserId;
  collaboratorIds: UserId[];
  record: RelatedRecord;
  updatedAt: string;
}

export interface Reaction {
  emoji: string;
  userIds: UserId[];
}

export interface Message {
  id: MessageId;
  /** Stable RENDER key for optimistically-sent messages: set to the pending
   *  id and carried onto the committed server message (and across reloads),
   *  so the pending→committed swap does not remount the bubble and replay
   *  its entry animation. Absent on ordinary messages — render key falls
   *  back to `id`. */
  clientKey?: string;
  threadId: ThreadId;
  authorId: UserId;
  body: string;
  html: string;
  createdAt: string;
  editedAt?: string;
  replyToId?: MessageId;
  attachments: Attachment[];
  link?: LinkPreview;
  card?: CollaborationCard;
  reactions: Reaction[];
  delivery: DeliveryState;
  pinned: boolean;
  /** Who holds the active pin (server-provided; null/absent when unpinned). */
  pinnedBy?: UserId | null;
  /** Server-derived pin capabilities for the SIGNED-IN user — the UI renders
   *  pin/unpin commands from this list; the server stays the enforcer. */
  pinActions: ("pin" | "unpin")[];
  deleted: boolean;
  system?: { event: "joined" | "added" | "removed" | "created"; subjectUserId: UserId };
}

export interface Thread {
  id: ThreadId;
  kind: ThreadKind;
  name: string;
  avatarUrl: string;
  participantIds: UserId[];
  queue: Queue;
  unreadCount: number;
  muted: boolean;
  favourite: boolean;
  complianceControlled: boolean;
  /** SIOMAC extension: thread creator (record-card owner attribution). */
  createdBy?: UserId;
  /** SIOMAC extension: the signed-in user authored ≥1 post (drives the Sent
   *  queue — server-derived from the /threads tab=sent filter). */
  authoredByMe?: boolean;
  relatedRecord?: RelatedRecord;
  /** The signed-in user has an unsent composer draft on this thread. */
  hasDraft?: boolean;
  /** First characters of that draft (server-provided, for the list row). */
  draftPreview?: string | null;
  lastActivityAt: string;
}

export interface ActivityEntry {
  id: string;
  threadId: ThreadId;
  actorId: UserId;
  type: "message" | "upload" | "pin" | "unpin" | "invite" | "join" | "mute" | "read";
  description: string;
  createdAt: string;
}

export interface MessageDraft {
  body: string;
  html: string;
  replyToId?: MessageId;
  attachments: Attachment[];
  link?: LinkPreview;
}

export interface WorkspaceSnapshot {
  currentUserId: UserId;
  users: User[];
  threads: Thread[];
  messages: Message[];
  activity: ActivityEntry[];
}
