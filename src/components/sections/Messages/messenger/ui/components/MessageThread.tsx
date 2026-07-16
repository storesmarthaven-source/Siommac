// Ported from the bundle (ui/components/MessageThread.tsx). SIOMAC deltas:
//   • reactions + favourites + typing are hidden features — their controls and
//     indicators are removed (no dead buttons);
//   • the fixture's `author.id === "admin"` styling rule is replaced with the
//     real rule: the CURRENT USER'S messages are right-aligned in the accent
//     bubble (is-self + is-admin classes drive the ported CSS unchanged).
import {
  Archive, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Globe2, Info, LockKeyhole, MessageSquareText, MoreHorizontal, Pin, PinOff,
  Reply, Settings2, SmilePlus, Trash2, UserPlus, Users,
} from "./icons";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useMessaging } from "../../app/MessagingProvider";
import { messageById, messagesForThread, userById } from "../../app/selectors";
import type { Attachment, CollaborationCard, Message, Thread } from "../../domain/models";
import { formatTime } from "../../domain/format";
import { Avatar, GroupAvatarStack } from "./Avatar";
import { Composer } from "./Composer";
import { AttachmentCard, CollaborationRecordCard, LinkCard, attachmentIcon, cardIcon, cardModule, cardTone } from "./MessageCards";

const emojiOnly = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍\s]+$/u;
const documentKinds = new Set<Attachment["kind"]>(["pdf", "word", "excel", "powerpoint", "text"]);

