// Ported from the bundle (ui/components/ThreadSidebar.tsx). SIOMAC deltas:
//   • the Sent queue is SERVER-derived (thread.authoredByMe from the /threads
//     tab=sent filter — legacy MessageCenter parity), so its counts are honest;
//   • the Compliance tab is the audited compliance BROWSER surface (legacy
//     parity, permission-gated by the workspace) — participant record threads
//     live in Inbox with the shield badge;
//   • QueueHeader exposes the New Message action (legacy parity);
//   • the Favourites filter + star are LIVE (favourites slice, mig 364).
import { Archive, BellOff, CheckCircle2, Inbox, PenSquare, Search, Send, ShieldCheck, Star } from "./icons";
import { useMemo, useState } from "preact/hooks";
import { useMessaging } from "../../app/MessagingProvider";
import { lastMessage, userById } from "../../app/selectors";
import type { Queue, Thread } from "../../domain/models";
import { formatRelativeTime } from "../../domain/format";
import { Avatar, GroupAvatarStack } from "./Avatar";

const tabs: Array<{ queue: Queue; label: string; icon: typeof Inbox }> = [
  { queue: "inbox", label: "Inbox", icon: Inbox },
  { queue: "sent", label: "Sent", icon: Send },
  { queue: "archived", label: "Archived", icon: Archive },
];

export function threadInQueue(thread: Thread, queue: Queue): boolean {
  if (queue === "sent") return thread.authoredByMe === true;
  if (queue === "compliance") return false;   // compliance is the browser surface, not a thread queue
  return thread.queue === queue;
}

export function QueueHeader({ queue, canCompliance, onQueue, onCompose }: {
  queue: Queue;
  canCompliance: boolean;
  onQueue(queue: Queue): void;
  onCompose(): void;
}) {
  const { snapshot } = useMessaging();
  if (!snapshot) return null;
  const tabList = canCompliance
    ? [...tabs, { queue: "compliance" as Queue, label: "Compliance", icon: ShieldCheck }]
    : tabs;
  return (
    <section className="sm-queue-header">
      <div><h1>Message Queues</h1><p>Inbox, sent, archived, and compliance conversations.</p></div>
      <nav aria-label="Message queues">
        {tabList.map(({ queue: value, label, icon: Icon }) => {
          const count = value === "compliance"
            ? null
            : snapshot.threads.filter((thread) => threadInQueue(thread, value)).length;
          return <button className={queue === value ? "is-active" : ""} type="button" key={value} onClick={() => onQueue(value)}><Icon />{label}{count !== null ? <b>{count}</b> : null}</button>;
        })}
        <button className="sm-compose-button" type="button" onClick={onCompose}><PenSquare />New Message</button>
      </nav>
    </section>
  );
}

export function ThreadSidebar({ activeThreadId, queue, onSelect }: { activeThreadId: string; queue: Queue; onSelect(thread: Thread): void }) {
  const { snapshot } = useMessaging();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "groups" | "favourites">("all");
  if (!snapshot) return null;
  const currentUser = userById(snapshot, snapshot.currentUserId);
  const visible = useMemo(() => snapshot.threads.filter((thread) => {
    const queueMatches = threadInQueue(thread, queue);
    const filterMatches = filter === "unread" ? thread.unreadCount > 0 : filter === "groups" ? thread.kind === "group" : filter === "favourites" ? thread.favourite : true;
    return queueMatches && filterMatches && thread.name.toLowerCase().includes(query.trim().toLowerCase());
  }), [filter, query, queue, snapshot.threads]);
  return (
    <aside className="sm-thread-sidebar">
      <header><Avatar user={currentUser} size="medium" showPresence /><h2>Chats</h2></header>
      <label className="sm-search"><Search /><input type="search" placeholder="Search conversations..." value={query} onInput={(event) => setQuery(event.currentTarget.value)} /></label>
      <div className="sm-thread-filters" role="tablist" aria-label="Conversation filters">
        {(["all", "unread", "groups", "favourites"] as const).map((value) => <button type="button" role="tab" aria-selected={filter === value} key={value} onClick={() => setFilter(value)}>{value === "favourites" ? "Favourites" : value[0]?.toUpperCase() + value.slice(1)}</button>)}
      </div>
      <div className="sm-thread-sidebar__label"><span>{filter === "all" ? "Conversations" : filter}</span><small>{visible.length}</small></div>
      <div className="sm-thread-list">{visible.map((thread) => {
        const message = lastMessage(snapshot, thread.id);
        const participant = thread.kind === "direct" ? thread.participantIds.map((id) => userById(snapshot, id)).find((user) => user.id !== currentUser.id) : undefined;
        const groupParticipants = thread.kind === "group" ? thread.participantIds.map((id) => userById(snapshot, id)) : [];
        return <button type="button" className={`${thread.id === activeThreadId ? "is-active" : ""} ${thread.kind === "group" ? "is-group" : ""}`} key={thread.id} onClick={() => onSelect(thread)}>
          {thread.kind === "group" ? <GroupAvatarStack users={groupParticipants} /> : <Avatar user={participant ?? currentUser} size="medium" showPresence={Boolean(participant)} />}
          <span><strong>{thread.name}</strong><em>{message?.deleted ? "Message deleted" : message?.body || message?.attachments[0]?.name || "No messages yet"}</em></span>
          <small>{formatRelativeTime(thread.lastActivityAt)}{thread.favourite ? <Star className="sm-thread-favourite-star" /> : null}{thread.muted ? <BellOff /> : null}{thread.complianceControlled ? <ShieldCheck /> : null}</small>
          {thread.unreadCount ? <b>{thread.unreadCount}</b> : null}
        </button>;
      })}{visible.length === 0 ? <div className="sm-empty-state"><CheckCircle2 /><strong>No conversations</strong><span>Nothing matches this queue and filter.</span></div> : null}</div>
    </aside>
  );
}
