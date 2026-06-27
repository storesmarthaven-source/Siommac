/**
 * src/components/nav/TicketsPanel.ts
 *
 * Support Tickets system — ported from the inline IIFE in nav.js (lines 1061–1485).
 * Wires the existing #ticketList, #ticketDetailPane, #ticketComposePane DOM.
 * Returns a cleanup function.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import {
  getTickets,
  createTicket,
  replyTicket,
  updateTicketStatus,
  deleteTicket,
  clearClosedTickets,
} from './api';
import { setHdrBadge, getUser, getRole, getFullName, getProfileImage, esc } from './navCore';
import { scheduleHdrBadgeSync } from './badgeSync';
import type { TicketItem, TicketReply } from './types';

const STATUS_LABEL: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed', deleted: 'Deleted',
};
const STATUS_CSS: Record<string, string> = {
  open: 'open', in_progress: 'pending', resolved: 'closed', closed: 'closed', deleted: 'deleted',
};

function initials(name: string): string {
  return (name || '?').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function timeAgoShort(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function isAdminView(): boolean {
  const r = getRole();
  return r === 'admin' || r === 'manager';
}

function seenKey(): string {
  return 'siomac_seen_reply_ids_' + (getUser() || '');
}

function loadSeenIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(seenKey()) ?? '[]') as string[]); } catch { return new Set(); }
}

function persistSeen(set: Set<string>): void {
  try { localStorage.setItem(seenKey(), JSON.stringify([...set])); } catch {}
}

function ticketBubbleHtml(r: TicketReply, seenIds: Set<string>, currentUser: string): string {
  const isMe     = r.fromUsername === currentUser;
  const isSystem = r.fromUsername === '__system__';
  if (isSystem) {
    return `<div data-reply-id="${esc(String(r.id))}" style="display:flex;align-items:center;gap:8px;padding:6px 16px;margin-bottom:8px;">
      <i class="fas fa-lock" style="color:#aaa;font-size:0.7rem;flex-shrink:0;"></i>
      <span style="font-size:0.75rem;color:#999;font-style:italic;">${esc(r.body)}</span>
      <span style="font-size:0.67rem;color:#bbb;margin-left:auto;white-space:nowrap;">${timeAgoShort(r.createdAt)}</span>
    </div>`;
  }
  const name     = r.fromName || r.fromUsername || '?';
  const inits    = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const align    = isMe ? 'flex-end' : 'flex-start';
  const bubbleBg    = isMe ? 'var(--siomac-navy,#1b2d54)' : 'var(--bg-subtle,#f0f2f5)';
  const bubbleColor = isMe ? '#fff' : 'var(--text-primary)';
  const avatarBg    = isMe ? 'var(--siomac-navy,#1b2d54)' : 'var(--siomac-red,#e40c0c)';
  const borderColor = isMe ? 'var(--siomac-navy,#1b2d54)' : 'var(--border,#ddd)';
  const photoUrl = r.fromPhoto || '';
  const avatar = photoUrl
    ? `<img src="${esc(photoUrl)}" alt="${esc(name)}" crossorigin="anonymous" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid ${borderColor};">`
    : `<div style="width:28px;height:28px;border-radius:50%;background:${avatarBg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight: var(--font-weight-bold);flex-shrink:0;">${esc(inits)}</div>`;
  const borderRadius = isMe ? '12px 12px 4px 12px' : '12px 12px 12px 4px';
  const bubble = `<div style="max-width:75%;background:${bubbleBg};color:${bubbleColor};padding:7px 11px;border-radius:${borderRadius};font-size:0.81rem;white-space:pre-wrap;line-height:1.4;">${esc(r.body)}</div>`;
  const textAlign = isMe ? 'right' : 'left';
  const meta   = `<div style="font-size:0.65rem;color:var(--text-muted);margin-top:3px;text-align:${textAlign};">${esc(isMe ? 'You' : name)} · ${timeAgoShort(r.createdAt)}</div>`;
  const flexDir = isMe ? 'row-reverse' : 'row';
  return `<div data-reply-id="${esc(String(r.id))}" style="display:flex;flex-direction:column;align-items:${align};margin-bottom:12px;">
    <div style="display:flex;align-items:flex-end;gap:6px;flex-direction:${flexDir};">${avatar}${bubble}</div>
    ${meta}
  </div>`;
}

export function mountTicketsPanel(): () => void {
  let _tickets: TicketItem[]          = [];
  let _ticketsLoaded                  = false;
  let _currentTicketId: string | number | null = null;
  let _composing                      = false;
  let _pollTimer: ReturnType<typeof setInterval> | null = null;
  const _seenReplyIds                 = loadSeenIds();

  // ── View helpers ──────────────────────────────────────────────────────────

  function showList(): void {
    const ticketList    = document.getElementById('ticketList');
    const detailPane    = document.getElementById('ticketDetailPane');
    const composePane   = document.getElementById('ticketComposePane');
    const modalFoot     = document.getElementById('ticketModalFoot');
    if (ticketList)  ticketList.style.display  = '';
    if (detailPane)  detailPane.style.display  = 'none';
    if (composePane) composePane.style.display = 'none';
    if (modalFoot)   modalFoot.style.display   = '';
    _currentTicketId = null;
    _composing       = false;
  }

  function showCompose(): void {
    const ticketList    = document.getElementById('ticketList');
    const detailPane    = document.getElementById('ticketDetailPane');
    const composePane   = document.getElementById('ticketComposePane');
    const modalFoot     = document.getElementById('ticketModalFoot');
    const categoryEl    = document.getElementById('ticketCategory') as HTMLSelectElement | null;
    const subjectEl     = document.getElementById('ticketSubject')  as HTMLInputElement | null;
    const bodyEl        = document.getElementById('ticketBody')     as HTMLTextAreaElement | null;
    if (ticketList)  ticketList.style.display  = 'none';
    if (detailPane)  detailPane.style.display  = 'none';
    if (composePane) composePane.style.display = 'flex';
    if (modalFoot)   modalFoot.style.display   = 'none';
    if (categoryEl) categoryEl.value = 'general';
    if (subjectEl)  subjectEl.value  = '';
    if (bodyEl)     bodyEl.value     = '';
    subjectEl?.focus();
    _composing = true;
  }

  // ── Badge ─────────────────────────────────────────────────────────────────

  function updateTicketBadge(): void {
    if (!_ticketsLoaded) return;
    const currentUser = getUser();
    const unseen = _tickets.reduce(
      (sum, t) => sum + (t.replies ?? []).filter(r => !_seenReplyIds.has(String(r.id)) && r.fromUsername !== currentUser).length,
      0,
    );
    ['hdrTicketBadge', 'empTicketBadge', 'mgrTicketBadge'].forEach(id =>
      setHdrBadge(document.getElementById(id), unseen)
    );
    if (isAdminView()) {
      const openCount = _tickets.filter(t => t.status === 'open').length;
      const countEl   = document.getElementById('ticketOpenCount');
      if (countEl) countEl.textContent = openCount ? `${openCount} Open Ticket${openCount !== 1 ? 's' : ''}` : '';
    }
  }

  // ── List rendering ────────────────────────────────────────────────────────

  function ticketRowKey(t: TicketItem): string {
    const lastReply = t.replies.length ? t.replies[t.replies.length - 1]! : null;
    const unseenCount = t.replies.filter(r => !_seenReplyIds.has(String(r.id))).length;
    return (t.status || '') + '|' + t.replies.length + '|' + (lastReply ? lastReply.createdAt : t.createdAt) + '|' + unseenCount;
  }

  function ticketRowHtml(t: TicketItem): string {
    const currentUser  = getUser();
    const adminView    = isAdminView();
    const isDeleted    = t.status === 'deleted';
    const isSentByMe   = t.fromUsername === currentUser;
    const css          = STATUS_CSS[t.status] ?? 'open';
    const lbl          = STATUS_LABEL[t.status] ?? t.status;
    const lastReply    = t.replies.length ? t.replies[t.replies.length - 1]! : null;
    const latestTime   = lastReply ? lastReply.createdAt : t.createdAt;
    const previewBody  = lastReply ? lastReply.body : t.body;
    const previewBy    = lastReply
      ? (lastReply.fromUsername === currentUser ? 'You' : (lastReply.fromName || lastReply.fromUsername))
      : (isSentByMe ? 'You' : (t.fromName || t.fromUsername));
    const unseenCount  = t.replies.filter(r => !_seenReplyIds.has(String(r.id)) && r.fromUsername !== currentUser).length;
    const hasNewReply  = unseenCount > 0 && !isDeleted;
    const avatarName   = adminView ? (t.fromName || 'U') : 'Me';
    const inits        = initials(avatarName);
    const grayscaleStyle = isDeleted ? 'filter:grayscale(1);opacity:0.5;' : '';
    const avatarInlineOverride = isDeleted ? 'background:#aaa;color:#fff;' : (isSentByMe ? 'background:var(--siomac-navy,#1b2d54);color:#fff;' : '');
    const avatarHtml = t.fromPhoto
      ? `<img src="${esc(t.fromPhoto)}" alt="${esc(inits)}" crossorigin="anonymous" style="width:36px;height:36px;border-radius:50%;flex-shrink:0;object-fit:cover;${grayscaleStyle}border:2px solid var(--border,#eee);">`
      : `<div class="hdr-msg-avatar" style="width:36px;height:36px;font-size:0.7rem;${avatarInlineOverride}">${esc(inits)}</div>`;
    const deletedBadge = isDeleted
      ? `<span style="font-size:0.62rem;font-weight:600;color:#999;background:#f0f0f0;border:1px solid #ddd;border-radius:4px;padding:1px 6px;margin-left:4px;">Deleted</span>`
      : '';
    const canDelete = !adminView && !isDeleted && (t.status === 'open' || t.status === 'in_progress');
    const deleteBtn = canDelete
      ? `<button data-delete-ticket-id="${esc(String(t.id))}" title="Delete ticket" style="margin-left:auto;border:none;background:none;cursor:pointer;color:var(--siomac-red,#e40c0c);font-size:0.75rem;padding:2px 6px;border-radius:6px;opacity:.7;transition:opacity .15s;flex-shrink:0;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity='.7'"><i class="fas fa-trash-alt"></i></button>`
      : '';
    const indicator = !hasNewReply ? ''
      : `<span style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;align-self:center;background:rgba(228,12,12,0.09);border:1.5px solid rgba(228,12,12,0.22);border-radius:20px;padding:2px 7px 2px 5px;white-space:nowrap;"><span style="width:7px;height:7px;border-radius:50%;background:var(--siomac-red);flex-shrink:0;"></span><span style="font-size:0.65rem;font-weight: var(--font-weight-bold);color:var(--siomac-red);">New reply</span></span>`;
    const borderStyle   = hasNewReply ? 'border-left:3px solid var(--siomac-red);padding-left:11px;' : 'border-left:3px solid transparent;padding-left:11px;';
    const nameWeight    = hasNewReply ? '700' : '600';
    const nameColor     = hasNewReply ? 'var(--text-primary)' : 'var(--text-muted)';
    const nameDecor     = isDeleted ? 'text-decoration:line-through;' : '';
    const subjectWeight = hasNewReply ? '700' : '600';
    const ptrEvents     = isDeleted ? `pointer-events:${adminView ? 'auto' : 'none'};` : '';
    const displayName   = adminView ? (t.fromName || '—') : `#${t.ticketNumber}`;
    return `<div class="hdr-ticket-item ${css}${isDeleted ? ' hdr-ticket-deleted' : ''}${hasNewReply ? ' unread' : ''}" data-ticket-id="${esc(String(t.id))}" style="cursor:pointer;display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);${borderStyle}${isDeleted ? `opacity:0.6;${ptrEvents}` : ''}">
      ${avatarHtml}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <span style="font-weight:${nameWeight};color:${nameColor};${nameDecor}">${esc(displayName)}</span>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
            <span class="hdr-ticket-status ${css}">${esc(lbl)}</span>${deletedBadge}
            <span style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap;">${timeAgoShort(latestTime)}</span>
          </div>
        </div>
        <div style="font-size:0.78rem;font-weight:${subjectWeight};color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(t.subject)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><span style="font-style:italic;">${esc(previewBy)}:</span> ${esc(previewBody || '—')}</div>
      </div>
      ${indicator}
      ${deleteBtn}
    </div>`;
  }

  function renderList(): void {
    const list = document.getElementById('ticketList');
    if (!list) return;
    const adminView = isAdminView();
    const visible   = (adminView ? _tickets : _tickets.filter(t => t.status !== 'deleted'))
      .slice().sort((a, b) => {
        const latestA = a.replies.length ? a.replies[a.replies.length - 1]!.createdAt : a.createdAt;
        const latestB = b.replies.length ? b.replies[b.replies.length - 1]!.createdAt : b.createdAt;
        return new Date(latestB).getTime() - new Date(latestA).getTime();
      });
    if (!visible.length) {
      list.innerHTML = '<div class="hdr-notif-empty"><i class="fas fa-ticket-alt" style="opacity:.3"></i><p>No tickets yet</p></div>';
      return;
    }
    const empty = list.querySelector('.hdr-notif-empty');
    if (empty) list.innerHTML = '';
    const existingById = new Map<string, Element>();
    list.querySelectorAll<HTMLElement>('.hdr-ticket-item[data-ticket-id]').forEach(el =>
      existingById.set(el.dataset['ticketId'] ?? '', el)
    );
    const frag = document.createDocumentFragment();
    visible.forEach(t => {
      const id  = String(t.id);
      const key = ticketRowKey(t);
      let el = existingById.get(id);
      if (!el || (el as HTMLElement).dataset['ticketKey'] !== key) {
        const tmp = document.createElement('div');
        tmp.innerHTML = ticketRowHtml(t);
        el = tmp.firstElementChild ?? undefined;
      }
      if (el) { (el as HTMLElement).dataset['ticketKey'] = key; frag.appendChild(el); }
    });
    list.innerHTML = '';
    list.appendChild(frag);
  }

  // ── Detail pane ───────────────────────────────────────────────────────────

  function showDetail(ticketId: string | number): void {
    const currentUser = getUser();
    const t = _tickets.find(x => String(x.id) === String(ticketId));
    if (!t) return;
    _currentTicketId = ticketId;
    (t.replies ?? []).forEach(r => _seenReplyIds.add(String(r.id)));
    persistSeen(_seenReplyIds);
    updateTicketBadge();
    renderList();

    const ticketList = document.getElementById('ticketList');
    const composePane = document.getElementById('ticketComposePane');
    const modalFoot   = document.getElementById('ticketModalFoot');
    const pane        = document.getElementById('ticketDetailPane');
    if (ticketList)  ticketList.style.display  = 'none';
    if (composePane) composePane.style.display = 'none';
    if (modalFoot)   modalFoot.style.display   = 'none';
    if (pane)        pane.style.display        = 'flex';

    const adminView   = isAdminView();
    const statusSel   = document.getElementById('ticketStatusSelect') as HTMLSelectElement | null;
    const statusSave  = document.getElementById('ticketStatusSaveBtn');
    if (statusSel)  statusSel.style.display  = adminView ? '' : 'none';
    if (statusSave) statusSave.style.display = adminView ? '' : 'none';
    if (adminView && statusSel) { statusSel.value = t.status; statusSel.dataset['userChanged'] = ''; }

    const isDeleted   = t.status === 'deleted';
    const css         = STATUS_CSS[t.status] ?? 'open';
    const lbl         = STATUS_LABEL[t.status] ?? t.status;
    const deletedBanner = isDeleted
      ? `<div style="padding:8px 16px;background:#fff3cd;border-bottom:1px solid #ffc107;display:flex;align-items:center;gap:8px;font-size:0.78rem;color:#7a5c00;"><i class="fas fa-trash-alt"></i><span>This ticket was <strong>deleted by the employee</strong> before it was resolved.</span></div>`
      : '';
    const deletedStyle = isDeleted ? 'opacity:0.65;' : '';
    const adminReporter = adminView ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;">Reported by ${esc(t.fromName)}</div>` : '';
    const subjectDecor  = isDeleted ? 'text-decoration:line-through;color:#999;' : '';
    const ticketNumDecor= isDeleted ? 'text-decoration:line-through;color:#999;' : '';

    const detailBody = document.getElementById('ticketDetailBody');
    if (detailBody) {
      detailBody.innerHTML = `
        ${deletedBanner}
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);${deletedStyle}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span class="hdr-ticket-id" style="${ticketNumDecor}">#${esc(t.ticketNumber)}</span>
            <span class="hdr-ticket-status ${css}">${esc(lbl)}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${timeAgoShort(t.createdAt)}</span>
          </div>
          <div style="font-size:0.88rem;font-weight: var(--font-weight-bold);margin-bottom:6px;${subjectDecor}">${esc(t.subject)}</div>
          ${adminReporter}
          <div style="font-size:0.83rem;color:var(--text-primary);white-space:pre-wrap;">${esc(t.body)}</div>
        </div>
        <div data-ticket-replies style="padding:12px 16px;display:flex;flex-direction:column;">
          ${t.replies.map(r => ticketBubbleHtml(r, _seenReplyIds, currentUser)).join('')}
        </div>`;
      const replyInputEl = document.getElementById('ticketReplyInput') as HTMLTextAreaElement | null;
      if (replyInputEl) replyInputEl.value = '';
      detailBody.scrollTop = detailBody.scrollHeight;
      requestAnimationFrame(() => { detailBody.scrollTop = detailBody.scrollHeight; });
    }

    const isClosed     = t.status === 'closed' || t.status === 'resolved' || t.status === 'deleted';
    const replyInput   = document.getElementById('ticketReplyInput')   as HTMLTextAreaElement | null;
    const replySendBtn = document.getElementById('ticketReplySendBtn') as HTMLButtonElement | null;
    if (replyInput && replySendBtn) {
      replyInput.disabled    = isClosed;
      replyInput.placeholder = isDeleted ? 'This ticket has been deleted.' : isClosed ? 'This ticket is closed and can no longer be replied to.' : 'Write your reply…';
      replyInput.style.background = isClosed ? 'var(--bg-subtle,#f8fafe)' : '';
      replyInput.style.color      = isClosed ? 'var(--text-muted)' : '';
      replySendBtn.disabled     = isClosed || !replyInput.value.trim();
      replySendBtn.style.opacity = (isClosed || !replyInput.value.trim()) ? '0.4' : '';
    }
  }

  function updateTicketDetail(ticketId: string | number): void {
    const t = _tickets.find(x => String(x.id) === String(ticketId));
    if (!t) return;
    const body = document.getElementById('ticketDetailBody');
    if (!body) return;
    const repliesEl = body.querySelector('[data-ticket-replies]');
    if (!repliesEl) { showDetail(ticketId); return; }

    const statusEl = body.querySelector('.hdr-ticket-status');
    if (statusEl) {
      const css = STATUS_CSS[t.status] ?? 'open';
      const lbl = STATUS_LABEL[t.status] ?? t.status;
      statusEl.className   = `hdr-ticket-status ${css}`;
      statusEl.textContent = lbl;
      const sel = document.getElementById('ticketStatusSelect') as HTMLSelectElement | null;
      const detailPane = document.getElementById('ticketDetailPane');
      if (sel && detailPane?.style.display !== 'none' && sel.dataset['userChanged'] !== '1') {
        sel.value = t.status;
      }
    }

    const currentUser = getUser();
    const existingIds = new Set([...repliesEl.querySelectorAll<HTMLElement>('[data-reply-id]')].map(el => el.dataset['replyId'] ?? ''));
    let appended = false;
    (t.replies ?? []).forEach(r => {
      if (existingIds.has(String(r.id))) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = ticketBubbleHtml(r, _seenReplyIds, currentUser);
      const child = tmp.firstElementChild;
      if (child) repliesEl.appendChild(child);
      appended = true;
    });
    if (appended) {
      body.scrollTop = body.scrollHeight;
      requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
    }

    const isDeleted2   = t.status === 'deleted';
    const isClosed     = t.status === 'closed' || t.status === 'resolved' || isDeleted2;
    const replyInput   = document.getElementById('ticketReplyInput')   as HTMLTextAreaElement | null;
    const replySendBtn = document.getElementById('ticketReplySendBtn') as HTMLButtonElement | null;
    if (replyInput && replySendBtn) {
      replyInput.disabled    = isClosed;
      replyInput.placeholder = isDeleted2 ? 'This ticket has been deleted.' : isClosed ? 'This ticket is closed and can no longer be replied to.' : 'Write your reply…';
      replyInput.style.background = isClosed ? 'var(--bg-subtle,#f8fafe)' : '';
      replyInput.style.color      = isClosed ? 'var(--text-muted)' : '';
      replySendBtn.disabled     = isClosed || !replyInput.value.trim();
      replySendBtn.style.opacity = (isClosed || !replyInput.value.trim()) ? '0.4' : '';
    }
  }

  // ── Fetch / poll ──────────────────────────────────────────────────────────

  async function fetchTickets(keepDetail = false): Promise<void> {
    try {
      const res = await getTickets();
      if (!res.success) return;
      _tickets       = res.data ?? [];
      _ticketsLoaded = true;
      updateTicketBadge();
      if (_currentTicketId) { updateTicketDetail(_currentTicketId); }
      else if (!_composing) { showList(); renderList(); }
    } catch (_) {}
    void keepDetail; // suppressed — keepDetail is for caller clarity only
  }

  // ── Sync reply button ─────────────────────────────────────────────────────

  function syncTicketReplyBtn(): void {
    const btn = document.getElementById('ticketReplySendBtn') as HTMLButtonElement | null;
    if (!btn) return;
    const t = _currentTicketId ? _tickets.find(x => String(x.id) === String(_currentTicketId)) : null;
    const isClosed = t ? ['closed', 'resolved', 'deleted'].includes(t.status) : false;
    if (isClosed) return; // state managed by showDetail / updateTicketDetail
    const empty = !((document.getElementById('ticketReplyInput') as HTMLTextAreaElement | null)?.value ?? '').trim();
    btn.disabled     = empty;
    btn.style.opacity = empty ? '0.4' : '';
  }

  // ── Start / stop ──────────────────────────────────────────────────────────

  function start(): void {
    const adminView = isAdminView();
    const titleEl   = document.getElementById('ticketModalTitle');
    const newBtn    = document.getElementById('ticketNewBtn');
    const hdrClear  = document.getElementById('ticketClearClosedBtn');
    const empClear  = document.getElementById('ticketClearClosedEmpBtn');
    if (titleEl)  titleEl.textContent     = adminView ? 'Support Tickets' : 'My Tickets';
    if (newBtn)   newBtn.style.display    = adminView ? 'none' : '';
    if (hdrClear) hdrClear.style.display  = adminView ? '' : 'none';
    if (empClear) empClear.style.display  = adminView ? 'none' : '';
    void fetchTickets();
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => { void fetchTickets(); }, 10_000);
  }

  function stop(): void {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    _tickets       = [];
    _ticketsLoaded = false;
  }

  // ── Wire DOM buttons ──────────────────────────────────────────────────────

  const ticketNewBtn      = document.getElementById('ticketNewBtn');
  const ticketCancelBtn   = document.getElementById('ticketCancelBtn');
  const detailBackBtn     = document.getElementById('ticketDetailBackBtn');
  const submitBtn         = document.getElementById('ticketSubmitBtn') as HTMLButtonElement | null;
  const replyInputEl      = document.getElementById('ticketReplyInput') as HTMLTextAreaElement | null;
  const replySendBtnEl    = document.getElementById('ticketReplySendBtn') as HTMLButtonElement | null;
  const statusSelectEl    = document.getElementById('ticketStatusSelect') as HTMLSelectElement | null;
  const statusSaveBtnEl   = document.getElementById('ticketStatusSaveBtn');
  const ticketRefreshBtn  = document.getElementById('ticketRefreshBtn');
  const clearClosedBtn    = document.getElementById('ticketClearClosedBtn');
  const clearClosedEmpBtn = document.getElementById('ticketClearClosedEmpBtn');

  function onNewClick()      { showCompose(); }
  function onCancelClick()   { showList(); }
  function onDetailBack()    { showList(); renderList(); }
  function onReplyInput()    { syncTicketReplyBtn(); }
  function onStatusChange()  { if (statusSelectEl) statusSelectEl.dataset['userChanged'] = '1'; }
  function onRefreshClick()  {
    (window as unknown as { _spinBtn?: (id: string) => void })._spinBtn?.('ticketRefreshBtn');
    void fetchTickets(_currentTicketId != null);
  }
  function onClearEmpClick() { document.getElementById('ticketClearClosedBtn')?.click(); }

  function onSubmitClick(): void {
    const categoryEl = document.getElementById('ticketCategory') as HTMLSelectElement | null;
    const subjectEl  = document.getElementById('ticketSubject')  as HTMLInputElement | null;
    const bodyEl     = document.getElementById('ticketBody')     as HTMLTextAreaElement | null;
    const category   = categoryEl?.value ?? 'general';
    const subject    = (subjectEl?.value ?? '').trim();
    const body       = (bodyEl?.value ?? '').trim();
    const win = window as unknown as { showPopup?: (t: string, h: string, m: string) => void };
    if (!subject) { subjectEl?.focus(); return; }
    if (!body)    { bodyEl?.focus();    return; }
    if (submitBtn) submitBtn.disabled = true;
    createTicket({ category, subject, body }).then(res => {
      if (submitBtn) submitBtn.disabled = false;
      if (!res.success) { win.showPopup?.('error', 'Failed', res.message ?? ''); return; }
      showList();
      setTimeout(() => { void fetchTickets(); scheduleHdrBadgeSync(); }, 400);
      win.showPopup?.('success', 'Ticket Submitted', `Your ticket ${res.ticketNumber ?? ''} has been submitted.`);
    }).catch(() => { if (submitBtn) submitBtn.disabled = false; });
  }

  function onReplySendClick(): void {
    const currentUser     = getUser();
    const currentFullName = getFullName();
    const replyEl = document.getElementById('ticketReplyInput') as HTMLTextAreaElement | null;
    const body    = (replyEl?.value ?? '').trim();
    if (!body) return;
    const btn = replySendBtnEl;
    if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }
    if (replyEl) replyEl.value = '';
    const optimisticReply: TicketReply = {
      id:           'tmp_' + Date.now(),
      fromUsername: currentUser,
      fromName:     currentFullName || currentUser,
      fromPhoto:    getProfileImage() || '',
      body,
      createdAt:    new Date().toISOString(),
    };
    const t = _currentTicketId ? _tickets.find(x => String(x.id) === String(_currentTicketId)) : null;
    if (t) {
      t.replies = t.replies ?? [];
      t.replies.push(optimisticReply);
      _seenReplyIds.add(String(optimisticReply.id));
      persistSeen(_seenReplyIds);
      updateTicketBadge();
      renderList();
      if (_currentTicketId != null) showDetail(_currentTicketId);
    }
    replyTicket({ ticketId: _currentTicketId!, body }).then(res => {
      syncTicketReplyBtn();
      const win = window as unknown as { showPopup?: (t: string, h: string, m: string) => void };
      if (!res.success) { win.showPopup?.('error', 'Failed', res.message ?? ''); return; }
      void fetchTickets(true);
    }).catch(() => { syncTicketReplyBtn(); });
  }

  function onStatusSaveClick(): void {
    const sel    = document.getElementById('ticketStatusSelect') as HTMLSelectElement | null;
    const status = sel?.value ?? '';
    updateTicketStatus({ ticketId: _currentTicketId!, status }).then(res => {
      const win = window as unknown as { showPopup?: (t: string, h: string, m: string) => void };
      if (!res.success) { win.showPopup?.('error', 'Failed', res.message ?? ''); return; }
      if (sel) sel.dataset['userChanged'] = '';
      const t = _tickets.find(x => String(x.id) === String(_currentTicketId));
      if (t) { t.status = status; if (_currentTicketId != null) showDetail(_currentTicketId); renderList(); updateTicketBadge(); }
    }).catch(() => {});
  }

  function onClearClosedClick(): void {
    const currentUser = getUser();
    const adminView   = isAdminView();
    const closedCount = _tickets.filter(t =>
      ['closed', 'resolved', 'deleted'].includes(t.status) &&
      (adminView || t.fromUsername === currentUser)
    ).length;
    const win  = window as unknown as { showPopup?: (t: string, h: string, m: string) => void };
    const cpop = (window as unknown as { cpop?: { fire: (o: object) => Promise<{ isConfirmed: boolean }> } }).cpop;
    if (!closedCount) { win.showPopup?.('info', 'Nothing to Clear', 'There are no closed, resolved or deleted tickets to clear.'); return; }
    if (!cpop) return;
    cpop.fire({
      icon: 'warning', title: 'Clear Closed Tickets?',
      text: `This will permanently delete ${closedCount} closed, resolved or deleted ticket${closedCount !== 1 ? 's' : ''}. This cannot be undone.`,
      showCancelButton: true, confirmButtonText: 'Clear All', confirmButtonColor: '#e40c0c',
    }).then(result => {
      if (!result.isConfirmed) return;
      clearClosedTickets().then(res => {
        if (!res.success) { win.showPopup?.('error', 'Failed', res.message ?? ''); return; }
        win.showPopup?.('success', 'Cleared', `${res.count ?? 0} ticket${(res.count ?? 0) !== 1 ? 's' : ''} removed.`);
        void fetchTickets();
      }).catch(() => win.showPopup?.('error', 'Error', 'Could not clear tickets.'));
    });
  }

  // ── Click delegation: row open / delete ──────────────────────────────────

  function onDeleteTicketClick(e: Event): void {
    const btn = (e.target as Element).closest<HTMLElement>('[data-delete-ticket-id]');
    if (!btn) return;
    e.stopPropagation();
    const ticketId = btn.dataset['deleteTicketId'];
    const t        = _tickets.find(x => String(x.id) === String(ticketId));
    const cpop = (window as unknown as { cpop?: { fire: (o: object) => Promise<{ isConfirmed: boolean }> } }).cpop;
    if (!cpop) return;
    cpop.fire({
      icon: 'warning', title: 'Delete Ticket?',
      text: t ? `Delete ticket #${t.ticketNumber} — "${t.subject}"? This cannot be undone.` : 'Are you sure you want to delete this ticket?',
      showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#e40c0c',
    }).then(result => {
      if (!result.isConfirmed) return;
      const win = window as unknown as { showPopup?: (t: string, h: string, m: string) => void };
      deleteTicket(ticketId!).then(res => {
        if (!res.success) { win.showPopup?.('error', 'Failed', res.message ?? ''); return; }
        void fetchTickets(); showList();
      }).catch(() => win.showPopup?.('error', 'Error', 'Could not delete ticket.'));
    });
  }

  function onTicketRowClick(e: Event): void {
    if ((e.target as Element).closest('[data-delete-ticket-id]')) return;
    const row = (e.target as Element).closest<HTMLElement>('.hdr-ticket-item[data-ticket-id]');
    if (!row) return;
    showDetail(row.dataset['ticketId'] ?? '');
  }

  // Register listeners
  ticketNewBtn?.addEventListener('click',      onNewClick);
  ticketCancelBtn?.addEventListener('click',   onCancelClick);
  detailBackBtn?.addEventListener('click',     onDetailBack);
  submitBtn?.addEventListener('click',         onSubmitClick);
  replyInputEl?.addEventListener('input',      onReplyInput);
  replySendBtnEl?.addEventListener('click',    onReplySendClick);
  statusSelectEl?.addEventListener('change',   onStatusChange);
  statusSaveBtnEl?.addEventListener('click',   onStatusSaveClick);
  ticketRefreshBtn?.addEventListener('click',  onRefreshClick);
  clearClosedEmpBtn?.addEventListener('click', onClearEmpClick);
  clearClosedBtn?.addEventListener('click',    onClearClosedClick);
  document.addEventListener('click', onDeleteTicketClick);
  document.addEventListener('click', onTicketRowClick);

  syncTicketReplyBtn();

  // ── Expose globals ────────────────────────────────────────────────────────

  const win = window as unknown as Record<string, unknown>;
  win['_applyTicketData']      = (res: { success: boolean; data?: TicketItem[] }) => {
    if (!res?.success) return;
    _tickets = res.data ?? [];
    updateTicketBadge();
    showList();
    renderList();
  };
  win['_startTicketSystem']    = start;
  win['_stopTicketSystem']     = stop;
  win['_fetchTickets']         = () => { void fetchTickets(_currentTicketId != null); };
  win['_updateTicketBadgeNow'] = updateTicketBadge;
  win['_getTicketUnreadCount'] = () => {
    const r = getRole();
    return (r === 'admin' || r === 'manager') ? _tickets.filter(t => t.status === 'open').length : 0;
  };
  win['_clearTicketDetail']    = () => { _currentTicketId = null; _composing = false; };
  win['_ticketModalOpened']    = () => {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => { void fetchTickets(); }, 3_000);
  };
  win['_ticketModalClosed']    = () => {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => { void fetchTickets(); }, 10_000);
  };

  // Cleanup function
  return () => {
    stop();
    ticketNewBtn?.removeEventListener('click',      onNewClick);
    ticketCancelBtn?.removeEventListener('click',   onCancelClick);
    detailBackBtn?.removeEventListener('click',     onDetailBack);
    submitBtn?.removeEventListener('click',         onSubmitClick);
    replyInputEl?.removeEventListener('input',      onReplyInput);
    replySendBtnEl?.removeEventListener('click',    onReplySendClick);
    statusSelectEl?.removeEventListener('change',   onStatusChange);
    statusSaveBtnEl?.removeEventListener('click',   onStatusSaveClick);
    ticketRefreshBtn?.removeEventListener('click',  onRefreshClick);
    clearClosedEmpBtn?.removeEventListener('click', onClearEmpClick);
    clearClosedBtn?.removeEventListener('click',    onClearClosedClick);
    document.removeEventListener('click', onDeleteTicketClick);
    document.removeEventListener('click', onTicketRowClick);
  };
}
