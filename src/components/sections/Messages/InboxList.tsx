/**
 * src/components/sections/Messages/InboxList.tsx
 *
 * Inbox list pane — renders a sorted list of message conversations.
 * Replaces the DOM-string msgRowHtml + renderList in MessagesPanel.ts.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h }               from 'preact';
import { useMemo }         from 'preact/hooks';
import { useSessionStore } from '@store/session';
import { confirm }         from '@shared/ConfirmDialog';
import { useDeleteMessage, useMarkRead } from './hooks';
import type { MsgItem }    from '@components/nav/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgoShort(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)    return 'Just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function initials(name: string): string {
  return (name || '?').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function msgLatest(m: MsgItem): string {
  return m.latestAt ?? (m.replies.length ? m.replies[m.replies.length - 1]!.createdAt : m.createdAt);
}

// ── Row component ─────────────────────────────────────────────────────────────

interface RowProps {
  msg:       MsgItem;
  isAdmin:   boolean;
  username:  string;
  onOpen:    (id: string | number) => void;
  onDeleted: () => void;
}

function MsgRow({ msg: m, isAdmin, username, onOpen, onDeleted }: RowProps) {
  const deleteMut = useDeleteMessage();
  const markRead  = useMarkRead();

  const isSentByMe  = m.fromUsername === username;
  const otherName   = isSentByMe ? m.toName   : m.fromName;
  const otherPhoto  = isSentByMe ? m.toPhoto  : m.fromPhoto;
  const inits       = initials(otherName);
  const replyCount  = m.replies.length;
  const lastReply   = replyCount ? m.replies[replyCount - 1]! : null;
  const previewBody = lastReply ? lastReply.body : m.body;
  const previewBy   = lastReply
    ? (lastReply.fromUsername === username ? 'You' : lastReply.fromName)
    : (isSentByMe ? 'You' : m.fromName);
  const isDeleted   = !!m.otherPartyDeleted;
  const hasUnread   = (m.isUnread || m.unreadReplyCount > 0) && !isDeleted;
  const latestTime  = msgLatest(m);

  async function handleDelete(e: MouseEvent) {
    e.stopPropagation();
    const label = `"${m.subject}"`;
    const ok    = await confirm({
      title:        `Delete ${label}?`,
      message:      'This will permanently delete the entire conversation and all replies. This cannot be undone.',
      variant:      'danger',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    deleteMut.mutate(m.id, { onSuccess: onDeleted });
  }

  function handleOpen() {
    if (hasUnread) markRead.mutate(m.id);
    onOpen(m.id);
  }

  return (
    <div
      class={`hdr-msg-item${hasUnread ? ' unread' : ''}`}
      style={{
        borderLeft: hasUnread ? '3px solid var(--siomac-red)' : '3px solid transparent',
        paddingLeft: 11,
        opacity: isDeleted ? 0.6 : undefined,
      }}
      onClick={handleOpen}
    >
      {/* Avatar */}
      {otherPhoto
        ? <img
            src={otherPhoto}
            alt={inits}
            crossOrigin="anonymous"
            class="hdr-msg-avatar"
            style={{ objectFit: 'cover', border: `2px solid ${isDeleted ? 'var(--border)' : 'var(--border,#eee)'}`, filter: isDeleted ? 'grayscale(1)' : undefined }}
          />
        : <div
            class="hdr-msg-avatar"
            style={isDeleted ? 'background:#aaa;color:#fff;' : (isSentByMe ? 'background:var(--siomac-navy,#001f3f);color:#fff;' : undefined)}
          >
            {inits}
          </div>
      }

      {/* Text */}
      <div class="hdr-msg-text" style={{ flex: 1, minWidth: 0 }}>
        <div class="hdr-msg-name" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: hasUnread ? 700 : 600, color: hasUnread ? 'var(--text-primary)' : 'var(--text-muted)', textDecoration: isDeleted ? 'line-through' : undefined }}>
            {otherName}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {isDeleted && (
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>
                Removed
              </span>
            )}
            <span class="hdr-msg-time" style={{ whiteSpace: 'nowrap' }}>
              {timeAgoShort(latestTime)}
            </span>
          </div>
        </div>
        <div style={{ fontSize: '0.78rem', fontWeight: hasUnread ? 700 : 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.subject}
        </div>
        <div class="hdr-msg-preview">
          <em>{previewBy}:</em>{' '}{previewBody}
        </div>
      </div>

      {/* Unread indicator dot */}
      {hasUnread && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, alignSelf: 'center', background: 'rgba(228,12,12,0.09)', border: '1.5px solid rgba(228,12,12,0.22)', borderRadius: 20, padding: '2px 7px 2px 5px', whiteSpace: 'nowrap' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--siomac-red)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--siomac-red)' }}>
            {m.isUnread ? 'Unread' : 'New reply'}
          </span>
        </span>
      )}

      {/* Admin delete button */}
      {isAdmin && (
        <button
          title="Delete conversation"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--siomac-red,#e40c0c)', fontSize: '0.75rem', padding: '4px 6px', borderRadius: 6, opacity: 0.6, flexShrink: 0 }}
          onClick={handleDelete}
          disabled={deleteMut.isPending}
        >
          <i class="fas fa-trash-alt" />
        </button>
      )}
    </div>
  );
}

// ── InboxList ─────────────────────────────────────────────────────────────────

interface InboxListProps {
  messages:  MsgItem[];
  onOpen:    (id: string | number) => void;
  onRefetch: () => void;
}

export function InboxList({ messages, onOpen, onRefetch }: InboxListProps) {
  const username = useSessionStore(s => s.username) ?? '';
  const role     = useSessionStore(s => s.role);
  const isAdmin  = role === 'admin' || role === 'manager';

  const sorted = useMemo(() => {
    return [...messages].sort((a, b) =>
      (new Date(msgLatest(b)).getTime() || 0) - (new Date(msgLatest(a)).getTime() || 0),
    );
  }, [messages]);

  if (!sorted.length) {
    return (
      <div class="hdr-notif-empty">
        <i class="fas fa-inbox" />
        <p>No messages yet</p>
      </div>
    );
  }

  return (
    <>
      {sorted.map(m => (
        <MsgRow
          key={String(m.id)}
          msg={m}
          isAdmin={isAdmin}
          username={username}
          onOpen={onOpen}
          onDeleted={onRefetch}
        />
      ))}
    </>
  );
}
