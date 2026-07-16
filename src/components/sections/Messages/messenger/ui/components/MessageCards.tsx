// Ported from the bundle (ui/components/MessageCards.tsx). The reaction "Like"
// action is live (reactions slice — mig 20260919000363).
import {
  Activity, AudioLines, Clock3, Copy, ExternalLink, Eye, File, FileArchive, FileCode2,
  FileImage, FileJson, FileSpreadsheet, FileText, FolderOpen, Heart, Presentation,
  ArrowUpRight, Globe2, MessageCircle, Pin, ShieldCheck, Users,
} from "./icons";
import type { Attachment, CollaborationCard, LinkPreview, User } from "../../domain/models";
import { formatFileSize, formatTime } from "../../domain/format";
import { Avatar } from "./Avatar";

export function attachmentIcon(kind: Attachment["kind"]) {
  return kind === "zip" ? FileArchive
    : kind === "excel" ? FileSpreadsheet
    : kind === "powerpoint" ? Presentation
    : kind === "image" ? FileImage
    : kind === "audio" ? AudioLines
    : kind === "json" ? FileJson
    : ["html", "css"].includes(kind) ? FileCode2
    : ["pdf", "word", "text"].includes(kind) ? FileText : File;
}

function FileGlyph({ attachment }: { attachment: Attachment }) {
  const Icon = attachmentIcon(attachment.kind);
  return <span className={`sm-file-glyph sm-file-glyph--${attachment.kind}`}><Icon /><b>{attachment.kind.toUpperCase()}</b></span>;
}

type AttachmentCardProps =
  | { attachment: Attachment; interactive?: true; liked: boolean; onPreview(): void; onOpen(): void; onPin(): void; onLike(): void }
  | { attachment: Attachment; interactive: false };

export function AttachmentCard(props: AttachmentCardProps) {
  const { attachment } = props;
  const available = attachment.transferState === "available";
  return (
    <article className="sm-attachment-card">
      <FileGlyph attachment={attachment} />
      <div className="sm-attachment-card__content">
        <strong title={attachment.name}>{attachment.name}</strong>
        <span><FileText />{formatFileSize(attachment.sizeBytes)}</span>
        {attachment.transferState !== "available" ? (
          <div className="sm-progress" aria-label={`Uploading ${attachment.progress}%`}>
            <span><i style={{ width: `${attachment.progress}%` }} /></span><em>{attachment.progress}%</em>
          </div>
        ) : <span><Clock3 />Updated {formatTime(new Date().toISOString())}</span>}
      </div>
      {props.interactive !== false ? <div className="sm-card-actions" aria-label={`${attachment.name} actions`}>
        <button type="button" disabled={!available} onClick={props.onPreview}><Eye />Preview</button>
        <button type="button" disabled={!available} onClick={props.onOpen}><FolderOpen />Open</button>
        <button type="button" disabled={!available} onClick={props.onPin}><Pin />Pin</button>
        <button type="button" disabled={!available} className={props.liked ? "is-active" : ""} onClick={props.onLike}><Heart />{props.liked ? "Liked" : "Like"}</button>
      </div> : null}
    </article>
  );
}

export function LinkCard({ link }: { link: LinkPreview }) {
  return (
    <article className="sm-link-card">
      <span className="sm-link-card__icon"><Globe2 /></span>
      <div className="sm-link-card__copy"><small>{link.hostname}</small><strong>{link.title}</strong><p>{link.description}</p><a href={link.url} target="_blank" rel="noreferrer">{link.url}</a></div>
      <span className="sm-link-card__actions">
        <button type="button" onClick={() => void navigator.clipboard.writeText(link.url)}><Copy />Copy</button>
        <a href={link.url} target="_blank" rel="noreferrer"><ArrowUpRight />Open</a>
      </span>
    </article>
  );
}

export const cardTone: Record<CollaborationCard["type"], string> = {
  worksheet: "green", capa: "violet", "incident-report": "red", "controlled-document": "blue",
  "evidence-bundle": "amber", permit: "teal",
};

export const cardIcon: Record<CollaborationCard["type"], typeof FileSpreadsheet> = {
  worksheet: FileSpreadsheet, capa: ShieldCheck, "incident-report": FileText,
  "controlled-document": FileText, "evidence-bundle": FileArchive, permit: ShieldCheck,
};

export const cardModule: Record<CollaborationCard["type"], string> = {
  worksheet: "HSE Collaboration", capa: "CAPA Collaboration", "incident-report": "Incident Collaboration",
  "controlled-document": "Document Collaboration", "evidence-bundle": "Evidence Collaboration", permit: "Permit Collaboration",
};

export function CollaborationRecordCard({ card, owner, collaborators, onOpen, onComment, onActivity, onPin }: {
  card: CollaborationCard;
  owner: User;
  collaborators: User[];
  onOpen(): void;
  onComment(): void;
  onActivity(): void;
  onPin(): void;
}) {
  const tone = cardTone[card.type];
  const CardIcon = cardIcon[card.type];
  return (
    <article className={`sm-record-card sm-record-card--${tone}`}>
      <div className="sm-record-card__module"><span><CardIcon />{cardModule[card.type]}</span><b>Shared</b></div>
      <div className="sm-record-card__body">
        <header className="sm-record-card__header">
          <span className="sm-record-card__icon"><CardIcon /></span>
          <span><strong>{card.title}</strong><small>{card.subtitle}</small></span>
        </header>
        <dl className="sm-record-card__details">
          <div><dt>Related record</dt><dd><a href={card.record.href}>{card.record.type} · {card.record.id}</a></dd></div>
          <div><dt>Status</dt><dd><span className="sm-status-pill">{card.status}</span></dd></div>
          <div><dt>Owner</dt><dd>{owner.name}</dd></div>
          <div><dt>Updated</dt><dd>{formatTime(card.updatedAt)}</dd></div>
        </dl>
        <div className="sm-record-card__collaborators"><span><Users />Collaborators</span><span className="sm-avatar-stack">{collaborators.slice(0, 4).map((user) => <Avatar key={user.id} user={user} size="small" />)}</span><em>{collaborators.length} collaborators</em></div>
      </div>
      <footer className="sm-record-card__actions">
        <button type="button" onClick={onOpen}><ExternalLink />Open</button>
        <button type="button" onClick={onComment}><MessageCircle />Comment</button>
        <button type="button" onClick={onActivity}><Activity />View activity</button>
        <button type="button" onClick={onPin}><Pin />Pin</button>
      </footer>
    </article>
  );
}
