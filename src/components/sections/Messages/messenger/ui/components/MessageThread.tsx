// Ported from the bundle (ui/components/MessageThread.tsx). SIOMAC deltas:
//   • reactions + favourites + typing are hidden features — their controls and
//     indicators are removed (no dead buttons);
//   • the fixture's `author.id === "admin"` styling rule is replaced with the
//     real rule: the CURRENT USER'S messages are right-aligned in the accent
//     bubble (is-self + is-admin classes drive the ported CSS unchanged).
import {
  Archive, ArchiveRestore, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Globe2, Info, LockKeyhole, MessageSquareText, MoreHorizontal, Pin, PinOff,
  Reply, Settings2, ShieldCheck, SmilePlus, Star, Trash2, UserPlus, Users,
} from "./icons";
import { renderRichHtml } from "@lib/richText";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useMessaging } from "../../app/MessagingProvider";
import { messageById, messagesForThread, userById } from "../../app/selectors";
import type { Attachment, CollaborationCard, Message, Thread } from "../../domain/models";
import { formatTime } from "../../domain/format";
import { Avatar, GroupAvatarStack } from "./Avatar";
import { Composer } from "./Composer";
import { AttachmentCard, CollaborationRecordCard, LinkCard, attachmentIcon, cardIcon, cardModule, cardTone, cardTypeFor } from "./MessageCards";

const emojiOnly = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍\s]+$/u;
const documentKinds = new Set<Attachment["kind"]>(["pdf", "word", "excel", "powerpoint", "text"]);

/**
 * The thread's identity + actions header. Rendered by MessagesWorkspace as a
 * PORTAL into the pill's footer band (the chrome row above the shell) — NOT
 * inside the thread column. Context flows through portals, so useMessaging
 * works here.
 */
export function ThreadHeader({ thread, onOpenDetails, onOpenAppearance, onInvite, canCompliance, onCompliance }: {
  thread: Thread;
  onOpenDetails: () => void;
  onOpenAppearance: () => void;
  onInvite: () => void;
  canCompliance?: boolean;
  onCompliance?: () => void;
}) {
  const { snapshot, actions } = useMessaging();
  if (!snapshot) return null;
  const currentUser = userById(snapshot, snapshot.currentUserId);
  const participants = thread.participantIds.map((id) => userById(snapshot, id));
  const counterpart = participants.find((participant) => participant.id !== currentUser.id) ?? currentUser;
  return (
    <header className="sm-thread-header">
      <div className="sm-thread-header__identity">{thread.kind === "group" ? <GroupAvatarStack users={participants} variant="header" /> : <Avatar user={counterpart} size="medium" showPresence />}<span><h2>{thread.name}</h2><p>{thread.kind === "group" ? `${participants.length} participants` : counterpart.presence}</p></span></div>
      <nav aria-label="Thread actions">
        <button className={`sm-icon-button ${thread.favourite ? "is-favourite" : ""}`} type="button" title={thread.favourite ? "Remove from favourites" : "Add to favourites"} aria-label={thread.favourite ? "Remove from favourites" : "Add to favourites"} onClick={() => void actions.setFavourite(thread.id, !thread.favourite)}><Star /></button>
        {thread.kind === "group" ? <button className="sm-icon-button" type="button" title="Invite participant" aria-label="Invite participant" onClick={onInvite}><UserPlus /></button> : null}
        <button className="sm-icon-button" type="button" title="Chat appearance" aria-label="Chat appearance" onClick={onOpenAppearance}><Settings2 /></button>
        {/* Archived threads get a DISTINCT restore glyph — one icon for two
            opposite actions made unarchiving undiscoverable. */}
        <button className="sm-icon-button" type="button" title={thread.queue === "archived" ? "Restore to Inbox" : "Archive thread"} aria-label={thread.queue === "archived" ? "Restore to Inbox" : "Archive thread"} onClick={() => void actions.setArchived(thread.id, thread.queue !== "archived")}>{thread.queue === "archived" ? <ArchiveRestore /> : <Archive />}</button>
        <button className="sm-icon-button" type="button" title="Thread information" aria-label="Thread information" onClick={onOpenDetails}><Info /></button>
        {/* Compliance is a workspace mode switch (not a thread action) — set
            apart at the end of the row by a hairline separator, permission-gated. */}
        {canCompliance && onCompliance ? <button className="sm-icon-button sm-thread-header__compliance" type="button" title="Compliance" aria-label="Compliance" onClick={onCompliance}><ShieldCheck /></button> : null}
      </nav>
    </header>
  );
}

