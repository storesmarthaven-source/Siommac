import { Fragment, type VNode } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useActiveSection } from '@/shell/sections/useActiveSection';
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
import { Drawer, LucideIcon, Modal, PanelEmpty } from '@ui';
import { TicketCreateDialog } from './TicketCreateDialog';
import './ticketCenter.css';
import './ticketCenterMockup.css';

type Scope = 'queue' | 'assigned' | 'all';
type DrawerTab = 'Details' | 'Attachments' | 'Participants' | 'Activity';
type ActionDialog = 'resolve' | 'priority' | 'tag' | null;
type QuickView = 'all' | 'waiting_requester' | 'overdue' | 'due_today' | 'resolved';

const OPEN_STATUSES = new Set(['open', 'assigned', 'in_progress', 'waiting_requester', 'reopened']);
const PAGE_SIZE = 6;

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char: string) => char.toUpperCase());
}

// Compact pager: show every page up to 7, otherwise first + last + a window of
// neighbours around the current page, with 'gap' markers for the elided ranges.
function pagerWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: (number | 'gap')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) items.push('gap');
  for (let p = start; p <= end; p++) items.push(p);
  if (end < total - 1) items.push('gap');
  items.push(total);
  return items;
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

function durationBetween(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return 'Pending';
  const minutes = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function dueRemaining(value: string | null | undefined, nowMs: number): string {
  if (!value) return 'No target is configured';
  const minutes = Math.round((new Date(value).getTime() - nowMs) / 60_000);
  const overdue = minutes < 0;
  const absolute = Math.abs(minutes);
  const days = Math.floor(absolute / 1440);
  const hours = Math.floor((absolute % 1440) / 60);
  const label = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h` : `${absolute}m`;
  return overdue ? `${label} overdue` : `${label} remaining`;
}

function recordText(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function recordIdentifier(record: Record<string, unknown>, key: string, fallback: string): string {
  const value = record[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
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
    <button type="button" class={`tc-ticket-row${selected ? ' selected' : ''}${ticket.status === 'resolved' ? ' resolved' : ''}`} onClick={onClick}>
      <span class={`tc-avatar-wrap${ticket.unreadCount > 0 ? ' unread' : ''}`}>
        <Avatar profile={requester} fallback={ticket.ticketNumber} />
        <span class={`tc-status-dot ${ticket.status}`} title={titleCase(ticket.status)} />
      </span>
      <span class="tc-ticket-copy">
        <span class="tc-ticket-name"><strong>{requester?.displayName ?? ticket.ticketNumber}</strong><time>{relativeTime(ticket.lastActivityAt)}</time></span>
        <span class="tc-ticket-number">{ticket.ticketNumber}</span>
        <span class="tc-ticket-subject">{ticket.subject}</span>
        <TicketPills ticket={{ ...ticket, queueCode: systemTag?.label ?? ticket.queueCode }} />
      </span>
    </button>
  );
}

function MockupTicketDetailsDrawer({ open, tab, setTab, detail, isWatcher, nowMs, onClose, onDownload, onAttach, onAddTag, onToggleWatch }: {
  open: boolean;
  tab: DrawerTab;
  setTab: (tab: DrawerTab) => void;
  detail: ReturnType<typeof useTicket>['data'];
  isWatcher: boolean;
  nowMs: number;
  onClose: () => void;
  onDownload: (id: string) => void;
  onAttach: (file: File | undefined) => void;
  onAddTag: () => void;
  onToggleWatch: () => void;
}): VNode {
  const ticket = detail?.ticket;
  const firstResponse = detail?.comments.find(comment => !comment.isInternal && !comment.isSystem && comment.authorUserId !== ticket?.requesterUserId);
  const lifecycle = ['Created', 'Assigned', 'In progress', 'Resolved'];
  const stage = !ticket ? 0 : ['resolved', 'closed'].includes(ticket.status) ? 3 : ['in_progress', 'waiting_requester'].includes(ticket.status) ? 2 : ticket.assigneeUserId ? 1 : 0;
  const sourceModule = ticket ? recordText(ticket, 'sourceModule', 'Employee self-service') : 'Employee self-service';
  const sourceEntityType = ticket ? recordText(ticket, 'sourceEntityType', 'Not linked') : 'Not linked';
  const sourceEntityId = ticket ? recordIdentifier(ticket, 'sourceEntityId', '') : '';
  return (
    <Drawer rich open={open} onClose={onClose} title="Ticket detail" sub={ticket ? `${ticket.ticketNumber} · ${titleCase(ticket.queueCode)}` : ''} noFooter panelClass="tc-details-drawer tc-mockup-drawer">
      {!detail || !ticket ? <PanelEmpty>Loading ticket details…</PanelEmpty> : <div class="tc-drawer-body">
        <div class="tc-drawer-document-head"><div><h3>{ticket.subject}</h3><p>Requested by {ticket.requester?.displayName ?? 'SIOMAC user'} · {titleCase(sourceModule)}</p></div><span class={`tc-drawer-pill ${ticket.status}`}>{titleCase(ticket.status)}</span></div>
        <div class={`tc-drawer-ribbon${ticket.resolutionDueAt && new Date(ticket.resolutionDueAt).getTime() < nowMs ? ' overdue' : ''}`}><i class="fas fa-clock" /><div><strong>Resolution due {formatDate(ticket.resolutionDueAt)}</strong><small>{dueRemaining(ticket.resolutionDueAt, nowMs)} · target {durationBetween(ticket.createdAt, ticket.resolutionDueAt)}</small></div></div>
        <div class="tc-drawer-stat-grid"><div><small>Priority</small><strong>{titleCase(ticket.priority)}</strong><span>Handler managed</span></div><div><small>First response</small><strong>{durationBetween(ticket.createdAt, firstResponse?.createdAt)}</strong><span>{firstResponse ? 'Response recorded' : 'Pending'}</span></div><div><small>Activity</small><strong>{ticket.activitySequence}</strong><span>Current sequence</span></div></div>
        <nav class="tc-drawer-tabs" aria-label="Ticket detail sections">{(['Details', 'Attachments', 'Participants', 'Activity'] as DrawerTab[]).map(next => <button type="button" key={next} class={tab === next ? 'active' : ''} aria-pressed={tab === next} onClick={() => setTab(next)}>{next}</button>)}</nav>
        {tab === 'Details' && <>
          <section class="tc-drawer-section"><header><span>Request</span></header><dl class="tc-drawer-field-grid"><div><dt>Request type</dt><dd>{titleCase(ticket.requestTypeCode)}</dd></div><div><dt>Queue</dt><dd>{titleCase(ticket.queueCode)}</dd></div><div><dt>Priority</dt><dd>{titleCase(ticket.priority)}</dd></div><div><dt>Status</dt><dd>{titleCase(ticket.status)}</dd></div><div><dt>Confidential</dt><dd>{ticket.isConfidential ? 'Yes' : 'No'}</dd></div><div><dt>Version</dt><dd>{ticket.version}</dd></div></dl></section>
          <section class="tc-drawer-section"><header><span>Lifecycle</span></header><div class="tc-drawer-steps">{lifecycle.map((label, index) => <Fragment key={label}><div class={index < stage ? 'done' : index === stage ? 'current' : ''}><i /><strong>{label}</strong><small>{index < stage ? 'Completed' : index === stage ? 'Current' : 'Pending'}</small></div>{index < lifecycle.length - 1 && <span class={index < stage ? 'done' : ''} />}</Fragment>)}</div></section>
          <section class="tc-drawer-section"><header><span>Ownership and source</span></header><dl class="tc-drawer-field-grid"><div><dt>Assignee</dt><dd>{ticket.assignee?.displayName ?? 'Unassigned'}</dd></div><div><dt>Requester</dt><dd>{ticket.requester?.displayName ?? 'Unavailable'}</dd></div><div><dt>Source module</dt><dd>{titleCase(sourceModule)}</dd></div><div><dt>Source record</dt><dd>{sourceEntityId ? `${titleCase(sourceEntityType)} · ${sourceEntityId}` : sourceEntityType}</dd></div></dl></section>
          <section class="tc-drawer-section"><header><span>Tags</span>{detail.canHandle && <button type="button" onClick={onAddTag}>＋ Add tag</button>}</header><div class="tc-drawer-tags">{detail.tags.length ? detail.tags.map(tag => <span key={tag.key}>{tag.label}</span>) : <PanelEmpty>No tags</PanelEmpty>}</div></section>
        </>}
        {tab === 'Attachments' && <section class="tc-drawer-section"><header><span>Files ({detail.attachments.length})</span><label><i class="fas fa-paperclip" /> Add attachment<input type="file" onChange={event => onAttach(event.currentTarget.files?.[0])} /></label></header>{detail.attachments.length ? detail.attachments.map(file => <button class="tc-drawer-file" key={file.id} onClick={() => onDownload(file.id)}><i class="fas fa-file" /><span><strong>{file.fileName}</strong><small>{fileSize(file.sizeBytes)}</small></span><i class="fas fa-download" /></button>) : <PanelEmpty>No attachments on this ticket.</PanelEmpty>}</section>}
        {tab === 'Participants' && <section class="tc-drawer-section"><header><span>Ticket participants ({detail.participants.length})</span>{detail.canHandle && <button type="button" onClick={onToggleWatch}>{isWatcher ? 'Unwatch' : '＋ Watch'}</button>}</header>{detail.participants.length ? detail.participants.map((participant, index) => { const profile = participant.user ?? null; return <div class="tc-person-row" key={recordIdentifier(participant, 'userId', String(index))}><Avatar small profile={profile} /><span><strong>{profile?.displayName ?? 'SIOMAC user'}</strong><small>{titleCase(recordText(participant, 'role', 'participant'))}</small></span><em>{participant.notificationsMuted === true ? 'Muted' : 'Notifications on'}</em></div>; }) : <PanelEmpty>Participant details are restricted to ticket handlers.</PanelEmpty>}</section>}
        {tab === 'Activity' && <section class="tc-drawer-section"><header><span>Sequenced activity ({detail.events.length})</span></header><ol class="tc-drawer-activity">{detail.events.length ? [...detail.events].reverse().map((event, index) => { const sequence = recordIdentifier(event, 'sequence', ''); return <li key={recordIdentifier(event, 'id', String(index))}><i /><span><strong>{titleCase(recordText(event, 'eventType', 'updated'))}</strong><small>{event.actor?.displayName ?? 'System'} · {formatDate(recordText(event, 'createdAt', ''))}{sequence ? ` · Sequence ${sequence}` : ''}</small></span></li>; }) : <PanelEmpty>No activity recorded.</PanelEmpty>}</ol></section>}
      </div>}
    </Drawer>
  );
}

export function TicketCenter(): VNode {
  const isTicketsActive = useActiveSection()('s-tickets');
  const currentUserId = useSessionStore(state => state.userId);
  const currentName = useSessionStore(state => state.fullName);
  const currentPhoto = useSessionStore(state => state.profileImage);
  const currentProfile: TicketUserProfile | null = currentUserId ? { id: currentUserId, displayName: currentName ?? 'You', email: null, role: null, photoUrl: currentPhoto } : null;
  const [scope, setScope] = useState<Scope>('queue');
  const [search, setSearch] = useState('');
  const [querySearch, setQuerySearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [quickView, setQuickView] = useState<QuickView>('all');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [queueCode, setQueueCode] = useState('');
  const [requestTypeCode, setRequestTypeCode] = useState('');
  const [tagKey, setTagKey] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [page, setPage] = useState(1);
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
  const [referenceNow] = useState(() => Date.now());
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
  const tickets = useMemo(() => listQ.data ?? [], [listQ.data]);
  const allTickets = useMemo(() => allQ.data ?? [], [allQ.data]);
  const detail = detailQ.data;
  const ticket = detail?.ticket;
  const displayTickets = useMemo(() => tickets.filter(row => {
    if (quickView === 'all') return true;
    if (quickView === 'waiting_requester' || quickView === 'resolved') return row.status === quickView;
    if (!row.resolutionDueAt || !OPEN_STATUSES.has(row.status)) return false;
    const due = new Date(row.resolutionDueAt);
    if (quickView === 'overdue') return due.getTime() < referenceNow;
    const now = new Date(referenceNow);
    return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate();
  }), [quickView, referenceNow, tickets]);

  useEffect(() => {
    const firstTicket = displayTickets[0];
    if (!selectedId && firstTicket) setSelectedId(firstTicket.id);
    if (selectedId && firstTicket && !displayTickets.some(row => row.id === selectedId)) setSelectedId(firstTicket.id);
    if (selectedId && displayTickets.length === 0) setSelectedId('');
  }, [displayTickets, selectedId]);

  // Show PAGE_SIZE (6) tickets per page. currentPage is clamped so a shrinking
  // list (after a filter) never strands the view on an empty page.
  const pageCount = Math.max(1, Math.ceil(displayTickets.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedTickets = displayTickets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Return to page 1 whenever the filter/scope/search inputs change (not on refetch).
  useEffect(() => { setPage(1); }, [scope, querySearch, status, priority, queueCode, requestTypeCode, tagKey, quickView]);

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

  const overdue = useMemo(() => allTickets.filter(row => OPEN_STATUSES.has(row.status) && row.resolutionDueAt && new Date(row.resolutionDueAt).getTime() < referenceNow).length, [allTickets, referenceNow]);
  const dueToday = useMemo(() => {
    const now = new Date(referenceNow);
    return allTickets.filter(row => {
      if (!OPEN_STATUSES.has(row.status) || !row.resolutionDueAt) return false;
      const due = new Date(row.resolutionDueAt);
      return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate();
    }).length;
  }, [allTickets, referenceNow]);

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

  const navSlot = typeof document !== 'undefined' ? document.getElementById('topbar-nav-slot') : null;
  // Join the header into the global top bar (beside the account pill) while the
  // Ticket Center is the ACTIVE panel — the same #topbar-nav-slot portal the
  // Messenger uses. Gated on the active section so this chrome never leaks onto
  // other pages (the panel stays mounted while hidden).
  const bandHeader = isTicketsActive && navSlot
    ? createPortal(
        <div class="tc-band">
          <div class="tc-band-head"><h1>Recent Tickets</h1><button type="button" class="tc-band-new" onClick={() => setCreateOpen(true)}><LucideIcon name="Plus" size={15} /><span>New ticket</span></button></div>
          <div class="tc-band-stats" aria-label="Ticket summary">
            <div class="tc-kpi tc-kpi--blue"><span class="tc-kpi-ic"><LucideIcon name="Inbox" size={15} /></span><div class="tc-kpi-body"><span class="tc-kpi-num">{summaryQ.data?.ticketsOpen ?? allTickets.filter(row => OPEN_STATUSES.has(row.status)).length}</span><span class="tc-kpi-name">Open</span></div></div>
            <div class="tc-kpi tc-kpi--purple"><span class="tc-kpi-ic"><LucideIcon name="Mail" size={15} /></span><div class="tc-kpi-body"><span class="tc-kpi-num">{summaryQ.data?.ticketsUnread ?? 0}</span><span class="tc-kpi-name">Unread</span></div></div>
            <div class="tc-kpi tc-kpi--red"><span class="tc-kpi-ic"><LucideIcon name="Clock" size={15} /></span><div class="tc-kpi-body"><span class="tc-kpi-num">{overdue}</span><span class="tc-kpi-name">Overdue</span></div></div>
            <div class="tc-kpi tc-kpi--amber"><span class="tc-kpi-ic"><LucideIcon name="Calendar" size={15} /></span><div class="tc-kpi-body"><span class="tc-kpi-num">{dueToday}</span><span class="tc-kpi-name">Due today</span></div></div>
          </div>
        </div>,
        navSlot,
      )
    : null;

  return (
    <div class="tc-page">
      {bandHeader}
      <main class="tc-workspace">
        <section class="tc-list-panel">
          <header class="tc-list-head">
            <div class="tc-search"><i class="fas fa-search" /><input value={search} onInput={event => setSearch(event.currentTarget.value)} placeholder="Search tickets" /><button class={filtersOpen ? 'active' : ''} onClick={() => setFiltersOpen(open => !open)} aria-label="Filters"><i class="fas fa-filter" /></button></div>
            {hasQueueAccess ? (
              <div class="tc-scopes">
                {([
                  ['queue', 'Queue', 'List'],
                  ['assigned', 'Assigned', 'User'],
                  ['all', 'All', 'Ticket'],
                ] as const).map(([key, label, icon]) => (
                  <button type="button" class={scope === key ? 'active' : ''} onClick={() => setScope(key)} key={key}><LucideIcon name={icon} size={14} />{label}</button>
                ))}
              </div>
            ) : (
              <div class="tc-self-scope"><LucideIcon name="User" size={14} /> My requests</div>
            )}
            {filtersOpen && <div class="tc-filters">
              <div class="tc-quick-views">
                <strong>Views</strong>
                {([
                  ['waiting_requester', 'Waiting on requester', allTickets.filter(row => row.status === 'waiting_requester').length],
                  ['overdue', 'Overdue', overdue],
                  ['due_today', 'Due today', dueToday],
                  ['resolved', 'Resolved', allTickets.filter(row => row.status === 'resolved').length],
                ] as const).map(([key, label, count]) => <button type="button" class={quickView === key ? 'active' : ''} onClick={() => setQuickView(quickView === key ? 'all' : key)}><span>{label}</span><b>{count}</b></button>)}
              </div>
              <label>Status<select value={status} onChange={event => setStatus(event.currentTarget.value)}><option value="">All statuses</option><option value="open">Open</option><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="waiting_requester">Waiting on requester</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label>
              <label>Priority<select value={priority} onChange={event => setPriority(event.currentTarget.value)}><option value="">All priorities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
              <label>Queue<select value={queueCode} onChange={event => setQueueCode(event.currentTarget.value)}><option value="">All queues</option>{queueOptions.map(code => <option value={code} key={code}>{titleCase(code)}</option>)}</select></label>
              <label>Request type<select value={requestTypeCode} onChange={event => setRequestTypeCode(event.currentTarget.value)}><option value="">All request types</option>{requestTypeOptions.map(code => <option value={code} key={code}>{titleCase(code)}</option>)}</select></label>
              <label>Tag<select value={tagKey} onChange={event => setTagKey(event.currentTarget.value)}><option value="">All tags</option>{tagOptions.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
              <button onClick={() => { setQuickView('all'); setStatus(''); setPriority(''); setQueueCode(''); setRequestTypeCode(''); setTagKey(''); }}>Clear</button>
            </div>}
            <div class="tc-list-group"><strong>{titleCase(scope)} tickets ({displayTickets.length})</strong><span>Newest</span></div>
          </header>
          <div class="tc-ticket-scroll">
            {listQ.isLoading && <div class="tc-list-state">Loading tickets…</div>}
            {listQ.isError && <div class="tc-list-state">Tickets could not be loaded.<button onClick={() => void listQ.refetch()}>Try again</button></div>}
            {!listQ.isLoading && !listQ.isError && displayTickets.length === 0 && <div class="tc-list-state"><i class="fas fa-ticket" />No tickets match these filters.</div>}
            {pagedTickets.map(row => <TicketRow key={row.id} ticket={row} selected={row.id === selectedId} onClick={() => selectTicket(row.id)} />)}
          </div>
          <footer class="tc-list-foot"><span>{displayTickets.length === 0 ? '0' : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, displayTickets.length)}`} of {displayTickets.length}</span><div class="tc-list-pages"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="Previous page">‹</button>{pagerWindow(currentPage, pageCount).map((p, i) => p === 'gap' ? <span class="tc-page-gap" key={`gap${i}`}>…</span> : <button type="button" key={p} class={p === currentPage ? 'active' : ''} onClick={() => setPage(p)}>{p}</button>)}<button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} aria-label="Next page">›</button></div><button onClick={() => void listQ.refetch()}><i class="fas fa-rotate" /> Refresh</button></footer>
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
                      <div><header><span><strong>{requester?.displayName ?? 'Requester'}</strong><small>Employee self-service</small></span><time>{formatDate(ticket.createdAt)}</time></header><TicketRichText value={recordText(ticket, 'description', '')} />
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
                  <div class="tc-recipient"><Avatar small profile={currentProfile} /><strong>{composerMode === 'internal' ? 'Internal note' : 'Reply to:'}</strong>{composerMode === 'reply' && <span class="tc-recipient-chip">{requester?.displayName ?? 'Requester'}</span>}<div><button class={composerMode === 'reply' ? 'active' : ''} onClick={() => setComposerMode('reply')}>Reply</button>{detail.canHandle && <button class={composerMode === 'internal' ? 'active' : ''} onClick={() => setComposerMode('internal')}><i class="fas fa-note-sticky" /> Internal note</button>}</div><small>{composerMode === 'internal' ? 'Visible to handlers only' : `Visible to ${requester?.displayName ?? 'requester'}`}</small></div>
                  <div class="tc-format">
                    <select aria-label="Paragraph style" onChange={event => format('formatBlock', event.currentTarget.value)}><option value="p">Paragraph</option><option value="h3">Heading</option></select>
                    <span />
                    <button onMouseDown={event => event.preventDefault()} onClick={() => format('bold')}><b>B</b></button>
                    <button onMouseDown={event => event.preventDefault()} onClick={() => format('italic')}><i>I</i></button>
                    <button onMouseDown={event => event.preventDefault()} onClick={() => format('underline')}><u>U</u></button>
                    <span />
                    <button aria-label="Align left" onClick={() => format('justifyLeft')}><i class="fas fa-align-left" /></button>
                    <button aria-label="Align center" onClick={() => format('justifyCenter')}><i class="fas fa-align-center" /></button>
                    <button aria-label="Align right" onClick={() => format('justifyRight')}><i class="fas fa-align-right" /></button>
                    <span />
                    <button onClick={() => format('insertUnorderedList')}><i class="fas fa-list-ul" /></button>
                    <button onClick={() => format('insertOrderedList')}><i class="fas fa-list-ol" /></button>
                    <button onClick={() => { const url = window.prompt('Paste a link'); if (url) format('createLink', url); }}><i class="fas fa-link" /></button>
                  </div>
                  <div ref={editorRef} class="tc-editor" contentEditable role="textbox" aria-multiline="true" data-placeholder={composerMode === 'internal' ? 'Write an internal note…' : 'Type your reply…'} onInput={event => setBody(editorToMarkdown(event.currentTarget))} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); sendComment(); } }} />
                  <footer><button type="button" class="tc-emoji" aria-label="Insert emoji" onClick={() => format('insertText', '🙂')}><i class="far fa-face-smile" /></button><label class={uploading ? 'disabled' : ''}><i class="fas fa-paperclip" /> Attach<input type="file" disabled={uploading} onChange={event => void attach(event.currentTarget.files?.[0])} /></label><small>{composerMode === 'internal' ? 'Visible to handlers only' : 'Requester will be notified'}</small><button disabled={!body.trim() || comment.isPending} onClick={sendComment}><i class="fas fa-paper-plane" /> {comment.isPending ? 'Sending…' : composerMode === 'internal' ? 'Add note' : 'Send reply'}</button></footer>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <MockupTicketDetailsDrawer open={drawerOpen} tab={drawerTab} setTab={setDrawerTab} detail={detail} isWatcher={isWatcher} nowMs={referenceNow} onClose={() => setDrawerOpen(false)} onDownload={id => void download(id)} onAttach={file => void attach(file)} onAddTag={() => { setActionValue(''); setActionDialog('tag'); }} onToggleWatch={() => runAction(isWatcher ? 'unwatch' : 'watch')} />
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
