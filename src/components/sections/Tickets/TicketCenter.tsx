import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  getTicketAttachmentUrl,
  uploadTicketAttachment,
  useCommentTicket,
  useCommsSummary,
  useMarkTicketRead,
  useMyTickets,
  useTicket,
  useUpdateTicket,
  type CanonicalTicket,
  type TicketListArgs,
  type TicketUserProfile,
} from '@api/communications';
import { useSessionStore } from '@store/session';
import { toast } from '@store/ui';
import { Drawer, FieldList, FieldRow, InfoCard, Modal, PageHeader, PanelEmpty, PanelTabs } from '@ui';
import { TicketCreateDialog } from './TicketCreateDialog';
import './ticketCenter.css';

type Scope = 'queue' | 'assigned' | 'all';
type DrawerTab = 'Details' | 'Attachments' | 'Participants' | 'Activity';
type ActionDialog = 'resolve' | 'priority' | 'tag' | null;

const OPEN_STATUSES = new Set(['open', 'assigned', 'in_progress', 'waiting_requester', 'reopened']);

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char: string) => char.toUpperCase());
}

function initials(profile: TicketUserProfile | null, fallback = 'T'): string {
  return (profile?.displayName ?? fallback).split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-TT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function serializeInlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  const content = [...node.childNodes].map(serializeInlineNode).join('');
  switch (node.tagName) {
    case 'B':
    case 'STRONG':
      return content ? `**${content}**` : '';
    case 'I':
    case 'EM':
      return content ? `*${content}*` : '';
    case 'U':
      return content ? `++${content}++` : '';
    case 'A': {
      const href = node.getAttribute('href') ?? '';
      return content && /^(https?:|mailto:)/i.test(href) ? `[${content}](${href})` : content;
    }
    case 'BR':
      return '\n';
    default:
      return content;
  }
}

function editorToMarkdown(editor: HTMLElement): string {
  const lines: string[] = [];
  const appendBlock = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent?.trim();
      if (value) lines.push(value);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      [...node.children].forEach((child, index) => {
        const prefix = node.tagName === 'UL' ? '- ' : `${index + 1}. `;
        lines.push(`${prefix}${[...child.childNodes].map(serializeInlineNode).join('').trim()}`);
      });
      return;
    }
    if (node.tagName === 'DIV' || node.tagName === 'P') {
      lines.push([...node.childNodes].map(serializeInlineNode).join('').trim());
      return;
    }
    lines.push(serializeInlineNode(node).trim());
  };
  [...editor.childNodes].forEach(appendBlock);
  const serialized = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return serialized || editor.innerText?.trim() || editor.textContent?.trim() || '';
}

function safeLink(value: string): string | null {
  return /^(https?:|mailto:)/i.test(value) ? value : null;
}

function InlineTicketText({ value }: { value: string }): VNode {
  const parts: Array<string | VNode> = [];
  const pattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|\+\+[^+\n]+\+\+|\[[^\]\n]+\]\([^) \n]+\))/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(value.slice(cursor, index));
    const token = match[0];
    if (token.startsWith('**')) parts.push(<strong>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('*')) parts.push(<em>{token.slice(1, -1)}</em>);
    else if (token.startsWith('++')) parts.push(<u>{token.slice(2, -2)}</u>);
    else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link?.[2] ? safeLink(link[2]) : null;
      parts.push(href ? <a href={href} target="_blank" rel="noopener noreferrer">{link?.[1]}</a> : token);
    }
    cursor = index + token.length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return <>{parts}</>;
}

function TicketRichText({ value }: { value: string }): VNode {
  const blocks: VNode[] = [];
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (/^- /.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^- /.test(lines[index] ?? '')) items.push((lines[index++] ?? '').slice(2));
      blocks.push(<ul>{items.map(item => <li><InlineTicketText value={item} /></li>)}</ul>);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\. /.test(lines[index] ?? '')) items.push((lines[index++] ?? '').replace(/^\d+\. /, ''));
      blocks.push(<ol>{items.map(item => <li><InlineTicketText value={item} /></li>)}</ol>);
      continue;
    }
    if (line.trim()) blocks.push(<p><InlineTicketText value={line} /></p>);
    index += 1;
  }
  return <div class="tc-rich-text">{blocks}</div>;
}

