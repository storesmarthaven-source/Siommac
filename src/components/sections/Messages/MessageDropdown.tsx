/**
 * src/components/sections/Messages/MessageDropdown.tsx
 *
 * Compact message dropdown (rendered inside #hdrMsgModal). Mirrors
 * NotificationDropdown exactly: header · tabs (All / Unread) · recent threads
 * capped at 12 · calm empty state · footer (New Message · View all).
 *
 * New Message → opens ComposeThreadDialog inline.
 * Thread click → opens MessageCenter with that thread selected.
 * View all → navigates to s-messages section.
 */

import { type VNode } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import {
  useMessageThreadsFull, useCommsSummary, useMarkThreadRead,
  type MessageThreadListItem, type ThreadFilters,
} from '@api/communications';
import { showSection, setHdrBadge } from '@components/nav/navCore';
import { MessageDropdownItem } from './MessageDropdownItem';
import { ComposeThreadDialog } from './ComposeThreadDialog';

const TABS = [
  { key: 'all',    label: 'All'    },
  { key: 'unread', label: 'Unread' },
] as const;

function closeModal(): void {
  document.getElementById('hdrMsgModal')?.classList.remove('open');
  document.querySelectorAll('[data-pill-action].active').forEach(b => b.classList.remove('active'));
}

function goToCenter(): void {
  closeModal();
  showSection('s-messages');
}

export function MessageDropdown(): VNode {
  const [tab, setTab]             = useState<'all' | 'unread'>('all');
  const [menuOpen, setMenuOpen]   = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const menuRef    = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Reset overflow menu when modal is closed
  useEffect(() => {
    const modal = document.getElementById('hdrMsgModal');
    if (!modal) return;
    const obs = new MutationObserver(() => {
      if (!modal.classList.contains('open')) setMenuOpen(false);
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || menuBtnRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const { data: summary } = useCommsSummary();
  const unread = summary?.messagesUnread ?? 0;

  // Keep header badge in sync
  useEffect(() => {
    document.querySelectorAll('[data-pill-badge="msg"]').forEach(el => setHdrBadge(el, unread));
  }, [unread]);

  const filters: ThreadFilters = {
    tab:   tab === 'unread' ? 'inbox' : 'all',
    limit: 30,
  };
  const { data, isLoading, refetch } = useMessageThreadsFull(filters);

  // Client-side filter for unread tab
  const rows = (data ?? []).filter(t => {
    if (tab === 'unread') return t.unread_count > 0;
    return true;
  }).slice(0, 12);

  const markRead = useMarkThreadRead();

  function openThread(t: MessageThreadListItem) {
    if (t.unread_count > 0) markRead.mutate(t.id);
    closeModal();
    showSection('s-messages');
    // Broadcast selected thread id for MessageCenter to pick up
    window.dispatchEvent(new CustomEvent('siomac:openThread', { detail: { threadId: t.id } }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '70vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
        <i class="fas fa-comments" style={{ color: 'var(--siomac-navy)' }} />
        <span style={{ fontWeight: 700, color: 'var(--siomac-navy)', fontSize: '0.9rem' }}>Messages</span>
        {unread > 0 && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{unread} unread</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }}>
          <button ref={menuBtnRef} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 6px' }}
            onClick={() => setMenuOpen(o => !o)} title="More">
            <i class="fas fa-ellipsis" />
          </button>
          <button class="hdr-modal-close" data-modal="hdrMsgModal"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} title="Close">
            <i class="fas fa-times" />
          </button>
          {menuOpen && (
            <div ref={menuRef} style={{ position: 'absolute', top: '100%', right: 0, zIndex: 41, minWidth: '200px', marginTop: '4px',
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px',
              boxShadow: 'var(--elev-4)', overflow: 'hidden' }}>
              {[
                { icon: 'fa-pen-to-square', label: 'New Message',   onClick: () => { setComposeOpen(true); setMenuOpen(false); } },
                { icon: 'fa-up-right-from-square', label: 'View all messages', onClick: () => { goToCenter(); setMenuOpen(false); } },
                { icon: 'fa-rotate',        label: 'Refresh',       onClick: () => { void refetch(); setMenuOpen(false); } },
              ].map(it => (
                <button key={it.label} onClick={it.onClick}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '9px 12px',
                    background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                    textAlign: 'left', fontSize: '0.8rem', color: 'var(--siomac-navy)', whiteSpace: 'nowrap' }}>
                  <i class={`fas ${it.icon}`} style={{ width: '16px', color: 'var(--text-muted)', flexShrink: 0 }} /> {it.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ flex: 1, padding: '6px 8px', borderRadius: '7px', border: 'none', cursor: 'pointer',
              fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit',
              background: tab === t.key ? 'var(--siomac-navy)' : 'transparent',
              color: tab === t.key ? '#fff' : 'var(--text-muted)' }}>
            {t.label}{tab === t.key && t.key === 'unread' && unread > 0 ? ` (${unread})` : ''}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: '120px' }}>
        {isLoading && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Loading…</div>
        )}
        {!isLoading && rows.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <i class="fas fa-comments" style={{ fontSize: '2rem', color: 'var(--text-muted)', opacity: 0.4 }} />
            <div style={{ fontWeight: 700, color: 'var(--siomac-navy)', marginTop: '10px' }}>
              {tab === 'unread' ? 'No unread messages' : 'No messages yet'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {tab === 'unread'
                ? 'All threads are read.'
                : 'Start a conversation with your team.'}
            </div>
            <button class="hse-btn" style={{ marginTop: '14px' }} onClick={() => setComposeOpen(true)}>
              <i class="fas fa-pen-to-square" /> New Message
            </button>
          </div>
        )}
        {rows.map(t => (
          <MessageDropdownItem key={t.id} thread={t} onOpen={openThread} />
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px',
        borderTop: '1px solid var(--border)', background: 'rgba(27,45,85,0.04)' }}>
        <button onClick={() => setComposeOpen(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '0.86rem', fontWeight: 600, color: 'var(--siomac-navy)', padding: 0 }}>
          <i class="fas fa-pen-to-square" style={{ marginRight: '5px' }} /> New Message
        </button>
        <button onClick={goToCenter}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '0.86rem', fontWeight: 600, color: 'var(--siomac-navy)', padding: 0 }}>
          View all
        </button>
      </div>

      <ComposeThreadDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onCreated={(threadId) => {
          setComposeOpen(false);
          closeModal();
          showSection('s-messages');
          window.dispatchEvent(new CustomEvent('siomac:openThread', { detail: { threadId } }));
        }}
      />
    </div>
  );
}
