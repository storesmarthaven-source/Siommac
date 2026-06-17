/**
 * src/components/sections/Tickets/TicketQueue.tsx
 *
 * Ticket list view — replaces the innerHTML rendering in TicketsPanel.ts.
 *
 * Preserves all visual behaviour from the legacy panel:
 *   ✓ "New reply" indicator with red pill badge
 *   ✓ Status badge (open / in-progress / resolved / closed / deleted)
 *   ✓ SLA overdue badge (>48 h open)
 *   ✓ Sorted by latest activity
 *   ✓ Admins see all tickets; employees see own only
 *   ✓ Employees can delete their own open/in-progress tickets
 *   ✓ Seen-reply tracking via localStorage (per-user key)
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { useMemo, useCallback }  from 'preact/hooks';
import { useSessionStore }        from '@store/session';
import { Spinner }                from '@shared/Spinner';
import { confirm }                from '@shared/ConfirmDialog';
import { useTickets, useDeleteTicket } from './hooks';
import { useSeenReplies }         from './useSeenReplies';
import {
  TICKET_STATUS_LABEL,
  TICKET_STATUS_CSS,
  ticketLatestAt,
  isOverdue,
} from '@api/schemas/ticket';
import type { TicketRow }         from '@api/schemas/ticket';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function initials(name: string): string {
  return (name || '?').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── Row component ─────────────────────────────────────────────────────────────

interface TicketRowProps {
  ticket:    TicketRow;
  isAdmin:   boolean;
  username:  string;
  seenIds:   Set<string>;
  onOpen:    (id: string) => void;
  onDelete:  (id: string) => void;
}

function TicketRowItem({ ticket: t, isAdmin, username, seenIds, onOpen, onDelete }: TicketRowProps) {
  const isDeleted   = t.status === 'deleted';
  const isSentByMe  = t.fromUsername === username;
  const css         = TICKET_STATUS_CSS[t.status] ?? 'open';
  const lbl         = TICKET_STATUS_LABEL[t.status] ?? t.status;
  const lastReply   = t.replies.length ? t.replies[t.replies.length - 1]! : null;
  const latestTime  = ticketLatestAt(t);
  const previewBody = lastReply ? lastReply.body : t.body;
  const previewBy   = lastReply
    ? (lastReply.fromUsername === username ? 'You' : (lastReply.fromName || lastReply.fromUsername))
    : (isSentByMe ? 'You' : (t.fromName || t.fromUsername));

  const unseenCount = t.replies.filter(
    r => !seenIds.has(r.id) && r.fromUsername !== username,
  ).length;
  const hasNew = unseenCount > 0 && !isDeleted;

  const canDelete = !isAdmin && !isDeleted &&
    (t.status === 'open' || t.status === 'in_progress');

  const displayName = isAdmin ? (t.fromName || '—') : `#${t.ticketNumber}`;
  const avatarName  = isAdmin ? (t.fromName || 'U') : 'Me';
  const inits       = initials(avatarName);

  return (
    <div
      class={`hdr-ticket-item ${css}${isDeleted ? ' hdr-ticket-deleted' : ''}${hasNew ? ' unread' : ''}`}
      data-ticket-id={t.id}
      onClick={() => !isDeleted || isAdmin ? onOpen(t.id) : undefined}
      style={{
        cursor:       (!isDeleted || isAdmin) ? 'pointer' : 'default',
        borderLeft:   hasNew ? '3px solid var(--siomac-red)' : '3px solid transparent',
        paddingLeft:  '11px',
        opacity:      isDeleted ? 0.6 : 1,
        pointerEvents: (isDeleted && !isAdmin) ? 'none' : 'auto',
      }}
    >
      {/* Avatar */}
      {t.fromPhoto
        ? <img
            src={t.fromPhoto}
            alt={inits}
            crossOrigin="anonymous"
            style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', filter: isDeleted ? 'grayscale(1)' : '', border: '2px solid var(--border)' }}
          />
        : <div
            class="hdr-msg-avatar"
            style={{ width: 36, height: 36, fontSize: '0.7rem', background: isDeleted ? '#aaa' : (isSentByMe ? 'var(--siomac-navy,#1b2d54)' : undefined) }}
          >
            {inits}
          </div>
      }

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontWeight: hasNew ? 700 : 600,
            color:      hasNew ? 'var(--text-primary)' : 'var(--text-muted)',
            textDecoration: isDeleted ? 'line-through' : undefined,
          }}>
            {displayName}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span class={`hdr-ticket-status ${css}`}>{lbl}</span>
            {isOverdue({ ...t }) && (
              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#e40c0c', background: 'rgba(228,12,12,0.09)', border: '1.5px solid rgba(228,12,12,0.22)', borderRadius: 4, padding: '1px 5px' }}>
                Overdue
              </span>
            )}
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {timeAgo(latestTime)}
            </span>
          </div>
        </div>

        <div class="hdr-ticket-title" style={{ fontWeight: hasNew ? 700 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t.subject}
        </div>
        <div class="hdr-ticket-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ fontStyle: 'italic' }}>{previewBy}:</span> {previewBody || '—'}
        </div>
      </div>

      {/* New reply indicator */}
      {hasNew && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, alignSelf: 'center', background: 'rgba(228,12,12,0.09)', border: '1.5px solid rgba(228,12,12,0.22)', borderRadius: 20, padding: '2px 7px 2px 5px', whiteSpace: 'nowrap' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--siomac-red)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--siomac-red)' }}>New reply</span>
        </span>
      )}

      {/* Delete button (employees only, open/in-progress) */}
      {canDelete && (
        <button
          title="Delete ticket"
          onClick={e => { e.stopPropagation(); onDelete(t.id); }}
          style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--siomac-red,#e40c0c)', fontSize: '0.75rem', padding: '2px 6px', borderRadius: 6, opacity: 0.7, flexShrink: 0 }}
        >
          <i class="fas fa-trash-alt" />
        </button>
      )}
    </div>
  );
}

