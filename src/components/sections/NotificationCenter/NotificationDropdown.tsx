/**
 * src/components/sections/NotificationCenter/NotificationDropdown.tsx
 *
 * The compact bell dropdown (rendered inside #hdrNotifModal). Header (bell +
 * unread count + overflow + close) · tabs (All / Unread / Action Required) ·
 * latest notifications · calm empty state · footer (Mark all read · View all).
 * Shares NotificationItem with the full Notification Center.
 */

import { type VNode } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import {
  useNotifications, useCommsSummary, useMarkNotificationRead,
  useMarkAllNotificationsRead, useArchiveNotification,
  type CanonicalNotification, type NotificationListArgs,
} from '@api/communications';
import { showSection } from '@components/nav/navCore';
import { useHeaderModalOpen } from '@/hooks/useHeaderModalOpen';
import { NotificationDropdownItem } from './NotificationDropdownItem';
import { openNotificationTarget, openTicketNotification } from './notifAction';

const TABS = [
  { key: 'all',    label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'action', label: 'Action Required' },
] as const;

/** Close the bell overlay (mirrors NavController's close behaviour). */
function closeModal(): void {
  document.getElementById('hdrNotifModal')?.classList.remove('open');
  document.querySelectorAll('[data-pill-action].active').forEach(b => b.classList.remove('active'));
}

function goToCenter(): void {
  closeModal();
  showSection('s-notification-center');
}

export function NotificationDropdown(): VNode {
  const [tab, setTab] = useState<string>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // Gate list fetches on modal visibility — no background fetches while hidden.
  const isOpen = useHeaderModalOpen('hdrNotifModal');

  // Reset the overflow menu whenever the bell dialog is closed.
  useEffect(() => {
    if (!isOpen) setMenuOpen(false);
  }, [isOpen]);

  // Close the overflow menu on an outside click (without blocking the X button).
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
  const unread = summary?.notificationsUnread ?? 0;

  const args: NotificationListArgs = {
    limit: 30,
  };
  // Keep one canonical preview query warm; tabs filter the small result locally.
  const { data, isLoading, isError, refetch } = useNotifications(args);
  // Belt-and-suspenders: also filter client-side so the tabs are correct even if
  // an older deployed backend ignores the unreadOnly / actionRequiredOnly args.
  const rows = (data ?? []).filter(n => {
    if (tab === 'unread') return !n.is_read;
    if (tab === 'action') return n.action_required && n.action_status === 'pending';
    return true;
  }).slice(0, 12);

  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const archive = useArchiveNotification();

  function open(n: CanonicalNotification) {
    if (!n.is_read) markRead.mutate(n.id);
    closeModal();
    if (!openNotificationTarget(n)) openTicketNotification(n);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '70vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
        <i class="fas fa-bell" style={{ color: 'var(--siomac-navy)' }} />
        <span style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', fontSize: '0.9rem' }}>Notifications</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{unread} unread</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }}>
          <button ref={menuBtnRef} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 6px' }}
            onClick={() => setMenuOpen(o => !o)} title="More">
            <i class="fas fa-ellipsis" />
          </button>
          <button class="hdr-modal-close" data-modal="hdrNotifModal" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }} title="Close">
            <i class="fas fa-times" />
          </button>
          {menuOpen && (
            <div ref={menuRef} style={{ position: 'absolute', top: '100%', right: 0, zIndex: 41, minWidth: '210px', marginTop: '4px',
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--elev-4)', overflow: 'hidden' }}>
              {[
                { icon: 'fa-check-double', label: 'Mark all read', onClick: () => markAll.mutate({}) },
                { icon: 'fa-sliders', label: 'Notification preferences', onClick: goToCenter },
                { icon: 'fa-up-right-from-square', label: 'View Notification Center', onClick: goToCenter },
                { icon: 'fa-box-archive', label: 'Archive all read', onClick: () => archive.mutate({ all: true }) },
                { icon: 'fa-rotate', label: 'Refresh', onClick: () => { void refetch(); } },
              ].map(it => (
                <button key={it.label} onClick={() => { it.onClick(); setMenuOpen(false); }}
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
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: '120px' }}>
        {isLoading && <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Loading…</div>}
        {!isLoading && isError && (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <i class="fas fa-triangle-exclamation" style={{ fontSize: '1.8rem', color: 'var(--text-muted)', opacity: 0.5 }} />
            <div style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', marginTop: '10px' }}>Notifications could not be loaded</div>
            <button class="hse-btn" style={{ marginTop: '14px' }} onClick={() => void refetch()}>
              <i class="fas fa-rotate-right" /> Try again
            </button>
          </div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <i class="fas fa-bell-slash" style={{ fontSize: '2rem', color: 'var(--text-muted)', opacity: 0.4 }} />
            <div style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', marginTop: '10px' }}>You're all caught up</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>No new notifications or required actions.</div>
            <button class="hse-btn" style={{ marginTop: '14px' }} onClick={goToCenter}>
              <i class="fas fa-bell" /> View Notification Center
            </button>
          </div>
        )}
        {rows.map(n => (
          <NotificationDropdownItem key={n.id} n={n} onOpen={open} />
        ))}
      </div>

      {/* Footer — quick actions only */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', borderTop: '1px solid var(--border)', background: 'rgba(27,45,85,0.04)' }}>
          <button disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate({})}
            style={{ background: 'none', border: 'none', cursor: unread === 0 ? 'default' : 'pointer',
              fontSize: '0.86rem', fontWeight: 600, color: unread === 0 ? 'var(--text-muted)' : 'var(--siomac-navy)', padding: 0 }}>
            Mark all read
          </button>
          <button onClick={goToCenter}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.86rem', fontWeight: 600, color: 'var(--siomac-navy)', padding: 0 }}>
            View all
          </button>
        </div>
      )}
    </div>
  );
}
