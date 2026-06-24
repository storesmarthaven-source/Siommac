/**
 * src/components/sections/Messages/MessageDropdownItem.tsx
 *
 * Soft thread row for the header message dropdown. Avatar (initials fallback),
 * thread title, last-post preview, relative time, and unread dot/count.
 * Mirrors NotificationDropdownItem's visual softness.
 */

import { type VNode } from 'preact';
import type { MessageThreadListItem } from '@api/communications';
import { useSessionStore } from '@store/session';
import { threadTitle, threadAvatarParticipant } from './threadDisplay';

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export function MessageDropdownItem({ thread, onOpen }: {
  thread:  MessageThreadListItem;
  onOpen:  (t: MessageThreadListItem) => void;
}): VNode {
  const myId        = useSessionStore(s => s.userId);
  const isUnread    = thread.unreadCount > 0;
  const displayName = threadTitle(thread, myId);
  const preview   = thread.lastPostPreview ?? '';
  const timeStr   = relativeTime(thread.lastPostAt ?? thread.createdAt);

  // Avatar: the OTHER person (excluded by id, not by a non-existent 'self' role).
  const firstParticipant = threadAvatarParticipant(thread.participants, myId);
  const avatarUrl  = firstParticipant?.profileImage ?? null;
  const avatarText = initials(firstParticipant?.displayName ?? firstParticipant?.username);

  return (
    <div
      onClick={() => onOpen(thread)}
      class={`nc-row${isUnread ? ' is-unread' : ''}`}
      style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '16px 14px',
        borderBottom: '1px solid var(--border)', cursor: 'pointer',
        background: isUnread ? 'rgba(27,45,85,0.06)' : 'transparent',
        borderLeft: isUnread ? '3px solid var(--siomac-navy)' : '3px solid transparent' }}
    >
      {/* Avatar */}
      <div style={{ width: '42px', height: '42px', borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: avatarUrl ? 'transparent' : 'rgba(27,45,85,0.12)', overflow: 'hidden' }}>
        {avatarUrl
          ? <img src={avatarUrl} alt={avatarText} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--siomac-navy)' }}>{avatarText}</span>
        }
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', fontWeight: isUnread ? 700 : 500,
            color: 'var(--siomac-navy)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {displayName}
          </span>
          <span style={{ flexShrink: 0, fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {timeStr}
          </span>
          {isUnread && (
            <span style={{ flexShrink: 0, minWidth: '18px', height: '18px', borderRadius: '9px',
              background: 'var(--siomac-navy)', color: '#fff', fontSize: '0.62rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
              {thread.unreadCount > 9 ? '9+' : thread.unreadCount}
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '3px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {preview}
        </div>
      </div>
    </div>
  );
}
