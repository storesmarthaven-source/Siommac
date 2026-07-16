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
  id: string;
  type: "Incident" | "CAPA" | "Inspection" | "Attendance" | "Document";
  title: string;
  href: string;
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
  type: "worksheet" | "capa" | "incident-report" | "controlled-document" | "evidence-bundle" | "permit";
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
  /** SIOMAC extension: the signed-in user authored ≥1 post (drives the Sent
   *  queue — server-derived from the /threads tab=sent filter). */
  authoredByMe?: boolean;
  relatedRecord?: RelatedRecord;
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