export function MessageThread({ thread, onOpenDetails, onOpenAppearance, onInvite, onPreview, onActivity, onOpenCollaboration }: {
  thread: Thread;
  onOpenDetails(): void;
  onOpenAppearance(): void;
  onInvite(): void;
  onPreview(attachment: Attachment): void;
  onActivity(): void;
  onOpenCollaboration(card: CollaborationCard): void;
}) {
  const { snapshot, actions } = useMessaging();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [activePinIndex, setActivePinIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldStick = useRef(true);
  if (!snapshot) return null;
  const messages = messagesForThread(snapshot, thread.id);
  const currentUser = userById(snapshot, snapshot.currentUserId);
  const participants = thread.participantIds.map((id) => userById(snapshot, id));
  const counterpart = participants.find((participant) => participant.id !== currentUser.id) ?? currentUser;
  const pinned = messages.filter((message) => message.pinned && !message.deleted);
  const activePin = pinned.length ? pinned[activePinIndex % pinned.length] : undefined;
  const activePinAuthor = activePin ? userById(snapshot, activePin.authorId) : undefined;
  const activePinAttachment = activePin?.attachments[0];
  const activePinType = activePinAttachment?.kind.toUpperCase() ?? (activePin?.card ? "Record" : activePin?.link ? "Link" : "Message");
  const activePinTitle = activePin?.attachments[0]?.name ?? activePin?.card?.title ?? activePin?.link?.title ?? activePin?.body;
  const ActivePinIcon = activePinAttachment ? attachmentIcon(activePinAttachment.kind)
    : activePin?.card ? cardIcon[activePin.card.type]
    : activePin?.link ? Globe2 : MessageSquareText;
  const activePinTone = activePinAttachment ? activePinAttachment.kind
    : activePin?.card ? cardTone[activePin.card.type]
    : activePin?.link ? "link" : "message";
  const activePinHeader = activePinAttachment
    ? `Pinned ${activePinAttachment.kind.toUpperCase()} ${documentKinds.has(activePinAttachment.kind) ? "document" : "file"}`
    : activePin?.card ? `Pinned ${cardModule[activePin.card.type]}`
    : activePin?.link ? "Pinned link" : "Pinned message";

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const list = listRef.current;
    if (!list) return;
    if (typeof list.scrollTo === "function") list.scrollTo({ top: list.scrollHeight, behavior });
    else list.scrollTop = list.scrollHeight;
  }, []);

  useEffect(() => { void actions.markRead(thread.id); setReplyTo(null); requestAnimationFrame(() => scrollToBottom("auto")); }, [actions, scrollToBottom, thread.id]);
  useEffect(() => { void actions.markRead(thread.id); if (shouldStick.current) requestAnimationFrame(() => scrollToBottom()); }, [actions, messages.length, scrollToBottom, thread.id]);

  function jumpTo(messageId: string) {
    document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <section className="sm-thread" aria-label={`Conversation with ${thread.name}`}>
      <header className="sm-thread-header">
        <div className="sm-thread-header__identity">{thread.kind === "group" ? <GroupAvatarStack users={participants} variant="header" /> : <Avatar user={counterpart} size="large" showPresence />}<span><h2>{thread.name}</h2><p>{thread.kind === "group" ? `${participants.length} participants` : counterpart.presence}</p></span></div>
        <nav aria-label="Thread actions">
          {thread.kind === "group" ? <button className="sm-icon-button" type="button" aria-label="Invite participant" onClick={onInvite}><UserPlus /></button> : null}
          <button className="sm-icon-button" type="button" aria-label="Chat appearance" onClick={onOpenAppearance}><Settings2 /></button>
          <button className="sm-icon-button" type="button" aria-label={thread.queue === "archived" ? "Restore thread" : "Archive thread"} onClick={() => void actions.setArchived(thread.id, thread.queue !== "archived")}><Archive /></button>
          <button className="sm-icon-button" type="button" aria-label="Thread information" onClick={onOpenDetails}><Info /></button>
        </nav>
      </header>

      {activePin ? <section className={`sm-pinned-banner sm-pinned-banner--contextual sm-pinned-banner--${activePinTone} ${thread.complianceControlled ? "is-compliance" : ""}`} aria-label="Pinned item">
        <header className="sm-pinned-context__band">
          <span><ActivePinIcon />{activePinHeader}</span>
          <span><em>{(activePinIndex % pinned.length) + 1} of {pinned.length}</em><b>{activePinType}</b></span>
        </header>
        <div className="sm-pinned-context__body">
          <button className="sm-pinned-context__main" type="button" onClick={() => jumpTo(activePin.id)}>
            <strong>{activePinTitle}</strong>
            <small>{activePinAuthor?.name} · {formatTime(activePin.createdAt)}</small>
          </button>
          <aside className="sm-pinned-context__policy">
            <span><LockKeyhole />{thread.complianceControlled ? "Restricted visibility" : "Thread participants"}</span>
            <span><Archive />{thread.complianceControlled ? "Compliance retention" : "Standard retention"}</span>
          </aside>
          <div className="sm-pinned-context__controls">
            {pinned.length > 1 ? <><button className="sm-icon-button" type="button" aria-label="Previous pinned item" onClick={() => setActivePinIndex((value) => (value - 1 + pinned.length) % pinned.length)}><ChevronLeft /></button><button className="sm-icon-button" type="button" aria-label="Next pinned item" onClick={() => setActivePinIndex((value) => (value + 1) % pinned.length)}><ChevronRight /></button></> : null}
            <button className="sm-icon-button" type="button" aria-label="Unpin current item" onClick={() => void actions.togglePin(activePin.id)}><PinOff /></button>
          </div>
        </div>
      </section> : null}

      <div ref={listRef} className="sm-message-list" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; shouldStick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
        {messages.map((message) => message.system ? <SystemEvent key={message.id} message={message} /> : (
          <MessageRow key={message.id} message={message} currentUserId={currentUser.id} onReply={() => setReplyTo(message)} onPreview={onPreview} onActivity={onActivity} onOpenCollaboration={onOpenCollaboration} onJump={jumpTo} />
        ))}
      </div>

      {!shouldStick.current ? <button className="sm-scroll-latest" type="button" aria-label="Scroll to latest message" onClick={() => scrollToBottom()}><ChevronDown /></button> : null}
      <Composer threadId={thread.id} replyTo={replyTo} onClearReply={() => setReplyTo(null)} onSent={() => scrollToBottom()} />
    </section>
  );
}

function SystemEvent({ message }: { message: Message }) {
  return <div id={`message-${message.id}`} className={`sm-system-event sm-system-event--${message.system?.event ?? "joined"}`}><Users /><span>{message.body}</span></div>;
}

