/**
 * src/components/sections/Messages/threadDisplay.ts
 *
 * Pure helpers for rendering a thread from the CURRENT USER's perspective:
 * who the "other" person is (for the avatar) and the thread's display title.
 *
 * The bug these fix + lock down: the UI used `p.role !== 'self'` to exclude
 * yourself, but participant roles are 'owner' | 'participant' | 'viewer' — never
 * 'self' — so nobody was excluded and the avatar fell through to participants[0]
 * (often you), showing your own photo on the person messaging you. Self is
 * excluded by USER ID, never by role.
 *
 * Unit-tested in threadDisplay.test.ts.
 */

export interface ParticipantLike {
  userId:       string;
  displayName?: string | null;
  username?:    string | null;
}

/** Participants other than the current user (excluded by id). */
export function otherParticipants<T extends ParticipantLike>(participants: T[], myId: string | null): T[] {
  return participants.filter(p => p.userId !== myId);
}

/** The participant whose avatar represents the thread for the current user —
 *  the first OTHER person, falling back to the first participant (self-thread). */
export function threadAvatarParticipant<T extends ParticipantLike>(participants: T[], myId: string | null): T | undefined {
  const others = otherParticipants(participants, myId);
  return others[0] ?? participants[0];
}

/** The thread's display title: its subject, else the other participants' names,
 *  else 'Thread'. (Uses `||` so an empty subject/name string still falls back.) */
export function threadTitle(
  thread: { subject?: string | null; participants: ParticipantLike[] },
  myId: string | null,
): string {
  return (thread.subject || '')
    || (otherParticipants(thread.participants, myId).map(p => p.displayName || p.username || '?').join(', ') || 'Thread');
}
