/**
 * A compact, scan-friendly notification row. It uses the canonical Avatar,
 * Badge, Button and Lucide icon components while leaving business behaviour in
 * NotificationDropdown. An actor avatar is shown only when the event carries
 * real actor metadata; system events use their module icon.
 */

import { type VNode } from 'preact';
import { type CanonicalNotification } from '@api/communications';
import {
  Avatar, Badge, Button, NotificationListItem,
  type NotificationIndicatorTone,
} from '@ui';
import { moduleMeta, relativeTime } from './notifMeta';
import { NotificationFileAttachment } from './NotificationFileAttachment';

const INDICATOR_TONE: Record<string, NotificationIndicatorTone> = {
  critical: 'danger',
  warning: 'warning',
  success: 'success',
  info: 'info',
};

function metadataText(n: CanonicalNotification, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = n.metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function NotificationDropdownItem({ n, onOpen }: {
  n: CanonicalNotification;
  onOpen: (n: CanonicalNotification) => void;
}): VNode {
  const mod = moduleMeta(n);
  const actionPending = n.action_required && n.action_status === 'pending';
  const muted = n.action_status === 'completed' || n.action_status === 'expired' || n.action_status === 'dismissed';
  const showDot = !n.is_read && !muted;
  const actorName = metadataText(n, ['actorName', 'actor_name', 'senderName', 'sender_name']);
  const actorPhoto = metadataText(n, ['actorPhotoUrl', 'actor_photo_url', 'senderPhotoUrl', 'sender_photo_url']);
  const source = n.source_id && !n.source_id.startsWith('SEED-') ? n.source_id : null;
  const time = relativeTime(n.created_at);

  return <NotificationListItem
    title={n.title}
    description={n.body ?? undefined}
    metadata={[mod.label, ...(source ? [source] : [])]}
    timestamp={time}
    dateTime={n.created_at}
    iconVariant={mod.notificationVariant}
    visual={actorName ? <Avatar name={actorName} src={actorPhoto} size={36} decorative /> : undefined}
    status={actionPending ? <Badge tone="warning" size="sm">Action Required</Badge> : undefined}
    details={<NotificationFileAttachment notification={n} compact />}
    action={actionPending ? <Button variant="secondary" size="sm" onClick={() => onOpen(n)}>Review</Button> : undefined}
    unread={showDot}
    indicatorTone={INDICATOR_TONE[n.severity] ?? 'neutral'}
    muted={muted}
    onOpen={() => onOpen(n)}
  />;
}
