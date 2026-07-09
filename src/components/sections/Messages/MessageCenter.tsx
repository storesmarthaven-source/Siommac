/**
 * src/components/sections/Messages/MessageCenter.tsx
 *
 * Full-page s-messages section. PageHeader + TabBar (Inbox/Sent/Archived) +
 * New Message button on the right of the tab row + two-pane body:
 *   left → ThreadList, right → Conversation (or empty state).
 *
 * Listens for siomac:openThread CustomEvent so the dropdown can pre-select a
 * thread on navigation.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { PageHeader, type AreaTab } from '@ui';
import {
  useMessageThreadsFull, useThreadPosts, useMarkThreadRead,
  usePostMessage, useArchiveThread, useCommsSummary,
  useThread, useAddThreadParticipants, useRemoveThreadParticipant, useMessageRecipients, useMuteThread,
  useMessageAttachmentUploadUrl, useCreateMessageAttachment,
  usePinMessage, useUnpinMessage, usePins, useOnlineUsers, usePinnedSummary,
  ThreadAccessError,
  type MessageThreadListItem, type MessageParticipantProfile, type ThreadFilters,
  type MessageAttachment, type MessagePostRow,
} from '@api/communications';
import { useSessionStore } from '@store/session';
import { useCan } from '@lib/permissions';
import { ComposeThreadDialog } from './ComposeThreadDialog';
import { AccessThreadDialog } from './AccessThreadDialog';
import { ComplianceBrowser } from './ComplianceBrowser';
import { threadTitle, threadAvatarParticipant, otherParticipants } from './threadDisplay';

const TABS: AreaTab[] = [
  { key: 'inbox',    label: 'Inbox',    icon: 'fa-inbox' },
  { key: 'sent',     label: 'Sent',     icon: 'fa-paper-plane' },
  { key: 'archived', label: 'Archived', icon: 'fa-box-archive' },
];

// ── Shared helpers ────────────────────────────────────────────────────────────

function fmtBytes(n: number | null | undefined): string {
  if (n == null || n <= 0) return '';
  if (n < 1024)            return `${n} B`;
  if (n < 1024 * 1024)     return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(ct: string | null | undefined): string {
  if (!ct) return 'fa-file';
  if (ct.startsWith('image/'))              return 'fa-file-image';
  if (ct === 'application/pdf')             return 'fa-file-pdf';
  if (ct.includes('word'))                  return 'fa-file-word';
  if (ct.includes('excel') || ct.includes('spreadsheet') || ct === 'text/csv') return 'fa-file-excel';
  if (ct.startsWith('text/'))               return 'fa-file-lines';
  return 'fa-file';
}

function moduleLabel(m: string | null | undefined): string {
  return m ? m.replace(/^hse[._-]?/i, '').replace(/[_-]/g, ' ').toUpperCase() : '';
}

type BubbleTone = 'admin' | 'outgoing' | 'incoming';
function messageTone(post: MessagePostRow, myId: string | null): BubbleTone {
  const r = (post.authorRoleKey ?? '').toLowerCase();
  if (['superadmin', 'super_admin', 'system_admin', 'admin'].includes(r)) return 'admin';
  if (post.authorUserId && post.authorUserId === myId)                     return 'outgoing';
  return 'incoming';
}
/** Centered timeline label for a system-event post (from its payload). */
function systemEventLabel(post: MessagePostRow): string {
  const p = (post.systemEventPayload ?? {}) as Record<string, unknown>;
  const s = (k: string) => String(p[k] ?? '');
  switch (post.systemEventType) {
    case 'participant_added':   return `${s('addedUserName')} was added to the conversation by ${s('actorName')}`;
    case 'participant_removed': return `${s('removedUserName')} was removed by ${s('actorName')}`;
    case 'participant_left':    return `${s('userName')} left the conversation`;
    case 'thread_archived':     return 'Conversation archived';
    case 'thread_reopened':     return 'Conversation reopened';
    default:                    return post.body || 'Conversation updated';
  }
}

/** Small pill used for thread-row tags (module / group / action-required / files). */
function TagChip({ label, tone = 'info' }: { label: string; tone?: 'info' | 'priority' | 'danger' }): VNode {
  const c = tone === 'priority' ? { bg: '#fff7ed', fg: '#b45309' }
          : tone === 'danger'   ? { bg: '#fff1f2', fg: '#be123c' }
          :                       { bg: 'var(--bg-subtle, #f1f4f9)', fg: 'var(--text-muted, #68799a)' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: '18px', padding: '0 7px',
      borderRadius: '999px', background: c.bg, color: c.fg, fontSize: '0.62rem', fontWeight: 'var(--font-weight-bold)' }}>{label}</span>
  );
}

// ── Rich attachment rendering (image grid + document cards) ─────────────────────

function attTypeOf(a: MessageAttachment): string {
  const ct  = (a.contentType ?? '').toLowerCase();
  const ext = a.fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ct.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (ext === 'pdf' || ct === 'application/pdf')        return 'pdf';
  if (['doc', 'docx'].includes(ext))                    return 'word';
  if (['xls', 'xlsx', 'csv'].includes(ext))             return 'excel';
  if (['ppt', 'pptx'].includes(ext))                    return 'powerpoint';
  if (['txt', 'md', 'rtf'].includes(ext))               return 'text';
  if (['zip', 'rar', '7z', 'gz'].includes(ext))         return 'archive';
  return 'document';
}
function attIcon(t: string): { label: string; color: string } {
  switch (t) {
    case 'pdf':        return { label: 'PDF', color: '#ef4444' };
    case 'word':       return { label: 'DOC', color: '#2563eb' };
    case 'excel':      return { label: 'XLS', color: '#16a34a' };
    case 'powerpoint': return { label: 'PPT', color: '#ea580c' };
    case 'text':       return { label: 'TXT', color: '#64748b' };
    case 'archive':    return { label: 'ZIP', color: '#7c3aed' };
    default:           return { label: 'FILE', color: '#132957' };
  }
}

