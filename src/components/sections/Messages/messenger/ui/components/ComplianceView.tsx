// ComplianceView — the audited compliance surface (legacy MessageCenter
// parity): the permission-gated ComplianceBrowser on the left, a READ-ONLY
// conversation on the right, and the time-boxed AccessThreadDialog when the
// read-gate denies access. Compliance access is read access (messaging access
// model) — no composer, no message actions.
//
// Reuses the standalone legacy pieces (ComplianceBrowser, AccessThreadDialog)
// and renders the conversation with the Messenger's own components/styles.
import { useState } from "preact/hooks";
import { ComplianceBrowser } from "../../../ComplianceBrowser";
import { AccessThreadDialog } from "../../../AccessThreadDialog";
import type { MessageThreadListItem } from "@api/communications";
import { useMessaging } from "../../app/MessagingProvider";
import type { Message, User } from "../../domain/models";
import { formatTime } from "../../domain/format";
import { Avatar } from "./Avatar";
import { RichMessage } from "./MessageThread";
import { LockKeyhole, MessageSquareText, ShieldCheck, Users } from "./icons";

interface LoadedThread {
  messages: Message[];
  authors: Map<string, User>;
}

export function ComplianceView() {
  const { actions } = useMessaging();
  const [selected, setSelected] = useState<MessageThreadListItem | null>(null);
  const [loaded, setLoaded] = useState<LoadedThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);

  async function open(thread: MessageThreadListItem) {
    setSelected(thread); setLoaded(null); setDenied(false); setLoading(true);
    try {
      const detail = await actions.loadThreadDetail(thread.id);
      setLoaded({ messages: detail.messages, authors: new Map(detail.authors.map((a) => [a.id, a])) });
    } catch {
      // The read-gate denied access — offer the audited access-request flow.
      setDenied(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sm-shell sm-compliance">
      <aside className="sm-compliance__browser">
        <ComplianceBrowser selectedId={selected?.id ?? null} onSelect={(t) => void open(t)} />
      </aside>
      <section className="sm-thread sm-compliance__thread" aria-label="Compliance conversation">
        {!selected ? (
          <div className="sm-empty-state sm-compliance__empty"><ShieldCheck /><strong>Compliance browser</strong><span>Select a conversation to view its audited content. Access outside your participation is time-boxed and logged.</span></div>
        ) : (
          <>
            <header className="sm-thread-header">
              <div className="sm-thread-header__identity">
                <span className="sm-compliance__badge"><ShieldCheck /></span>
                <span><h2>{selected.subject || 'Conversation'}</h2><p>{selected.threadType} · read-only compliance view</p></span>
              </div>
              <nav aria-label="Compliance policy">
                <span className="sm-compliance__policy"><LockKeyhole />Audited access</span>
              </nav>
            </header>
            <div className="sm-message-list" aria-live="polite">
              {loading ? <div className="sm-loading"><span /><strong>Loading conversation...</strong></div> : null}
              {denied ? (
                <div className="sm-empty-state sm-compliance__denied">
                  <LockKeyhole />
                  <strong>Access is restricted</strong>
                  <span>You are not a participant. Request audited, time-boxed compliance access to read this conversation.</span>
                  <button type="button" onClick={() => setAccessOpen(true)}>Request access</button>
                </div>
              ) : null}
              {loaded?.messages.map((message) => (
                <ComplianceMessage key={message.id} message={message} author={loaded.authors.get(message.authorId)} />
              ))}
              {loaded && loaded.messages.length === 0 ? (
                <div className="sm-empty-state"><MessageSquareText /><strong>No messages</strong><span>This conversation has no readable content.</span></div>
              ) : null}
            </div>
            <footer className="sm-compliance__footer">
              <Users /> {selected.participantCount ?? '—'} participants · compliance retention · no replies from this view
            </footer>
          </>
        )}
        {selected ? (
          <AccessThreadDialog
            open={accessOpen}
            threadId={selected.id}
            onClose={() => setAccessOpen(false)}
            onGranted={() => { setAccessOpen(false); void open(selected); }}
          />
        ) : null}
      </section>
    </div>
  );
}

function ComplianceMessage({ message, author }: { message: Message; author?: User }) {
  const who: User = author ?? { id: message.authorId, name: message.authorId || 'System', title: '', avatarUrl: '', presence: 'offline' };
  if (message.deleted) return <article className="sm-message"><Avatar user={who} size="medium" /><div className="sm-message__main"><div className="sm-deleted-message">This message was deleted.</div></div></article>;
  return (
    <article className="sm-message">
      <Avatar user={who} size="medium" />
      <div className="sm-message__main">
        <header className="sm-message__meta"><strong>{who.name}</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></header>
        {message.body ? <div className="sm-bubble"><span><RichMessage html={message.html} /></span></div> : null}
        {message.attachments.map((attachment) => (
          <div key={attachment.id} className="sm-compliance__attachment">
            <span className={`sm-file-chip sm-file-chip--${attachment.kind}`}>{attachment.name.split('.').pop()?.toUpperCase()}</span>
            <span>{attachment.name}</span>
          </div>
        ))}
      </div>
    </article>
  );
}
