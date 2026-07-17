// Ported from the bundle (ui/components/ThreadSidebar.tsx). SIOMAC deltas:
//   • the Sent queue is SERVER-derived (thread.authoredByMe from the /threads
//     tab=sent filter — legacy MessageCenter parity), so its counts are honest;
//   • the Compliance tab is the audited compliance BROWSER surface (legacy
//     parity, permission-gated by the workspace) — participant record threads
//     live in Inbox with the shield badge;
//   • QueueHeader exposes the New Message action (legacy parity);
//   • the Favourites filter + star are LIVE (favourites slice, mig 364).
import { Archive, BellOff, CheckCircle2, Inbox, PenSquare, Search, Send, ShieldCheck, Star } from "./icons";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useMessaging } from "../../app/MessagingProvider";
import { lastMessage, userById } from "../../app/selectors";
import type { Queue, Thread } from "../../domain/models";
import { formatRelativeTime } from "../../domain/format";
import { Avatar, GroupAvatarStack } from "./Avatar";

const tabs: { queue: Queue; label: string; icon: typeof Inbox }[] = [
  { queue: "inbox", label: "Inbox", icon: Inbox },
  { queue: "sent", label: "Sent", icon: Send },
  { queue: "archived", label: "Archived", icon: Archive },
];

export function threadInQueue(thread: Thread, queue: Queue): boolean {
  // Archived threads live ONLY in the Archived tab — Sent membership is
  // authorship-derived and would otherwise keep showing them.
  if (queue === "sent") return thread.authoredByMe === true && thread.queue !== "archived";
  if (queue === "compliance") return false;   // compliance is the browser surface, not a thread queue
  return thread.queue === queue;
}

export function QueueHeader({ queue, onQueue }: {
  queue: Queue;
  onQueue: (queue: Queue) => void;
}) {
  const { snapshot } = useMessaging();
  if (!snapshot) return null;
  return (
    // Rendered by MessagesWorkspace inside the pill footer band's FIRST column
    // (above the conversation list). The Compliance tab lives in the band's
    // right column (above the rail) — MessagesWorkspace owns it.
    <nav className="app-topbar-nav sm-topbar-queues" aria-label="Message queues">
      <div className="app-topbar-nav-tabs">
        {tabs.map(({ queue: value, label, icon: Icon }) => {
          const count = snapshot.threads.filter((thread) => threadInQueue(thread, value)).length;
          return <button className={`app-topbar-nav-btn${queue === value ? " active" : ""}`} type="button" key={value} onClick={() => onQueue(value)}><Icon />{label}<b>{count}</b></button>;
        })}
      </div>
    </nav>
  );
}

interface ContentHit { postId: string; threadId: string; subject: string; snippet: string; createdAt: string }

