// Ported from the Messenger port bundle (src/app/selectors.ts), with one SIOMAC
// hardening: userById returns a placeholder instead of throwing — real snapshots
// are built from thread participants + online users, so an author who has since
// left the roster (or a cold cache) must degrade gracefully, not crash the tree.
import type { Message, Thread, ThreadId, User, UserId, WorkspaceSnapshot } from "../domain/models";

export function userById(snapshot: WorkspaceSnapshot, userId: UserId): User {
  const user = snapshot.users.find((item) => item.id === userId);
  return user ?? { id: userId, name: userId || "Unknown user", title: "", avatarUrl: "", presence: "offline" };
}

export function threadById(snapshot: WorkspaceSnapshot, threadId: ThreadId): Thread {
  const thread = snapshot.threads.find((item) => item.id === threadId);
  if (!thread) throw new Error(`Unknown thread: ${threadId}`);
  return thread;
}

export function messagesForThread(snapshot: WorkspaceSnapshot, threadId: ThreadId): Message[] {
  return snapshot.messages
    .filter((message) => message.threadId === threadId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function messageById(snapshot: WorkspaceSnapshot, messageId: string): Message | undefined {
  return snapshot.messages.find((message) => message.id === messageId);
}

export function lastMessage(snapshot: WorkspaceSnapshot, threadId: ThreadId): Message | undefined {
  return messagesForThread(snapshot, threadId).at(-1);
}