// ── Queue ─────────────────────────────────────────────────────────────────────

interface TicketQueueProps {
  onOpenTicket:  (id: string) => void;
  onNewTicket:   () => void;
}

export function TicketQueue({ onOpenTicket, onNewTicket: _ }: TicketQueueProps) {
  const { data: tickets = [], isLoading, error } = useTickets();
  const { seenIds, markAllSeen } = useSeenReplies();
  const deleteMut  = useDeleteTicket();
  const role       = useSessionStore(s => s.role);
  const username   = useSessionStore(s => s.username) ?? '';
  const isAdmin    = role === 'admin' || role === 'manager';

  const sorted = useMemo(() => {
    const visible = isAdmin
      ? tickets
      : tickets.filter(t => t.status !== 'deleted');
    return [...visible].sort(
      (a, b) => new Date(ticketLatestAt(b)).getTime() - new Date(ticketLatestAt(a)).getTime(),
    );
  }, [tickets, isAdmin]);

  const handleOpen = useCallback((id: string) => {
    // Mark all replies on this ticket as seen
    const t = tickets.find(x => x.id === id);
    if (t) markAllSeen(t.replies.map(r => r.id));
    onOpenTicket(id);
  }, [tickets, markAllSeen, onOpenTicket]);

  const handleDelete = useCallback(async (id: string) => {
    const t = tickets.find(x => x.id === id);
    const ok = await confirm({
      title:        'Delete Ticket?',
      message:      t ? `Delete ticket #${t.ticketNumber} — "${t.subject}"? This cannot be undone.` : 'Delete this ticket? This cannot be undone.',
      variant:      'danger',
      confirmLabel: 'Delete',
    });
    if (ok) void deleteMut.mutateAsync(id);
  }, [tickets, deleteMut]);

  if (isLoading) {
    return (
      <div class="hdr-modal-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
        <Spinner size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div class="hdr-notif-empty">
        <i class="fas fa-exclamation-circle" style={{ opacity: 0.4 }} />
        <p>Failed to load tickets.</p>
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div class="hdr-notif-empty">
        <i class="fas fa-ticket-alt" style={{ opacity: 0.3 }} />
        <p>No tickets yet</p>
      </div>
    );
  }

  return (
    <div class="hdr-modal-body" style={{ padding: 0, overflowY: 'auto' }}>
      {sorted.map(t => (
        <TicketRowItem
          key={t.id}
          ticket={t}
          isAdmin={isAdmin}
          username={username}
          seenIds={seenIds}
          onOpen={handleOpen}
          onDelete={handleDelete}
        />
      ))}
    </div>
  );
}