export function MessageThread({ thread, onPreview, onActivity, onOpenCollaboration }: {
  thread: Thread;
  onPreview: (attachment: Attachment) => void;
  onActivity: () => void;
  onOpenCollaboration: (card: CollaborationCard) => void;
}) {
  const { snapshot, actions, typingByThread, hasOlderByThread, loadingThreadIds } = useMessaging();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [activePinIndex, setActivePinIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldStickRef = useRef(true);
  // Render mirror of shouldStickRef (refs must not be read during render); only
  // updated when the threshold flips, so scrolling doesn't re-render per event.
  const [atBottom, setAtBottom] = useState(true);
  // Hooks below must run on EVERY render (no early return above them) — an
  // early bail here changes the hook count between renders and corrupts state.
  const messages = snapshot ? messagesForThread(snapshot, thread.id) : [];

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const list = listRef.current;
    if (!list) return;
    if (typeof list.scrollTo === "function") list.scrollTo({ top: list.scrollHeight, behavior });
    else list.scrollTop = list.scrollHeight;
  }, []);

  // Which thread the list is currently anchored for.
  const anchoredThreadRef = useRef<string | null>(null);
  const listInnerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setReplyTo(null); shouldStickRef.current = true; setAtBottom(true); }, [thread.id]);

  // markRead fires ONLY while unread incoming messages exist AND the reader can
  // actually see them (tab visible + window focused). Own sends bump
  // messages.length but never unreadCount, so they no longer trigger the call;
  // a backgrounded tab keeps its badge honest until the user returns — the
  // focus/visibility listeners catch up the moment they do.
  const unreadCount = thread.unreadCount;
  useEffect(() => {
    if (unreadCount === 0) return;
    const markIfVisible = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) void actions.markRead(thread.id);
    };
    markIfVisible();
    window.addEventListener("focus", markIfVisible);
    document.addEventListener("visibilitychange", markIfVisible);
    return () => { window.removeEventListener("focus", markIfVisible); document.removeEventListener("visibilitychange", markIfVisible); };
  }, [actions, thread.id, unreadCount]);

  // Anchor BEFORE paint on thread switch so no intermediate frame shows the top.
  useLayoutEffect(() => {
    if (!messages.length) return;
    if (anchoredThreadRef.current !== thread.id) {
      anchoredThreadRef.current = thread.id;
      scrollToBottom("instant");
    }
  }, [messages.length, scrollToBottom, thread.id]);

  // The LOAD-BEARING anchor: while the reader is at the bottom, ANY content
  // growth re-pins the newest message instantly — the preview→full-history
  // jump, image/attachment sizing, fonts, and new messages all arrive AFTER
  // the one-shot mount scroll, which is exactly how the list used to end up
  // parked at the top. A chat opens at the bottom and stays there; scrolling
  // up to read (shouldStickRef=false) is always respected.
  // Keyed on snapshot-presence, NOT mount: on a cold load this component's
  // first render is null (no snapshot yet), so a mount-only effect grabbed
  // null refs, bailed, and never retried — the anchor was dead for the first
  // thread until a switch remounted the refs.
  const domReady = snapshot ? 1 : 0;
  useEffect(() => {
    const list = listRef.current;
    const inner = listInnerRef.current;
    if (!list || !inner) return;
    const ro = new ResizeObserver(() => {
      // scrollTo with explicit "instant" — a bare scrollTop assignment (and
      // behavior "auto") obey the list's scroll-behavior:smooth CSS and glide.
      if (shouldStickRef.current) list.scrollTo({ top: list.scrollHeight, behavior: "instant" });
    });
    ro.observe(inner);
    return () => { ro.disconnect(); };
  }, [domReady]);

  if (!snapshot) return null;
  const currentUser = userById(snapshot, snapshot.currentUserId);
  const typingNames = (typingByThread.get(thread.id) ?? []).map((id) => userById(snapshot, id).name);
  // Record threads render a live collaboration card built from the resolved
  // source record (real ref/status; owner = thread creator; drill-through via
  // the app's section navigation).
  const recordCard: CollaborationCard | null = thread.relatedRecord ? {
    id: `record-${thread.id}`,
    type: cardTypeFor(thread.relatedRecord.type),
    title: thread.relatedRecord.title,
    subtitle: thread.relatedRecord.id,
    status: thread.relatedRecord.status ?? "—",
    ownerId: thread.createdBy ?? thread.participantIds[0] ?? currentUser.id,
    collaboratorIds: thread.participantIds,
    record: thread.relatedRecord,
    updatedAt: thread.lastActivityAt,
  } : null;
  const pinned = messages.filter((message) => message.pinned && !message.deleted);
  const activePin = pinned.length ? pinned[activePinIndex % pinned.length] : undefined;
  const activePinAuthor = activePin ? userById(snapshot, activePin.authorId) : undefined;
  const activePinAttachment = activePin?.attachments[0];
  const activePinType = activePinAttachment?.kind.toUpperCase() ?? (activePin?.card ? "Record" : activePin?.link ? "Link" : "Message");
  const activePinTitle = activePin?.attachments[0]?.name ?? activePin?.card?.title ?? activePin?.link?.title ?? activePin?.body;
  // eslint-disable-next-line react-hooks/static-components -- lookup of statically-defined icon components, not a new component per render
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

  function handleListScroll(event: Event) {
    const element = event.currentTarget as HTMLDivElement;
    const stick = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
    shouldStickRef.current = stick;
    setAtBottom(stick);
  }

  function jumpTo(messageId: string) {
    document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <section className="sm-thread" aria-label={`Conversation with ${thread.name}`}>
      {activePin ? <section className={`sm-pinned-banner sm-pinned-banner--contextual sm-pinned-banner--${activePinTone} ${thread.complianceControlled ? "is-compliance" : ""}`} aria-label="Pinned item">
        <header className="sm-pinned-context__band">
          {/* eslint-disable-next-line react-hooks/static-components -- ActivePinIcon is a lookup of statically-defined components */}
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
            {activePin.pinActions.includes("unpin") ? <button className="sm-icon-button" type="button" title="Unpin" aria-label="Unpin current item" onClick={() => void actions.togglePin(activePin.id)}><PinOff /></button> : null}
          </div>
        </div>
      </section> : null}

      {/* Relative wrapper occupying the list's grid row: the scroll-to-latest
          chevron anchors to ITS bottom edge, so it always floats just above the
          composer no matter how tall the composer grows (reply chip,
          attachments) — no hardcoded offset. */}
      <div className="sm-thread__scroller">
      <div ref={listRef} className="sm-message-list" aria-live="polite" onScroll={handleListScroll}>
        {/* Single content wrapper = the ResizeObserver target that keeps the
            list pinned to the newest message through async growth. */}
        <div ref={listInnerRef} className="sm-message-list__inner">
          {loadingThreadIds.has(thread.id) && messages.length === 0 ? (
            <div className="sm-loading sm-thread-loading" role="status">
              <span aria-hidden="true" /><strong>Loading conversation...</strong>
            </div>
          ) : null}
          {hasOlderByThread.get(thread.id) ? (
            <button
              className="sm-load-older" type="button" disabled={loadingOlder}
              onClick={() => {
                // Prepending grows the list ABOVE the viewport — hold the
                // reader's position by restoring the scroll delta after paint.
                const list = listRef.current;
                const prevHeight = list?.scrollHeight ?? 0;
                const prevTop = list?.scrollTop ?? 0;
                setLoadingOlder(true);
                void actions.loadOlderMessages(thread.id)
                  .catch(() => { /* provider surfaces errors via toast upstream */ })
                  .finally(() => {
                    setLoadingOlder(false);
                    requestAnimationFrame(() => {
                      if (list) list.scrollTo({ top: prevTop + (list.scrollHeight - prevHeight), behavior: "instant" });
                    });
                  });
              }}
            >{loadingOlder ? "Loading..." : "Load earlier messages"}</button>
          ) : null}
          {recordCard ? (
            <CollaborationRecordCard
              card={recordCard}
              owner={userById(snapshot, recordCard.ownerId)}
              collaborators={recordCard.collaboratorIds.map((id) => userById(snapshot, id))}
              onOpen={() => onOpenCollaboration(recordCard)}
              onActivity={onActivity}
            />
          ) : null}
          {messages.map((message) => message.system
            ? <SystemEvent key={message.clientKey ?? message.id} message={message} />
            : message.isInternal
              ? <InternalNote key={message.clientKey ?? message.id} message={message} />
              : (
                <MessageRow key={message.clientKey ?? message.id} message={message} currentUserId={currentUser.id} onReply={() => setReplyTo(message)} onPreview={onPreview} onActivity={onActivity} onOpenCollaboration={onOpenCollaboration} onJump={jumpTo} />
              ))}
        </div>
      </div>
      {!atBottom ? <button className="sm-scroll-latest" type="button" aria-label="Scroll to latest message" onClick={() => scrollToBottom()}><ChevronDown /></button> : null}
      </div>

      {typingNames.length ? (
        <div className="sm-typing-indicator" aria-live="polite">
          <span className="sm-typing-dots" aria-hidden="true"><i /><i /><i /></span>
          {typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.join(", ")} are typing…`}
        </div>
      ) : null}
      <Composer threadId={thread.id} replyTo={replyTo} onClearReply={() => setReplyTo(null)} onRestoreReply={setReplyTo} onSent={() => scrollToBottom()} />
    </section>
  );
}

function SystemEvent({ message }: { message: Message }) {
  return <div id={`message-${message.id}`} className={`sm-system-event sm-system-event--${message.system?.event ?? "joined"}`}><Users /><span>{message.body}</span></div>;
}

// Author-only internal note — amber block, rendered inline with messages. Carries
// NO delivery status, reactions, reply, pin, or forward controls.
function InternalNote({ message }: { message: Message }) {
  const { snapshot } = useMessaging();
  if (!snapshot) return null;
  const author = userById(snapshot, message.authorId);
  return (
    <article id={`message-${message.id}`} className="sm-message is-self sm-message--note">
      <Avatar user={author} size="medium" />
      <div className="sm-message__main">
        <header className="sm-message__meta sm-message__meta--note"><LockKeyhole /><strong>Internal note · Only you can see this.</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></header>
        <div className="sm-bubble sm-bubble--note"><span><RichMessage html={message.html || message.body} /></span></div>
      </div>
    </article>
  );
}

function MessageRow({ message, currentUserId, onReply, onPreview, onActivity, onOpenCollaboration, onJump }: {
  message: Message; currentUserId: string; onReply: () => void; onPreview: (attachment: Attachment) => void; onActivity: () => void; onOpenCollaboration: (card: CollaborationCard) => void; onJump: (id: string) => void;
}) {
  const { snapshot, actions } = useMessaging();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!snapshot) return null;
  const author = userById(snapshot, message.authorId);
  const isSelf = message.authorId === currentUserId;
  const replySource = message.replyToId ? messageById(snapshot, message.replyToId) : undefined;
  const pinnable = (Boolean(message.body.trim()) && !emojiOnly.test(message.body.trim())) || message.attachments.length > 0 || Boolean(message.card ?? message.link);
  // Server-derived capability: which pin command (if any) this user may run.
  const pinAction = message.pinActions.includes("unpin") ? "unpin" as const
    : message.pinActions.includes("pin") && pinnable ? "pin" as const
    : null;
  const liked = message.reactions.some((reaction) => reaction.emoji === "👍" && reaction.userIds.includes(currentUserId));

  if (message.deleted) return <article id={`message-${message.id}`} className={`sm-message ${isSelf ? "is-self" : ""}`}><Avatar user={author} size="medium" /><div className="sm-message__main"><div className="sm-deleted-message">This message was deleted.</div></div></article>;

  return (
    <article id={`message-${message.id}`} className={`sm-message ${isSelf ? "is-self is-admin" : ""}`}>
      <Avatar user={author} size="medium" showPresence={!isSelf} />
      <div className="sm-message__main">
        <header className="sm-message__meta"><strong>{author.name}</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></header>
        {replySource ? <button className="sm-reply-reference" type="button" onClick={() => onJump(replySource.id)}><Reply /><span><strong>{userById(snapshot, replySource.authorId).name}</strong><em>{replySource.body || replySource.attachments[0]?.name}</em></span></button> : null}
        {message.body ? <div className="sm-bubble"><span><RichMessage html={message.html} /></span></div> : null}
        {message.attachments.map((attachment) => <AttachmentCard key={attachment.id} attachment={attachment} liked={liked} onPreview={() => onPreview(attachment)} onOpen={() => void actions.download(attachment)} onPin={() => void actions.togglePin(message.id)} onLike={() => void actions.toggleReaction(message.id, "👍")} />)}
        {message.link ? <LinkCard link={message.link} /> : null}
        {message.card ? <CollaborationRecordCard card={message.card} owner={userById(snapshot, message.card.ownerId)} collaborators={message.card.collaboratorIds.map((id) => userById(snapshot, id))} onOpen={() => onOpenCollaboration(message.card!)} onComment={onReply} onActivity={onActivity} onPin={() => void actions.togglePin(message.id)} /> : null}
        {message.reactions.length > 0 ? <div className="sm-reactions">{message.reactions.map((reaction) => <button type="button" key={reaction.emoji} title={`${reaction.userIds.length} reaction${reaction.userIds.length === 1 ? "" : "s"}`} onClick={() => void actions.toggleReaction(message.id, reaction.emoji)}>{reaction.emoji}<span>{reaction.userIds.length}</span></button>)}</div> : null}
        {/* Sender-only receipt row — shown for EVERY outgoing message (text, attachment, link, or card), so an attachment-only message still gets a read state. */}
        {isSelf ? <div className="sm-message__receipt"><MessageStatus message={message} /></div> : null}
        <div className="sm-message-actions" aria-label="Message actions">
          <button type="button" onClick={onReply}><Reply />Reply</button>
          {pinAction ? <button type="button" onClick={() => void actions.togglePin(message.id)}>{pinAction === "unpin" ? <PinOff /> : <Pin />}{pinAction === "unpin" ? "Unpin" : "Pin"}</button> : null}
          <button type="button" onClick={() => void actions.toggleReaction(message.id, "👍")}><SmilePlus />{liked ? "Unlike" : "Like"}</button>
          {isSelf ? <div className="sm-message-menu"><button type="button" aria-label="More message actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal /></button>{menuOpen ? <div role="menu"><button type="button" role="menuitem" onClick={() => void actions.remove(message.id)}><Trash2 />Delete</button></div> : null}</div> : null}
        </div>
      </div>
    </article>
  );
}

// Sender-only receipt. A real read (readByCount > 0, from message_post_receipts)
// wins over the delivery state; otherwise fall back to sending/delivered/sent.
export function MessageStatus({ message }: { message: Message }) {
  if (message.delivery === "sending") return <span className="sm-delivery" title="Sending"><Check /></span>;
  if (message.readByCount > 0) {
    return (
      <span className="sm-delivery is-read" title={`Read by ${message.readByCount}`}>
        <CheckCheck /><em>{message.readByCount === 1 ? "Read" : `Read by ${message.readByCount}`}</em>
      </span>
    );
  }
  if (message.delivery === "delivered" || message.delivery === "read") return <span className="sm-delivery" title="Delivered"><CheckCheck /></span>;
  return <span className="sm-delivery" title="Sent"><Check /></span>;
}

// Render the sanitized rich-text body (inline marks, links, headings, lists,
// alignment) via the shared renderer — same subset the composer produces and
// the Ticket Center uses. The renderer re-sanitizes, so a stored body is safe.
export function RichMessage({ html }: { html: string }) {
  return renderRichHtml(html);
}
