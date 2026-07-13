/**
 * src/components/sections/Tickets/TicketDetail.tsx
 *
 * Ticket thread view + reply input + admin status controls.
 *
 * Replaces showDetail() / updateTicketDetail() / ticketBubbleHtml() from
 * TicketsPanel.ts with a declarative Preact component.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { useState, useEffect, useRef } from 'preact/hooks';
import { useSessionStore }  from '@store/session';
import { Spinner }          from '@shared/Spinner';
import { useTickets, useSendReply, useUpdateStatus } from './hooks';
import { useSeenReplies }   from './useSeenReplies';
import {
  TICKET_STATUS_LABEL,
  TICKET_STATUS_CSS,
  TICKET_STATUSES,
  isClosed,
} from '@api/schemas/ticket';
import type {  TicketReply, TicketStatus } from '@api/schemas/ticket';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Reply bubble ──────────────────────────────────────────────────────────────

function ReplyBubble({ reply: r, username }: { reply: TicketReply; username: string }) {
  const isMe     = r.fromUsername === username;
  const isSystem = r.fromUsername === '__system__';

  if (isSystem) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', marginBottom: 8 }}>
        <i class="fas fa-lock" style={{ color: '#aaa', fontSize: '0.7rem', flexShrink: 0 }} />
        <span style={{ fontSize: '0.75rem', color: '#999', fontStyle: 'italic' }}>{r.body}</span>
        <span style={{ fontSize: '0.67rem', color: '#bbb', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{timeAgo(r.createdAt)}</span>
      </div>
    );
  }

  const name        = r.fromName || r.fromUsername || '?';
  const inits       = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const align       = isMe ? 'flex-end'   : 'flex-start';
  const bubbleBg    = isMe ? 'var(--siomac-navy,#1b2d54)' : 'var(--bg-subtle,#f0f2f5)';
  const bubbleColor = isMe ? '#fff'        : 'var(--text-primary)';
  const avatarBg    = isMe ? 'var(--siomac-navy,#1b2d54)' : 'var(--siomac-red,#e40c0c)';
  const borderColor = isMe ? 'var(--siomac-navy,#1b2d54)' : 'var(--border,#ddd)';
  const borderRadius= isMe ? '12px 12px 4px 12px' : '12px 12px 12px 4px';
  const flexDir     = isMe ? 'row-reverse' : 'row';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, flexDirection: flexDir }}>
        {r.fromPhoto
          ? <img src={r.fromPhoto} alt={name} crossOrigin="anonymous"
              style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${borderColor}` }} />
          : <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarBg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 'var(--font-weight-bold)', flexShrink: 0 }}>
              {inits}
            </div>
        }
        <div style={{ maxWidth: '75%', background: bubbleBg, color: bubbleColor, padding: '7px 11px', borderRadius: borderRadius, fontSize: '0.81rem', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
          {r.body}
        </div>
      </div>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 3, textAlign: isMe ? 'right' : 'left' }}>
        {isMe ? 'You' : name} · {timeAgo(r.createdAt)}
      </div>
    </div>
  );
}

// ── Detail ────────────────────────────────────────────────────────────────────

interface TicketDetailProps {
  ticketId: string;
  onBack:   () => void;
}

export function TicketDetail({ ticketId, onBack }: TicketDetailProps) {
  const { data: tickets = [], isLoading } = useTickets();
  const { markAllSeen } = useSeenReplies();
  const username   = useSessionStore(s => s.username) ?? '';
  const role       = useSessionStore(s => s.role);
  const isAdmin    = role === 'admin' || role === 'manager';

  const ticket = tickets.find(t => t.id === ticketId);

  const replyMut      = useSendReply(ticketId);
  const statusMut     = useUpdateStatus(ticketId);

  const [replyText, setReplyText] = useState('');
  const [pendingStatus, setPendingStatus] = useState<TicketStatus | ''>('');
  const bodyRef = useRef<HTMLDivElement>(null);

  // Mark all replies as seen when this ticket is opened
  useEffect(() => {
    if (ticket) {
      markAllSeen(ticket.replies.map(r => r.id));
    }
  }, [ticket?.replies.length]);   // only re-run when reply count changes

  // Scroll to bottom on new replies
  useEffect(() => {
    if (bodyRef.current) {
      requestAnimationFrame(() => {
        if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      });
    }
  }, [ticket?.replies.length]);

  // Sync status select with server value (only when not dirty)
  useEffect(() => {
    if (ticket) setPendingStatus(ticket.status);
  }, [ticket?.status]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 120 }}>
        <Spinner size={24} />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Ticket not found.
      </div>
    );
  }

  const closed      = isClosed(ticket);
  const isDeleted   = ticket.status === 'deleted';
  const css         = TICKET_STATUS_CSS[ticket.status] ?? 'open';
  const lbl         = TICKET_STATUS_LABEL[ticket.status] ?? ticket.status;
  const replyDisabled = closed || replyMut.isPending;

  function handleSendReply() {
    const body = replyText.trim();
    if (!body || replyDisabled) return;
    setReplyText('');
    replyMut.mutate(body);
  }

  function handleStatusSave() {
    if (!pendingStatus || pendingStatus === ticket?.status) return;
    statusMut.mutate(pendingStatus);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Deleted banner */}
      {isDeleted && (
        <div style={{ padding: '8px 16px', background: '#fff3cd', borderBottom: '1px solid #ffc107', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: '#7a5c00' }}>
          <i class="fas fa-trash-alt" />
          <span>This ticket was <strong>deleted by the employee</strong> before it was resolved.</span>
        </div>
      )}

      {/* Header */}
      <div ref={bodyRef} class="hdr-modal-body" style={{ flex: 1, padding: 0, overflowY: 'auto' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', opacity: isDeleted ? 0.65 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span class="hdr-ticket-id" style={{ textDecoration: isDeleted ? 'line-through' : undefined }}>
              #{ticket.ticketNumber}
            </span>
            <span class={`hdr-ticket-status ${css}`}>{lbl}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {timeAgo(ticket.createdAt)}
            </span>
          </div>
          <div style={{ fontSize: '0.88rem', fontWeight: 'var(--font-weight-bold)', marginBottom: 6, textDecoration: isDeleted ? 'line-through' : undefined }}>
            {ticket.subject}
          </div>
          {isAdmin && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>
              Reported by {ticket.fromName}
            </div>
          )}
          <div style={{ fontSize: '0.83rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
            {ticket.body}
          </div>
        </div>

        {/* Reply bubbles */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column' }}>
          {ticket.replies.map(r => (
            <ReplyBubble key={r.id} reply={r} username={username} />
          ))}
        </div>
      </div>

      {/* Reply input + controls */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          rows={3}
          class="form-control"
          placeholder={
            isDeleted ? 'This ticket has been deleted.' :
            closed    ? 'This ticket is closed and can no longer be replied to.' :
                        'Write your reply…'
          }
          disabled={replyDisabled}
          value={replyText}
          onInput={e => setReplyText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSendReply(); }}
          style={{
            resize: 'none',
            background: closed ? 'var(--bg-subtle,#f8fafe)' : undefined,
            color:      closed ? 'var(--text-muted)' : undefined,
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <button class="hdr-foot-link" style={{ color: 'var(--siomac-navy)' }} onClick={onBack}>
            <i class="fas fa-arrow-left" /> Back
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Admin: status selector */}
            {isAdmin && !isDeleted && (
              <>
                <select
                  class="form-select"
                  value={pendingStatus}
                  onChange={e => setPendingStatus((e.target as HTMLSelectElement).value as TicketStatus)}
                  style={{ width: 'auto', padding: '4px 28px 4px 8px', fontSize: '0.78rem' }}
                >
                  {TICKET_STATUSES.filter(s => s !== 'deleted').map(s => (
                    <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>
                  ))}
                </select>
                <button
                  class="hdr-foot-link"
                  disabled={statusMut.isPending || pendingStatus === ticket.status}
                  onClick={handleStatusSave}
                >
                  {statusMut.isPending
                    ? <Spinner size={16} />
                    : <><i class="fas fa-save" /> Update</>
                  }
                </button>
              </>
            )}
            <button
              class="hdr-foot-link"
              disabled={replyDisabled || !replyText.trim()}
              style={{ color: 'var(--siomac-blue)', opacity: (replyDisabled || !replyText.trim()) ? 0.4 : 1 }}
              onClick={handleSendReply}
            >
              {replyMut.isPending
                ? <Spinner size={16} />
                : <><i class="fas fa-paper-plane" /> Send Reply</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
