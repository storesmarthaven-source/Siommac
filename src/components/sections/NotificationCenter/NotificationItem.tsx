/** Product adapter from canonical notification data to the UI Kit notification row. */

import { type VNode } from 'preact';
import { type CanonicalNotification } from '@api/communications';
import {
  Avatar, Badge, Button, LucideIcon, NotificationListItem,
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

function notificationStatus(n: CanonicalNotification): VNode | undefined {
  if (n.action_required && n.action_status === 'pending') {
    return <Badge tone="warning" size="sm">Action Required</Badge>;
  }
  if (n.action_status === 'completed') {
    return <Badge tone="success" size="sm" icon={<LucideIcon name="Check" />}>Completed</Badge>;
  }
  if (n.action_status === 'expired' || n.action_status === 'dismissed') {
    return <Badge tone="neutral" size="sm">Archived</Badge>;
  }
  return undefined;
}

export function NotificationItem({ n, onOpen, onArchive }: {
  n: CanonicalNotification;
  onOpen: (n: CanonicalNotification) => void;
  onArchive?: (n: CanonicalNotification) => void;
}): VNode {
  const mod = moduleMeta(n);
  const muted = n.action_status === 'completed' || n.action_status === 'expired' || n.action_status === 'dismissed';
  const actorName = metadataText(n, ['actorName', 'actor_name', 'senderName', 'sender_name']);
  const actorPhoto = metadataText(n, ['actorPhotoUrl', 'actor_photo_url', 'senderPhotoUrl', 'sender_photo_url']);
  const context = metadataText(n, [
    'projectName', 'project_name', 'siteName', 'site_name', 'entityName', 'entity_name',
    'caseNo', 'case_no', 'claimNo', 'claim_no', 'runNo', 'run_no', 'payslipNo', 'payslip_no',
  ]);
  const source = n.source_id && !n.source_id.startsWith('SEED-') ? n.source_id : null;
  const due = n.due_at ? `Due ${relativeTime(n.due_at)}` : null;
  const actionPending = n.action_required && n.action_status === 'pending';
  const details = <NotificationFileAttachment notification={n} />;

  return <NotificationListItem
    class="nc-center-item"
    title={n.title}
    description={n.body ?? undefined}
    metadata={[mod.label, ...(context ? [context] : []), ...(source && source !== context ? [source] : []), ...(due ? [due] : [])]}
    timestamp={relativeTime(n.created_at)}
    dateTime={n.created_at}
    iconVariant={mod.notificationVariant}
    visual={actorName ? <Avatar name={actorName} src={actorPhoto} size={36} decorative /> : undefined}
    status={notificationStatus(n)}
    details={details}
    controls={onArchive ? <Button
      variant="ghost"
      size="sm"
      tone="danger"
      iconOnly
      aria-label={`Archive ${n.title}`}
      title="Archive Notification"
      iconLeft={<LucideIcon name="Archive" />}
      onClick={() => onArchive(n)}
    /> : undefined}
    action={actionPending ? (
      <div class="nc-rich-actions">
        <Button variant="secondary" size="sm" iconRight={<LucideIcon name="ArrowRight" />} onClick={() => onOpen(n)}>
          Review Details
        </Button>
        {due && <span>{due}</span>}
      </div>
    ) : undefined}
    unread={!n.is_read && !muted}
    indicatorTone={INDICATOR_TONE[n.severity] ?? 'neutral'}
    muted={muted}
    onOpen={() => onOpen(n)}
  />;
}
