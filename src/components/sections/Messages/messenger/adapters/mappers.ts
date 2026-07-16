// adapters/mappers.ts — map the SIOMAC messaging DTO (types/messaging.ts, the
// single source of truth shared with the backend) onto the Messenger domain
// models (domain/models.ts). One place owns the impedance match; the adapters
// stay thin. camelCase both sides — this is a structural remap, not a rename.
import type {
  MessageThread as ThreadDTO,
  MessagePost as PostDTO,
  MessageAttachment as AttachmentDTO,
  MessageParticipant as ParticipantDTO,
  MessageAttachmentType,
  MessageSystemEventType,
} from '../../../../../../types/messaging';
import type { OnlineUser } from '@api/communications';
import type {
  Attachment, AttachmentKind, DeliveryState, Message, Thread, ThreadKind,
  TransferState, User, Presence,
} from '../domain/models';

// ── Attachments ────────────────────────────────────────────────────────────────
const ATTACHMENT_KIND: Record<MessageAttachmentType, AttachmentKind> = {
  image: 'image', video: 'video', audio: 'audio', pdf: 'pdf', word: 'word',
  excel: 'excel', powerpoint: 'powerpoint', text: 'text', archive: 'zip',
  document: 'generic', other: 'generic',
};

function mapTransferState(status: AttachmentDTO['uploadStatus']): TransferState {
  switch (status) {
    case 'queued':    return 'queued';
    case 'uploading': return 'uploading';
    case 'failed':    return 'failed';
    default:          return 'available';
  }
}

export function mapAttachment(a: AttachmentDTO): Attachment {
  const url = a.downloadUrl ?? a.url ?? undefined;
  const previewUrl = a.previewUrl ?? a.thumbnailUrl ?? undefined;
  return {
    id: a.id,
    kind: ATTACHMENT_KIND[a.attachmentType ?? 'other'] ?? 'generic',
    name: a.fileName,
    mimeType: a.contentType ?? '',
    sizeBytes: a.sizeBytes ?? 0,
    ...(url ? { url } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    transferState: mapTransferState(a.uploadStatus),
    progress: 100,
  };
}

// ── Posts → Messages ────────────────────────────────────────────────────────────
const SYSTEM_EVENT: Partial<Record<MessageSystemEventType, 'joined' | 'added' | 'removed' | 'created'>> = {
  participant_added:   'added',
  participant_removed: 'removed',
  participant_left:    'removed',
  thread_created:      'created',
};

function mapDelivery(status: PostDTO['deliveryStatus']): DeliveryState {
  switch (status) {
    case 'sending':   return 'sending';
    case 'delivered': return 'delivered';
    case 'read':      return 'read';
    case 'failed':    return 'failed';
    default:          return 'sent';
  }
}

export function mapPost(p: PostDTO): Message {
  const sysEvent = p.postType === 'system_event' && p.systemEventType ? SYSTEM_EVENT[p.systemEventType] : undefined;
  return {
    id: p.id,
    threadId: p.threadId,
    authorId: p.authorUserId ?? '',
    body: p.body ?? '',
    html: p.body ?? '',                       // backend already sanitizes; escape/markup is a Phase-3 render concern
    createdAt: p.createdAt,
    ...(p.editedAt ? { editedAt: p.editedAt } : {}),
    ...(p.replyToPost?.id ? { replyToId: p.replyToPost.id } : {}),
    attachments: (p.attachments ?? []).map(mapAttachment),
    reactions: [],                            // reactions hidden until its own backend slice
    delivery: mapDelivery(p.deliveryStatus),
    pinned: p.isPinned ?? false,
    deleted: p.deletedAt != null,
    ...(sysEvent ? { system: { event: sysEvent, subjectUserId: String((p.systemEventPayload ?? {})['userId'] ?? '') } } : {}),
  };
}

// ── Participants / online → Users ────────────────────────────────────────────────
function toPresence(status: string | undefined): Presence {
  return status === 'online' ? 'online' : 'offline';
}

export function mapParticipantToUser(p: ParticipantDTO): User {
  return {
    id: p.userId,
    name: p.displayName ?? p.username ?? p.userId,
    title: p.role ?? '',
    avatarUrl: p.profileImage ?? '',
    presence: toPresence(p.status),
  };
}

export function mapOnlineToUser(o: OnlineUser): User {
  return {
    id: o.userId,
    name: o.displayName ?? o.userId,
    title: '',
    avatarUrl: o.profileImage ?? '',
    presence: toPresence(o.status),
  };
}

// ── Threads ──────────────────────────────────────────────────────────────────────
function mapKind(threadType: ThreadDTO['threadType']): ThreadKind {
  return threadType === 'direct' ? 'direct' : 'group';
}

/** For a direct thread, the display name/avatar is the OTHER participant. */
function directCounterpart(t: ThreadDTO, currentUserId: string): ParticipantDTO | undefined {
  return t.participants.find(p => p.userId !== currentUserId) ?? t.participants[0];
}

export function mapThread(t: ThreadDTO, currentUserId: string): Thread {
  const isDirect = t.threadType === 'direct';
  const other = isDirect ? directCounterpart(t, currentUserId) : undefined;
  const queue = t.isArchived
    ? 'archived'
    : (t.threadType === 'record' || t.threadType === 'system' ? 'compliance' : 'inbox');
  return {
    id: t.id,
    kind: mapKind(t.threadType),
    name: isDirect ? (other?.displayName ?? other?.username ?? 'Direct message') : (t.subject ?? 'Group'),
    avatarUrl: isDirect ? (other?.profileImage ?? '') : '',
    participantIds: t.participants.map(p => p.userId),
    queue,
    unreadCount: t.unreadCount ?? 0,
    muted: t.isMuted ?? false,
    favourite: false,                          // favourites hidden until its own backend slice
    complianceControlled: t.threadType === 'record' || t.threadType === 'system',
    ...(t.sourceModule && t.sourceEntityId ? {
      relatedRecord: {
        id: t.sourceEntityId,
        type: 'Document' as const,             // refined per-module in Phase 3 (collaboration cards)
        title: t.subject ?? '',
        href: '',
      },
    } : {}),
    lastActivityAt: t.lastPostAt ?? t.createdAt,
  };
}