export function ThreadSidebar({ activeThreadId, queue, onSelect, onCompose }: { activeThreadId: string; queue: Queue; onSelect: (thread: Thread) => void; onCompose: () => void }) {
  const { snapshot, actions, threadsHaveMore } = useMessaging();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "groups" | "favourites">("all");
  const [contentHits, setContentHits] = useState<ContentHit[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // Server-side CONTENT search (>=2 chars, debounced) alongside the local
  // name filter — contract: messenger-pagination-search.md.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) { setContentHits([]); return; }
    const timer = window.setTimeout(() => {
      actions.searchMessages(trimmed)
        .then(setContentHits)
        .catch(() => setContentHits([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [actions, query]);
  // No early return above the useMemo — hook count must be stable per render.
  const threads = snapshot?.threads;
  const visible = useMemo(() => (threads ?? []).filter((thread) => {
    const queueMatches = threadInQueue(thread, queue);
    const filterMatches = filter === "unread" ? thread.unreadCount > 0 : filter === "groups" ? thread.kind === "group" : filter === "favourites" ? thread.favourite : true;
    return queueMatches && filterMatches && thread.name.toLowerCase().includes(query.trim().toLowerCase());
  }), [filter, query, queue, threads]);
  if (!snapshot) return null;
  const currentUser = userById(snapshot, snapshot.currentUserId);
  return (
    <aside className="sm-thread-sidebar">
      <header>
        <Avatar user={currentUser} size="medium" showPresence /><h2>Chats</h2>
        <button className="sm-compose-button" type="button" aria-label="New message" title="New message" onClick={onCompose}><PenSquare /></button>
      </header>
      <label className="sm-search"><Search /><input type="search" placeholder="Search conversations..." value={query} onInput={(event) => setQuery(event.currentTarget.value)} /></label>
      <div className="sm-thread-filters" role="tablist" aria-label="Conversation filters">
        {(["all", "unread", "groups", "favourites"] as const).map((value) => <button type="button" role="tab" aria-selected={filter === value} key={value} onClick={() => setFilter(value)}>{value === "favourites" ? "Favourites" : (value[0] ?? "").toUpperCase() + value.slice(1)}</button>)}
      </div>
      <div className="sm-thread-sidebar__label"><span>{filter === "all" ? "Conversations" : filter}</span><small>{visible.length}</small></div>
      <div className="sm-thread-list">{visible.map((thread) => {
        const message = lastMessage(snapshot, thread.id);
        const participant = thread.kind === "direct" ? thread.participantIds.map((id) => userById(snapshot, id)).find((user) => user.id !== currentUser.id) : undefined;
        const groupParticipants = thread.kind === "group" ? thread.participantIds.map((id) => userById(snapshot, id)) : [];
        return <button type="button" className={`${thread.id === activeThreadId ? "is-active" : ""} ${thread.kind === "group" ? "is-group" : ""} ${thread.unreadCount ? "is-unread" : ""}`} key={thread.id} onClick={() => onSelect(thread)}>
          {thread.kind === "group" ? <GroupAvatarStack users={groupParticipants} /> : <Avatar user={participant ?? currentUser} size="medium" showPresence={Boolean(participant)} />}
          <span><strong>{thread.name}</strong>{thread.hasDraft && thread.draftPreview ? <em className="sm-draft-preview">Draft: {thread.draftPreview}</em> : <em>{message?.deleted ? "Message deleted" : (message?.body.trim() ? message.body : message?.attachments[0]?.name) ?? "No messages yet"}</em>}</span>
          <small>{formatRelativeTime(thread.lastActivityAt)}{thread.favourite ? <Star className="sm-thread-favourite-star" /> : null}{thread.muted ? <BellOff /> : null}{thread.complianceControlled ? <ShieldCheck /> : null}</small>
          {thread.unreadCount ? <b>{thread.unreadCount}</b> : null}
        </button>;
      })}{visible.length === 0 && contentHits.length === 0 ? <div className="sm-empty-state"><CheckCircle2 /><strong>No conversations</strong><span>Nothing matches this queue and filter.</span></div> : null}
      {contentHits.length > 0 ? (
        <div className="sm-search-hits">
          <div className="sm-thread-sidebar__label"><span>In messages</span><small>{contentHits.length}</small></div>
          {contentHits.map((hit) => (
            <button type="button" key={hit.postId} className="sm-search-hit"
              onClick={() => { try { window.dispatchEvent(new CustomEvent("siomac:openThread", { detail: { threadId: hit.threadId } })); } catch { /* ignore */ } }}>
              <strong>{hit.subject}</strong>
              <em>{hit.snippet}</em>
            </button>
          ))}
        </div>
      ) : null}
      {threadsHaveMore && query.trim().length === 0 ? (
        <button className="sm-load-more" type="button" disabled={loadingMore}
          onClick={() => { setLoadingMore(true); void actions.loadMoreThreads().catch(() => { /* toast upstream */ }).finally(() => setLoadingMore(false)); }}>
          {loadingMore ? "Loading..." : "Load more conversations"}
        </button>
      ) : null}</div>
    </aside>
  );
}
