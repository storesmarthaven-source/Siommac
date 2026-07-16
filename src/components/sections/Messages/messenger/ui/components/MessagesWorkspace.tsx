// Ported from the bundle (ui/components/MessagesWorkspace.tsx). SIOMAC deltas:
//   • the active thread defaults to the first visible thread (no fixture id)
//     and selecting a thread lazy-loads its messages via actions.selectThread;
//   • legacy MessageCenter parity: New Message (ComposeThreadDialog), the
//     permission-gated Compliance browser surface, and the shell deep-link
//     events (siomac:openThread / siomac:openRecord) from the header dropdown
//     and notification clicks;
//   • typing state is gone (hidden feature).
import { AlertCircle } from "./icons";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useCan } from "@lib/permissions";
import { ComposeThreadDialog } from "../../../ComposeThreadDialog";
import { useMessaging } from "../../app/MessagingProvider";
import type { ActivityEntry, Attachment, CollaborationCard, Queue, Thread } from "../../domain/models";
import { DetailsPanel } from "./DetailsPanel";
import { MessageThread } from "./MessageThread";
import { QueueHeader, ThreadSidebar, threadInQueue } from "./ThreadSidebar";
import { ComplianceView } from "./ComplianceView";
import { ActivityDialog, CollaborationDialog, InviteDialog, PreviewDialog } from "./WorkspaceDialogs";
import { AppearanceDialog } from "./AppearanceDialog";
import { notifyCollaborationStarted } from "../../integration/messagingNotifications";

