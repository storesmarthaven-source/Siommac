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
  useThread, useAddThreadParticipants, useRemoveThreadParticipant, useMessageRecipients,
  useMessageAttachmentUploadUrl, useCreateMessageAttachment,
  type MessageThreadListItem, type MessageParticipantProfile, type ThreadFilters,
  type MessageAttachment,
} from '@api/communications';
import { useSessionStore } from '@store/session';
import { ComposeThreadDialog } from './ComposeThreadDialog';

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

/** A single downloadable attachment chip. */
function AttachChip({ a }: { a: MessageAttachment }): VNode {
  const href = a.url ?? undefined;
  const Tag  = href ? 'a' : 'span';
  return (
    <Tag
      href={href}
      download={a.fileName}
      target="_blank"
      rel="noopener noreferrer"
      title={a.fileName}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        padding: '3px 9px', borderRadius: '6px',
        background: 'var(--bg-subtle, #f4f5f7)', border: '1px solid var(--border)',
        fontSize: '0.72rem', color: 'var(--siomac-navy)', textDecoration: 'none',
        cursor: href ? 'pointer' : 'default', flexShrink: 0,
      }}>
      <i class={`fas ${fileIcon(a.contentType)}`} style={{ fontSize: '0.68rem' }} />
      <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {a.fileName}
      </span>
      {a.sizeBytes != null && <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{fmtBytes(a.sizeBytes)}</span>}
    </Tag>
  );
}

// ── Thread list (left pane) ────────────────────────────────────────────────────