function TicketPills({ ticket }: { ticket: CanonicalTicket }): VNode {
  return (
    <div class="tc-pills">
      <span class={`tc-pill status ${ticket.status}`}>{titleCase(ticket.status)}</span>
      <span class={`tc-pill priority ${ticket.priority}`}><i />{titleCase(ticket.priority)} priority</span>
      <span class="tc-pill queue">{ticket.queueCode.replace(/_/g, ' ')}</span>
    </div>
  );
}

function Avatar({ profile, fallback, small = false }: { profile: TicketUserProfile | null; fallback?: string; small?: boolean }): VNode {
  return profile?.photoUrl
    ? <img class={`tc-avatar${small ? ' small' : ''}`} src={profile.photoUrl} alt="" />
    : <span class={`tc-avatar${small ? ' small' : ''}`}>{initials(profile, fallback)}</span>;
}

function TicketRow({ ticket, selected, onClick }: { ticket: CanonicalTicket; selected: boolean; onClick: () => void }): VNode {
  const requester = ticket.requester;
  const systemTag = ticket.tags.find(tag => tag.kind === 'system');
  return (
    <button type="button" class={`tc-ticket-row${selected ? ' selected' : ''}`} onClick={onClick}>
      <span class={`tc-unread${ticket.unreadCount > 0 ? ' on' : ''}`} />
      <Avatar profile={requester} fallback={ticket.ticketNumber} />
      <span class="tc-ticket-copy">
        <span class="tc-ticket-name"><strong>{requester?.displayName ?? ticket.ticketNumber}</strong><time>{relativeTime(ticket.lastActivityAt)}</time></span>
        <span class="tc-ticket-number">{ticket.ticketNumber}</span>
        <span class="tc-ticket-subject">{ticket.subject}</span>
        <TicketPills ticket={{ ...ticket, queueCode: systemTag?.label ?? ticket.queueCode }} />
      </span>
    </button>
  );
}

