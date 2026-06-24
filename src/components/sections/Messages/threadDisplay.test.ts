import { describe, it, expect } from 'vitest';
import { otherParticipants, threadAvatarParticipant, threadTitle } from './threadDisplay';

const me   = { userId: 'USR-ME',  displayName: 'Me',    username: 'me'  };
const alice = { userId: 'USR-A',  displayName: 'Alice', username: 'alice' };
const bob   = { userId: 'USR-B',  displayName: 'Bob',   username: 'bob' };

describe('threadDisplay — excludes self by id, never by role', () => {
  it('otherParticipants drops the current user', () => {
    expect(otherParticipants([me, alice], 'USR-ME')).toEqual([alice]);
  });

  it('avatar participant is the OTHER person, even when self is listed first', () => {
    // The original bug: self (owner) is participants[0] → its photo was shown.
    expect(threadAvatarParticipant([me, alice], 'USR-ME')).toEqual(alice);
    expect(threadAvatarParticipant([alice, me], 'USR-ME')).toEqual(alice);
  });

  it('group thread avatar is one of the OTHER members, not self', () => {
    const pick = threadAvatarParticipant([me, alice, bob], 'USR-ME');
    expect(pick).not.toEqual(me);
    expect([alice, bob]).toContainEqual(pick);
  });

  it('title is the other participant(s), not yourself', () => {
    expect(threadTitle({ subject: null, participants: [me, alice] }, 'USR-ME')).toBe('Alice');
    expect(threadTitle({ subject: null, participants: [me, alice, bob] }, 'USR-ME')).toBe('Alice, Bob');
  });

  it('explicit subject wins over derived names', () => {
    expect(threadTitle({ subject: 'Project X', participants: [me, alice] }, 'USR-ME')).toBe('Project X');
  });

  it('empty subject falls back to names (not an empty string)', () => {
    expect(threadTitle({ subject: '', participants: [me, alice] }, 'USR-ME')).toBe('Alice');
  });

  it('self-only thread falls back gracefully (no crash, shows self)', () => {
    expect(threadAvatarParticipant([me], 'USR-ME')).toEqual(me);
    expect(threadTitle({ subject: null, participants: [me] }, 'USR-ME')).toBe('Thread');
  });

  it('null current-user id keeps everyone (does not crash)', () => {
    expect(otherParticipants([me, alice], null)).toEqual([me, alice]);
  });
});
