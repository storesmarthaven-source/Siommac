// app/typingState.ts — pure typing-indicator state (immutable, TTL-based).
//
// Senders broadcast {active:true} every TYPING_REFRESH_MS while input
// continues and {active:false} on send/clear; receivers hold each user for
// TYPING_TTL_MS past the last refresh so a dropped stop-event can't strand a
// stuck "is typing…" (the TTL sweep clears it).
import type { ThreadId, UserId } from '../domain/models';

/** threadId → userId → expiry (epoch ms). */
export type TypingState = ReadonlyMap<ThreadId, ReadonlyMap<UserId, number>>;

export const emptyTypingState: TypingState = new Map();

/** Apply one typing event. Returns the same reference when nothing changed. */
export function applyTyping(
  state: TypingState, threadId: ThreadId, userId: UserId,
  active: boolean, now: number, ttlMs: number,
): TypingState {
  const thread = state.get(threadId);
  if (!active) {
    if (!thread?.has(userId)) return state;
    const nextThread = new Map(thread);
    nextThread.delete(userId);
    const next = new Map(state);
    if (nextThread.size) next.set(threadId, nextThread); else next.delete(threadId);
    return next;
  }
  const nextThread = new Map(thread ?? []);
  nextThread.set(userId, now + ttlMs);
  const next = new Map(state);
  next.set(threadId, nextThread);
  return next;
}

/** Drop expired entries. Returns the same reference when nothing expired. */
export function pruneTyping(state: TypingState, now: number): TypingState {
  let changed = false;
  const next = new Map<ThreadId, ReadonlyMap<UserId, number>>();
  for (const [threadId, users] of state) {
    const live = new Map([...users].filter(([, expiry]) => expiry > now));
    if (live.size !== users.size) changed = true;
    if (live.size) next.set(threadId, live);
  }
  return changed ? next : state;
}

/** Users currently typing in a thread (unexpired), excluding `except`. */
export function typingUserIds(state: TypingState, threadId: ThreadId, now: number, except?: UserId): UserId[] {
  const users = state.get(threadId);
  if (!users) return [];
  return [...users].filter(([id, expiry]) => expiry > now && id !== except).map(([id]) => id);
}

/** True when any entry exists (drives the 1s prune interval on/off). */
export function hasTyping(state: TypingState): boolean {
  return state.size > 0;
}
