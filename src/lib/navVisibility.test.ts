/**
 * src/lib/navVisibility.test.ts — generic namespaced nav-visibility store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  type VisibilityItem,
  isVisible, resolveVisible, setVisible, toggleVisible, resetVisibility, subscribeVisibility,
} from './navVisibility';

const NS = 'test-ns';
const items: VisibilityItem[] = [
  { id: 'a', defaultVisible: true },
  { id: 'b', defaultVisible: false },
  { id: 'c', defaultVisible: true },
];

beforeEach(() => localStorage.clear());

describe('resolveVisible', () => {
  it('returns default-visible items in registry order when no overrides', () => {
    expect(resolveVisible(NS, items)).toEqual(['a', 'c']);
  });

  it('honours overrides over defaults', () => {
    setVisible(NS, 'b', true);   // turn a default-off item on
    setVisible(NS, 'a', false);  // turn a default-on item off
    expect(resolveVisible(NS, items)).toEqual(['b', 'c']);
  });
});

describe('isVisible', () => {
  it('falls back to the registry default', () => {
    expect(isVisible(NS, items, 'a')).toBe(true);
    expect(isVisible(NS, items, 'b')).toBe(false);
  });
  it('reflects an explicit override', () => {
    setVisible(NS, 'b', true);
    expect(isVisible(NS, items, 'b')).toBe(true);
  });
});

describe('toggleVisible', () => {
  it('flips relative to current effective visibility', () => {
    toggleVisible(NS, items, 'a');           // default true → false
    expect(isVisible(NS, items, 'a')).toBe(false);
    toggleVisible(NS, items, 'a');           // → true
    expect(isVisible(NS, items, 'a')).toBe(true);
  });
});

describe('namespace isolation + reset', () => {
  it('keeps namespaces independent', () => {
    setVisible('ns1', 'a', false);
    expect(isVisible('ns2', items, 'a')).toBe(true);
  });
  it('reset restores defaults', () => {
    setVisible(NS, 'a', false);
    resetVisibility(NS);
    expect(resolveVisible(NS, items)).toEqual(['a', 'c']);
  });
});

describe('subscribe', () => {
  it('notifies subscribers on change with the namespace', () => {
    const fn = vi.fn();
    const off = subscribeVisibility(fn);
    setVisible(NS, 'a', false);
    expect(fn).toHaveBeenCalledWith(NS);
    off();
    setVisible(NS, 'a', true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
