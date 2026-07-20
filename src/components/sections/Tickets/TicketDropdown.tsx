import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useCommsSummary, useMarkTicketRead, useMyTickets, type CanonicalTicket } from '@api/communications';
import { showSection, setHdrBadge } from '@components/nav/navCore';
import { TicketCreateDialog } from './TicketCreateDialog';

function closeModal(): void {
  document.getElementById('hdrTicketModal')?.classList.remove('open');
  document.querySelectorAll('[data-pill-action].active').forEach(button => button.classList.remove('active'));
}

function openCenter(ticketId?: string): void {
  closeModal();
  showSection('s-tickets');
  if (ticketId) window.dispatchEvent(new CustomEvent('siomac:openTicket', { detail: { ticketId } }));
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char: string) => char.toUpperCase());
}

function TicketItem({ ticket, onOpen }: { ticket: CanonicalTicket; onOpen: (ticket: CanonicalTicket) => void }): VNode {
  const name = ticket.requester?.displayName ?? ticket.ticketNumber;
  const avatar = ticket.requester?.photoUrl;
  const initials = name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return (
    <button class="tc-drop-item" onClick={() => onOpen(ticket)}>
      {avatar ? <img src={avatar} alt="" /> : <span>{initials}</span>}
      <div><header><strong>{name}</strong><small>{ticket.ticketNumber}</small></header><p>{ticket.subject}</p><footer><em class={ticket.status}>{titleCase(ticket.status)}</em><i>{titleCase(ticket.priority)}</i>{ticket.unreadCount > 0 && <b>{ticket.unreadCount}</b>}</footer></div>
    </button>
  );
}

export function TicketDropdown(): VNode {
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const ticketsQ = useMyTickets({ scope: 'mine', limit: 30 });
  const summaryQ = useCommsSummary();
  const markRead = useMarkTicketRead();
  const unread = summaryQ.data?.ticketsUnread ?? 0;

  useEffect(() => {
    document.querySelectorAll('[data-pill-badge="ticket"]').forEach(element => setHdrBadge(element, summaryQ.data?.ticketsOpen ?? 0));
  }, [summaryQ.data?.ticketsOpen]);

  const rows = (ticketsQ.data ?? []).filter(ticket => tab === 'all' || ticket.unreadCount > 0).slice(0, 10);

  function open(ticket: CanonicalTicket): void {
    if (ticket.unreadCount > 0) markRead.mutate({ ticketId: ticket.id, sequence: ticket.activitySequence });
    openCenter(ticket.id);
  }

  return (
    <div class="tc-dropdown">
      <header><i class="fas fa-ticket" /><strong>Tickets</strong>{unread > 0 && <small>{unread} unread</small>}<button class="hdr-modal-close" data-modal="hdrTicketModal" aria-label="Close"><i class="fas fa-times" /></button></header>
      <nav><button class={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>All</button><button class={tab === 'unread' ? 'active' : ''} onClick={() => setTab('unread')}>Unread{unread > 0 ? ` (${unread})` : ''}</button></nav>
      <div class="tc-drop-list">
        {ticketsQ.isLoading && <p class="tc-drop-state">Loading tickets…</p>}
        {ticketsQ.isError && <p class="tc-drop-state">Tickets could not be loaded.<button onClick={() => void ticketsQ.refetch()}>Try again</button></p>}
        {!ticketsQ.isLoading && !ticketsQ.isError && rows.length === 0 && <p class="tc-drop-state"><i class="fas fa-ticket" />{tab === 'unread' ? 'No unread tickets.' : 'No tickets yet.'}</p>}
        {rows.map(ticket => <TicketItem key={ticket.id} ticket={ticket} onOpen={open} />)}
      </div>
      <footer><button onClick={() => setCreateOpen(true)}><i class="fas fa-plus" /> New ticket</button><button onClick={() => openCenter()}>View all</button></footer>
      <TicketCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={ticketId => openCenter(ticketId)} />
    </div>
  );
}
