// Ported from the bundle (ui/components/DetailsPanel.tsx). SIOMAC deltas:
//   • the fixture "Test as Maya / ?user=" identity-switch link is removed;
//   • participant subtitles come from the real participant role/title (the
//     fixture labelled participants[0] "Owner", which our data does not claim).
import {
  Activity, ArrowLeft, Bell, BellOff, Download, ExternalLink, FileText, Image,
  Info, Link2, MessageSquare, Paperclip, Pin, PinOff, UserMinus, UserPlus, Users, X,
} from "./icons";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useMessaging } from "../../app/MessagingProvider";
import { messagesForThread, userById } from "../../app/selectors";
import { openAppSection } from "./MessageCards";
import type { Attachment, Message, Thread } from "../../domain/models";
import { formatFileSize, formatTime } from "../../domain/format";
import { Avatar } from "./Avatar";

interface DetailsPanelProps {
  thread: Thread;
  infoOpen: boolean;
  onCloseInfo: () => void;
  onInvite: () => void;
  onPreview: (attachment: Attachment) => void;
  onJump: (messageId: string) => void;
}

export function DetailsPanel({ thread, infoOpen, onCloseInfo, onInvite, onPreview, onJump }: DetailsPanelProps) {
  const { snapshot, actions } = useMessaging();
  const [showAllFiles, setShowAllFiles] = useState(false);
  if (!snapshot) return null;

  const currentUser = userById(snapshot, snapshot.currentUserId);
  const participants = thread.participantIds
    .filter((id) => id !== currentUser.id)
    .map((id) => userById(snapshot, id));
  const messages = messagesForThread(snapshot, thread.id);
  const pinnedMessages = messages.filter((message) => message.pinned && !message.deleted && message.attachments.length === 0);
  const pinnedDocuments = messages.flatMap((message) => message.pinned
    ? message.attachments.map((attachment) => ({ message, attachment }))
    : []);
  const attachments = messages.flatMap((message) => message.attachments.map((attachment) => ({ message, attachment })));
  const images = attachments.filter(({ attachment }) => attachment.kind === "image");
  const liveMessages = messages.filter((message) => !message.deleted && !message.system);
  const collaborationCards = liveMessages.filter((message) => message.card);
  const links = liveMessages.filter((message) => message.link);
  const activitySummary = liveMessages.slice(-12).map((message) => ({
    id: `message-${message.id}`, createdAt: message.createdAt, actorId: message.authorId,
    description: message.attachments[0]?.name ?? message.card?.title ?? message.link?.title ?? message.body,
    kind: message.attachments.length ? "file" as const : message.card ? "record" as const : "message" as const,
  })).reverse();
  const visibleFiles = showAllFiles ? attachments : attachments.slice(0, 4);
  const createdDate = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" }).format(new Date(messages[0]?.createdAt ?? thread.lastActivityAt));

  return (
    <aside className={`sm-details-panel${infoOpen ? " is-info-open" : ""}`} data-theme-scope="adaptive">
      {infoOpen ? (
        <>
          <header className="sm-details-panel__takeover">
            <button className="sm-icon-button" type="button" aria-label="Back to conversation details" onClick={onCloseInfo}><ArrowLeft /></button>
            <span><strong>Thread information</strong><small>{thread.name}</small></span>
          </header>
          <PanelSection icon={<Info />} title="Conversation">
            <dl className="sm-info-list">
              <div><dt>Type</dt><dd>{thread.kind === "group" ? "Group chat" : "Direct message"}</dd></div>
              <div><dt>Created</dt><dd>{createdDate}</dd></div>
              <div><dt>Retention</dt><dd>{thread.complianceControlled ? "Compliance controlled" : "Standard policy"}</dd></div>
            </dl>
          </PanelSection>
          <PanelSection icon={<Activity />} title="Thread Summary">
            <div className="sm-thread-summary">
              <SummaryMetric icon={<MessageSquare />} value={liveMessages.length} label="Messages" />
              <SummaryMetric icon={<Paperclip />} value={attachments.length} label="Files" />
              <SummaryMetric icon={<Image />} value={images.length} label="Media" />
              <SummaryMetric icon={<Link2 />} value={links.length} label="Links" />
              <SummaryMetric icon={<FileText />} value={collaborationCards.length} label="Records" />
              <SummaryMetric icon={<Pin />} value={pinnedMessages.length + pinnedDocuments.length} label="Pinned" />
            </div>
          </PanelSection>
          <PanelSection icon={<Activity />} title="Recent Activity">
            <div className="sm-thread-activity">
              {activitySummary.map((entry) => <div key={entry.id}><span>{entry.kind === "file" ? <Paperclip /> : entry.kind === "record" ? <FileText /> : <MessageSquare />}</span><p><strong>{entry.description}</strong><small>{userById(snapshot, entry.actorId).name} · {formatTime(entry.createdAt)}</small></p></div>)}
              {activitySummary.length === 0 ? <p className="sm-panel-empty">No activity in this conversation yet.</p> : null}
            </div>
          </PanelSection>
          {thread.relatedRecord ? <RelatedRecordSection thread={thread} /> : null}
        </>
      ) : (
        <>
          <PanelSection icon={<Users />} title={`Participants · ${participants.length}`} action={thread.kind === "group" ? <button className="sm-panel-action sm-panel-action--invite" type="button" onClick={onInvite}><UserPlus />Invite</button> : undefined}>
            <div className="sm-participant-list">
              {participants.map((user) => (
                <div key={user.id}>
                  <Avatar user={user} size="small" showPresence />
                  <span><strong>{user.name}</strong><small>{user.title}</small></span>
                  <em className={`is-${user.presence}`}>{user.presence}</em>
                  {thread.kind === "group" ? <button className="sm-icon-button sm-remove-participant" type="button" aria-label={`Remove ${user.name}`} onClick={() => void actions.removeParticipant(thread.id, user.id)}><UserMinus /></button> : null}
                </div>
              ))}
            </div>
          </PanelSection>

          <div className="sm-mute-row">
            <span>{thread.muted ? <BellOff /> : <Bell />}<strong>Mute notifications</strong></span>
            <button className="sm-switch" type="button" role="switch" aria-checked={thread.muted} onClick={() => void actions.setMuted(thread.id, !thread.muted)}><i /></button>
          </div>

          <PanelSection icon={<Pin />} title="Pinned Messages">
            {pinnedMessages.length ? pinnedMessages.map((message) => (
              <PinnedMessage key={message.id} message={message} onJump={onJump} onUnpin={message.pinActions.includes("unpin") ? () => void actions.togglePin(message.id) : null} />
            )) : <p className="sm-panel-empty">No pinned messages.</p>}
          </PanelSection>

          <PanelSection icon={<FileText />} title="Pinned Documents">
            <div className="sm-pinned-documents">
              {pinnedDocuments.length ? pinnedDocuments.map(({ message, attachment }) => (
                <article key={attachment.id} className="sm-pinned-document">
                  <span className={`sm-file-chip sm-file-chip--${attachment.kind}`}>{fileLabel(attachment)}</span>
                  <span className="sm-pinned-document__copy"><strong>{attachment.name}</strong><small>{formatFileSize(attachment.sizeBytes)} · Pinned in this conversation</small></span>
                  <footer>
                    <button type="button" onClick={() => onPreview(attachment)}><Info />Preview</button>
                    <button type="button" onClick={() => void actions.download(attachment)}><Download />Download</button>
                    <button type="button" onClick={() => void actions.togglePin(message.id)}><PinOff />Unpin</button>
                  </footer>
                </article>
              )) : <p className="sm-panel-empty">No pinned documents.</p>}
            </div>
          </PanelSection>

          {images.length ? <PanelSection icon={<Image />} title="Shared Media"><div className="sm-media-grid">{images.slice(0, 6).map(({ attachment }) => <button type="button" key={attachment.id} onClick={() => onPreview(attachment)}><img src={attachment.previewUrl ?? attachment.url} alt={attachment.name} /></button>)}</div></PanelSection> : null}

          <PanelSection icon={<FileText />} title="Files">
            <div className="sm-sidebar-files">{visibleFiles.map(({ attachment }) => <button type="button" key={attachment.id} onClick={() => onPreview(attachment)}><span className={`sm-file-chip sm-file-chip--${attachment.kind}`}>{fileLabel(attachment)}</span><span><strong>{attachment.name}</strong><small>{formatFileSize(attachment.sizeBytes)}</small></span><ExternalLink /></button>)}</div>
            {attachments.length > 4 ? <button className="sm-files-toggle" type="button" onClick={() => setShowAllFiles((value) => !value)}>{showAllFiles ? "Show fewer files" : `Show all ${attachments.length} files`}</button> : null}
            {attachments.length === 0 ? <p className="sm-panel-empty">No files shared yet.</p> : null}
          </PanelSection>
          {thread.relatedRecord ? <RelatedRecordSection thread={thread} /> : null}
        </>
      )}
    </aside>
  );
}

