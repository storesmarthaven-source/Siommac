// Ported from the bundle (ui/components/ThreadSidebar.tsx). SIOMAC deltas:
//   • the "Favourites" filter and favourite star are removed (hidden feature);
//   • the "Sent" queue is deferred — with lazy per-thread loading its counts
//     would be dishonest (they only reflect already-opened threads), so the
//     queues are Inbox / Archived / Compliance until the backend exposes an
//     authored-by-me thread flag.
import { Archive, BellOff, CheckCircle2, Inbox, Search, ShieldCheck } from "./icons";
import { useMemo, useState } from "preact/hooks";
import { useMessaging } from "../../app/MessagingProvider";
import { lastMessage, userById } from "../../app/selectors";
import type { Queue, Thread } from "../../domain/models";
import { formatRelativeTime } from "../../domain/format";
import { Avatar, GroupAvatarStack } from "./Avatar";

const tabs: Array<{ queue: Queue; label: string; icon: typeof Inbox }> = [
  { queue: "inbox", label: "Inbox", icon: Inbox },
  { queue: "archived", label: "Archived", icon: Archive },
  { queue: "compliance", label: "Compliance", icon: ShieldCheck },
];

function threadInQueue(thread: Thread, queue: Queue): boolean {
  return queue === "compliance" ? thread.complianceControlled : thread.queue === queue;
}

export function QueueHeader({ queue, onQueue }: { queue: Queue; onQueue(queue: Queue): void }) {
  const { snapshot } = useMessaging();
  if (!snapshot) return null;
  return (
    <section className="sm-queue-header">
      <div><h1>Message Queues</h1><p>Inbox, archived, and compliance conversations.</p></div>
      <nav aria-label="Message queues">{tabs.map(({ queue: value, label, icon: Icon }) => {
        const count = snapshot.threads.filter((thread) => threadInQueue(thread, value)).length;
        return <button className={queue === value ? "is-active" : ""} type="button" key={value} onClick={() => onQueue(value)}><Icon />{label}<b>{count}</b></button>;
      })}</nav>
    </section>
  );
}

export function ThreadSidebar({ activeThreadId, queue, onSelect }: { activeThreadId: string; queue: Queue; onSelect(thread: Thread): void }) {
  const { snapshot } = useMessaging();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "groups">("all");
  if (!snapshot) return null;
  const currentUser = userById(snapshot, snapshot.currentUserId);
  const visible = useMemo(() => snapshot.threads.filter((thread) => {
    const queueMatches = threadInQueue(thread, queue);
    const filterMatches = filter === "unread" ? thread.unreadCount > 0 : filter === "groups" ? thread.kind === "group" : true;
    return queueMatches && filterMatches && thread.name.toLowerCase().includes(query.trim().toLowerCase());
  }), [filter, query, queue, snapshot.threads]);
  return (
    <aside className="sm-thread-sidebar">
      <header><Avatar user={currentUser} size="medium" showPresence /><h2>Chats</h2></header>
      <label className="sm-search"><Search /><input type="search" placeholder="Search conversations..." value={query} onInput={(event) => setQuery(event.currentTarget.value)} /></label>
      <div className="sm-thread-filters" role="tablist" aria-label="Conversation filters">
        {(["all", "unread", "groups"] as const).map((value) => <button type="button" role="tab" aria-selected={filter === value} key={value} onClick={() => setFilter(value)}>{value[0]?.toUpperCase() + value.slice(1)}</button>)}
      </div>
      <div className="sm-thread-sidebar__label"><span>{filter === "all" ? "Conversations" : filter}</span><small>{visible.length}</small></div>
      <div className="sm-thread-list">{visible.map((thread) => {
        const message = lastMessage(snapshot, thread.id);
        const participant = thread.kind === "direct" ? thread.participantIds.map((id) => userById(snapshot, id)).find((user) => user.id !== currentUser.id) : undefined;
        const groupParticipants = thread.kind === "group" ? thread.participantIds.map((id) => userById(snapshot, id)) : [];
        return <button type="button" className={`${thread.id === activeThreadId ? "is-active" : ""} ${thread.kind === "group" ? "is-group" : ""}`} key={thread.id} onClick={() => onSelect(thread)}>
          {thread.kind === "group" ? <GroupAvatarStack users={groupParticipants} /> : <Avatar user={participant ?? currentUser} size="medium" showPresence={Boolean(participant)} />}
          <span><strong>{thread.name}</strong><em>{message?.deleted ? "Message deleted" : message?.body || message?.attachments[0]?.name || "No messages yet"}</em></span>
          <small>{formatRelativeTime(thread.lastActivityAt)}{thread.muted ? <BellOff /> : null}{thread.complianceControlled ? <ShieldCheck /> : null}</small>
          {thread.unreadCount ? <b>{thread.unreadCount}</b> : null}
        </button>;
      })}{visible.length === 0 ? <div className="sm-empty-state"><CheckCircle2 /><strong>No conversations</strong><span>Nothing matches this queue and filter.</span></div> : null}</div>
    </aside>
  );
}