function ThreadList({ threads, selectedId, onSelect, isLoading }: {
  threads:    MessageThreadListItem[];
  selectedId: string | null;
  onSelect:   (t: MessageThreadListItem) => void;
  isLoading:  boolean;
}): VNode {
  const [search, setSearch] = useState('');
  const [chips, setChips] = useState({ unread: false, groups: false, records: false });
  const toggle = (k: 'unread' | 'groups' | 'records') => setChips(c => ({ ...c, [k]: !c[k] }));

  const filtered = threads.filter(t => {
    if (chips.unread  && !(t.unread_count > 0))     return false;
    if (chips.groups  && !(t.participant_count > 2)) return false;
    if (chips.records && !t.source_module)          return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const hit = (t.subject ?? '').toLowerCase().includes(q)
        || t.participants.some(p => (p.full_name ?? '').toLowerCase().includes(q))
        || (t.last_post_body ?? '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });

  function displayName(t: MessageThreadListItem): string {
    return t.subject
      ?? t.participants.filter(p => p.role !== 'self').map(p => p.full_name ?? p.username ?? '?').join(', ')
      ?? 'Thread';
  }

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
          const isUnread   = t.unread_count > 0;
          const name       = displayName(t);
          const firstP     = t.participants.find(p => p.role !== 'self') ?? t.participants[0];
          const ava        = firstP?.full_name ?? firstP?.username ?? '?';
          const iniText    = ((ava[0] ?? '').toUpperCase());
          return (
            <div key={t.id} onClick={() => onSelect(t)}
              style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                background: isSelected ? 'rgba(27,45,85,0.07)' : 'transparent',
                borderLeft: isSelected ? '3px solid var(--siomac-navy)' : '3px solid transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                  background: 'rgba(27,45,85,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--siomac-navy)' }}>{iniText}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.83rem', fontWeight: isUnread ? 700 : 500,
                      color: 'var(--siomac-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {relTime(t.last_post_at ?? t.created_at)}
                    </span>
                    {isUnread && (
                      <span style={{ flexShrink: 0, minWidth: '18px', height: '18px', borderRadius: '9px',
                        background: 'var(--siomac-navy)', color: '#fff', fontSize: '0.6rem', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                        {t.unread_count > 9 ? '9+' : t.unread_count}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>
                    {t.last_post_body ?? ''}
                  </div>
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

  const { data: posts = [], isLoading } = useThreadPosts(thread.id);
  const postMsg     = usePostMessage();
  const archive     = useArchiveThread();
  const markRead    = useMarkThreadRead();
  const getUploadUrl = useMessageAttachmentUploadUrl();
  const createAttach = useCreateMessageAttachment();

  // Mark read when thread opens
  useEffect(() => {
    if (thread.unread_count > 0) markRead.mutate(thread.id);
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
    postMsg.mutate({ threadId: thread.id, body: body.trim() || '​', attachmentIds: attachmentIds.length ? attachmentIds : undefined }, {
      onSuccess: () => {
        setBody('');
        setPending([]);
      },
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const displayName = thread.subject
    ?? thread.participants.filter(p => p.role !== 'self').map(p => p.full_name ?? p.username ?? '?').join(', ')
    ?? 'Thread';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Conversation header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--siomac-navy)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '1px' }}>
            {thread.participant_count} participants
            {thread.source_module ? ` · ${thread.source_module}` : ''}
          </div>
        </div>
        <button
          onClick={() => archive.mutate({ threadId: thread.id, archived: !thread.is_archived })}
          disabled={archive.isPending}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '7px',
            cursor: 'pointer', color: 'var(--text-muted)', padding: '5px 10px', fontSize: '0.76rem' }}
          title={thread.is_archived ? 'Unarchive' : 'Archive'}>
          <i class={`fas ${thread.is_archived ? 'fa-inbox' : 'fa-box-archive'}`} />
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
        {posts.map(post => {
          // Backend returns camelCase (PostRow). Support both camelCase and snake_case for safety.
          const isSystem   = post.isSystem ?? post.is_system ?? false;
          const isDeleted  = post.deletedAt != null || (post as { is_deleted?: boolean }).is_deleted === true;
          const isEdited   = post.editedAt != null || (post as { is_edited?: boolean }).is_edited === true;
          const createdAt  = post.createdAt ?? post.created_at;
          const authorName = post.authorName
            ?? post.author_profile?.full_name
            ?? post.author_profile?.username
            ?? (isSystem ? 'System' : 'Unknown');
          const profileImg = post.author_profile?.profile_image ?? null;
          const iniText    = ((authorName[0] ?? '').toUpperCase());
          const attachments: MessageAttachment[] = Array.isArray(post.attachments) ? post.attachments : [];

          const relTime = (() => {
            const d = Date.now() - new Date(createdAt).getTime();
            const m = Math.round(d / 60000);
            if (m < 1) return 'just now';
            if (m < 60) return `${m}m ago`;
            const h = Math.round(m / 60);
            if (h < 24) return `${h}h ago`;
            return new Date(createdAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          })();

          if (isSystem) {
            return (
              <div key={post.id} style={{ textAlign: 'center' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'var(--bg-surface)',
                  padding: '3px 12px', borderRadius: '20px', border: '1px solid var(--border)' }}>
                  {post.body}
                </span>
              </div>
            );
          }

          return (
            <div key={post.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <div style={{ width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                background: 'rgba(27,45,85,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {profileImg
                  ? <img src={profileImg} alt={iniText}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                  : <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--siomac-navy)' }}>{iniText}</span>
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '3px' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--siomac-navy)' }}>{authorName}</span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{relTime}</span>
                  {isEdited && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>(edited)</span>}
                </div>
                <div style={{ fontSize: '0.83rem', color: isDeleted ? 'var(--text-muted)' : 'var(--siomac-navy)',
                  lineHeight: 1.5, fontStyle: isDeleted ? 'italic' : 'normal',
                  background: 'var(--bg-surface)', borderRadius: '10px', padding: '8px 12px',
                  border: '1px solid var(--border)' }}>
                  {isDeleted ? 'This message was deleted.' : post.body}
                </div>
                {/* Attachment chips */}
                {attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                    {attachments.map(a => <AttachChip key={a.id} a={a} />)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      {!thread.is_archived && (
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
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
      {thread.is_archived && (
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', flexShrink: 0,
          background: 'var(--bg-surface)', fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          <i class="fas fa-box-archive" style={{ marginRight: '5px' }} />
          This thread is archived. Unarchive to send messages.
        </div>
      )}
    </div>
  );
}

// ── Thread details panel (right pane) ─────────────────────────────────────────

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase()) || '?';
}

function Avatar({ name, img, size = 34 }: { name: string; img?: string | null; size?: number }): VNode {
  return img
    ? <img src={img} alt={name} style={{ width: `${size}px`, height: `${size}px`, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
    : (
      <div style={{ width: `${size}px`, height: `${size}px`, borderRadius: '50%', flexShrink: 0,
        background: 'rgba(27,45,85,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: `${size * 0.36}px`, fontWeight: 700, color: 'var(--siomac-navy)' }}>{initials(name)}</span>
      </div>
    );
}

function SectionHead({ children }: { children: ComponentChildren }): VNode {
  return (
    <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
      color: 'var(--text-muted)', marginBottom: '10px' }}>{children}</div>
  );
}

function ThreadDetailsPanel({ thread }: { thread: MessageThreadListItem }): VNode {
  const myId = useSessionStore(s => s.userId);
  const { data: detail }   = useThread(thread.id);
  const { data: allPosts = [] } = useThreadPosts(thread.id);
  const participants: MessageParticipantProfile[] = detail?.participants ?? thread.participants;
  const isOwner = thread.role === 'owner';

  // Flatten all attachments from all posts for the Files panel
  const allFiles: (MessageAttachment & { createdAt: string; authorName: string | null })[] = [];
  for (const post of allPosts) {
    const postAttachments: MessageAttachment[] = Array.isArray(post.attachments) ? post.attachments : [];
    const createdAt = post.createdAt ?? post.created_at ?? '';
    const authorName = post.authorName ?? post.author_profile?.full_name ?? null;
    for (const a of postAttachments) {
      allFiles.push({ ...a, createdAt, authorName });
    }
  }

  const addP    = useAddThreadParticipants();
  const removeP = useRemoveThreadParticipant();

  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data: recipients = [] } = useMessageRecipients(q);
  const existing = new Set(participants.map(p => p.user_id));
  const candidates = recipients.filter(r => !existing.has(r.user_id)).slice(0, 6);

  const typeLabel = thread.thread_type === 'group'  ? 'Group conversation'
                  : thread.thread_type === 'record' ? 'Record discussion'
                  : thread.thread_type === 'system' ? 'System thread'
                  :                                    'Direct message';
  const others = participants.filter(p => p.user_id !== myId);
  const title  = thread.subject ?? (others.map(p => p.full_name ?? p.username ?? '?').join(', ') || 'Conversation');

  return (
    <div style={{ padding: '18px 14px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', textAlign: 'center' }}>
        <Avatar name={title} img={others[0]?.profile_image} size={64} />
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--siomac-navy)' }}>{title}</div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            {typeLabel} · {thread.participant_count} {thread.participant_count === 1 ? 'person' : 'people'}
          </div>
        </div>
      </div>

      {/* Linked record */}
      {thread.source_module && thread.source_entity_id && (
        <div>
          <SectionHead>Linked record</SectionHead>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
            background: 'var(--bg-subtle, #f7f8fa)', border: '1px solid var(--border)', borderRadius: '10px' }}>
            <i class="fas fa-link" style={{ color: 'var(--siomac-navy)' }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--siomac-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {thread.source_entity_id}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {thread.source_module}{thread.source_entity_type ? ` · ${thread.source_entity_type}` : ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Participants */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <SectionHead>Participants ({participants.length})</SectionHead>
          {isOwner && (
            <button onClick={() => setAddOpen(o => !o)}
              style={{ marginLeft: 'auto', marginTop: '-6px', background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--siomac-navy)', fontSize: '0.74rem', fontWeight: 600 }}>
              <i class="fas fa-user-plus" /> Add
            </button>
          )}
        </div>

        {isOwner && addOpen && (
          <div style={{ marginBottom: '10px' }}>
            <div class="vt-search" style={{ marginBottom: '6px' }}>
              <i class="fas fa-search" />
              <input type="search" placeholder="Search people…" value={q}
                onInput={e => setQ((e.target as HTMLInputElement).value)} />
            </div>
            {candidates.map(r => (
              <button key={r.user_id} disabled={addP.isPending}
                onClick={() => { addP.mutate({ threadId: thread.id, userIds: [r.user_id] }); setQ(''); setAddOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '6px 8px',
                  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: '7px' }}>
                <Avatar name={r.full_name ?? r.username ?? '?'} img={r.profile_image} size={26} />
                <span style={{ fontSize: '0.8rem', color: 'var(--siomac-navy)' }}>{r.full_name ?? r.username}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {participants.map(p => {
            const name = (p.user_id === myId ? 'You' : (p.full_name ?? p.username ?? '?'));
            return (
              <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Avatar name={p.full_name ?? p.username ?? '?'} img={p.profile_image} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--siomac-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{p.role}</div>
                </div>
                {isOwner && p.user_id !== myId && (
                  <button onClick={() => removeP.mutate({ threadId: thread.id, userId: p.user_id })} disabled={removeP.isPending}
                    title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}>
                    <i class="fas fa-xmark" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Files */}
      <div>
        <SectionHead>Files ({allFiles.length})</SectionHead>
        {allFiles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '18px 8px', color: 'var(--text-muted)' }}>
            <i class="fas fa-paperclip" style={{ fontSize: '1.3rem', opacity: 0.4 }} />
            <div style={{ fontSize: '0.76rem', marginTop: '6px' }}>No files shared yet.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {allFiles.map(a => {
              const href = a.url ?? undefined;
              const Tag  = href ? 'a' : 'div';
              return (
                <Tag
                  key={a.id}
                  href={href}
                  download={a.fileName}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 9px',
                    borderRadius: '8px', border: '1px solid var(--border)',
                    background: 'var(--bg-subtle, #f4f5f7)', textDecoration: 'none',
                    cursor: href ? 'pointer' : 'default',
                  }}>
                  <i class={`fas ${fileIcon(a.contentType)}`} style={{ color: 'var(--siomac-navy)', fontSize: '1rem', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.77rem', fontWeight: 600, color: 'var(--siomac-navy)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.fileName}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      {[fmtBytes(a.sizeBytes), a.authorName].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {href && <i class="fas fa-download" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }} />}
                </Tag>
              );
            })}
          </div>
        )}
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

  const filters: ThreadFilters = {
    tab:   tab as ThreadFilters['tab'],
    limit: 100,
  };
  const { data: threads = [], isLoading } = useMessageThreadsFull(filters);

  // Listen for dropdown pre-selection events
  useEffect(() => {
    function onOpenThread(e: Event) {
      const { threadId } = (e as CustomEvent<{ threadId: string }>).detail;
      const t = threads.find(x => x.id === threadId);
      if (t) setSelectedThread(t);
    }
    window.addEventListener('siomac:openThread', onOpenThread);
    return () => window.removeEventListener('siomac:openThread', onOpenThread);
  }, [threads]);

  // Auto-deselect if thread no longer in list
  useEffect(() => {
    if (selectedThread && !threads.find(t => t.id === selectedThread.id)) {
      setSelectedThread(null);
    }
  }, [threads, selectedThread]);

  // 0 threads on this tab → full-width welcome state (no split). >0 → split.
  const hasThreads = threads.length > 0;
  const emptyAll   = !isLoading && !hasThreads;
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
          {TABS.map(t => {
            const on    = tab === t.key;
            const count = t.key === 'inbox' ? unread : undefined;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{ display: 'flex', alignItems: 'center', gap: '7px', height: '34px', padding: '0 14px',
                  borderRadius: '9px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit',
                  border: 'none', background: on ? 'var(--siomac-navy)' : 'transparent',
                  color: on ? '#fff' : 'var(--text-muted)' }}>
                <i class={`fas ${t.icon}`} style={{ fontSize: '0.78rem' }} /> {t.label}
                {count !== undefined && count > 0 && (
                  <span style={{ minWidth: '18px', height: '18px', borderRadius: '9px', padding: '0 5px',
                    background: on ? 'rgba(255,255,255,0.25)' : 'var(--border)',
                    color: on ? '#fff' : 'var(--siomac-navy)', fontSize: '0.66rem', fontWeight: 700,
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
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--siomac-navy)' }}>{emptyTitle}</div>
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
          {/* Left pane — thread list */}
          <div style={{ width: '300px', minWidth: '260px', flexShrink: 0,
            borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
            <ThreadList
              threads={threads}
              selectedId={selectedThread?.id ?? null}
              onSelect={setSelectedThread}
              isLoading={isLoading}
            />
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
                    <div style={{ width: '280px', flexShrink: 0, borderLeft: '1px solid var(--border)', overflowY: 'auto' }}>
                      <ThreadDetailsPanel thread={selectedThread} />
                    </div>
                  )}
                </div>
              )
              : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: '10px', color: 'var(--text-muted)', padding: '24px', textAlign: 'center' }}>
                  <i class="fas fa-comments" style={{ fontSize: '2.4rem', opacity: 0.25 }} />
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--siomac-navy)' }}>
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