function SummaryMetric({ icon, value, label }: { icon: ComponentChildren; value: number; label: string }) {
  return <div><span>{icon}</span><p><strong>{label}</strong><small>{value} {value === 1 ? "item" : "items"}</small></p></div>;
}

function PinnedMessage({ message, onJump, onUnpin }: { message: Message; onJump: (messageId: string) => void; onUnpin: (() => void) | null }) {
  // onUnpin null = the caller lacks the capability (pinned by someone else,
  // not thread owner) — no dead control is rendered.
  return <article className="sm-pinned-item"><button type="button" onClick={() => onJump(message.id)}><strong>Pinned message</strong><span>{message.body}</span></button>{onUnpin ? <button className="sm-icon-button" type="button" aria-label="Unpin message" onClick={onUnpin}><X /></button> : null}</article>;
}

function RelatedRecordSection({ thread }: { thread: Thread }) {
  const record = thread.relatedRecord;
  if (!record) return null;
  // Drill-through via the app's section navigation (record.href is a section
  // id, not a URL); no resolver → informational display, no dead link.
  const body = <><small>{record.type} · {record.id}{record.status ? ` · ${record.status}` : ''}</small><strong>{record.title}</strong>{record.href ? <ExternalLink /> : null}</>;
  return <PanelSection icon={<ExternalLink />} title="Related Record">
    {record.href
      ? <button type="button" className="sm-related-record" onClick={() => openAppSection(record.href)}>{body}</button>
      : <span className="sm-related-record">{body}</span>}
  </PanelSection>;
}

function fileLabel(attachment: Attachment): string {
  return attachment.name.split(".").pop()?.toUpperCase() ?? attachment.kind.toUpperCase();
}

function PanelSection({ icon, title, action, children }: { icon: ComponentChildren; title: string; action?: ComponentChildren; children: ComponentChildren }) {
  return <section className="sm-panel-section"><header><span>{icon}<strong>{title}</strong></span>{action}</header>{children}</section>;
}