function TicketDetailsDrawer({ open, tab, setTab, detail, onClose, onDownload }: {
  open: boolean;
  tab: DrawerTab;
  setTab: (tab: DrawerTab) => void;
  detail: ReturnType<typeof useTicket>['data'];
  onClose: () => void;
  onDownload: (id: string) => void;
}): VNode {
  const ticket = detail?.ticket;
  return (
    <Drawer rich open={open} onClose={onClose} title="Ticket details" sub={ticket?.ticketNumber ?? ''} noFooter panelClass="tc-details-drawer">
      <PanelTabs primary={['Details', 'Attachments']} more={['Participants', 'Activity']} active={tab} onChange={next => setTab(next as DrawerTab)} />
      {!detail || !ticket ? <PanelEmpty>Loading ticket details…</PanelEmpty> : (
        <div class="tc-drawer-body">
          {tab === 'Details' && (
            <>
              <InfoCard title="Request">
                <FieldList>
                  <FieldRow label="Subject" value={ticket.subject} />
                  <FieldRow label="Status" value={titleCase(ticket.status)} />
                  <FieldRow label="Priority" value={titleCase(ticket.priority)} />
                  <FieldRow label="Queue" value={ticket.queueCode} />
                  <FieldRow label="Request type" value={ticket.requestTypeCode} />
                  <FieldRow label="Requester" value={ticket.requester?.displayName ?? 'Unavailable'} />
                  <FieldRow label="Assignee" value={ticket.assignee?.displayName ?? 'Unassigned'} />
                </FieldList>
              </InfoCard>
              <InfoCard title="Service level">
                <FieldList>
                  <FieldRow label="Response due" value={formatDate(ticket.responseDueAt)} />
                  <FieldRow label="Resolution due" value={formatDate(ticket.resolutionDueAt)} />
                  <FieldRow label="Created" value={formatDate(ticket.createdAt)} />
                  <FieldRow label="Last activity" value={formatDate(ticket.lastActivityAt)} />
                </FieldList>
              </InfoCard>
              <InfoCard title="Tags">
                <div class="tc-drawer-tags">{detail.tags.length ? detail.tags.map(tag => <span key={tag.key}>{tag.label}</span>) : <PanelEmpty>No tags</PanelEmpty>}</div>
              </InfoCard>
            </>
          )}
          {tab === 'Attachments' && (
            <InfoCard title={`Attachments (${detail.attachments.length})`}>
              {detail.attachments.length ? detail.attachments.map(file => (
                <button class="tc-drawer-file" key={file.id} onClick={() => onDownload(file.id)}>
                  <i class="fas fa-file" /><span><strong>{file.fileName}</strong><small>{fileSize(file.sizeBytes)}</small></span><i class="fas fa-download" />
                </button>
              )) : <PanelEmpty>No attachments on this ticket.</PanelEmpty>}
            </InfoCard>
          )}
          {tab === 'Participants' && (
            <InfoCard title={`Participants (${detail.participants.length})`}>
              {detail.participants.length ? detail.participants.map((participant, index) => {
                const profile = participant.user ?? null;
                return <div class="tc-person-row" key={String(participant.userId ?? index)}><Avatar small profile={profile} /><span><strong>{profile?.displayName ?? 'SIOMAC user'}</strong><small>{titleCase(String(participant.role ?? 'participant'))}</small></span></div>;
              }) : <PanelEmpty>Participant details are restricted to ticket handlers.</PanelEmpty>}
            </InfoCard>
          )}
          {tab === 'Activity' && (
            <InfoCard title={`Activity (${detail.events.length})`}>
              {detail.events.length ? [...detail.events].reverse().map((event, index) => (
                <div class="tc-activity-row" key={String(event.id ?? index)}>
                  <i class="fas fa-circle" /><span><strong>{titleCase(String(event.eventType ?? 'updated'))}</strong><small>{event.actor?.displayName ?? 'System'} · {formatDate(String(event.createdAt ?? ''))}</small></span>
                </div>
              )) : <PanelEmpty>No activity recorded.</PanelEmpty>}
            </InfoCard>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function TicketCenter(): VNode {
  const currentUserId = useSessionStore(state => state.userId);
  const currentName = useSessionStore(state => state.fullName);
  const currentPhoto = useSessionStore(state => state.profileImage);
  const currentProfile: TicketUserProfile | null = currentUserId ? { id: currentUserId, displayName: currentName ?? 'You', email: null, role: null, photoUrl: currentPhoto } : null;
  const [scope, setScope] = useState<Scope>('queue');
  const [search, setSearch] = useState('');
  const [querySearch, setQuerySearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [queueCode, setQueueCode] = useState('');
  const [requestTypeCode, setRequestTypeCode] = useState('');
  const [tagKey, setTagKey] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [requestedTicketNumber, setRequestedTicketNumber] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('Details');
  const [composerMode, setComposerMode] = useState<'reply' | 'internal'>('reply');
  const [body, setBody] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState<ActionDialog>(null);
  const [actionValue, setActionValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const markedReadRef = useRef('');

  useEffect(() => {
    const timer = window.setTimeout(() => setQuerySearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const listArgs: TicketListArgs = {
    scope,
    search: querySearch || null,
    status: status || null,
    priority: (priority || null) as TicketListArgs['priority'],
    queueCode: queueCode || null,
    requestTypeCode: requestTypeCode || null,
    tagKey: tagKey || null,
    limit: 100,
  };
  const listQ = useMyTickets(listArgs);
  const allQ = useMyTickets({ scope: 'all', limit: 100 });
  const detailQ = useTicket(selectedId);
  const summaryQ = useCommsSummary();
  const comment = useCommentTicket();
  const update = useUpdateTicket();
  const markRead = useMarkTicketRead();
  const tickets = listQ.data ?? [];
  const allTickets = allQ.data ?? [];
  const detail = detailQ.data;
  const ticket = detail?.ticket;

  useEffect(() => {
    if (!selectedId && tickets[0]) setSelectedId(tickets[0].id);
    if (selectedId && tickets.length > 0 && !tickets.some(row => row.id === selectedId)) setSelectedId(tickets[0]!.id);
  }, [selectedId, tickets]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<{ ticketId?: string; ticketNumber?: string; create?: boolean }>).detail;
      if (id?.ticketId) setSelectedId(id.ticketId);
      if (id?.ticketNumber) setRequestedTicketNumber(id.ticketNumber);
      if (id?.create) setCreateOpen(true);
    };
    window.addEventListener('siomac:openTicket', onOpen);
    return () => window.removeEventListener('siomac:openTicket', onOpen);
  }, []);

  useEffect(() => {
    if (!requestedTicketNumber) return;
    const match = allTickets.find(row => row.ticketNumber === requestedTicketNumber);
    if (match) {
      setSelectedId(match.id);
      setRequestedTicketNumber('');
    }
  }, [allTickets, requestedTicketNumber]);

  useEffect(() => {
    if (!detail || detail.unreadCount <= 0) return;
    const key = `${selectedId}:${detail.ticket.activitySequence}`;
    if (markedReadRef.current === key) return;
    markedReadRef.current = key;
    markRead.mutate({ ticketId: selectedId, sequence: detail.ticket.activitySequence });
  }, [detail, markRead, selectedId]);

  const overdue = useMemo(() => allTickets.filter(row => OPEN_STATUSES.has(row.status) && row.resolutionDueAt && new Date(row.resolutionDueAt).getTime() < Date.now()).length, [allTickets]);
  const dueToday = useMemo(() => {
    const now = new Date();
    return allTickets.filter(row => {
      if (!OPEN_STATUSES.has(row.status) || !row.resolutionDueAt) return false;
      const due = new Date(row.resolutionDueAt);
      return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate();
    }).length;
  }, [allTickets]);

  function selectTicket(id: string): void {
    setSelectedId(id);
    setBody('');
    if (editorRef.current) editorRef.current.innerHTML = '';
  }

  function runAction(action: Parameters<ReturnType<typeof useUpdateTicket>['mutate']>[0]['action'], payload: Record<string, unknown> = {}): void {
    if (!selectedId) return;
    update.mutate({ ticketId: selectedId, action, payload }, {
      onSuccess: () => {
        toast.success('Ticket updated.');
        setActionDialog(null);
        setActionValue('');
        setMoreOpen(false);
      },
      onError: error => toast.error(error instanceof Error ? error.message : 'Ticket update failed.'),
    });
  }

  function sendComment(): void {
    const text = editorRef.current ? editorToMarkdown(editorRef.current) : body.trim();
    if (!selectedId || !text || comment.isPending) return;
    comment.mutate({ ticketId: selectedId, body: text, isInternal: composerMode === 'internal' }, {
      onSuccess: () => {
        setBody('');
        if (editorRef.current) editorRef.current.innerHTML = '';
        toast.success(composerMode === 'internal' ? 'Internal note added.' : 'Reply sent.');
      },
      onError: error => toast.error(error instanceof Error ? error.message : 'Could not send reply.'),
    });
  }

  function format(command: string, value?: string): void {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setBody(editorRef.current ? editorToMarkdown(editorRef.current) : '');
  }

  async function attach(file: File | undefined): Promise<void> {
    if (!file || !selectedId) return;
    setUploading(true);
    try {
      await uploadTicketAttachment(selectedId, file);
      await detailQ.refetch();
      toast.success('Attachment uploaded.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Attachment upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function download(id: string): Promise<void> {
    try {
      const url = await getTicketAttachmentUrl(id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open attachment.');
    }
  }

  const requester = ticket?.requester ?? null;
  const activeStatus = ticket?.status ?? '';
  const hasQueueAccess = allTickets.some(row => row.canHandle);
  const queueOptions = useMemo(() => [...new Set(allTickets.map(row => row.queueCode))].sort(), [allTickets]);
  const requestTypeOptions = useMemo(() => [...new Set(allTickets.map(row => row.requestTypeCode))].sort(), [allTickets]);
  const tagOptions = useMemo(() => {
    const map = new Map<string, string>();
    allTickets.forEach(row => row.tags.forEach(tag => map.set(tag.key, tag.label)));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allTickets]);
  const isWatcher = detail?.participants.some(row => row.userId === currentUserId && row.role === 'watcher') ?? false;

  return (
    <div class="tc-page">
      <PageHeader
        icon="fa-ticket"
        title="Ticket Center"
        module="Workspace"
        sub="Requests, service queues and staff support in one authorised workspace."
        actions={<button class="tc-new-ticket" onClick={() => setCreateOpen(true)}><i class="fas fa-plus" /> New ticket</button>}
      />
      <div class="tc-summary">
        <div><i class="fas fa-inbox blue" /><span><small>Open tickets</small><strong>{summaryQ.data?.ticketsOpen ?? allTickets.filter(row => OPEN_STATUSES.has(row.status)).length}</strong></span></div>
        <div><i class="fas fa-envelope purple" /><span><small>Unread</small><strong>{summaryQ.data?.ticketsUnread ?? 0}</strong></span></div>
        <div><i class="fas fa-clock red" /><span><small>Overdue</small><strong>{overdue}</strong></span></div>
        <div><i class="fas fa-calendar-day amber" /><span><small>Due today</small><strong>{dueToday}</strong></span></div>
      </div>
      <main class="tc-workspace">
        <section class="tc-list-panel">
          <header class="tc-list-head">
            <h2>Recent Tickets</h2>
            <div class="tc-search"><i class="fas fa-search" /><input value={search} onInput={event => setSearch(event.currentTarget.value)} placeholder="Search tickets" /><button class={filtersOpen ? 'active' : ''} onClick={() => setFiltersOpen(open => !open)} aria-label="Filters"><i class="fas fa-filter" /></button></div>
            {hasQueueAccess ? <div class="tc-scopes">
              {([
                ['queue', 'Queue', 'fa-list'],
                ['assigned', 'Assigned', 'fa-user'],
                ['all', 'All', 'fa-ticket'],
              ] as const).map(([key, label, icon]) => <button class={scope === key ? 'active' : ''} onClick={() => setScope(key)} key={key}><i class={`fas ${icon}`} />{label}</button>)}
            </div> : <div class="tc-self-scope"><i class="fas fa-user" /> My requests</div>}
            {filtersOpen && <div class="tc-filters">
              <label>Status<select value={status} onChange={event => setStatus(event.currentTarget.value)}><option value="">All statuses</option><option value="open">Open</option><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="waiting_requester">Waiting on requester</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label>
              <label>Priority<select value={priority} onChange={event => setPriority(event.currentTarget.value)}><option value="">All priorities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
              <label>Queue<select value={queueCode} onChange={event => setQueueCode(event.currentTarget.value)}><option value="">All queues</option>{queueOptions.map(code => <option value={code} key={code}>{titleCase(code)}</option>)}</select></label>
              <label>Request type<select value={requestTypeCode} onChange={event => setRequestTypeCode(event.currentTarget.value)}><option value="">All request types</option>{requestTypeOptions.map(code => <option value={code} key={code}>{titleCase(code)}</option>)}</select></label>
              <label>Tag<select value={tagKey} onChange={event => setTagKey(event.currentTarget.value)}><option value="">All tags</option>{tagOptions.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
              <button onClick={() => { setStatus(''); setPriority(''); setQueueCode(''); setRequestTypeCode(''); setTagKey(''); }}>Clear</button>
            </div>}
            <div class="tc-list-group"><strong>{titleCase(scope)} tickets ({tickets.length})</strong><span>Newest</span></div>
          </header>
          <div class="tc-ticket-scroll">
            {listQ.isLoading && <div class="tc-list-state">Loading tickets…</div>}
            {listQ.isError && <div class="tc-list-state">Tickets could not be loaded.<button onClick={() => void listQ.refetch()}>Try again</button></div>}
            {!listQ.isLoading && !listQ.isError && tickets.length === 0 && <div class="tc-list-state"><i class="fas fa-ticket" />No tickets match these filters.</div>}
            {tickets.map(row => <TicketRow key={row.id} ticket={row} selected={row.id === selectedId} onClick={() => selectTicket(row.id)} />)}
          </div>
          <footer class="tc-list-foot"><span>{tickets.length} ticket{tickets.length === 1 ? '' : 's'}</span><button onClick={() => void listQ.refetch()}><i class="fas fa-rotate" /> Refresh</button></footer>
        </section>
        <section class="tc-thread-panel">
          {!selectedId ? <div class="tc-thread-empty"><i class="fas fa-ticket" /><h2>Select a ticket</h2><p>Choose a ticket to see its conversation and actions.</p></div> : (
            <>
              <header class="tc-thread-head">
                <div class="tc-thread-title"><small>{ticket?.ticketNumber ?? 'Loading…'}</small><h2>{ticket?.subject ?? 'Loading ticket…'}</h2>{ticket && <TicketPills ticket={ticket} />}</div>
                {ticket && <div class="tc-actions">
                  {detail?.canHandle && <button class={isWatcher ? 'active' : ''} aria-label={isWatcher ? 'Unwatch ticket' : 'Watch ticket'} onClick={() => runAction(isWatcher ? 'unwatch' : 'watch')}><i class={`${isWatcher ? 'fas' : 'far'} fa-star`} /></button>}
                  <button aria-label="Open activity" onClick={() => { setDrawerTab('Activity'); setDrawerOpen(true); }}><i class="fas fa-clock-rotate-left" /></button>
                  <button aria-label="More ticket actions" onClick={() => setMoreOpen(open => !open)}><i class="fas fa-ellipsis-vertical" /></button>
                  <span />
                  {detail?.canHandle && ticket.assigneeUserId !== currentUserId && <button onClick={() => currentUserId && runAction('assign', { assigneeId: currentUserId })}>Assign to me</button>}
                  {detail?.canHandle && ['open', 'assigned', 'reopened'].includes(activeStatus) && <button onClick={() => runAction('start')}>Start</button>}
                  <button class="details" onClick={() => { setDrawerTab('Details'); setDrawerOpen(true); }}>Ticket details <i class="fas fa-chevron-right" /></button>
                  {detail?.canHandle && OPEN_STATUSES.has(activeStatus) && <button class="resolve" onClick={() => { setActionValue('fulfilled'); setActionDialog('resolve'); }}><i class="fas fa-check" /> Resolve</button>}
                  {moreOpen && <div class="tc-action-menu">
                    {detail?.canHandle && <button onClick={() => runAction('wait_requester')}>Waiting on requester</button>}
                    {detail?.canHandle && <button onClick={() => setActionDialog('priority')}>Change priority</button>}
                    {detail?.canHandle && <button onClick={() => setActionDialog('tag')}>Add tag</button>}
                    {detail?.canHandle && activeStatus === 'resolved' && <button onClick={() => runAction('close')}>Close ticket</button>}
                    {['resolved', 'closed'].includes(activeStatus) && <button onClick={() => runAction('reopen')}>Reopen ticket</button>}
                    {!['closed', 'cancelled'].includes(activeStatus) && <button class="danger" onClick={() => runAction('cancel')}>Cancel ticket</button>}
                  </div>}
                </div>}
              </header>
              <div class="tc-conversation">
                {detailQ.isLoading && <div class="tc-list-state">Loading conversation…</div>}
                {detailQ.isError && <div class="tc-list-state">The conversation could not be loaded.<button onClick={() => void detailQ.refetch()}>Try again</button></div>}
                {detail && ticket && (
                  <>
                    <article class="tc-message">
                      <Avatar profile={requester} fallback={ticket.ticketNumber} />
                      <div><header><span><strong>{requester?.displayName ?? 'Requester'}</strong><small>Employee self-service</small></span><time>{formatDate(ticket.createdAt)}</time></header><TicketRichText value={String(ticket.description ?? '')} />
                        {detail.attachments.length > 0 && <div class="tc-attachments"><strong>{detail.attachments.length} attachment{detail.attachments.length === 1 ? '' : 's'}</strong>{detail.attachments.map(file => <button key={file.id} onClick={() => void download(file.id)}><i class="fas fa-file" /><span><b>{file.fileName}</b><small>{fileSize(file.sizeBytes)}</small></span><i class="fas fa-download" /></button>)}</div>}
                      </div>
                    </article>
                    {detail.comments.map(row => row.isSystem ? (
                      <div class="tc-system-event" key={row.id}><i class="fas fa-circle-info" />{row.body}<time>{formatDate(row.createdAt)}</time></div>
                    ) : row.isInternal ? (
                      <article class="tc-internal-note" key={row.id}><i class="fas fa-note-sticky" /><div><header><strong>Internal note by {row.author?.displayName ?? 'SIOMAC handler'}</strong><time>{formatDate(row.createdAt)}</time></header><TicketRichText value={row.body} /></div></article>
                    ) : (
                      <article class="tc-message" key={row.id}><Avatar profile={row.author} fallback="U" /><div><header><span><strong>{row.author?.displayName ?? 'SIOMAC user'}</strong><small>{row.authorUserId === ticket.requesterUserId ? 'Requester' : 'Ticket handler'}</small></span><time>{formatDate(row.createdAt)}</time></header><TicketRichText value={row.body} /></div></article>
                    ))}
                  </>
                )}
              </div>
              {detail && !['closed', 'cancelled'].includes(activeStatus) && (
                <div class={`tc-composer${composerMode === 'internal' ? ' internal' : ''}`}>
                  <div class="tc-recipient"><Avatar small profile={currentProfile} /><strong>{composerMode === 'internal' ? 'Internal note' : 'Reply to:'}</strong>{composerMode === 'reply' && <span>{requester?.displayName ?? 'Requester'}</span>}<div><button class={composerMode === 'reply' ? 'active' : ''} onClick={() => setComposerMode('reply')}>Reply</button>{detail.canHandle && <button class={composerMode === 'internal' ? 'active' : ''} onClick={() => setComposerMode('internal')}>Internal note</button>}</div></div>
                  <div class="tc-format">
                    <button onMouseDown={event => event.preventDefault()} onClick={() => format('bold')}><b>B</b></button>
                    <button onMouseDown={event => event.preventDefault()} onClick={() => format('italic')}><i>I</i></button>
                    <button onMouseDown={event => event.preventDefault()} onClick={() => format('underline')}><u>U</u></button>
                    <span />
                    <button onClick={() => format('insertUnorderedList')}><i class="fas fa-list-ul" /></button>
                    <button onClick={() => format('insertOrderedList')}><i class="fas fa-list-ol" /></button>
                    <button onClick={() => { const url = window.prompt('Paste a link'); if (url) format('createLink', url); }}><i class="fas fa-link" /></button>
                  </div>
                  <div ref={editorRef} class="tc-editor" contentEditable role="textbox" aria-multiline="true" data-placeholder={composerMode === 'internal' ? 'Write an internal note…' : 'Type your reply…'} onInput={event => setBody(editorToMarkdown(event.currentTarget))} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); sendComment(); } }} />
                  <footer><label class={uploading ? 'disabled' : ''}><i class="fas fa-paperclip" /> Attach<input type="file" disabled={uploading} onChange={event => void attach(event.currentTarget.files?.[0])} /></label><small>{composerMode === 'internal' ? 'Visible to handlers only' : 'Requester will be notified'}</small><button disabled={!body.trim() || comment.isPending} onClick={sendComment}><i class="fas fa-paper-plane" /> {comment.isPending ? 'Sending…' : composerMode === 'internal' ? 'Add note' : 'Send reply'}</button></footer>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <TicketDetailsDrawer open={drawerOpen} tab={drawerTab} setTab={setDrawerTab} detail={detail} onClose={() => setDrawerOpen(false)} onDownload={id => void download(id)} />
      <TicketCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={id => setSelectedId(id)} />
      <Modal
        open={actionDialog !== null}
        title={actionDialog === 'resolve' ? 'Resolve ticket' : actionDialog === 'priority' ? 'Change priority' : 'Add ticket tag'}
        sub={ticket?.ticketNumber}
        size="sm"
        onClose={() => setActionDialog(null)}
        onSubmit={() => {
          if (actionDialog === 'resolve') runAction('resolve', { resolutionCode: actionValue });
          if (actionDialog === 'priority') runAction('set_priority', { priority: actionValue });
          if (actionDialog === 'tag') runAction('add_tag', { label: actionValue.trim() });
        }}
        submitLabel={actionDialog === 'resolve' ? 'Resolve' : 'Save'}
        submitDisabled={!actionValue.trim() || update.isPending}
      >
        <div class="tc-form">
          {actionDialog === 'resolve' && <label>Resolution code<select value={actionValue} onChange={event => setActionValue(event.currentTarget.value)}><option value="fulfilled">Request fulfilled</option><option value="information_provided">Information provided</option><option value="no_action">No action required</option></select></label>}
          {actionDialog === 'priority' && <label>Priority<select value={actionValue} onChange={event => setActionValue(event.currentTarget.value)}><option value="">Select priority</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>}
          {actionDialog === 'tag' && <label>Tag label<input value={actionValue} maxLength={40} onInput={event => setActionValue(event.currentTarget.value)} placeholder="e.g. Embassy follow-up" /></label>}
        </div>
      </Modal>
    </div>
  );
}