/** Inline image grid (up to 4 + overflow) and document cards for a post. */
function MessageAttachments({ attachments }: { attachments: MessageAttachment[] }): VNode | null {
  if (!attachments.length) return null;
  const images = attachments.filter(a => attTypeOf(a) === 'image');
  const docs   = attachments.filter(a => attTypeOf(a) !== 'image');
  const shown  = images.slice(0, 4);
  const more   = images.length - shown.length;
  return (
    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {images.length > 0 && (
        <div style={{ display: 'grid', gap: '4px', maxWidth: '320px',
          gridTemplateColumns: images.length === 1 ? '1fr' : 'repeat(2, 1fr)' }}>
          {shown.map((im, i) => (
            <a key={im.id} href={im.url ?? undefined} target="_blank" rel="noopener noreferrer"
              style={{ position: 'relative', display: 'block', borderRadius: '10px', overflow: 'hidden', background: '#eef3fa', minHeight: '90px' }}>
              {im.url
                ? <img src={im.url} alt={im.fileName} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', maxHeight: '170px' }} />
                : <span style={{ display: 'grid', placeItems: 'center', height: '90px', color: 'var(--text-muted)' }}>IMG</span>}
              {i === 3 && more > 0 && (
                <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(19,41,87,.6)', color: '#fff', fontSize: '1.2rem', fontWeight: 600 }}>+{more}</span>
              )}
            </a>
          ))}
        </div>
      )}
      {docs.map(d => {
        const t  = attTypeOf(d);
        const ic = attIcon(t);
        return (
          <a key={d.id} href={d.url ?? undefined} download={d.fileName} target="_blank" rel="noopener noreferrer"
            style={{ display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: '10px', alignItems: 'center', maxWidth: '320px',
              padding: '8px', border: '1px solid var(--border)', borderRadius: '10px', background: '#fff', textDecoration: 'none' }}>
            <span style={{ width: '36px', height: '36px', borderRadius: '8px', background: ic.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: '0.58rem', fontWeight: 600 }}>{ic.label}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: '0.76rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.fileName}</span>
              <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-muted)' }}>{t.toUpperCase()}{d.sizeBytes ? ` · ${fmtBytes(d.sizeBytes)}` : ''}</span>
            </span>
            <i class="fas fa-download" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }} />
          </a>
        );
      })}
    </div>
  );
}

// ── Thread list (left pane) ────────────────────────────────────────────────────

