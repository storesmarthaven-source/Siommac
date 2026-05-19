/**
 * src/components/nav/MessagesPanel.ts
 *
 * Messages system — ported from the inline IIFE in nav.js (lines 649–1059).
 * Wires the existing #msgList, #msgDetailPane, #msgComposePane DOM.
 * Returns a cleanup function.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import {
  getMessages,
  markMessageRead,
  sendMessage,
  replyMessage,
  deleteMessage,
  getEmployeesForMsg,
} from './api';
import { setHdrBadge, getUser, getRole, getFullName, getProfileImage, esc } from './navCore';
import type { MsgItem, MsgReply } from './types';

function timeAgoShort(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)    return 'Just now';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function fmtTimestamp(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function initials(name: string): string {
  return (name || '?').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function isAdmin(): boolean {
  const r = getRole();
  return r === 'admin' || r === 'manager';
}

function msgLatest(m: MsgItem): string {
  return m.latestAt ?? (m.replies.length ? m.replies[m.replies.length - 1]!.createdAt : m.createdAt);
}

function sortMsgs(msgs: MsgItem[]): void {
  msgs.sort((a, b) => (new Date(msgLatest(b)).getTime() || 0) - (new Date(msgLatest(a)).getTime() || 0));
}

function msgRowKey(m: MsgItem): string {
  return `${String(m.isUnread)}|${m.unreadReplyCount}|${m.replies.length}|${msgLatest(m)}`;
}

function bubbleHtml(
  isMe: boolean,
  senderName: string,
  body: string,
  time: string,
  photoUrl: string,
): string {
  const currentUser     = getUser();
  const currentFullName = getFullName();
  const name     = senderName || (isMe ? currentFullName || currentUser || 'You' : '?');
  const inits    = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const align    = isMe ? 'flex-end' : 'flex-start';
  const bubbleBg    = isMe ? 'var(--siomac-navy,#1b2d54)' : 'var(--bg-subtle,#f0f2f5)';
  const bubbleColor = isMe ? '#fff' : 'var(--text-primary)';
  const avatarBg    = isMe ? 'var(--siomac-navy,#1b2d54)' : '#888';
  const borderColor = isMe ? 'var(--siomac-navy,#1b2d54)' : 'var(--border,#ddd)';
  const avatar = photoUrl
    ? `<img src="${esc(photoUrl)}" alt="${esc(name)}" crossorigin="anonymous" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid ${borderColor};">`
    : `<div style="width:32px;height:32px;border-radius:50%;background:${avatarBg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0;">${esc(inits)}</div>`;
  const borderRadius = isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px';
  const bubble = `<div style="max-width:75%;background:${bubbleBg};color:${bubbleColor};padding:8px 12px;border-radius:${borderRadius};font-size:0.82rem;white-space:pre-wrap;line-height:1.4;">${esc(body)}</div>`;
  const textAlign = isMe ? 'right' : 'left';
  const meta   = `<div style="font-size:0.67rem;color:var(--text-muted);margin-top:3px;text-align:${textAlign};">${esc(isMe ? 'You' : name)} · ${fmtTimestamp(time)}</div>`;
  const flexDir = isMe ? 'row-reverse' : 'row';
  return `<div style="display:flex;flex-direction:column;align-items:${align};margin-bottom:14px;">
    <div style="display:flex;align-items:flex-end;gap:6px;flex-direction:${flexDir};">${avatar}${bubble}</div>
    ${meta}
  </div>`;
}

export function mountMessagesPanel(): () => void {
  let _msgs: MsgItem[]        = [];
  let _msgsLoaded             = false;
  let _empList: Array<{ username: string; fullName: string; role: string }> = [];
  let _currentMsgId: string | number | null = null;
  let _composing              = false;
  let _pollTimer: ReturnType<typeof setInterval> | null = null;
  const _readPending          = new Set<string>();

  // ── View helpers ──────────────────────────────────────────────────────────

  function showList(): void {
    const msgList        = document.getElementById('msgList');
    const detailPane     = document.getElementById('msgDetailPane');
    const composePane    = document.getElementById('msgComposePane');
    const msgModalFoot   = document.getElementById('msgModalFoot');
    if (msgList)      msgList.style.display      = '';
    if (detailPane)   detailPane.style.display   = 'none';
    if (composePane)  composePane.style.display  = 'none';
    if (msgModalFoot) msgModalFoot.style.display = '';
    _currentMsgId = null;
    _composing    = false;
  }

  function showCompose(replyToUsername?: string): void {
    const msgList        = document.getElementById('msgList');
    const detailPane     = document.getElementById('msgDetailPane');
    const composePane    = document.getElementById('msgComposePane');
    const msgModalFoot   = document.getElementById('msgModalFoot');
    const subject        = document.getElementById('msgComposeSubject') as HTMLInputElement | null;
    const body           = document.getElementById('msgComposeBody') as HTMLTextAreaElement | null;
    const toWrap         = document.getElementById('msgToWrap');
    const toSel          = document.getElementById('msgToSelect') as HTMLSelectElement | null;
    if (msgList)      msgList.style.display      = 'none';
    if (detailPane)   detailPane.style.display   = 'none';
    if (composePane)  composePane.style.display  = 'flex';
    if (msgModalFoot) msgModalFoot.style.display = 'none';
    if (subject) subject.value = '';
    if (body)    body.value    = '';
    _composing = true;
    syncSendBtn();
    if (isAdmin()) {
      if (toWrap) toWrap.style.display = '';
      if (toSel) {
        toSel.innerHTML = '<option value="">— Loading… —</option>';
        getEmployeesForMsg().then(res => {
          _empList = res.data ?? [];
          toSel.innerHTML = '<option value="">— Select employee —</option>'
            + _empList.map(e =>
              `<option value="${esc(e.username)}">${esc(e.fullName)} (${esc(e.role)})</option>`
            ).join('');
          if (replyToUsername) toSel.value = replyToUsername;
        }).catch(() => {
          if (toSel) toSel.innerHTML = '<option value="">— Failed to load —</option>';
        });
      }
    } else {
      if (toWrap) toWrap.style.display = 'none';
    }
    subject?.focus();
  }

  // ── Badge ─────────────────────────────────────────────────────────────────

  function updateMsgBadge(): void {
    if (!_msgsLoaded) return;
    const unread = _msgs.filter(m => !m.otherPartyDeleted && (m.isUnread || m.unreadReplyCount > 0)).length;
    ['hdrMsgBadge', 'empMsgBadge', 'mgrMsgBadge'].forEach(id =>
      setHdrBadge(document.getElementById(id), unread)
    );
  }

  // ── List rendering ────────────────────────────────────────────────────────

  function msgRowHtml(m: MsgItem): string {
    const currentUser = getUser();
    const isSentByMe  = m.fromUsername === currentUser;
    const otherName   = isSentByMe ? m.toName  : m.fromName;
    const otherPhoto  = isSentByMe ? m.toPhoto : m.fromPhoto;
    const inits       = initials(otherName);
    const replyCount  = m.replies.length;
    const lastReply   = replyCount ? m.replies[replyCount - 1]! : null;
    const latestTime  = msgLatest(m);
    const previewBody = lastReply ? lastReply.body : m.body;
    const previewBy   = lastReply
      ? (lastReply.fromUsername === currentUser ? 'You' : lastReply.fromName)
      : (isSentByMe ? 'You' : m.fromName);
    const isDeleted   = !!m.otherPartyDeleted;
    const hasUnread   = m.isUnread && !isDeleted;
    const hasNewReply = ((m.unreadReplyCount > 0) || (!isSentByMe && m.isUnread)) && !isDeleted;
    const hasIndicator = hasUnread || hasNewReply;
    const grayscaleStyle = isDeleted ? 'filter:grayscale(1);opacity:.5;' : '';
    const avatarBorderColor = isDeleted ? '#eee' : 'var(--border,#eee)';
    const avatarHtml = otherPhoto
      ? `<img src="${esc(otherPhoto)}" alt="${esc(inits)}" crossorigin="anonymous" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid ${avatarBorderColor};${grayscaleStyle}">`
      : `<div class="hdr-msg-avatar" style="${isDeleted ? 'background:#aaa;color:#fff;' : (isSentByMe ? 'background:var(--siomac-navy,#001f3f);color:#fff' : '')}">${esc(inits)}</div>`;
    const removedBadge = isDeleted
      ? `<span style="font-size:0.65rem;font-weight:600;color:#999;background:#f0f0f0;border:1px solid #ddd;border-radius:4px;padding:1px 6px;white-space:nowrap;flex-shrink:0;">Removed</span>`
      : '';
    const indicator = !hasIndicator ? '' : hasNewReply
      ? `<span style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;align-self:center;background:rgba(228,12,12,0.09);border:1.5px solid rgba(228,12,12,0.22);border-radius:20px;padding:2px 7px 2px 5px;white-space:nowrap;"><span style="width:7px;height:7px;border-radius:50%;background:var(--siomac-red);flex-shrink:0;"></span><span style="font-size:0.65rem;font-weight:700;color:var(--siomac-red);">New reply</span></span>`
      : `<span style="width:9px;height:9px;border-radius:50%;background:var(--siomac-red);flex-shrink:0;align-self:center;box-shadow:0 0 0 2px rgba(228,12,12,0.18);"></span>`;
    const listDeleteBtn = isAdmin()
      ? `<button data-delete-msg-id="${esc(String(m.id))}" title="Delete conversation" style="border:none;background:none;cursor:pointer;color:var(--siomac-red,#e40c0c);font-size:0.75rem;padding:4px 6px;border-radius:6px;opacity:.6;transition:opacity .15s;flex-shrink:0;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity='.6'"><i class="fas fa-trash-alt"></i></button>`
      : '';
    const borderStyle = hasIndicator ? 'border-left:3px solid var(--siomac-red);padding-left:11px;' : 'border-left:3px solid transparent;padding-left:11px;';
    const nameWeight = hasIndicator ? '700' : '600';
    const nameColor  = hasIndicator ? 'var(--text-primary)' : 'var(--text-muted)';
    const nameDecor  = isDeleted ? 'text-decoration:line-through;' : '';
    const subjectWeight = hasIndicator ? '700' : '600';
    const deletedOpacity = isDeleted ? 'opacity:.6;' : '';
    return `<div class="hdr-msg-item${hasIndicator ? ' unread' : ''}" data-msg-id="${esc(String(m.id))}" style="cursor:pointer;display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);${borderStyle}${deletedOpacity}">
      ${avatarHtml}
      <div class="hdr-msg-text" style="flex:1;min-width:0;">
        <div class="hdr-msg-name" style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <span style="font-weight:${nameWeight};color:${nameColor};${nameDecor}">${esc(otherName)}</span>
          <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">${removedBadge}<span class="hdr-msg-time" style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap;">${timeAgoShort(latestTime)}</span></div>
        </div>
        <div style="font-size:0.78rem;font-weight:${subjectWeight};color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.subject)}</div>
        <div class="hdr-msg-preview" style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><span style="font-style:italic;">${esc(previewBy)}:</span> ${esc(previewBody)}</div>
      </div>
      ${indicator}
      ${listDeleteBtn}
    </div>`;
  }

  function renderList(): void {
    const list = document.getElementById('msgList');
    if (!list) return;
    if (!_msgs.length) {
      list.innerHTML = '<div class="hdr-notif-empty"><i class="fas fa-inbox"></i><p>No messages yet</p></div>';
      return;
    }
    sortMsgs(_msgs);
    const empty = list.querySelector('.hdr-notif-empty');
    if (empty) list.innerHTML = '';
    const existingById = new Map<string, Element>();
    list.querySelectorAll<HTMLElement>('.hdr-msg-item[data-msg-id]').forEach(el =>
      existingById.set(el.dataset['msgId'] ?? '', el)
    );
    const frag = document.createDocumentFragment();
    _msgs.forEach(m => {
      const id  = String(m.id);
      const key = msgRowKey(m);
      let el = existingById.get(id);
      if (!el || (el as HTMLElement).dataset['msgKey'] !== key) {
        const tmp = document.createElement('div');
        tmp.innerHTML = msgRowHtml(m);
        el = tmp.firstElementChild ?? undefined;
      }
      if (el) { (el as HTMLElement).dataset['msgKey'] = key; frag.appendChild(el); }
    });
    list.innerHTML = '';
    list.appendChild(frag);
  }

  // ── Detail pane ───────────────────────────────────────────────────────────

  function showDetail(msgId: string | number): void {
    const currentUser = getUser();
    const m = _msgs.find(x => String(x.id) === String(msgId));
    if (!m) return;
    _currentMsgId = msgId;
    const msgList       = document.getElementById('msgList');
    const composePane   = document.getElementById('msgComposePane');
    const msgModalFoot  = document.getElementById('msgModalFoot');
    const detailPane    = document.getElementById('msgDetailPane');
    if (msgList)      msgList.style.display      = 'none';
    if (composePane)  composePane.style.display  = 'none';
    if (msgModalFoot) msgModalFoot.style.display = 'none';
    if (detailPane)   detailPane.style.display   = 'flex';

    const otherName    = m.fromUsername === currentUser ? m.toName : m.fromName;
    const isDeleted    = !!m.otherPartyDeleted;
    const deletedBadge = isDeleted
      ? `<span style="font-size:0.65rem;font-weight:600;color:#999;background:#f0f0f0;border:1px solid #ddd;border-radius:4px;padding:1px 7px;">Employee Removed</span>`
      : '';
    const deleteBtn = isAdmin()
      ? `<button data-delete-msg-id="${esc(String(m.id))}" title="Delete conversation" style="margin-left:auto;border:none;background:none;cursor:pointer;color:var(--siomac-red,#e40c0c);font-size:0.8rem;padding:2px 6px;border-radius:6px;display:flex;align-items:center;gap:4px;opacity:.75;transition:opacity .15s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity='.75'"><i class="fas fa-trash-alt"></i> Delete</button>`
      : '';
    const fromLabel  = m.fromUsername === currentUser ? 'To' : 'From';
    const header = `<div style="padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg-subtle,#f8fafe);">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:2px;display:flex;align-items:center;gap:6px;">${esc(fromLabel)}: <strong>${esc(otherName)}</strong>${deletedBadge}</div>
          <div style="font-size:0.88rem;font-weight:700;color:var(--text-primary);">${esc(m.subject)}</div>
        </div>
        ${deleteBtn}
      </div>
    </div>`;

    const isMeFirst = m.fromUsername === currentUser;
    const thread = `<div data-bubble-id="orig_${esc(String(m.id))}">${bubbleHtml(isMeFirst, m.fromName, m.body, m.createdAt, m.fromPhoto)}</div>`
      + m.replies.map(r =>
        `<div data-bubble-id="reply_${esc(String(r.id))}">${bubbleHtml(r.fromUsername === currentUser, r.fromName, r.body, r.createdAt, r.fromPhoto)}</div>`
      ).join('');

    const bodyEl = document.getElementById('msgDetailBody');
    if (bodyEl) {
      bodyEl.innerHTML = header
        + `<div data-msg-thread style="padding:14px 16px;display:flex;flex-direction:column;">${thread}</div>`;
      bodyEl.scrollTop = bodyEl.scrollHeight;
      requestAnimationFrame(() => { bodyEl.scrollTop = bodyEl.scrollHeight; });
    }

    const replyInput   = document.getElementById('msgReplyInput')   as HTMLTextAreaElement | null;
    const replySendBtn = document.getElementById('msgReplySendBtn') as HTMLButtonElement | null;
    if (replyInput && replySendBtn) {
      replyInput.disabled    = isDeleted;
      replyInput.placeholder = isDeleted ? 'This employee has been removed — replies are disabled.' : 'Write your reply…';
      replyInput.style.background = isDeleted ? 'var(--bg-subtle,#f8fafe)' : '';
      replyInput.style.color      = isDeleted ? 'var(--text-muted)' : '';
      replySendBtn.disabled  = isDeleted;
      replySendBtn.style.opacity  = isDeleted ? '0.4' : '';
    }

    if ((m.isUnread || m.unreadReplyCount > 0) && !isDeleted) {
      m.isUnread = false; m.unreadReplyCount = 0;
      _readPending.add(String(msgId));
      renderList(); updateMsgBadge();
      markMessageRead(m.id).catch(() => {});
    }
  }

  function updateDetail(msgId: string | number): void {
    const currentUser = getUser();
    const m = _msgs.find(x => String(x.id) === String(msgId));
    if (!m) return;
    const bodyEl = document.getElementById('msgDetailBody');
    if (!bodyEl) return;
    const threadEl = bodyEl.querySelector('[data-msg-thread]');
    if (!threadEl) { showDetail(msgId); return; }

    type BubbleMsg = { id: string; fromUsername: string; fromName: string; body: string; createdAt: string; fromPhoto: string };
    const allMessages: BubbleMsg[] = [
      { id: 'orig_' + String(m.id), fromUsername: m.fromUsername, fromName: m.fromName, body: m.body, createdAt: m.createdAt, fromPhoto: m.fromPhoto },
      ...m.replies.map(r => ({ id: 'reply_' + String(r.id), fromUsername: r.fromUsername, fromName: r.fromName, body: r.body, createdAt: r.createdAt, fromPhoto: r.fromPhoto })),
    ];

    // Remove optimistic temp replies once real ones arrive
    const realReplyIds = new Set(allMessages.filter(x => x.id.startsWith('reply_') && !x.id.includes('tmp_')).map(x => x.id));
    if (realReplyIds.size > 0) {
      threadEl.querySelectorAll('[data-bubble-id^="reply_tmp_"]').forEach(el => el.remove());
    }

    const existingIds = new Set([...threadEl.querySelectorAll<HTMLElement>('[data-bubble-id]')].map(el => el.dataset['bubbleId'] ?? ''));
    let appended = false;
    let newFromOther = false;
    allMessages.forEach(msg => {
      if (existingIds.has(msg.id)) return;
      const isMe = msg.fromUsername === currentUser;
      if (!isMe) newFromOther = true;
      const tmp = document.createElement('div');
      tmp.innerHTML = `<div data-bubble-id="${esc(msg.id)}">${bubbleHtml(isMe, msg.fromName, msg.body, msg.createdAt, msg.fromPhoto)}</div>`;
      const child = tmp.firstElementChild;
      if (child) threadEl.appendChild(child);
      appended = true;
    });

    if (appended) {
      bodyEl.scrollTop = bodyEl.scrollHeight;
      if (newFromOther) {
        ['hdrMsgBtn', 'empMsgBtn', 'mgrMsgBtn'].forEach(id => {
          const msgBtn = document.getElementById(id);
          if (msgBtn) {
            msgBtn.classList.remove('msg-new-reply-pulse');
            void msgBtn.offsetWidth;
            msgBtn.classList.add('msg-new-reply-pulse');
            setTimeout(() => msgBtn.classList.remove('msg-new-reply-pulse'), 1400);
          }
        });
        const existing = document.getElementById('msgNewReplyToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id        = 'msgNewReplyToast';
        toast.innerHTML = '<i class="fas fa-comment-dots"></i> New reply received';
        const parent = bodyEl.parentElement;
        if (parent) parent.insertBefore(toast, bodyEl);
        setTimeout(() => {
          toast.classList.add('msg-reply-toast-hide');
          setTimeout(() => toast.remove(), 400);
        }, 3000);
        m.isUnread = false; m.unreadReplyCount = 0;
        _readPending.add(String(msgId));
        updateMsgBadge();
        markMessageRead(m.id).catch(() => {});
      }
    }
  }

  // ── Button sync helpers ───────────────────────────────────────────────────

  function syncSendBtn(): void {
    const btn     = document.getElementById('msgSendBtn') as HTMLButtonElement | null;
    if (!btn) return;
    const subject = ((document.getElementById('msgComposeSubject') as HTMLInputElement | null)?.value ?? '').trim();
    const body    = ((document.getElementById('msgComposeBody')    as HTMLTextAreaElement | null)?.value ?? '').trim();
    const empty   = !subject || !body;
    btn.disabled     = empty;
    btn.style.opacity = empty ? '0.4' : '';
  }

  function syncReplyBtn(): void {
    const btn   = document.getElementById('msgReplySendBtn') as HTMLButtonElement | null;
    if (!btn) return;
    const empty = !((document.getElementById('msgReplyInput') as HTMLTextAreaElement | null)?.value ?? '').trim();
    btn.disabled     = empty;
    btn.style.opacity = empty ? '0.4' : '';
  }

  // ── Fetch / poll ──────────────────────────────────────────────────────────

  async function fetchMsgs(): Promise<void> {
    try {
      const res = await getMessages();
      if (!res.success) return;
      const currentUser = getUser();
      const raw = res.data ?? [];
      _msgs = raw;
      // Apply pending-read cache
      _readPending.forEach(id => {
        const m = _msgs.find(x => String(x.id) === id);
        if (m) {
          if (!m.isUnread && m.unreadReplyCount === 0) { _readPending.delete(id); }
          else { m.isUnread = false; m.unreadReplyCount = 0; }
        } else { _readPending.delete(id); }
      });
      sortMsgs(_msgs);
      _msgsLoaded = true;
      if (res.unreadCount != null) {
        ['hdrMsgBadge', 'empMsgBadge', 'mgrMsgBadge'].forEach(id =>
          setHdrBadge(document.getElementById(id), res.unreadCount ?? 0)
        );
      } else {
        updateMsgBadge();
      }
      if (_currentMsgId) { updateDetail(_currentMsgId); }
      else if (!_composing) { renderList(); }
    } catch (_) {}
  }

  // ── Start / stop ──────────────────────────────────────────────────────────

  function start(): void {
    const adminView = isAdmin();
    const titleEl   = document.getElementById('msgModalTitle');
    const composeLabel = document.getElementById('msgComposeBtnLabel');
    const markAllBtn   = document.getElementById('msgMarkAllReadBtn');
    if (titleEl)     titleEl.textContent      = adminView ? 'Messages' : 'My Messages';
    if (composeLabel) composeLabel.textContent = 'New Message';
    if (markAllBtn)  markAllBtn.style.display  = adminView ? '' : 'none';
    if (adminView) {
      getEmployeesForMsg().then(res => { _empList = res.data ?? []; }).catch(() => {});
    }
    void fetchMsgs();
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => { void fetchMsgs(); }, 5_000);
  }

  function stop(): void {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    _msgs       = [];
    _msgsLoaded = false;
    _currentMsgId = null;
    _composing  = false;
    _readPending.clear();
  }

  // ── Wire DOM buttons ──────────────────────────────────────────────────────

  const composeBtn         = document.getElementById('msgComposeBtn');
  const cancelComposeBtn   = document.getElementById('msgCancelComposeBtn');
  const detailBackBtn      = document.getElementById('msgDetailBackBtn');
  const composeSubjectEl   = document.getElementById('msgComposeSubject');
  const composeBodyEl      = document.getElementById('msgComposeBody');
  const replyInputEl       = document.getElementById('msgReplyInput');
  const sendBtnEl          = document.getElementById('msgSendBtn') as HTMLButtonElement | null;
  const markAllReadBtn     = document.getElementById('msgMarkAllReadBtn');
  const refreshBtn         = document.getElementById('msgRefreshBtn');
  const replySendBtnEl     = document.getElementById('msgReplySendBtn') as HTMLButtonElement | null;

  function onComposeClick()      { showCompose(); }
  function onCancelCompose()     { showList(); }
  function onDetailBack()        { showList(); renderList(); }
  function onSubjectInput()      { syncSendBtn(); }
  function onBodyInput()         { syncSendBtn(); }
  function onReplyInput()        { syncReplyBtn(); }
  function onMarkAllReadClick()  {
    _msgs.filter(m => m.isUnread || m.unreadReplyCount > 0).forEach(m => {
      markMessageRead(m.id).catch(() => {});
      m.isUnread = false; m.unreadReplyCount = 0; _readPending.add(String(m.id));
    });
    renderList(); updateMsgBadge();
  }
  function onRefreshClick()  {
    (window as unknown as { _spinBtn?: (id: string) => void })._spinBtn?.('msgRefreshBtn');
    void fetchMsgs();
  }

  function onSendClick(): void {
    const currentUser     = getUser();
    const currentFullName = getFullName();
    const subject    = ((document.getElementById('msgComposeSubject') as HTMLInputElement | null)?.value ?? '').trim();
    const body       = ((document.getElementById('msgComposeBody') as HTMLTextAreaElement | null)?.value ?? '').trim();
    const toUsername = isAdmin() ? ((document.getElementById('msgToSelect') as HTMLSelectElement | null)?.value ?? '') : '';
    const win = window as unknown as { showPopup?: (t: string, h: string, m: string) => void };
    if (isAdmin() && !toUsername) { win.showPopup?.('error', 'Missing', 'Please select a recipient.'); return; }
    if (!subject) { (document.getElementById('msgComposeSubject') as HTMLInputElement | null)?.focus(); return; }
    if (!body)    { (document.getElementById('msgComposeBody')    as HTMLTextAreaElement | null)?.focus(); return; }
    if (sendBtnEl) sendBtnEl.disabled = true;
    const sentAt = new Date().toISOString();
    sendMessage({ subject, body, toUsername }).then(res => {
      if (sendBtnEl) sendBtnEl.disabled = false;
      if (!res.success) { win.showPopup?.('error', 'Failed', res.message ?? ''); return; }
      _msgs.unshift({
        id: (res.id ?? ('tmp_' + Date.now())),
        fromUsername: currentUser,
        fromName:     currentFullName || currentUser,
        fromPhoto:    getProfileImage() || '',
        toUsername:   toUsername || 'admin',
        toName:       toUsername || 'Admin',
        toPhoto:      '',
        subject, body,
        isUnread:         false,
        readByRecipient:  false,
        createdAt:        sentAt,
        latestAt:         sentAt,
        unreadReplyCount: 0,
        replies:          [],
      });
      showList(); renderList(); void fetchMsgs();
      win.showPopup?.('success', 'Sent!', 'Your message has been sent.');
    }).catch(() => {
      if (sendBtnEl) sendBtnEl.disabled = false;
      (window as unknown as { showPopup?: (t: string, h: string, m: string) => void }).showPopup?.('error', 'Failed', 'Could not send message. Please try again.');
    });
  }

  function onReplySendClick(): void {
    const currentUser     = getUser();
    const currentFullName = getFullName();
    const replyEl = document.getElementById('msgReplyInput') as HTMLTextAreaElement | null;
    const body = (replyEl?.value ?? '').trim();
    if (!body) return;
    const btn = replySendBtnEl;
    if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }
    if (replyEl) replyEl.value = '';
    const replyAt = new Date().toISOString();
    const m = _msgs.find(x => String(x.id) === String(_currentMsgId));
    const tmpReply: MsgReply = {
      id:           'tmp_' + Date.now(),
      fromUsername: currentUser,
      fromName:     currentFullName || currentUser,
      fromPhoto:    getProfileImage() || '',
      body,
      createdAt:    replyAt,
    };
    if (m) m.replies.push(tmpReply);
    if (_currentMsgId != null) updateDetail(_currentMsgId);
    replyMessage({ messageId: _currentMsgId!, body }).then(res => {
      syncReplyBtn();
      const win = window as unknown as { showPopup?: (t: string, h: string, m: string) => void };
      if (!res.success) { win.showPopup?.('error', 'Failed', res.message ?? ''); return; }
      void fetchMsgs();
    }).catch(() => { syncReplyBtn(); });
  }

  // ── Click delegation: row click (open detail) ─────────────────────────────

  function onRowClick(e: Event): void {
    if ((e.target as Element).closest('[data-delete-msg-id]')) return;
    const row = (e.target as Element).closest<HTMLElement>('.hdr-msg-item[data-msg-id]');
    if (!row) return;
    showDetail(row.dataset['msgId'] ?? '');
  }

  // ── Click delegation: delete button ──────────────────────────────────────

  function onDeleteClick(e: Event): void {
    const btn = (e.target as Element).closest<HTMLElement>('[data-delete-msg-id]');
    if (!btn) return;
    const msgId = btn.dataset['deleteMsgId'];
    if (!msgId) return;
    const m     = _msgs.find(x => String(x.id) === String(msgId));
    const label = m ? `"${m.subject}"` : 'this conversation';
    const cpop  = (window as unknown as { cpop?: { fire: (opts: object) => Promise<{ isConfirmed: boolean }> } }).cpop;
    if (!cpop) return;
    cpop.fire({
      icon: 'warning', title: `Delete ${label}?`,
      text: 'This will permanently delete the entire conversation and all replies. This cannot be undone.',
      showCancelButton: true, confirmButtonText: 'Delete', cancelButtonText: 'Cancel',
    }).then(result => {
      if (!result.isConfirmed) return;
      (btn as HTMLButtonElement).disabled = true;
      deleteMessage(msgId).then(res => {
        (btn as HTMLButtonElement).disabled = false;
        const win = window as unknown as { showPopup?: (t: string, h: string, m: string) => void };
        if (!res.success) { win.showPopup?.('error', 'Failed', res.message ?? 'Could not delete conversation.'); return; }
        _msgs = _msgs.filter(x => String(x.id) !== String(msgId));
        showList(); renderList(); updateMsgBadge();
        win.showPopup?.('success', 'Deleted', 'Conversation deleted.');
      }).catch(() => { (btn as HTMLButtonElement).disabled = false; });
    });
  }

  composeBtn?.addEventListener('click',       onComposeClick);
  cancelComposeBtn?.addEventListener('click', onCancelCompose);
  detailBackBtn?.addEventListener('click',    onDetailBack);
  composeSubjectEl?.addEventListener('input', onSubjectInput);
  composeBodyEl?.addEventListener('input',    onBodyInput);
  replyInputEl?.addEventListener('input',     onReplyInput);
  sendBtnEl?.addEventListener('click',        onSendClick);
  markAllReadBtn?.addEventListener('click',   onMarkAllReadClick);
  refreshBtn?.addEventListener('click',       onRefreshClick);
  replySendBtnEl?.addEventListener('click',   onReplySendClick);
  document.addEventListener('click', onRowClick);
  document.addEventListener('click', onDeleteClick);

  syncSendBtn();
  syncReplyBtn();

  // ── Expose globals ────────────────────────────────────────────────────────

  const win = window as unknown as Record<string, unknown>;
  win['_startMsgSystem']    = start;
  win['_stopMsgSystem']     = stop;
  win['_fetchMsgs']         = () => { void fetchMsgs(); };
  win['_updateMsgBadgeNow'] = updateMsgBadge;
  win['_getMsgUnreadCount'] = () => _msgs.filter(m => !m.otherPartyDeleted && (m.isUnread || m.unreadReplyCount > 0)).length;
  win['_clearMsgDetail']    = () => { _currentMsgId = null; _composing = false; };
  win['_msgModalOpened']    = () => {
    _currentMsgId = null; _composing = false;
    void fetchMsgs();
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => { void fetchMsgs(); }, 3_000);
  };
  win['_msgModalClosed']    = () => {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(() => { void fetchMsgs(); }, 5_000);
  };

  // Cleanup function
  return () => {
    stop();
    composeBtn?.removeEventListener('click',       onComposeClick);
    cancelComposeBtn?.removeEventListener('click', onCancelCompose);
    detailBackBtn?.removeEventListener('click',    onDetailBack);
    composeSubjectEl?.removeEventListener('input', onSubjectInput);
    composeBodyEl?.removeEventListener('input',    onBodyInput);
    replyInputEl?.removeEventListener('input',     onReplyInput);
    sendBtnEl?.removeEventListener('click',        onSendClick);
    markAllReadBtn?.removeEventListener('click',   onMarkAllReadClick);
    refreshBtn?.removeEventListener('click',       onRefreshClick);
    replySendBtnEl?.removeEventListener('click',   onReplySendClick);
    document.removeEventListener('click', onRowClick);
    document.removeEventListener('click', onDeleteClick);
  };
}
