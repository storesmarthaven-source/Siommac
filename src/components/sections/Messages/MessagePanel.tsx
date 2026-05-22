/**
 * src/components/sections/Messages/MessagePanel.tsx
 *
 * Top-level orchestrator for the Messages modal.
 * Manages the three-pane state machine (list → detail → compose)
 * and wires all header/footer buttons.
 *
 * This component is mounted inside #hdrMsgModal, replacing the legacy
 * MessagesPanel.ts polling system entirely.
 *
 * REALTIME: message invalidations arrive via onRealtimeEvent('messages')
 * + onRealtimeEvent('message_replies') → TanStack Query → re-render.
 * Zero polling. Zero window._fetchMsgs.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { h }               from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { useSessionStore } from '@store/session';
import { useMessages, useMarkRead, useMessageRealtime } from './hooks';
import { InboxList }       from './InboxList';
import { ConversationView } from './ConversationView';
import { ComposePane }     from './ComposePane';
import type { MsgItem }    from '@components/nav/types';

type Pane = 'list' | 'detail' | 'compose';

export function MessagePanel() {
  const [pane,     setPane]     = useState<Pane>('list');
  const [activeId, setActiveId] = useState<string | number | null>(null);

  // Subscribe to realtime — no polling
  useMessageRealtime();

  const { data: messages = [], refetch, isFetching } = useMessages();
  const markRead = useMarkRead();
  const role     = useSessionStore(s => s.role);
  const username = useSessionStore(s => s.username) ?? '';
  const isAdmin  = role === 'admin' || role === 'manager';

  // Badge count — unread conversations
  const unreadCount = messages.filter(m =>
    !m.otherPartyDeleted && (m.isUnread || m.unreadReplyCount > 0),
  ).length;

  // Sync header badges whenever count changes
  useEffect(() => {
    ['hdrMsgBadge', 'empMsgBadge', 'mgrMsgBadge'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (unreadCount > 0) {
        el.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        el.style.display = '';
      } else {
        el.textContent = '';
        el.style.display = 'none';
      }
    });
  }, [unreadCount]);

  // Expose legacy window globals so NavController (attSystem) still works
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w['_startMsgSystem']     = () => { void refetch(); };
    w['_stopMsgSystem']      = () => { /* no-op — TanStack Query owns lifecycle */ };
    w['_fetchMsgs']          = () => { void refetch(); };
    w['_updateMsgBadgeNow']  = () => { /* badge is reactive — no-op */ };
    w['_getMsgUnreadCount']  = () => unreadCount;
    w['_clearMsgDetail']     = () => { setPane('list'); setActiveId(null); };
    w['_msgModalOpened']     = () => {
      setPane('list');
      setActiveId(null);
      void refetch();
    };
    w['_msgModalClosed']     = () => { /* TanStack Query will background-refetch as needed */ };
    return () => {
      w['_fetchMsgs']         = () => {};
      w['_clearMsgDetail']    = () => {};
      w['_msgModalOpened']    = () => {};
    };
  // refetch and unreadCount are stable / primitive
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadCount]);

  const activeMsg: MsgItem | undefined = activeId != null
    ? messages.find(m => String(m.id) === String(activeId))
    : undefined;

  const handleOpen = useCallback((id: string | number) => {
    setActiveId(id);
    setPane('detail');
  }, []);

  const handleBack = useCallback(() => {
    setActiveId(null);
    setPane('list');
  }, []);

  const handleCompose = useCallback(() => setPane('compose'), []);

  const handleComposeSuccess = useCallback(() => {
    setPane('list');
    void refetch();
  }, [refetch]);

  const handleMarkAllRead = useCallback(() => {
    messages
      .filter(m => m.isUnread || m.unreadReplyCount > 0)
      .forEach(m => markRead.mutate(m.id));
  }, [messages, markRead]);

  return (
    <>
      {/* Modal header */}
      <div class="hdr-modal-head">
        <span>
          <i class="fas fa-comment-dots" />
          {' '}
          <span id="msgModalTitle">{isAdmin ? 'Messages' : 'My Messages'}</span>
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {pane === 'list' && (
            <button
              class="hdr-foot-link hdr-compose-btn"
              id="msgComposeBtn"
              title="New Message"
              style={{ padding: '4px 10px', fontSize: '0.78rem' }}
              onClick={handleCompose}
            >
              <i class="fas fa-plus" />
              {' '}
              <span id="msgComposeBtnLabel">New Message</span>
            </button>
          )}
          <button class="hdr-modal-close" data-modal="hdrMsgModal">
            <i class="fas fa-times" />
          </button>
        </div>
      </div>

      {/* Active pane */}
      {pane === 'list' && (
        <div class="hdr-modal-body" id="msgList" style={{ display: 'block' }}>
          <InboxList messages={messages} onOpen={handleOpen} onRefetch={() => void refetch()} />
        </div>
      )}

      {pane === 'detail' && activeMsg && (
        <ConversationView msg={activeMsg} onBack={handleBack} />
      )}

      {pane === 'detail' && !activeMsg && (
        // Message was deleted while viewing — fall back to list
        <div class="hdr-modal-body" id="msgList" style={{ display: 'block' }}>
          <InboxList messages={messages} onOpen={handleOpen} onRefetch={() => void refetch()} />
        </div>
      )}

      {pane === 'compose' && (
        <div id="msgComposePane" style={{ display: 'flex' }}>
          <ComposePane onBack={handleBack} onSuccess={handleComposeSuccess} />
        </div>
      )}

      {/* Modal footer — only on list pane */}
      {pane === 'list' && (
        <div class="hdr-modal-foot" id="msgModalFoot">
          {isAdmin && (
            <button
              class="hdr-foot-link"
              id="msgMarkAllReadBtn"
              style={{ color: 'var(--siomac-navy)' }}
              onClick={handleMarkAllRead}
            >
              Mark All As Read
            </button>
          )}
          <button
            class="hdr-foot-link"
            id="msgRefreshBtn"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <i class={`fas fa-${isFetching ? 'spinner fa-spin' : 'sync-alt'}`} /> Refresh
          </button>
        </div>
      )}
    </>
  );
}
