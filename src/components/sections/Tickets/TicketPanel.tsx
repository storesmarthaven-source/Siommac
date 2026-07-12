/**
 * src/components/sections/Tickets/TicketPanel.tsx
 *
 * Top-level orchestrator for the Support Tickets modal.
 * Manages the three-pane state machine (list → detail → compose)
 * and renders the modal header, footer, and active pane.
 *
 * This component is mounted directly into #hdrTicketModal by TicketModal.tsx,
 * replacing all DOM-string rendering and global-function wiring in TicketsPanel.ts.
 *
 * REALTIME: ticket invalidations arrive via onRealtimeEvent('support_tickets')
 * → TanStack Query → components re-render automatically. No polling, no
 * window._fetchTickets, no callWin().
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { useState, useEffect, useCallback }  from 'preact/hooks';
import { useSessionStore }   from '@store/session';
import { toast }             from '@store/ui';
import { confirm }           from '@shared/ConfirmDialog';
import { useTickets, useClearClosed, useTicketRealtime } from './hooks';
import { useSeenReplies }    from './useSeenReplies';
import { TicketQueue }       from './TicketQueue';
import { TicketDetail }      from './TicketDetail';
import { TicketCompose }     from './TicketCompose';

type Pane = 'list' | 'detail' | 'compose';

interface TicketPanelProps {
  /** Called by NavController when the modal is opened — re-fetch immediately */
  onOpen?: () => void;
}

