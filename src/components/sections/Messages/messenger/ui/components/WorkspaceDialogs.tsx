// Ported from the bundle (ui/components/WorkspaceDialogs.tsx). SIOMAC deltas:
//   • invite/group candidates come from the REAL employee directory
//     (actions.listRecipients → /communications/messages/recipients) instead of
//     the fixture snapshot users;
//   • group creation carries a REQUIRED first message (createThread demands a
//     body or attachment — the form enforces it instead of faking one).
import { Activity, Check, CheckCircle2, Download, FileText, Search, UserPlus, Users } from "./icons";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useMessaging } from "../../app/MessagingProvider";
import { userById } from "../../app/selectors";
import { openAppSection } from "./MessageCards";
import type { ActivityEntry, Attachment, CollaborationCard, Thread, User } from "../../domain/models";
import { formatTime } from "../../domain/format";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";
import { notifyChatParticipantAdded, notifyGroupChatStarted } from "../../integration/messagingNotifications";

export function InviteDialog({ open, thread, onClose, onGroupCreated }: { open: boolean; thread: Thread; onClose: () => void; onGroupCreated: (thread: Thread) => void }) {
  const { snapshot, actions } = useMessaging();
  const [mode, setMode] = useState<"invite" | "group">("invite");
  const [name, setName] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [directory, setDirectory] = useState<User[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);

  useEffect(() => {
    if (!open) { setMode("invite"); setName(""); setFirstMessage(""); setQuery(""); setSelected([]); setCreating(false); setFormError(""); return; }
    setDirectoryLoading(true);
    actions.listRecipients()
      .then(setDirectory)
      .catch((cause: unknown) => setFormError(cause instanceof Error ? cause.message : "Unable to load the employee directory"))
      .finally(() => setDirectoryLoading(false));
  }, [actions, open]);

  const candidates = useMemo(() => directory.filter((user) => {
    const isEligible = mode === "group" ? true : !thread.participantIds.includes(user.id);
    return isEligible && user.name.toLowerCase().includes(query.toLowerCase());
  }), [directory, mode, query, thread.participantIds]);

  if (!snapshot) return null;
  const canCreate = name.trim().length >= 2 && selected.length >= 2 && firstMessage.trim().length > 0 && !creating;

  async function create() {
    if (!canCreate) return;
    setCreating(true);
    try {
      setFormError("");
      const createdThread = await actions.createGroup(name, selected, firstMessage.trim());
      onGroupCreated(createdThread); onClose();
      notifyGroupChatStarted(createdThread, createdThread.participantIds.length, { onOpen: () => onGroupCreated(createdThread) });
    }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : "Unable to create the group"); }
    finally { setCreating(false); }
  }

  return <Dialog open={open} title="Invite people" description="Add people to this conversation or start a group chat." icon={<UserPlus />} onClose={onClose} size="small">
    <div className="sm-invite-mode" role="tablist" aria-label="Invite options">
      <button type="button" role="tab" aria-selected={mode === "invite"} onClick={() => { setMode("invite"); setQuery(""); }}><UserPlus />Add to this chat</button>
      <button type="button" role="tab" aria-selected={mode === "group"} onClick={() => { setMode("group"); setQuery(""); }}><Users />Create group</button>
    </div>
    {mode === "invite" ? <>
      <label className="sm-dialog-search"><Search /><input type="search" value={query} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search employees..." /></label>
      {formError ? <p className="sm-group-error" role="alert">{formError}</p> : null}
      <div className="sm-invite-list">{directoryLoading ? <p className="sm-invite-empty">Loading employees...</p> : candidates.length ? candidates.map((user) => <button type="button" key={user.id} onClick={() => { void (async () => {
        try {
          await actions.invite(thread.id, user.id); onClose();
          notifyChatParticipantAdded({ ...thread, kind: "group", participantIds: [...thread.participantIds, user.id] }, user.name, { onOpen: onClose });
        } catch (cause) { setFormError(cause instanceof Error ? cause.message : "Unable to add the participant"); }
      })(); }}><Avatar user={user} size="medium" /><span><strong>{user.name}</strong><small>{user.title}</small></span><UserPlus /></button>) : <p className="sm-invite-empty">Everyone available is already in this conversation.</p>}</div>
    </> : <div className="sm-group-form">
      <label><span>Group name</span><input value={name} maxLength={80} placeholder="Enter group name" onInput={(event) => setName(event.currentTarget.value)} /></label>
      <label><span>First message</span><input value={firstMessage} maxLength={2000} placeholder="Start the conversation..." onInput={(event) => setFirstMessage(event.currentTarget.value)} /></label>
      <label className="sm-dialog-search"><Search /><input type="search" value={query} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search employees..." /></label>
      <div className="sm-group-selection" aria-live="polite"><strong>{selected.length} selected</strong><span>{selected.length < 2 ? "Select at least two participants" : firstMessage.trim() ? "Ready to create" : "Add a first message"}</span></div>
      {formError ? <p className="sm-group-error" role="alert">{formError}</p> : null}
      <div className="sm-invite-list sm-group-list">{directoryLoading ? <p className="sm-invite-empty">Loading employees...</p> : candidates.map((user) => {
        const isSelected = selected.includes(user.id);
        return <button className={isSelected ? "is-selected" : ""} type="button" key={user.id} aria-pressed={isSelected} onClick={() => setSelected((current) => isSelected ? current.filter((id) => id !== user.id) : [...current, user.id])}><Avatar user={user} size="medium" /><span><strong>{user.name}</strong><small>{user.title}</small></span>{isSelected ? <CheckCircle2 /> : <UserPlus />}</button>;
      })}</div>
      <footer className="sm-group-footer"><button type="button" onClick={onClose}>Cancel</button><button type="button" disabled={!canCreate} onClick={() => void create()}><Users />{creating ? "Creating..." : "Create group"}</button></footer>
    </div>}
  </Dialog>;
}

