/**
 * types/messaging.ts
 *
 * The SINGLE source of truth for the messaging API contract, shared by the
 * Netlify functions (producer) and the Preact frontend (consumer). Both sides
 * import these types, so the compiler — not a runtime surprise — catches any
 * drift between what the backend sends and what the UI reads.
 *
 * Convention: camelCase end-to-end (matches the domain lib). The Supabase
 * snake_case columns are mapped to camelCase once, inside the lib query layer.
 * Routes return these shapes verbatim — no per-endpoint remapping.
 */

export type MessageThreadType = 'direct' | 'group' | 'record' | 'system';

/** Thread/post importance. Drives the Action-Required chip + bubble styling. */
export type MessagePriority = 'normal' | 'important' | 'urgent' | 'action_required';

/** Presence state for the Online-Now strip + participant dots. */
export type PresenceStatus = 'online' | 'away' | 'offline';

/** Rich attachment classification — drives icon/preview rendering. */
export type MessageAttachmentType =
  | 'image' | 'video' | 'audio' | 'pdf' | 'word' | 'excel'
  | 'powerpoint' | 'text' | 'archive' | 'document' | 'other';

/** Timeline system-event kinds (rendered as centered announcements, not bubbles). */
export type MessageSystemEventType =
  | 'participant_added' | 'participant_removed' | 'participant_left'
  | 'participant_role_changed' | 'thread_created' | 'thread_archived'
  | 'thread_reopened' | 'thread_muted' | 'thread_unmuted';

export interface MessageParticipant {
  userId:        string;
  displayName:   string | null;
  email:         string | null;
  role:          string;
  username?:     string | null;
  profileImage?: string | null;
  /** Live presence — populated by thread-context; absent in lighter list payloads. */
  status?:       PresenceStatus;
  lastReadAt?:   string | null;
}

export interface MessageAttachment {
  id:          string;
  fileName:    string;
  filePath:    string;
  contentType: string | null;
  sizeBytes:   number | null;
  url:         string | null;   // signed download URL (best-effort, time-limited)
  // ── Rich Add-On (optional until the attachment pipeline populates them) ──
  threadId?:        string;
  postId?:          string | null;
  attachmentType?:  MessageAttachmentType;
  fileExtension?:   string | null;
  thumbnailUrl?:    string | null;
  previewUrl?:      string | null;
  downloadUrl?:     string | null;
  width?:           number | null;
  height?:          number | null;
  pageCount?:       number | null;
  uploadStatus?:    'queued' | 'uploading' | 'uploaded' | 'failed';
  scanStatus?:      'pending' | 'clean' | 'blocked' | 'failed';
  createdAt?:       string;
}

export interface MessagePost {
  id:              string;
  threadId:        string;
  authorUserId:    string | null;
  authorName:      string | null;
  authorEmail:     string | null;
  body:            string | null;   // null ⇒ system-event post (renders from payload)
  isSystem:        boolean;
  attachmentCount: number;
  editedAt:        string | null;   // null ⇒ not edited
  deletedAt:       string | null;   // null ⇒ not deleted
  deletedBy?:      string | null;   // who soft-deleted it (author or a moderator)
  createdAt:       string;
  attachments:     MessageAttachment[];
  // ── Rich Add-On (optional until the post pipeline populates them) ──
  postType?:            'message' | 'system_event';
  systemEventType?:     MessageSystemEventType | null;
  systemEventPayload?:  Record<string, unknown>;
  authorRoleKey?:       string | null;
  authorProfileImage?:        string | null;
  authorInitials?:            string;
  authorProfileImageVersion?: number;
  priority?:            MessagePriority;
  isPinned?:            boolean;
  replyToPost?: {
    id:         string;
    authorName: string | null;
    preview:    string;
  } | null;
  deliveryStatus?:  'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  readByCount?:     number;
  // ── P0 hardening (populated by messaging_send_message_tx) ──
  /** Per-thread monotonic sequence number. null for legacy posts. */
  sequence?:              number | null;
  /** Client-generated UUID used for idempotent retry. */
  clientIdempotencyKey?:  string | null;
}

