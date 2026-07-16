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
  Attachment, AttachmentKind, DeliveryState, LinkPreview, Message, Thread, ThreadKind,
  TransferState, User, Presence,
} from '../domain/models';
import { linkPreviewFromUrl } from '../domain/format';

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

// First URL in a message body → a rendered link-preview card (the backend has no
// separate link field; the composer persists attached links into the body).
const BODY_URL = /(?:https?:\/\/)[^\s<]+/i;

function linkFromBody(body: string): LinkPreview | undefined {
  const url = body.match(BODY_URL)?.[0];
  if (!url) return undefined;
  try { return linkPreviewFromUrl(url); } catch { return undefined; }
}

export function mapPost(p: PostDTO): Message {
  // ANY system-generated post renders as a system event (never as a normal
  // message with actions — the backend rejects reactions/pins/deletes on them).
  // Unmapped/legacy system events fall back to the generic 'created' rendering.
  const isSystemPost = p.isSystem || p.postType === 'system_event';
  const sysEvent = isSystemPost
    ? ((p.systemEventType ? SYSTEM_EVENT[p.systemEventType] : undefined) ?? 'created')
    : undefined;
  const link = !sysEvent ? linkFromBody(p.body ?? '') : undefined;
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
    ...(link ? { link } : {}),
    reactions: (p.reactions ?? []).map(r => ({ emoji: r.emoji, userIds: r.userIds })),
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

export function mapThread(t: ThreadDTO, currentUserId: string, authoredByMe = false): Thread {
  const isDirect = t.threadType === 'direct';
  const other = isDirect ? directCounterpart(t, currentUserId) : undefined;
  // Legacy-parity queue model: every participant thread lives in Inbox (or
  // Archived) — record/system threads included, with the compliance shield as
  // a badge. The Compliance TAB is the separate audited browser surface.
  const queue = t.isArchived ? 'archived' : 'inbox';
  return {
    id: t.id,
    kind: mapKind(t.threadType),
    name: isDirect ? (other?.displayName ?? other?.username ?? 'Direct message') : (t.subject ?? 'Group'),
    avatarUrl: isDirect ? (other?.profileImage ?? '') : '',
    participantIds: t.participants.map(p => p.userId),
    queue,
    unreadCount: t.unreadCount ?? 0,
    muted: t.isMuted ?? false,
    favourite: t.isFavourite ?? false,
    authoredByMe,
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