export function PreviewDialog({ attachment, onClose }: { attachment: Attachment | null; onClose: () => void }) {
  const { actions } = useMessaging();
  const preview = useMemo(() => {
    if (!attachment) return null;
    const url = attachment.previewUrl ?? attachment.url;
    if (!url) return <div className="sm-preview-unavailable"><FileText /><strong>Preview unavailable</strong><span>Download the file to inspect its contents.</span></div>;
    if (attachment.kind === "image") return <img className="sm-preview-image" src={url} alt={attachment.name} />;
    if (["pdf", "html", "css", "text"].includes(attachment.kind)) return <iframe className="sm-preview-frame" src={url} title={attachment.name} sandbox={attachment.kind === "html" ? "" : undefined} />;
    return <div className="sm-preview-unavailable"><FileText /><strong>{attachment.name}</strong><span>This file type opens in its registered application.</span></div>;
  }, [attachment]);
  return <Dialog open={Boolean(attachment)} title={attachment?.name ?? "File preview"} {...(attachment ? { description: `${attachment.kind.toUpperCase()} file` } : {})} icon={<FileText />} onClose={onClose} size="large"><div className="sm-preview">{preview}</div>{attachment ? <footer className="sm-dialog-footer"><button type="button" onClick={() => void actions.download(attachment)}><Download />Download</button></footer> : null}</Dialog>;
}

export function ActivityDialog({ open, thread, entries, onClose }: { open: boolean; thread: Thread; entries: ActivityEntry[]; onClose: () => void }) {
  const { snapshot } = useMessaging();
  if (!snapshot) return null;
  return <Dialog open={open} title="Thread activity" description={`Delivery, membership, and record activity for ${thread.name}.`} icon={<Activity />} onClose={onClose}>
    <ol className="sm-activity-list">{entries.length ? entries.map((entry) => { const actor = userById(snapshot, entry.actorId); return <li key={entry.id}><span><Check /></span><div><strong>{entry.description}</strong><small>{actor.name} · {formatTime(entry.createdAt)}</small></div></li>; }) : <li className="is-empty"><Activity /><div><strong>No recorded changes</strong><small>New thread activity will appear here.</small></div></li>}</ol>
  </Dialog>;
}

export function CollaborationDialog({ card, onClose }: { card: CollaborationCard | null; onClose: () => void }) {
  const { snapshot } = useMessaging();
  if (!snapshot) return null;
  const owner = card ? userById(snapshot, card.ownerId) : null;
  const collaborators = card ? card.collaboratorIds.map((id) => userById(snapshot, id)) : [];
  return <Dialog open={Boolean(card)} title={card?.title ?? "Collaboration record"} {...(card ? { description: card.subtitle } : {})} icon={<FileText />} onClose={onClose}>
    {card && owner ? <div className="sm-collaboration-dialog">
      <dl><div><dt>Status</dt><dd>{card.status}</dd></div><div><dt>Owner</dt><dd>{owner.name}</dd></div><div><dt>Related record</dt><dd>{card.record.type} / {card.record.id}</dd></div><div><dt>Updated</dt><dd>{formatTime(card.updatedAt)}</dd></div></dl>
      <section><h3>Collaborators</h3><div>{collaborators.map((user) => <span key={user.id}><Avatar user={user} size="medium" showPresence /><em><strong>{user.name}</strong><small>{user.title}</small></em></span>)}</div></section>
      <footer>{card.record.href
        ? <button type="button" onClick={() => { openAppSection(card.record.href); onClose(); }}><FileText />Open related record</button>
        : null}</footer>
    </div> : null}
  </Dialog>;
}