export function MessagesWorkspace() {
  const { snapshot, loading, error, preferences, actions } = useMessaging();
  const [queue, setQueue] = useState<Queue>("inbox");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [detailsInfo, setDetailsInfo] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [collaboration, setCollaboration] = useState<CollaborationCard | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const canCompliance = useCan("communications.compliance_read");

  // Shell deep-links: the header dropdown and message notifications target a
  // specific thread. Record the request; it resolves once the snapshot has it.
  useEffect(() => {
    function onOpenThread(e: Event) {
      const { threadId } = (e as CustomEvent<{ threadId: string }>).detail;
      if (threadId) { setPendingThreadId(threadId); void actions.reload(); }
    }
    function onOpenRecord(e: Event) {
      const d = (e as CustomEvent<{ sourceType?: string; sourceId?: string }>).detail;
      if (d?.sourceType === "message_thread" && d.sourceId) { setPendingThreadId(d.sourceId); void actions.reload(); }
    }
    window.addEventListener("siomac:openThread", onOpenThread);
    window.addEventListener("siomac:openRecord", onOpenRecord);
    return () => {
      window.removeEventListener("siomac:openThread", onOpenThread);
      window.removeEventListener("siomac:openRecord", onOpenRecord);
    };
  }, [actions]);

  useEffect(() => {
    if (!pendingThreadId || !snapshot) return;
    const target = snapshot.threads.find((thread) => thread.id === pendingThreadId);
    if (target) {
      setQueue(target.queue === "archived" ? "archived" : "inbox");
      setActiveId(target.id);
      setPendingThreadId(null);
    }
  }, [pendingThreadId, snapshot]);

  const active = useMemo(() => {
    if (!snapshot || queue === "compliance") return undefined;
    return snapshot.threads.find((thread) => thread.id === activeId && threadInQueue(thread, queue))
      ?? snapshot.threads.find((thread) => thread.id === activeId)
      ?? snapshot.threads.find((thread) => threadInQueue(thread, queue))
      ?? snapshot.threads[0];
  }, [activeId, queue, snapshot]);

  // Lazy-load the active thread's messages whenever the selection resolves.
  useEffect(() => {
    if (active) void actions.selectThread(active.id);
  }, [actions, active?.id]);

  const messageGap = preferences.density === "compact" ? "28px" : preferences.density === "spacious" ? "46px" : "36px";
  const messageTextSize = preferences.messageTextSize === "large" ? "15.5px" : preferences.messageTextSize === "extra-large" ? "17px" : "14px";
  const surfaces = { white: "#ffffff", "soft-gray": "#f5f7fa", "cool-blue": "#f2f6fa" } as const;
  const appearanceStyle = `--sm-navy:${preferences.accent};--sm-admin-bubble:${preferences.accent};--sm-thread-bg:${surfaces[preferences.surface]};--sm-message-gap:${messageGap};--sm-message-font-size:${messageTextSize}`;

  if (loading) return <div className="sm-workspace"><div className="sm-loading"><span /><strong>Loading messages...</strong></div></div>;
  if (!snapshot) return <div className="sm-workspace"><div className="sm-error"><AlertCircle /><strong>Messages are unavailable</strong><span>{error ?? "No conversations were returned."}</span><button type="button" onClick={() => void actions.reload()}>Try again</button></div></div>;
  const readySnapshot = snapshot;

  function selectThread(thread: Thread) { setActiveId(thread.id); setDetailsInfo(false); }
  function selectQueue(nextQueue: Queue) {
    setQueue(nextQueue);
    if (nextQueue === "compliance") return;
    const nextThread = readySnapshot.threads.find((thread) => threadInQueue(thread, nextQueue));
    if (nextThread) selectThread(nextThread);
  }
  function jumpTo(messageId: string) { document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function openCollaboration(card: CollaborationCard) {
    setCollaboration(card);
    notifyCollaborationStarted(card, { onOpen: () => setCollaboration(card) });
  }

  const composeDialog = (
    <ComposeThreadDialog
      open={composeOpen}
      onClose={() => setComposeOpen(false)}
      onCreated={(threadId) => {
        setComposeOpen(false);
        setQueue("inbox");
        setPendingThreadId(threadId);
        void actions.reload();
      }}
    />
  );

  if (queue === "compliance" && canCompliance) {
    return <main className="sm-workspace" style={appearanceStyle}>
      <QueueHeader queue={queue} canCompliance={canCompliance} onQueue={selectQueue} onCompose={() => setComposeOpen(true)} />
      <ComplianceView />
      {composeDialog}
    </main>;
  }

  if (!active) {
    return <main className="sm-workspace" style={appearanceStyle}>
      <QueueHeader queue={queue} canCompliance={canCompliance} onQueue={selectQueue} onCompose={() => setComposeOpen(true)} />
      <div className="sm-error"><AlertCircle /><strong>No conversations yet</strong><span>Start a direct message, group conversation, or record-linked discussion.</span><button type="button" onClick={() => setComposeOpen(true)}>New Message</button></div>
      {composeDialog}
    </main>;
  }
  const activeThread = active;
  function openActivity() { setActivity(readySnapshot.activity.filter((entry) => entry.threadId === activeThread.id)); setActivityOpen(true); }

  return <main className="sm-workspace" style={appearanceStyle} data-high-contrast={preferences.highContrast || undefined} data-reduced-motion={preferences.reducedMotion || undefined} data-enhanced-focus={preferences.enhancedFocus || undefined}>
    <QueueHeader queue={queue} canCompliance={canCompliance} onQueue={selectQueue} onCompose={() => setComposeOpen(true)} />
    {error ? <div className="sm-error-banner" role="alert">{error}</div> : null}
    <div className="sm-shell">
      <ThreadSidebar activeThreadId={active.id} queue={queue} onSelect={selectThread} />
      <MessageThread thread={active} onOpenDetails={() => setDetailsInfo(true)} onOpenAppearance={() => setAppearanceOpen(true)} onInvite={() => setInviteOpen(true)} onPreview={setPreview} onActivity={openActivity} onOpenCollaboration={openCollaboration} />
      <DetailsPanel thread={active} infoOpen={detailsInfo} onCloseInfo={() => setDetailsInfo(false)} onInvite={() => setInviteOpen(true)} onPreview={setPreview} onJump={jumpTo} />
    </div>
    <InviteDialog open={inviteOpen} thread={active} onClose={() => setInviteOpen(false)} onGroupCreated={(thread) => { setQueue("inbox"); setActiveId(thread.id); }} />
    <PreviewDialog attachment={preview} onClose={() => setPreview(null)} />
    <ActivityDialog open={activityOpen} thread={active} entries={activity} onClose={() => setActivityOpen(false)} />
    <CollaborationDialog card={collaboration} onClose={() => setCollaboration(null)} />
    <AppearanceDialog open={appearanceOpen} value={preferences} onSave={actions.savePreferences} onClose={() => setAppearanceOpen(false)} />
    {composeDialog}
  </main>;
}
