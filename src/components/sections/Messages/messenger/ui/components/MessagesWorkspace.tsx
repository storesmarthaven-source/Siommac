// Ported from the bundle (ui/components/MessagesWorkspace.tsx). SIOMAC deltas:
//   • the active thread defaults to the first visible thread (no fixture id)
//     and selecting a thread lazy-loads its messages via actions.selectThread;
//   • URL ?thread= sync is dropped (the SIOMAC shell owns the URL);
//   • typing state is gone (hidden feature).
import { AlertCircle } from "./icons";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useMessaging } from "../../app/MessagingProvider";
import type { ActivityEntry, Attachment, CollaborationCard, Queue, Thread } from "../../domain/models";
import { DetailsPanel } from "./DetailsPanel";
import { MessageThread } from "./MessageThread";
import { QueueHeader, ThreadSidebar } from "./ThreadSidebar";
import { ActivityDialog, CollaborationDialog, InviteDialog, PreviewDialog } from "./WorkspaceDialogs";
import { AppearanceDialog } from "./AppearanceDialog";
import { notifyCollaborationStarted } from "../../integration/messagingNotifications";

export function MessagesWorkspace() {
  const { snapshot, loading, error, preferences, actions } = useMessaging();
  const [queue, setQueue] = useState<Queue>("inbox");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailsInfo, setDetailsInfo] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [collaboration, setCollaboration] = useState<CollaborationCard | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

  const inQueue = (thread: Thread, value: Queue) =>
    value === "compliance" ? thread.complianceControlled : thread.queue === value;

  const active = useMemo(() => {
    if (!snapshot) return undefined;
    return snapshot.threads.find((thread) => thread.id === activeId)
      ?? snapshot.threads.find((thread) => inQueue(thread, queue))
      ?? snapshot.threads[0];
  }, [activeId, queue, snapshot]);

  // Lazy-load the active thread's messages whenever the selection resolves.
  useEffect(() => {
    if (active) void actions.selectThread(active.id);
  }, [actions, active?.id]);

  if (loading) return <div className="sm-workspace"><div className="sm-loading"><span /><strong>Loading messages...</strong></div></div>;
  if (!snapshot || !active) return <div className="sm-workspace"><div className="sm-error"><AlertCircle /><strong>Messages are unavailable</strong><span>{error ?? "No conversations were returned."}</span><button type="button" onClick={() => void actions.reload()}>Try again</button></div></div>;
  const readySnapshot = snapshot;
  const activeThread = active;

  function selectThread(thread: Thread) { setActiveId(thread.id); setDetailsInfo(false); }
  function openActivity() { setActivity(readySnapshot.activity.filter((entry) => entry.threadId === activeThread.id)); setActivityOpen(true); }
  function selectQueue(nextQueue: Queue) {
    setQueue(nextQueue);
    const nextThread = readySnapshot.threads.find((thread) => inQueue(thread, nextQueue));
    if (nextThread) selectThread(nextThread);
  }
  function jumpTo(messageId: string) { document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function openCollaboration(card: CollaborationCard) {
    setCollaboration(card);
    notifyCollaborationStarted(card, { onOpen: () => setCollaboration(card) });
  }

  const messageGap = preferences.density === "compact" ? "28px" : preferences.density === "spacious" ? "46px" : "36px";
  const messageTextSize = preferences.messageTextSize === "large" ? "15.5px" : preferences.messageTextSize === "extra-large" ? "17px" : "14px";
  const surfaces = { white: "#ffffff", "soft-gray": "#f5f7fa", "cool-blue": "#f2f6fa" } as const;
  const appearanceStyle = `--sm-navy:${preferences.accent};--sm-admin-bubble:${preferences.accent};--sm-thread-bg:${surfaces[preferences.surface]};--sm-message-gap:${messageGap};--sm-message-font-size:${messageTextSize}`;

  return <main className="sm-workspace" style={appearanceStyle} data-high-contrast={preferences.highContrast || undefined} data-reduced-motion={preferences.reducedMotion || undefined} data-enhanced-focus={preferences.enhancedFocus || undefined}>
    <QueueHeader queue={queue} onQueue={selectQueue} />
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
  </main>;
}
