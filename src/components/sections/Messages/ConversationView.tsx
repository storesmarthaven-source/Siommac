/**
 * src/components/sections/Messages/ConversationView.tsx
 *
 * Thread detail pane — renders chat bubbles for a single conversation
 * and a reply textarea. Replaces showDetail/updateDetail/bubbleHtml in
 * MessagesPanel.ts with declarative Preact.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h }               from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { useSessionStore } from '@store/session';
import { useSendReply }    from './hooks';
import type { MsgItem, MsgReply } from '@components/nav/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTimestamp(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

// ── Chat bubble ───────────────────────────────────────────────────────────────

interface BubbleProps {
  isMe:       boolean;
  senderName: string;
  body:       string;
  time:       string;
  photoUrl:   string;
}

function Bubble({ isMe, senderName, body, time, photoUrl }: BubbleProps) {
  const inits        = (senderName || '?').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const align        = isMe ? 'flex-end'  : 'flex-start';
  const flexDir      = isMe ? 'row-reverse' : 'row';
  const bubbleBg     = isMe ? 'var(--siomac-navy,#1b2d54)' : 'var(--bg-subtle,#f0f2f5)';
  const bubbleColor  = isMe ? '#fff'      : 'var(--text-primary)';
  const avatarBg     = isMe ? 'var(--siomac-navy,#1b2d54)' : '#888';
  const borderColor  = isMe ? 'var(--siomac-navy,#1b2d54)' : 'var(--border,#ddd)';
  const borderRadius = isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, flexDirection: flexDir }}>
        {/* Avatar */}
        {photoUrl
          ? <img src={photoUrl} alt={inits} crossOrigin="anonymous" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${borderColor}` }} />
          : <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarBg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}>
              {inits}
            </div>
        }
        {/* Bubble */}
        <div style={{ maxWidth: '75%', background: bubbleBg, color: bubbleColor, padding: '8px 12px', borderRadius, fontSize: '0.82rem', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
          {body}
        </div>
      </div>
      <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginTop: 3, textAlign: isMe ? 'right' : 'left' }}>
        {isMe ? 'You' : senderName} · {fmtTimestamp(time)}
      </div>
    </div>
  );
}

// ── ConversationView ──────────────────────────────────────────────────────────

interface ConversationViewProps {
  msg:    MsgItem;
  onBack: () => void;
}

export function ConversationView({ msg: m, onBack }: ConversationViewProps) {
  const username     = useSessionStore(s => s.username) ?? '';
  const role         = useSessionStore(s => s.role);
  const isAdmin      = role === 'admin' || role === 'manager';
  const [reply, setReply] = useState('');
  const bodyRef      = useRef<HTMLDivElement>(null);
  const replyMut     = useSendReply(m.id);

  const isDeleted    = !!m.otherPartyDeleted;
  const otherName    = m.fromUsername === username ? m.toName : m.fromName;
  const fromLabel    = m.fromUsername === username ? 'To' : 'From';

  // Scroll to bottom whenever replies change
  useEffect(() => {
    if (bodyRef.current) {
      requestAnimationFrame(() => {
        if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      });
    }
  }, [m.replies.length]);

  function handleSendReply() {
    const trimmed = reply.trim();
    if (!trimmed || replyMut.isPending) return;
    replyMut.mutate(trimmed, {
      onSuccess: () => setReply(''),
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSendReply();
  }

  // Build all messages: original + replies
  type BubbleEntry = { key: string } & BubbleProps;
  const entries: BubbleEntry[] = [
    {
      key:        'orig_' + String(m.id),
      isMe:       m.fromUsername === username,
      senderName: m.fromName,
      body:       m.body,
      time:       m.createdAt,
      photoUrl:   m.fromPhoto,
    },
    ...m.replies.map((r: MsgReply) => ({
      key:        'reply_' + String(r.id),
      isMe:       r.fromUsername === username,
      senderName: r.fromName,
      body:       r.body,
      time:       r.createdAt,
      photoUrl:   r.fromPhoto,
    })),
  ];

  return (
    <div id="msgDetailPane" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Thread header */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle,#f8fafe)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              {fromLabel}: <strong>{otherName}</strong>
              {isDeleted && (
                <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 7px' }}>
                  Employee Removed
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>{m.subject}</div>
          </div>
          {/* Admin delete */}
          {isAdmin && (
            <button
              title="Delete conversation"
              style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--siomac-red,#e40c0c)', fontSize: '0.8rem', padding: '2px 6px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4, opacity: 0.75 }}
              data-delete-msg-id={String(m.id)}
            >
              <i class="fas fa-trash-alt" /> Delete
            </button>
          )}
        </div>
      </div>

      {/* Chat bubbles */}
      <div ref={bodyRef} id="msgDetailBody" class="hdr-modal-body" style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
          {entries.map(({ key, ...bubble }) => <Bubble key={key} {...bubble} />)}
        </div>
      </div>

      {/* Reply input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <textarea
          id="msgReplyInput"
          class="form-control"
          rows={3}
          placeholder={isDeleted ? 'This employee has been removed — replies are disabled.' : 'Write your reply… (Ctrl+Enter to send)'}
          style={{
            resize: 'none',
            background: isDeleted ? 'var(--bg-subtle,#f8fafe)' : undefined,
            color: isDeleted ? 'var(--text-muted)' : undefined,
          }}
          disabled={isDeleted || replyMut.isPending}
          value={reply}
          onInput={(e: Event) => setReply((e.target as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <button class="hdr-foot-link" style={{ color: 'var(--siomac-navy)' }} onClick={onBack}>
            <i class="fas fa-arrow-left" /> Back
          </button>
          <button
            class="hdr-foot-link"
            style={{ color: 'var(--siomac-blue)', opacity: (!reply.trim() || isDeleted || replyMut.isPending) ? 0.4 : 1 }}
            disabled={!reply.trim() || isDeleted || replyMut.isPending}
            onClick={handleSendReply}
          >
            <i class={`fas fa-${replyMut.isPending ? 'spinner fa-spin' : 'paper-plane'}`} /> Send Reply
          </button>
        </div>
      </div>
    </div>
  );
}