export function TicketPanel({ onOpen }: TicketPanelProps) {
  const [pane,      setPane]      = useState<Pane>('list');
  const [activeId,  setActiveId]  = useState<string | null>(null);

  // Subscribe to realtime invalidations — no polling, no window._fetchTickets
  useTicketRealtime();

  const { data: tickets = [], refetch } = useTickets();
  const { seenIds }   = useSeenReplies();
  const clearMut      = useClearClosed();
  const role          = useSessionStore(s => s.role);
  const isAdmin       = role === 'admin' || role === 'manager';

  // Badge: unseen replies (employees) or open count (admins)
  const username = useSessionStore(s => s.username) ?? '';
  const badgeCount = isAdmin
    ? tickets.filter(t => t.status === 'open').length
    : tickets.reduce((sum, t) =>
        sum + t.replies.filter(r => !seenIds.has(r.id) && r.fromUsername !== username).length,
        0,
      );

  // Sync the header badges whenever the count changes
  useEffect(() => {
    ['hdrTicketBadge', 'empTicketBadge', 'mgrTicketBadge'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (badgeCount > 0) {
        el.textContent = badgeCount > 99 ? '99+' : String(badgeCount);
        el.style.display = '';
      } else {
        el.textContent = '';
        el.style.display = 'none';
      }
    });
    // Open-count footer text for admin view
    const countEl = document.getElementById('ticketOpenCount');
    if (countEl && isAdmin) {
      const open = tickets.filter(t => t.status === 'open').length;
      countEl.textContent = open ? `${open} Open Ticket${open !== 1 ? 's' : ''}` : '';
    }
  }, [badgeCount, tickets, isAdmin]);

  // Expose imperative hooks for NavController callWin() compatibility
  // — these replace window._fetchTickets / _clearTicketDetail / _ticketModalOpened
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w._fetchTickets         = () => { void refetch(); };
    w._clearTicketDetail    = () => { setPane('list'); setActiveId(null); };
    w._ticketModalOpened    = () => { void refetch(); onOpen?.(); };
    w._ticketModalClosed    = () => { /* nothing — TQ handles background refresh */ };
    w._updateTicketBadgeNow = () => { /* badge is reactive — no-op needed */ };
    w._getTicketUnreadCount = () => badgeCount;
    return () => {
      // Leave stubs rather than deleting — NavController may call after unmount
      w._fetchTickets      = () => { /* noop */ };
      w._clearTicketDetail = () => { /* noop */ };
    };
  }, [refetch, badgeCount, onOpen]);

  const handleOpenTicket = useCallback((id: string) => {
    setActiveId(id);
    setPane('detail');
  }, []);

  const handleBack = useCallback(() => {
    setActiveId(null);
    setPane('list');
  }, []);

  const handleNewTicket = useCallback(() => {
    setPane('compose');
  }, []);

  const handleComposeSuccess = useCallback((ticketNumber: string) => {
    setPane('list');
    toast.success(`Ticket ${ticketNumber} submitted successfully.`);
  }, []);

  const handleClearClosed = useCallback(async () => {
    const closedCount = tickets.filter(t =>
      ['closed', 'resolved', 'deleted'].includes(t.status) &&
      (isAdmin || t.fromUsername === username),
    ).length;

    if (!closedCount) {
      toast.info('No closed, resolved, or deleted tickets to clear.');
      return;
    }

    const ok = await confirm({
      title:        'Clear Closed Tickets?',
      message:      `This will permanently delete ${closedCount} closed, resolved, or deleted ticket${closedCount !== 1 ? 's' : ''}. This cannot be undone.`,
      variant:      'danger',
      confirmLabel: 'Clear All',
    });
    if (ok) void clearMut.mutateAsync();
  }, [tickets, isAdmin, username, clearMut]);

  return (
    <>
      {/* Modal header — title + action buttons */}
      <div class="hdr-modal-head">
        <span>
          <i class="fas fa-ticket-alt" />
          {' '}
          <span id="ticketModalTitle">{isAdmin ? 'Support Tickets' : 'My Tickets'}</span>
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Admin: clear closed */}
          {isAdmin && pane === 'list' && (
            <button
              class="hdr-foot-link"
              id="ticketClearClosedBtn"
              style={{ padding: '4px 10px', fontSize: '0.78rem', color: 'var(--text-muted)' }}
              onClick={handleClearClosed}
              disabled={clearMut.isPending}
            >
              <i class="fas fa-broom" /> Clear Closed
            </button>
          )}
          {/* Employee: new ticket */}
          {!isAdmin && pane === 'list' && (
            <button
              class="hdr-foot-link hdr-compose-btn"
              id="ticketNewBtn"
              style={{ padding: '4px 10px', fontSize: '0.78rem' }}
              onClick={handleNewTicket}
            >
              <i class="fas fa-plus" /> New Ticket
            </button>
          )}
          <button class="hdr-modal-close" data-modal="hdrTicketModal">
            <i class="fas fa-times" />
          </button>
        </div>
      </div>

      {/* Active pane */}
      {pane === 'list'    && <TicketQueue onOpenTicket={handleOpenTicket} onNewTicket={handleNewTicket} />}
      {pane === 'detail'  && activeId && <TicketDetail ticketId={activeId} onBack={handleBack} />}
      {pane === 'compose' && <TicketCompose onBack={handleBack} onSuccess={handleComposeSuccess} />}

      {/* Modal footer — only shown on list pane */}
      {pane === 'list' && (
        <div class="hdr-modal-foot" id="ticketModalFoot">
          {/* Employee: clear closed from footer */}
          {!isAdmin && (
            <button
              class="hdr-foot-link"
              id="ticketClearClosedEmpBtn"
              style={{ color: 'var(--text-muted)' }}
              onClick={handleClearClosed}
              disabled={clearMut.isPending}
            >
              <i class="fas fa-broom" /> Clear Closed
            </button>
          )}
          <span id="ticketOpenCount" style={{ fontSize: '0.78rem', color: 'var(--siomac-navy)', fontWeight: 600, marginRight: 'auto' }} />
          <button
            class="hdr-foot-link"
            id="ticketRefreshBtn"
            onClick={() => void refetch()}
          >
            <i class="fas fa-sync-alt" /> Refresh
          </button>
        </div>
      )}
    </>
  );
}