export interface MessageThread {
  id:               string;
  threadType:       MessageThreadType;
  subject:          string | null;
  sourceModule:     string | null;
  sourceEntityType: string | null;
  sourceEntityId:   string | null;
  createdBy:        string | null;
  createdAt:        string;
  lastPostAt:       string | null;
  lastPostPreview:  string | null;
  lastPostBy:       string | null;
  unreadCount:      number;
  participantCount: number;
  participants:     MessageParticipant[];
  isArchived:       boolean;
  myRole:           string;          // the requesting user's role in this thread
  // ── Rich Add-On (optional until the thread-list service populates them) ──
  lastPostAuthorName?: string | null;
  isUnread?:           boolean;
  isPinned?:           boolean;
  isMuted?:            boolean;
  hasDraft?:           boolean;
  draftPreview?:       string | null;
  failedSendCount?:    number;
  hasAttachments?:     boolean;
  actionRequired?:     boolean;
  priority?:           MessagePriority;
  // ── P0 hardening ──
  /** Thread version, bumped on every post/pin/membership change. Used for If-Match. */
  version?:            number;
  archivedAt?:         string | null;
}

/** A pinned thread or pinned post (visibility: shared with thread, or personal). */
export interface MessagePin {
  id:         string;
  threadId:   string;
  postId:     string | null;
  pinType:    'thread' | 'post';
  visibility: 'thread' | 'personal';
  pinnedBy:   { userId: string; displayName: string };
  pinnedAt:   string;
  note?:      string | null;
  postPreview?: {
    body:       string | null;
    authorName: string | null;
    createdAt:  string;
  } | null;
}

/** Right-hand context panel payload (profile, participants, pins, media, files). */
export interface ThreadContextResponse {
  thread: {
    id:             string;
    subject:        string | null;
    threadType:     MessageThreadType;
    actionRequired: boolean;
    priority:       MessagePriority;
    isPinned:       boolean;
    isMuted:        boolean;
    createdAt:      string;
    lastPostAt:     string | null;
  };
  participants: Array<{
    userId:      string;
    displayName: string;
    initials:    string;
    role:        string;
    status:      PresenceStatus;
    lastReadAt:  string | null;
  }>;
  pins:  MessagePin[];
  media: MessageAttachment[];
  files: MessageAttachment[];
  linkedRecord: {
    sourceModule:     string;
    sourceEntityType: string;
    sourceEntityId:   string;
    title:            string;
    status?:          string;
    route?:           string;
  } | null;
  details: {
    createdAt:       string;
    lastActivityAt:  string | null;
    unreadCount:     number;
    attachmentCount: number;
    auditEnabled:    boolean;
  };
}

/**
 * Fine-grained realtime reasons fired over the `messages` signal domain.
 * The client coarsely invalidates threads/posts/pins/context on any of these.
 */
export type MessageRealtimeReason =
  | 'post_created' | 'post_edited' | 'post_deleted' | 'system_event_created'
  | 'attachment_added' | 'thread_pinned' | 'post_pinned' | 'pin_removed'
  | 'participant_added' | 'participant_removed' | 'participant_left'
  | 'participant_role_changed' | 'thread_read' | 'thread_muted'
  | 'thread_archived' | 'typing_started' | 'typing_stopped';

export interface MessageThreadDetail {
  thread:       MessageThread;
  participants: MessageParticipant[];
}

export interface MessageRecipient {
  userId:        string;
  displayName:   string | null;
  email:         string | null;
  role?:         string;
  department?:   string | null;
  username?:     string | null;
  profileImage?: string | null;
}

/** Metadata-only row for the compliance thread browser (no message content). */
export interface ComplianceThread {
  threadId:         string;
  threadType:       MessageThreadType;
  subject:          string;
  lastPostAt:       string | null;
  participantCount: number;
  participantNames: string[];
  sourceModule:     string | null;
  sourceEntityType: string | null;
  sourceEntityId:   string | null;
  isParticipant:    boolean;
}