function ThreadList({ threads, selectedId, onSelect, isLoading }: {
  threads:    MessageThreadListItem[];
  selectedId: string | null;
  onSelect:   (t: MessageThreadListItem) => void;
  isLoading:  boolean;
}): VNode {
  const myId = useSessionStore(s => s.userId);
  const { data: online = [] } = useOnlineUsers();
  const { data: pinned = [] } = usePinnedSummary();
  const [search, setSearch] = useState('');
  const [chips, setChips] = useState({ unread: false, groups: false, records: false });
  const toggle = (k: 'unread' | 'groups' | 'records') => setChips(c => ({ ...c, [k]: !c[k] }));

  const filtered = threads.filter(t => {
    if (chips.unread  && !(t.unreadCount > 0))     return false;
    if (chips.groups  && !(t.participantCount > 2)) return false;
    if (chips.records && !t.sourceModule)          return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const hit = (t.subject ?? '').toLowerCase().includes(q)
        || t.participants.some(p => (p.displayName ?? '').toLowerCase().includes(q))
        || (t.lastPostPreview ?? '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });

  const displayName = (t: MessageThreadListItem): string => threadTitle(t, myId);

  function relTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = Date.now() - new Date(iso).getTime();
    const m = Math.round(d / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24)}d`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Search */}
      <div class="vt-search" style={{ margin: '12px 12px 8px', flexShrink: 0 }}>
        <i class="fas fa-search" />
        <input type="search" placeholder="Search conversations…" value={search}
          onInput={e => setSearch((e.target as HTMLInputElement).value)} />
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: '6px', padding: '0 12px 10px', flexShrink: 0, flexWrap: 'wrap' }}>
        {([['unread', 'Unread'], ['groups', 'Groups'], ['records', 'Records']] as const).map(([k, label]) => {
          const on = chips[k];
          return (
            <button key={k} onClick={() => toggle(k)}
              style={{ height: '28px', padding: '0 12px', borderRadius: '999px', cursor: 'pointer',
                fontSize: '0.72rem', fontWeight: 600, fontFamily: 'inherit',
                border: `1px solid ${on ? 'var(--siomac-navy)' : 'var(--border)'}`,
                background: on ? 'var(--siomac-navy)' : '#fff',
                color: on ? '#fff' : 'var(--text-muted)' }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* Online now */}
      {online.length > 0 && (
        <div style={{ padding: '0 12px 10px', flexShrink: 0 }}>
          <div style={{ fontSize: '0.64rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '7px' }}>Online now</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {online.slice(0, 7).map(u => (
              <div key={u.userId} title={u.displayName ?? ''} style={{ position: 'relative', width: '32px', height: '32px', borderRadius: '50%', overflow: 'hidden',
                background: 'rgba(27,45,85,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {u.profileImage
                  ? <img src={u.profileImage} alt={u.displayName ?? ''} loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: '0.6rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>{u.initials}</span>}
                <span style={{ position: 'absolute', right: '-1px', bottom: 0, width: '9px', height: '9px', borderRadius: '50%', border: '2px solid #fff', background: u.status === 'away' ? '#f59e0b' : '#38c878' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pinned conversations */}
      {pinned.length > 0 && (
        <div style={{ padding: '0 12px 8px', flexShrink: 0, borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
          <div style={{ fontSize: '0.64rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '7px' }}>
            <i class="fas fa-thumbtack" style={{ fontSize: '0.58rem' }} /> Pinned
          </div>
          {pinned.slice(0, 3).map(p => {
            const t = threads.find(x => x.id === p.threadId);
            const label = p.subject ?? (t ? threadTitle(t, myId) : 'Conversation');
            return (
              <div key={p.threadId} onClick={() => t && onSelect(t)} style={{ display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 8px', borderRadius: '8px', cursor: 'pointer', background: 'var(--bg-surface)', marginBottom: '4px' }}>
                <span style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--bg-subtle, #eef1f6)', color: 'var(--siomac-navy)', display: 'grid', placeItems: 'center', fontSize: '0.6rem', fontWeight: 'var(--font-weight-bold)', flexShrink: 0 }}>{(label[0] ?? '?').toUpperCase()}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: '0.74rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                  <span style={{ display: 'block', fontSize: '0.66rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.note ?? t?.lastPostPreview ?? ''}</span>
                </span>
                {t && t.unreadCount > 0 && <span style={{ minWidth: '16px', height: '16px', borderRadius: '8px', background: 'var(--danger, #dc2626)', color: '#fff', fontSize: '0.56rem', fontWeight: 'var(--font-weight-bold)', display: 'grid', placeItems: 'center', padding: '0 4px' }}>{t.unreadCount}</span>}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Loading…</div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <i class="fas fa-comments" style={{ fontSize: '1.6rem', color: 'var(--text-muted)', opacity: 0.4 }} />
            <div style={{ fontWeight: 600, color: 'var(--siomac-navy)', marginTop: '10px', fontSize: '0.85rem' }}>No threads</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '3px' }}>
              {search ? 'No results for this search.' : 'Start a conversation.'}
            </div>
          </div>
        )}
        {filtered.map(t => {
          const isSelected = t.id === selectedId;
          const isUnread   = t.unreadCount > 0;
          const name       = displayName(t);
          const firstP     = threadAvatarParticipant(t.participants, myId);
          const ava        = firstP?.displayName ?? firstP?.username ?? '?';
          const iniText    = ((ava[0] ?? '').toUpperCase());
          const failed     = (t.failedSendCount ?? 0) > 0;
          const preview    = t.hasDraft ? `Draft: ${t.draftPreview ?? ''}` : failed ? 'Message failed to send' : (t.lastPostPreview ?? '');
          const previewColor = t.hasDraft ? '#b45309' : failed ? 'var(--danger)' : 'var(--text-muted)';
          const hasTags    = t.actionRequired || t.sourceModule || t.threadType === 'group' || t.hasAttachments || failed;
          return (
            <div key={t.id} onClick={() => onSelect(t)}
              style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                background: isSelected ? 'var(--bg-subtle, #f4f6fa)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                  background: 'rgba(27,45,85,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {firstP?.profileImage
                    ? <img src={firstP.profileImage} alt={ava} loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: '0.75rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>{iniText}</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.83rem', fontWeight: isUnread ? 700 : 500,
                      color: 'var(--siomac-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                      {t.isPinned && <i class="fas fa-thumbtack" title="Pinned" style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginLeft: '6px' }} />}
                      {t.isMuted && <i class="fas fa-bell-slash" title="Muted" style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginLeft: '6px' }} />}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {relTime(t.lastPostAt ?? t.createdAt)}
                    </span>
                    {isUnread ? (
                      <span style={{ flexShrink: 0, minWidth: '18px', height: '18px', borderRadius: '9px',
                        background: 'var(--danger, #dc2626)', color: '#fff', fontSize: '0.6rem', fontWeight: 'var(--font-weight-bold)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                        {t.unreadCount > 9 ? '9+' : t.unreadCount}
                      </span>
                    ) : failed ? (
                      <span style={{ flexShrink: 0, fontSize: '0.62rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--danger)' }}>Failed</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: '0.71rem', color: previewColor, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px', fontWeight: t.hasDraft ? 700 : 400 }}>
                    {preview}
                  </div>
                  {hasTags && (
                    <div style={{ display: 'flex', gap: '5px', marginTop: '5px', flexWrap: 'wrap' }}>
                      {t.actionRequired && <TagChip label="Action Required" tone="priority" />}
                      {failed && <TagChip label="Retry" tone="danger" />}
                      {t.sourceModule && <TagChip label={moduleLabel(t.sourceModule)} />}
                      {t.threadType === 'group' && <TagChip label="Group" />}
                      {t.hasAttachments && <TagChip label="📎 Files" />}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Pending attachment (pre-upload state) ─────────────────────────────────────

interface PendingAttachment {
  localId:  string;   // uuid-ish local key
  file:     File;
  state:    'uploading' | 'done' | 'error';
  attachId: string | null;  // server-assigned id once done
  error:    string | null;
}

// ── Conversation (right pane) ─────────────────────────────────────────────────

function Conversation({ thread, detailsOpen, onToggleDetails }: {
  thread: MessageThreadListItem;
  detailsOpen?: boolean;
  onToggleDetails?: () => void;
}): VNode {
  const [body, setBody]               = useState('');
  const [pending, setPending]         = useState<PendingAttachment[]>([]);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  const myId = useSessionStore(s => s.userId);
  const { data: posts = [], isLoading, error, refetch } = useThreadPosts(thread.id);
  const [accessOpen, setAccessOpen] = useState(false);
  const accessErr   = error instanceof ThreadAccessError ? error : null;
  const postMsg     = usePostMessage();
  const archive     = useArchiveThread();
  const markRead    = useMarkThreadRead();
  const getUploadUrl = useMessageAttachmentUploadUrl();
  const createAttach = useCreateMessageAttachment();
  const pinMsg       = usePinMessage();
  const unpinMsg     = useUnpinMessage();
  const { data: pins = [] } = usePins(thread.id);
  const [replyTo, setReplyTo] = useState<MessagePostRow | null>(null);

  const isOwner   = thread.myRole === 'owner';
  const pinByPost = new Map(pins.filter(p => p.pinType === 'post' && p.postId).map(p => [p.postId as string, p]));

  // Mark read when thread opens
  useEffect(() => {
    if (thread.unreadCount > 0) markRead.mutate(thread.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);

  // Upload pipeline: get presigned URL → PUT file → create DB row
  async function uploadFile(file: File): Promise<string | null> {
    try {
      const urlRes = await getUploadUrl.mutateAsync({ fileName: file.name, mimeType: file.type || 'application/octet-stream' });
      // PUT raw binary to Supabase Storage
      const put = await fetch(urlRes.uploadUrl, {
        method:  'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body:    file,
      });
      if (!put.ok) throw new Error(`Storage PUT failed: ${put.status}`);
      // Persist DB row
      const id = await createAttach.mutateAsync({
        fileName:    file.name,
        filePath:    urlRes.path,
        contentType: file.type || null,
        sizeBytes:   file.size,
      });
      return id ?? null;
    } catch (err) {
      console.error('[MessageCenter] upload failed', err);
      return null;
    }
  }

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;

    for (const file of files) {
      const localId: string = `${Date.now()}-${Math.random()}`;
      const entry: PendingAttachment = { localId, file, state: 'uploading', attachId: null, error: null };
      setPending(prev => [...prev, entry]);

      void uploadFile(file).then(id => {
        setPending(prev => prev.map(p =>
          p.localId === localId
            ? (id ? { ...p, state: 'done' as const, attachId: id } : { ...p, state: 'error' as const, error: 'Upload failed' })
            : p,
        ));
      });
    }
  }

  function removePending(localId: string) {
    setPending(prev => prev.filter(p => p.localId !== localId));
  }

  const canSend = (body.trim().length > 0 || pending.some(p => p.state === 'done'))
    && !postMsg.isPending
    && !pending.some(p => p.state === 'uploading');

  function handleSend() {
    if (!canSend) return;
    const attachmentIds = pending.filter(p => p.state === 'done' && p.attachId).map(p => p.attachId as string);
    postMsg.mutate({ threadId: thread.id, body: body.trim() || '​', attachmentIds: attachmentIds.length ? attachmentIds : undefined, replyToPostId: replyTo?.id ?? null }, {
      onSuccess: () => {
        setBody('');
        setPending([]);
        setReplyTo(null);
      },
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const displayName = threadTitle(thread, myId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Conversation header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '1px' }}>
            {thread.participantCount} participants
            {thread.sourceModule ? ` · ${thread.sourceModule}` : ''}
          </div>
        </div>
        <button
          onClick={() => archive.mutate({ threadId: thread.id, archived: !thread.isArchived })}
          disabled={archive.isPending}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '7px',
            cursor: 'pointer', color: 'var(--text-muted)', padding: '5px 10px', fontSize: '0.76rem' }}
          title={thread.isArchived ? 'Unarchive' : 'Archive'}>
          <i class={`fas ${thread.isArchived ? 'fa-inbox' : 'fa-box-archive'}`} />
        </button>
        {onToggleDetails && (
          <button onClick={onToggleDetails}
            style={{ background: detailsOpen ? 'rgba(27,45,85,0.07)' : 'none', border: '1px solid var(--border)', borderRadius: '7px',
              cursor: 'pointer', color: detailsOpen ? 'var(--siomac-navy)' : 'var(--text-muted)', padding: '5px 10px', fontSize: '0.76rem' }}
            title="Details">
            <i class="fas fa-circle-info" />
          </button>
        )}
      </div>

      {/* Posts */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {isLoading && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Loading…</div>
        )}

        {/* Access denied — compliance flow available */}
        {!isLoading && accessErr?.code === 'compliance_required' && (
          <div style={{ margin: 'auto', maxWidth: '420px', textAlign: 'center', display: 'flex',
            flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '24px' }}>
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(27,45,85,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i class="fas fa-user-shield" style={{ fontSize: '1.5rem', color: 'var(--siomac-navy)' }} />
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>
              This is a private conversation
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              You are not a participant. Reading it requires controlled, audited compliance
              access — your name, the time, and your reason will be logged.
            </div>
            <button class="hse-btn primary" onClick={() => setAccessOpen(true)}>
              <i class="fas fa-key" /> Request Access
            </button>
          </div>
        )}

        {/* Access denied — no compliance capability */}
        {!isLoading && accessErr?.code === 'forbidden' && (
          <div style={{ margin: 'auto', maxWidth: '380px', textAlign: 'center', display: 'flex',
            flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '24px', color: 'var(--text-muted)' }}>
            <i class="fas fa-lock" style={{ fontSize: '1.6rem', opacity: 0.4 }} />
            <div style={{ fontSize: '0.9rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>No access</div>
            <div style={{ fontSize: '0.8rem' }}>
              You don't have access to this conversation. Only its participants can view it.
            </div>
          </div>
        )}

        {!accessErr && posts.map(post => {
          const isSystemEvent = post.postType === 'system_event' || (post.isSystem && !!post.systemEventType);
          const isSystem   = post.isSystem;
          const isDeleted  = post.deletedAt != null;
          const isEdited   = post.editedAt != null;
          const createdAt  = post.createdAt;
          const authorName = post.authorName ?? (isSystem ? 'System' : 'Unknown');
          const iniText    = ((authorName[0] ?? '').toUpperCase());
          const attachments: MessageAttachment[] = Array.isArray(post.attachments) ? post.attachments : [];
          const tone       = messageTone(post, myId);

          const relTime = (() => {
            const d = Date.now() - new Date(createdAt).getTime();
            const m = Math.round(d / 60000);
            if (m < 1) return 'just now';
            if (m < 60) return `${m}m ago`;
            const h = Math.round(m / 60);
            if (h < 24) return `${h}h ago`;
            return new Date(createdAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          })();

          // Centered timeline announcement (participant added/removed/left, etc.).
          if (isSystemEvent) {
            return (
              <div key={post.id} style={{ textAlign: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '0.72rem', color: 'var(--text-muted)',
                  background: 'var(--bg-surface)', padding: '4px 13px', borderRadius: '999px', border: '1px solid var(--border)' }}>
                  <i class="fas fa-circle-info" style={{ fontSize: '0.6rem' }} /> {systemEventLabel(post)}
                </span>
              </div>
            );
          }
          if (isSystem) {
            return (
              <div key={post.id} style={{ textAlign: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-surface)',
                  padding: '3px 12px', borderRadius: '20px', border: '1px solid var(--border)' }}>{post.body}</span>
              </div>
            );
          }

          const bubbleBg = isDeleted ? 'var(--bg-surface)' : tone === 'admin' ? 'var(--siomac-navy)' : tone === 'outgoing' ? '#f0edff' : 'var(--bg-surface)';
          const bubbleFg = tone === 'admin' && !isDeleted ? '#fff' : 'var(--siomac-navy)';
          const bubbleBd = tone === 'admin' ? 'var(--siomac-navy)' : tone === 'outgoing' ? '#e7e0ff' : 'var(--border)';

          return (
            <div key={post.id} class="msg-row" style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <div style={{ width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                background: 'rgba(27,45,85,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {post.authorProfileImage
                  ? <img src={post.authorProfileImage} alt={iniText} loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: '0.65rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>{iniText}</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '3px' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>{authorName}</span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{relTime}</span>
                  {isEdited && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>(edited)</span>}
                </div>

                {post.priority === 'action_required' && !isDeleted && (
                  <div style={{ marginBottom: '5px', fontSize: '0.7rem', fontWeight: 'var(--font-weight-bold)', color: '#b45309',
                    background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '5px 9px' }}>⚠ Action required</div>
                )}
                {post.replyToPost && (
                  <div style={{ marginBottom: '5px', fontSize: '0.7rem', color: 'var(--text-muted)', borderLeft: '3px solid var(--siomac-navy)',
                    background: 'rgba(27,45,85,0.04)', borderRadius: '0 8px 8px 0', padding: '5px 9px' }}>
                    <strong style={{ display: 'block', color: 'var(--siomac-navy)', fontSize: '0.66rem' }}>Replying to {post.replyToPost.authorName ?? 'message'}</strong>
                    {post.replyToPost.preview}
                  </div>
                )}

                <div style={{ fontSize: '0.83rem', color: isDeleted ? 'var(--text-muted)' : bubbleFg,
                  lineHeight: 1.5, fontStyle: isDeleted ? 'italic' : 'normal',
                  background: bubbleBg, borderRadius: '10px', padding: '8px 12px', border: `1px solid ${bubbleBd}` }}>
                  {isDeleted ? 'This message was deleted.' : post.body}
                </div>

                <MessageAttachments attachments={attachments} />

                {!isDeleted && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                    {post.isPinned && <span><i class="fas fa-thumbtack" /> Pinned</span>}
                    {(post.readByCount ?? 0) > 0 && <span>Read by {post.readByCount}</span>}
                    {post.deliveryStatus && <span style={{ textTransform: 'capitalize' }}>{post.deliveryStatus}</span>}
                    <button onClick={() => setReplyTo(post)} style={{ border: 0, background: 'transparent', color: 'var(--siomac-navy)', cursor: 'pointer', fontWeight: 'var(--font-weight-bold)', fontSize: '0.66rem', padding: 0 }}>Reply</button>
                    {pinByPost.get(post.id)
                      ? <button onClick={() => { const pin = pinByPost.get(post.id); if (pin) unpinMsg.mutate({ pinId: pin.id, threadId: thread.id }); }}
                          style={{ border: 0, background: 'transparent', color: 'var(--siomac-navy)', cursor: 'pointer', fontWeight: 'var(--font-weight-bold)', fontSize: '0.66rem', padding: 0 }}>Unpin</button>
                      : <button onClick={() => pinMsg.mutate({ threadId: thread.id, postId: post.id, pinType: 'post', visibility: 'personal' })}
                          style={{ border: 0, background: 'transparent', color: 'var(--siomac-navy)', cursor: 'pointer', fontWeight: 'var(--font-weight-bold)', fontSize: '0.66rem', padding: 0 }}>Pin</button>}
                    {isOwner && !pinByPost.get(post.id) && (
                      <button onClick={() => pinMsg.mutate({ threadId: thread.id, postId: post.id, pinType: 'post', visibility: 'thread' })}
                        style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 'var(--font-weight-bold)', fontSize: '0.66rem', padding: 0 }}>Pin for all</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      {!thread.isArchived && !accessErr && (
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          {/* Reply target preview */}
          {replyTo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', borderLeft: '3px solid var(--siomac-navy)',
              background: 'rgba(27,45,85,0.04)', borderRadius: '0 8px 8px 0', padding: '6px 10px' }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                <strong style={{ display: 'block', color: 'var(--siomac-navy)', fontSize: '0.68rem' }}>Replying to {replyTo.authorName ?? 'message'}</strong>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{(replyTo.body ?? '').slice(0, 80)}</span>
              </div>
              <button onClick={() => setReplyTo(null)} style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem' }}>×</button>
            </div>
          )}
          {/* Pending attachment chips */}
          {pending.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {pending.map(p => (
                <div key={p.localId} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '3px 8px', borderRadius: '6px',
                  background: p.state === 'error' ? 'rgba(220,38,38,0.07)' : 'var(--bg-subtle, #f4f5f7)',
                  border: `1px solid ${p.state === 'error' ? '#f87171' : 'var(--border)'}`,
                  fontSize: '0.72rem', color: p.state === 'error' ? '#dc2626' : 'var(--siomac-navy)',
                }}>
                  {p.state === 'uploading'
                    ? <i class="fas fa-spinner fa-spin" style={{ fontSize: '0.65rem' }} />
                    : p.state === 'error'
                      ? <i class="fas fa-triangle-exclamation" style={{ fontSize: '0.65rem' }} />
                      : <i class={`fas ${fileIcon(p.file.type)}`} style={{ fontSize: '0.65rem' }} />
                  }
                  <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.state === 'error' ? (p.error ?? 'Failed') : p.file.name}
                  </span>
                  {fmtBytes(p.file.size) && (
                    <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{fmtBytes(p.file.size)}</span>
                  )}
                  <button onClick={() => removePending(p.localId)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
                      color: 'var(--text-muted)', lineHeight: 1, flexShrink: 0 }}
                    title="Remove">
                    <i class="fas fa-xmark" style={{ fontSize: '0.65rem' }} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            {/* Paperclip */}
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Attach file"
              style={{ padding: '8px', borderRadius: '8px', border: '1px solid var(--border)',
                background: 'none', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}>
              <i class="fas fa-paperclip" style={{ fontSize: '0.82rem' }} />
            </button>
            <textarea
              value={body}
              onInput={e => setBody((e.target as HTMLTextAreaElement).value)}
              onKeyDown={onKeyDown}
              placeholder="Write a message… (Enter to send, Shift+Enter for newline)"
              rows={2}
              style={{ flex: 1, border: '1px solid var(--border)', borderRadius: '8px',
                padding: '8px 10px', fontSize: '0.82rem', fontFamily: 'inherit',
                resize: 'none', outline: 'none' }}
            />
            <button
              onClick={handleSend}
              disabled={!canSend}
              style={{ padding: '8px 14px', borderRadius: '8px', border: 'none',
                background: canSend ? 'var(--siomac-navy)' : 'var(--border)',
                color: canSend ? '#fff' : 'var(--text-muted)',
                cursor: canSend ? 'pointer' : 'default',
                fontSize: '0.82rem', fontWeight: 600, flexShrink: 0 }}>
              <i class="fas fa-paper-plane" />
            </button>
          </div>
        </div>
      )}
      {thread.isArchived && (
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', flexShrink: 0,
          background: 'var(--bg-surface)', fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          <i class="fas fa-box-archive" style={{ marginRight: '5px' }} />
          This thread is archived. Unarchive to send messages.
        </div>
      )}

      {/* Compliance access flow — only reachable when the read-gate denied access */}
      <AccessThreadDialog
        open={accessOpen}
        threadId={thread.id}
        onClose={() => setAccessOpen(false)}
        onGranted={() => { void refetch(); }}
      />
    </div>
  );
}

// ── Thread details panel (right pane) ─────────────────────────────────────────

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return (((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()) || '?';
}

function Avatar({ name, img, size = 34 }: { name: string; img?: string | null; size?: number }): VNode {
  return img
    ? <img src={img} alt={name} style={{ width: `${size}px`, height: `${size}px`, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
    : (
      <div style={{ width: `${size}px`, height: `${size}px`, borderRadius: '50%', flexShrink: 0,
        background: 'rgba(27,45,85,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: `${size * 0.36}px`, fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>{initials(name)}</span>
      </div>
    );
}

function SectionHead({ children }: { children: ComponentChildren }): VNode {
  return (
    <div style={{ fontSize: '0.7rem', fontWeight: 'var(--font-weight-bold)', textTransform: 'uppercase', letterSpacing: '.05em',
      color: 'var(--text-muted)', marginBottom: '10px' }}>{children}</div>
  );
}

function ThreadDetailsPanel({ thread }: { thread: MessageThreadListItem }): VNode {
  const myId = useSessionStore(s => s.userId);
  const { data: detail }   = useThread(thread.id);
  const { data: allPosts = [] } = useThreadPosts(thread.id);
  const participants: MessageParticipantProfile[] = detail?.participants ?? thread.participants;
  const isOwner = thread.myRole === 'owner';

  // Flatten all attachments from all posts for the Files panel
  const allFiles: (MessageAttachment & { createdAt: string; authorName: string | null })[] = [];
  for (const post of allPosts) {
    const postAttachments: MessageAttachment[] = Array.isArray(post.attachments) ? post.attachments : [];
    const createdAt = post.createdAt ?? '';
    const authorName = post.authorName ?? null;
    for (const a of postAttachments) {
      allFiles.push({ ...a, createdAt, authorName });
    }
  }
  const mediaFiles = allFiles.filter(a => attTypeOf(a) === 'image');
  const docFiles   = allFiles.filter(a => attTypeOf(a) !== 'image');

  const { data: pins = [] } = usePins(thread.id);
  const unpinMsg = useUnpinMessage();
  const postPins = pins.filter(p => p.pinType === 'post');
  const { data: online = [] } = useOnlineUsers();
  const onlineMap = new Map(online.map(u => [u.userId, u.status]));
  const muteThread = useMuteThread();

  const addP    = useAddThreadParticipants();
  const removeP = useRemoveThreadParticipant();

  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data: recipients = [] } = useMessageRecipients(q);
  const existing = new Set(participants.map(p => p.userId));
  const candidates = recipients.filter(r => !existing.has(r.userId)).slice(0, 6);

  const typeLabel = thread.threadType === 'group'  ? 'Group conversation'
                  : thread.threadType === 'record' ? 'Record discussion'
                  : thread.threadType === 'system' ? 'System thread'
                  :                                    'Direct message';
  const others = otherParticipants(participants, myId);
  const title  = thread.subject ?? (others.map(p => p.displayName ?? p.username ?? '?').join(', ') || 'Conversation');

  const presenceOf = (uid: string): 'online' | 'away' | 'offline' =>
    uid === myId ? 'online' : (onlineMap.get(uid) ?? 'offline');

  return (
    <div class="mc-panel">
      {/* Profile */}
      <div class="mc-panel-profile">
        <div class="mc-panel-avatar">
          {others[0]?.profileImage
            ? <img src={others[0].profileImage} alt={title} loading="lazy" referrerPolicy="no-referrer" />
            : <span>{initials(title)}</span>}
        </div>
        <h3>{title}</h3>
        <p>{typeLabel} · {thread.participantCount} {thread.participantCount === 1 ? 'person' : 'people'}</p>
        <div class="mc-panel-pills">
          {thread.actionRequired && <span class="mc-panel-pill is-warn">Action Required</span>}
          {thread.isPinned && <span class="mc-panel-pill is-info">Pinned</span>}
          {thread.sourceModule && <span class="mc-panel-pill">{moduleLabel(thread.sourceModule)}</span>}
        </div>
      </div>

      {/* Mute notifications */}
      <div class="mc-panel-section">
        <div class="mc-toggle-row">
          <span><i class="fas fa-bell-slash" style={{ marginRight: '8px', opacity: .55 }} />Mute notifications</span>
          <button class={`mc-toggle${thread.isMuted ? ' on' : ''}`} disabled={muteThread.isPending}
            title={thread.isMuted ? 'Unmute' : 'Mute'}
            onClick={() => muteThread.mutate({ threadId: thread.id, muted: !thread.isMuted })} />
        </div>
      </div>

      {/* Participants */}
      <div class="mc-panel-section">
        <div class="mc-panel-head">
          <h4><i class="fas fa-users" /> Participants · {participants.length}</h4>
          {isOwner && <button onClick={() => setAddOpen(o => !o)}><i class="fas fa-user-plus" /> Add</button>}
        </div>
        {isOwner && addOpen && (
          <div style={{ marginBottom: '8px' }}>
            <div class="vt-search" style={{ marginBottom: '6px' }}>
              <i class="fas fa-search" />
              <input type="search" placeholder="Search people…" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} />
            </div>
            {candidates.map(r => (
              <button key={r.userId} disabled={addP.isPending} class="mc-signal clickable" style={{ width: '100%', marginTop: '4px', textAlign: 'left' }}
                onClick={() => { addP.mutate({ threadId: thread.id, userIds: [r.userId] }); setQ(''); setAddOpen(false); }}>
                <span class="mc-signal-chip">{r.profileImage ? <img src={r.profileImage} alt="" /> : initials(r.displayName ?? r.username)}</span>
                <span class="mc-signal-text"><strong>{r.displayName ?? r.username}</strong><span>Add to conversation</span></span>
                <i class="fas fa-plus" style={{ color: 'rgba(255,255,255,.5)' }} />
              </button>
            ))}
          </div>
        )}
        {participants.map(p => {
          const name = p.userId === myId ? 'You' : (p.displayName ?? p.username ?? '?');
          const st = presenceOf(p.userId);
          return (
            <div key={p.userId} class="mc-signal">
              <span class="mc-signal-chip" style={{ position: 'relative' }}>
                {p.profileImage ? <img src={p.profileImage} alt="" /> : initials(p.displayName ?? p.username)}
                {st !== 'offline' && <span style={{ position: 'absolute', right: '-1px', bottom: '-1px', width: '9px', height: '9px', borderRadius: '50%', border: '2px solid #1b2d54', background: st === 'away' ? '#f59e0b' : '#22c55e' }} />}
              </span>
              <span class="mc-signal-text"><strong>{name}</strong><span style={{ textTransform: 'capitalize' }}>{p.role}</span></span>
              {isOwner && p.userId !== myId
                ? <button class="mc-signal-x" title="Remove" onClick={() => removeP.mutate({ threadId: thread.id, userId: p.userId })}><i class="fas fa-xmark" /></button>
                : (st !== 'offline' && <span class={`mc-signal-tag ${st === 'away' ? 'is-due' : 'is-ok'}`}>{st === 'away' ? 'Away' : 'Online'}</span>)}
            </div>
          );
        })}
      </div>

      {/* Pinned messages */}
      {postPins.length > 0 && (
        <div class="mc-panel-section">
          <div class="mc-panel-head"><h4><i class="fas fa-thumbtack" /> Pinned messages · {postPins.length}</h4></div>
          {postPins.map(pin => (
            <div key={pin.id} class="mc-signal">
              <span class="mc-signal-chip is-info"><i class="fas fa-thumbtack" /></span>
              <span class="mc-signal-text"><strong>{pin.postPreview?.body ?? pin.note ?? 'Pinned message'}</strong><span>by {pin.pinnedBy.displayName}{pin.visibility === 'thread' ? ' · everyone' : ' · personal'}</span></span>
              <button class="mc-signal-x" title="Unpin" onClick={() => unpinMsg.mutate({ pinId: pin.id, threadId: thread.id })}><i class="fas fa-xmark" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Shared media */}
      {mediaFiles.length > 0 && (
        <div class="mc-panel-section">
          <div class="mc-panel-head"><h4><i class="fas fa-images" /> Shared media · {mediaFiles.length}</h4></div>
          <div class="mc-media-grid">
            {mediaFiles.slice(0, 9).map(a => (
              <a key={a.id} class="mc-media-box" href={a.url ?? undefined} target="_blank" rel="noopener noreferrer">
                {a.url ? <img src={a.url} alt={a.fileName} loading="lazy" /> : 'IMG'}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Files */}
      <div class="mc-panel-section">
        <div class="mc-panel-head"><h4><i class="fas fa-paperclip" /> Files · {docFiles.length}</h4></div>
        {docFiles.length === 0
          ? <div style={{ color: 'rgba(255,255,255,.4)', fontSize: '0.7rem', padding: '4px 2px' }}>No files shared yet.</div>
          : docFiles.map(a => {
              const t = attTypeOf(a);
              const chipCls = t === 'pdf' ? 'is-pdf' : t === 'word' ? 'is-word' : t === 'excel' ? 'is-excel' : 'is-file';
              const label = t === 'pdf' ? 'PDF' : t === 'word' ? 'DOC' : t === 'excel' ? 'XLS' : 'FILE';
              return (
                <a key={a.id} class="mc-signal clickable" href={a.url ?? undefined} download={a.fileName} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  <span class={`mc-signal-chip ${chipCls}`}>{label}</span>
                  <span class="mc-signal-text"><strong>{a.fileName}</strong><span>{[fmtBytes(a.sizeBytes), a.authorName].filter(Boolean).join(' · ')}</span></span>
                  {a.url && <i class="fas fa-download" style={{ color: 'rgba(255,255,255,.5)' }} />}
                </a>
              );
            })}
      </div>

      {/* Linked record */}
      {thread.sourceModule && thread.sourceEntityId && (
        <div class="mc-panel-section">
          <div class="mc-panel-head"><h4><i class="fas fa-link" /> Linked record</h4></div>
          <div class="mc-signal">
            <span class="mc-signal-chip is-info">{moduleLabel(thread.sourceModule).slice(0, 3)}</span>
            <span class="mc-signal-text"><strong>{thread.sourceEntityType ?? 'Record'}</strong><span>{thread.sourceEntityId}</span></span>
          </div>
        </div>
      )}

      {/* Details */}
      <div class="mc-panel-section">
        <div class="mc-panel-head"><h4><i class="fas fa-circle-info" /> Details</h4></div>
        <div class="mc-detail-row"><span>Created</span><strong>{thread.createdAt ? new Date(thread.createdAt).toLocaleDateString() : '—'}</strong></div>
        <div class="mc-detail-row"><span>Last activity</span><strong>{thread.lastPostAt ? new Date(thread.lastPostAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div>
        <div class="mc-detail-row"><span>Unread</span><strong>{thread.unreadCount} messages</strong></div>
        <div class="mc-detail-row"><span>Attachments</span><strong>{allFiles.length} files</strong></div>
        <div class="mc-detail-row"><span>Priority</span><strong style={{ textTransform: 'capitalize' }}>{thread.priority ?? 'normal'}</strong></div>
      </div>
    </div>
  );
}

// ── MessageCenter (main export) ───────────────────────────────────────────────

export function MessageCenter(): VNode {
  const [tab, setTab]               = useState('inbox');
  const [selectedThread, setSelectedThread] = useState<MessageThreadListItem | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(true);

  const { data: summary } = useCommsSummary();
  const unread = summary?.messagesUnread ?? 0;

  const canCompliance = useCan('communications.compliance_read');
  const isCompliance  = tab === 'compliance';

  // The participant thread list isn't used in compliance view — avoid sending an
  // invalid tab to the /threads route.
  const filters: ThreadFilters = {
    tab:   (isCompliance ? 'inbox' : tab) as ThreadFilters['tab'],
    limit: 100,
  };
  const { data: threads = [], isLoading } = useMessageThreadsFull(filters);

  // A thread id requested by the dropdown (or compose) before the list is ready.
  // Held until `threads` loads, then resolved into a selection (see effect below).
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);

  // Listen for dropdown pre-selection events. We DON'T try to resolve the thread
  // here — the list may not be loaded yet — we just record the request.
  useEffect(() => {
    function onOpenThread(e: Event) {
      const { threadId } = (e as CustomEvent<{ threadId: string }>).detail;
      setPendingThreadId(threadId);
    }
    // Notification deep-link: a `siomac:openRecord` for a message_thread (fired by
    // openNotificationTarget when a message notification is clicked) opens the
    // exact conversation. The Messages module owns resolving its own records.
    function onOpenRecord(e: Event) {
      const d = (e as CustomEvent<{ sourceType?: string; sourceId?: string }>).detail;
      if (d?.sourceType === 'message_thread' && d.sourceId) setPendingThreadId(d.sourceId);
    }
    window.addEventListener('siomac:openThread', onOpenThread);
    window.addEventListener('siomac:openRecord', onOpenRecord);
    return () => {
      window.removeEventListener('siomac:openThread', onOpenThread);
      window.removeEventListener('siomac:openRecord', onOpenRecord);
    };
  }, []);

  // Resolve a pending open once the thread list actually contains it. This
  // survives the race where the event fires before the inbox query resolves.
  useEffect(() => {
    if (!pendingThreadId) return;
    const t = threads.find(x => x.id === pendingThreadId);
    if (t) {
      setSelectedThread(t);
      setPendingThreadId(null);
    }
  }, [threads, pendingThreadId]);

  // Auto-deselect if thread no longer in list (skip in compliance view — the
  // selected thread there is a synthesized row that isn't in the participant list).
  useEffect(() => {
    if (!isCompliance && selectedThread && !threads.find(t => t.id === selectedThread.id)) {
      setSelectedThread(null);
    }
  }, [threads, selectedThread, isCompliance]);

  // Switching tabs clears the open conversation.
  function switchTab(next: string) {
    if (next === tab) return;
    setTab(next);
    setSelectedThread(null);
  }

  const TAB_LIST: AreaTab[] = canCompliance
    ? [...TABS, { key: 'compliance', label: 'Compliance', icon: 'fa-user-shield' }]
    : TABS;

  // 0 threads on this tab → full-width welcome state (no split). >0 → split.
  // Compliance always uses the split layout (browser left, conversation right).
  const hasThreads = threads.length > 0;
  const emptyAll   = !isCompliance && !isLoading && !hasThreads;
  const emptyTitle = tab === 'archived' ? 'No archived conversations'
                   : tab === 'sent'     ? 'Nothing sent yet'
                   :                       'No conversations yet';

  return (
    <div class="hse-tab hse-dash" style={{ display: 'flex', flexDirection: 'column', gap: '14px', height: '100%' }}>
      <PageHeader
        icon="fa-comments"
        module="Messages"
        title="Messages"
        sub="Threaded conversations across your team and linked ERP records."
        meta={[
          { icon: 'fa-envelope', label: `${unread} unread` },
        ]}
      />

      {/* Compact tab row + New Message button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {TAB_LIST.map(t => {
            const on    = tab === t.key;
            const count = t.key === 'inbox' ? unread : undefined;
            return (
              <button key={t.key} onClick={() => switchTab(t.key)}
                style={{ display: 'flex', alignItems: 'center', gap: '7px', height: '34px', padding: '0 14px',
                  borderRadius: '9px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
                  border: on ? '1px solid var(--border)' : '1px solid transparent', background: on ? 'var(--bg-subtle, #eef1f8)' : 'transparent',
                  color: on ? 'var(--siomac-navy)' : 'var(--text-muted)' }}>
                <i class={`fas ${t.icon}`} style={{ fontSize: '0.78rem' }} /> {t.label}
                {count !== undefined && count > 0 && (
                  <span style={{ minWidth: '18px', height: '18px', borderRadius: '9px', padding: '0 5px',
                    background: 'var(--border)',
                    color: 'var(--siomac-navy)', fontSize: '0.66rem', fontWeight: 'var(--font-weight-bold)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <button class="hse-btn" onClick={() => setComposeOpen(true)} style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <i class="fas fa-pen-to-square" /> New Message
        </button>
      </div>

      {emptyAll ? (
        /* ── Full-width welcome state (no conversations) ─────────────────────── */
        <div style={{ height: 'calc(100vh - 230px)', minHeight: '420px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '14px', textAlign: 'center', padding: '24px',
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '14px' }}>
          <div style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'rgba(27,45,85,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <i class="fas fa-comments" style={{ fontSize: '1.8rem', color: 'var(--siomac-navy)', opacity: 0.7 }} />
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>{emptyTitle}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '420px' }}>
            Start a direct message, group conversation, or record-linked discussion.
          </div>
          <button class="hse-btn primary" onClick={() => setComposeOpen(true)}>
            <i class="fas fa-pen-to-square" /> New Message
          </button>
        </div>
      ) : (
        /* ── Split layout (threads exist) ────────────────────────────────────── */
        <div style={{ height: 'calc(100vh - 230px)', minHeight: '420px', display: 'flex', gap: '0', overflow: 'hidden',
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '14px' }}>
          {/* Left pane — thread list, or compliance browser */}
          <div style={{ width: '300px', minWidth: '260px', flexShrink: 0,
            borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
            {isCompliance ? (
              <ComplianceBrowser
                selectedId={selectedThread?.id ?? null}
                onSelect={setSelectedThread}
              />
            ) : (
              <ThreadList
                threads={threads}
                selectedId={selectedThread?.id ?? null}
                onSelect={setSelectedThread}
                isLoading={isLoading}
              />
            )}
          </div>

          {/* Right pane — conversation (+ details panel), or "select one" */}
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            {selectedThread
              ? (
                <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Conversation thread={selectedThread} detailsOpen={showDetails} onToggleDetails={() => setShowDetails(v => !v)} />
                  </div>
                  {showDetails && (
                    <div style={{ width: '324px', flexShrink: 0, padding: '12px', overflow: 'hidden' }}>
                      <ThreadDetailsPanel thread={selectedThread} />
                    </div>
                  )}
                </div>
              )
              : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: '10px', color: 'var(--text-muted)', padding: '24px', textAlign: 'center' }}>
                  <i class="fas fa-comments" style={{ fontSize: '2.4rem', opacity: 0.25 }} />
                  <div style={{ fontSize: '0.95rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>
                    Select a conversation
                  </div>
                  <div style={{ fontSize: '0.82rem' }}>
                    Choose a thread from the inbox to view the discussion.
                  </div>
                </div>
              )
            }
          </div>
        </div>
      )}

      <ComposeThreadDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onCreated={(threadId) => {
          setComposeOpen(false);
          // The new thread will appear after query invalidation; find and select it
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('siomac:openThread', { detail: { threadId } }));
          }, 300);
        }}
      />
    </div>
  );
}
