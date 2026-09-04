import { type VNode } from 'preact';
import { FileTypeIcon, fileTypeIconTypeFromName, LucideIcon } from '@ui';
import { type CanonicalNotification } from '@api/communications';
import './notificationFileAttachment.css';

function metadataText(notification: CanonicalNotification, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = notification.metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function metadataNumber(notification: CanonicalNotification, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = notification.metadata?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function formatBytes(bytes: number | null): string | null {
  if (bytes == null || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

/** Shared rich file preview for notification center and compact bell dropdown. */
export function NotificationFileAttachment({
  notification, compact = false,
}: { notification: CanonicalNotification; compact?: boolean }): VNode | null {
  const fileName = metadataText(notification, ['fileName', 'file_name', 'attachmentName', 'attachment_name']);
  if (!fileName) return null;
  const fileSize = formatBytes(metadataNumber(notification, ['fileSize', 'file_size', 'sizeBytes', 'size_bytes']));

  return (
    <span class={`nc-rich-file${compact ? ' nc-rich-file--compact' : ''}`}>
      <span class="nc-rich-file__icon">
        <FileTypeIcon type={fileTypeIconTypeFromName(fileName)} size={compact ? 27 : 30} />
      </span>
      <span class="nc-rich-file__copy">
        <strong>{fileName}</strong>
        <small>{fileSize ?? 'Attached File'}</small>
      </span>
      <LucideIcon name="ArrowUpRight" />
    </span>
  );
}
