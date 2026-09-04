import { type VNode } from 'preact';
import { LucideIcon, type LucideName } from '@ui';
import './notificationEmptyVisual.css';

export type NotificationEmptyVisualKind = 'all' | 'unread' | 'action' | 'archived' | 'search' | 'error';

const ICONS: Record<NotificationEmptyVisualKind, readonly [LucideName, LucideName, LucideName, LucideName, LucideName]> = {
  all: ['CalendarClock', 'ClipboardCheck', 'BellOff', 'UserCheck', 'Inbox'],
  unread: ['MailOpen', 'CheckCheck', 'MailCheck', 'Inbox', 'CircleCheckBig'],
  action: ['ClipboardList', 'BadgeCheck', 'ClipboardCheck', 'ListChecks', 'CircleCheckBig'],
  archived: ['PackageOpen', 'FileClock', 'Archive', 'FolderArchive', 'History'],
  search: ['Bell', 'Inbox', 'SearchX', 'ClipboardCheck', 'CalendarClock'],
  error: ['WifiOff', 'ServerOff', 'CloudOff', 'RefreshCw', 'TriangleAlert'],
};

/** Search-style icon cluster used by notification empty and error states. */
export function NotificationEmptyVisual({
  kind = 'all', compact = false,
}: { kind?: NotificationEmptyVisualKind; compact?: boolean }): VNode {
  return (
    <div class={`nc-empty-visual${compact ? ' nc-empty-visual--compact' : ''}`} aria-hidden="true">
      {ICONS[kind].map((icon, index) => (
        <span key={`${kind}-${icon}-${index}`}>
          <LucideIcon name={icon} size={index === 2 ? 22 : 18} strokeWidth={index === 2 ? 1.55 : 1.6} />
        </span>
      ))}
    </div>
  );
}