function MessageRow({ message, currentUserId, onReply, onPreview, onActivity, onOpenCollaboration, onJump }: {
  message: Message; currentUserId: string; onReply(): void; onPreview(attachment: Attachment): void; onActivity(): void; onOpenCollaboration(card: CollaborationCard): void; onJump(id: string): void;
}) {
  const { snapshot, actions } = useMessaging();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!snapshot) return null;
  const author = userById(snapshot, message.authorId);
  const isSelf = message.authorId === currentUserId;
  const replySource = message.replyToId ? messageById(snapshot, message.replyToId) : undefined;
  const canPin = Boolean(message.body.trim()) && !emojiOnly.test(message.body.trim()) || message.attachments.length > 0 || Boolean(message.card || message.link);
  const liked = message.reactions.some((reaction) => reaction.emoji === "👍" && reaction.userIds.includes(currentUserId));

  if (message.deleted) return <article id={`message-${message.id}`} className={`sm-message ${isSelf ? "is-self" : ""}`}><Avatar user={author} size="medium" /><div className="sm-message__main"><div className="sm-deleted-message">This message was deleted.</div></div></article>;

  return (
    <article id={`message-${message.id}`} className={`sm-message ${isSelf ? "is-self is-admin" : ""}`}>
      <Avatar user={author} size="medium" showPresence={!isSelf} />
      <div className="sm-message__main">
        <header className="sm-message__meta"><strong>{author.name}</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></header>
        {replySource ? <button className="sm-reply-reference" type="button" onClick={() => onJump(replySource.id)}><Reply /><span><strong>{userById(snapshot, replySource.authorId).name}</strong><em>{replySource.body || replySource.attachments[0]?.name}</em></span></button> : null}
        {message.body ? <div className="sm-bubble"><span><RichMessage html={message.html} /></span><MessageStatus message={message} /></div> : null}
        {message.attachments.map((attachment) => <AttachmentCard key={attachment.id} attachment={attachment} liked={liked} onPreview={() => onPreview(attachment)} onOpen={() => void actions.download(attachment)} onPin={() => void actions.togglePin(message.id)} onLike={() => void actions.toggleReaction(message.id, "👍")} />)}
        {message.link ? <LinkCard link={message.link} /> : null}
        {message.card ? <CollaborationRecordCard card={message.card} owner={userById(snapshot, message.card.ownerId)} collaborators={message.card.collaboratorIds.map((id) => userById(snapshot, id))} onOpen={() => onOpenCollaboration(message.card!)} onComment={onReply} onActivity={onActivity} onPin={() => void actions.togglePin(message.id)} /> : null}
        {message.reactions.length > 0 ? <div className="sm-reactions">{message.reactions.map((reaction) => <button type="button" key={reaction.emoji} title={`${reaction.userIds.length} reaction${reaction.userIds.length === 1 ? "" : "s"}`} onClick={() => void actions.toggleReaction(message.id, reaction.emoji)}>{reaction.emoji}<span>{reaction.userIds.length}</span></button>)}</div> : null}
        <div className="sm-message-actions" aria-label="Message actions">
          <button type="button" onClick={onReply}><Reply />Reply</button>
          <button type="button" disabled={!canPin} onClick={() => void actions.togglePin(message.id)}>{message.pinned ? <PinOff /> : <Pin />}{message.pinned ? "Unpin" : "Pin"}</button>
          <button type="button" onClick={() => void actions.toggleReaction(message.id, "👍")}><SmilePlus />{liked ? "Unlike" : "Like"}</button>
          {isSelf ? <div className="sm-message-menu"><button type="button" aria-label="More message actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal /></button>{menuOpen ? <div role="menu"><button type="button" role="menuitem" onClick={() => void actions.remove(message.id)}><Trash2 />Delete</button></div> : null}</div> : null}
        </div>
      </div>
    </article>
  );
}

function MessageStatus({ message }: { message: Message }) {
  if (message.delivery === "sending") return <span className="sm-delivery"><Check /></span>;
  if (message.delivery === "sent") return <span className="sm-delivery"><Check /></span>;
  return <span className={`sm-delivery ${message.delivery === "read" ? "is-read" : ""}`}><CheckCheck /></span>;
}

export function RichMessage({ html }: { html: string }) {
  const documentNode = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = documentNode.body.firstElementChild;
  return <>{root ? Array.from(root.childNodes).map((node, index) => renderRichNode(node, index)) : null}</>;
}

function renderRichNode(node: Node, key: number): ComponentChildren {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const children = Array.from(node.childNodes).map((child, index) => renderRichNode(child, index));
  if (node.tagName === "STRONG" || node.tagName === "B") return <strong key={key}>{children}</strong>;
  if (node.tagName === "EM" || node.tagName === "I") return <em key={key}>{children}</em>;
  if (node.tagName === "U") return <u key={key}>{children}</u>;
  if (node.tagName === "BR") return <br key={key} />;
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    return /^https?:\/\//i.test(href) ? <a key={key} href={href} target="_blank" rel="noreferrer">{children}</a> : children;
  }
  return children;
}
