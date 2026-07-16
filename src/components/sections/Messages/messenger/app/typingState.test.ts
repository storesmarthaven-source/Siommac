// typingState — pure TTL-based typing-indicator state.
import { describe, expect, test } from 'vitest';
import { applyTyping, emptyTypingState, hasTyping, pruneTyping, typingUserIds } from './typingState';

const TTL = 4000;
const T0 = 1_000_000;

describe('typingState', () => {
  test('active=true adds a user with a TTL expiry', () => {
    const s = applyTyping(emptyTypingState, 'th1', 'USR-A', true, T0, TTL);
    expect(typingUserIds(s, 'th1', T0)).toEqual(['USR-A']);
    expect(typingUserIds(s, 'th1', T0 + TTL + 1)).toEqual([]);   // expired
  });

  test('active=false removes the user; removing an absent user is a no-op (same ref)', () => {
    const s1 = applyTyping(emptyTypingState, 'th1', 'USR-A', true, T0, TTL);
    const s2 = applyTyping(s1, 'th1', 'USR-A', false, T0, TTL);
    expect(typingUserIds(s2, 'th1', T0)).toEqual([]);
    expect(applyTyping(s2, 'th1', 'USR-A', false, T0, TTL)).toBe(s2);
  });

  test('a refresh extends the expiry', () => {
    const s1 = applyTyping(emptyTypingState, 'th1', 'USR-A', true, T0, TTL);
    const s2 = applyTyping(s1, 'th1', 'USR-A', true, T0 + 2000, TTL);
    expect(typingUserIds(s2, 'th1', T0 + TTL + 1)).toEqual(['USR-A']);   // alive past the first TTL
  });

  test('threads and users are independent; self is excludable', () => {
    let s = applyTyping(emptyTypingState, 'th1', 'USR-A', true, T0, TTL);
    s = applyTyping(s, 'th1', 'USR-B', true, T0, TTL);
    s = applyTyping(s, 'th2', 'USR-C', true, T0, TTL);
    expect(typingUserIds(s, 'th1', T0).sort()).toEqual(['USR-A', 'USR-B']);
    expect(typingUserIds(s, 'th1', T0, 'USR-A')).toEqual(['USR-B']);     // except=self
    expect(typingUserIds(s, 'th2', T0)).toEqual(['USR-C']);
  });

  test('pruneTyping drops expired entries and empty threads; no-op keeps the reference', () => {
    let s = applyTyping(emptyTypingState, 'th1', 'USR-A', true, T0, TTL);
    s = applyTyping(s, 'th2', 'USR-B', true, T0 + 3000, TTL);
    expect(pruneTyping(s, T0 + 1000)).toBe(s);                            // nothing expired → same ref
    const pruned = pruneTyping(s, T0 + TTL + 1);
    expect(typingUserIds(pruned, 'th1', T0 + TTL + 1)).toEqual([]);
    expect(typingUserIds(pruned, 'th2', T0 + TTL + 1)).toEqual(['USR-B']);
    expect(hasTyping(pruned)).toBe(true);
    expect(hasTyping(pruneTyping(pruned, T0 + 10 * TTL))).toBe(false);
  });
});
