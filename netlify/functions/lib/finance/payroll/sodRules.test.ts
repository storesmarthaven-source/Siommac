/**
 * Unit tests for the payroll segregation-of-duties rules.
 *
 * These back a real gate: proposing a level the org cannot staff would strand
 * every future run at funding with PR403 — the exact deadlock the configurable
 * SoD feature exists to remove. The matching in particular must be exact, so the
 * degenerate cases below are the point of this file, not padding.
 */

import { describe, it, expect } from 'vitest';
import {
  SOD_LEVELS, DISTINCT_SEATS, CHAIN_SEATS,
  separationFor, maxDistinctAssignment, computeFeasibility,
  type SodSeatKey,
} from './sodRules';

const holders = (m: Partial<Record<SodSeatKey, string[]>>): Map<SodSeatKey, string[]> =>
  new Map(Object.entries(m) as [SodSeatKey, string[]][]);

/** Everyone can do everything — the common "small finance team" shape. */
const everyone = (...people: string[]): Map<SodSeatKey, string[]> =>
  holders({ prepare: people, certify: people, approve: people, fund: people, release: people });

describe('separationFor', () => {
  it('never separates prepare or certify from anything', () => {
    for (const level of SOD_LEVELS) {
      expect(separationFor('prepare', level)).toEqual([]);
      expect(separationFor('certify', level)).toEqual([]);
    }
  });

  it('always keeps the approver distinct from the preparer — the 2-person floor', () => {
    for (const level of SOD_LEVELS) {
      expect(separationFor('approve', level)).toEqual(['prepare']);
    }
  });

  it('widens fund/release separation as the level rises', () => {
    expect(separationFor('fund', 2)).toEqual(['prepare']);
    expect(separationFor('fund', 3)).toEqual(['prepare', 'approve']);
    expect(separationFor('fund', 4)).toEqual(['prepare', 'approve', 'certify']);
    // release carries the identical rule — the RPCs treat the two the same
    for (const level of SOD_LEVELS) {
      expect(separationFor('release', level)).toEqual(separationFor('fund', level));
    }
  });

  it('never lets the preparer fund or release, at any level', () => {
    for (const level of SOD_LEVELS) {
      expect(separationFor('fund', level)).toContain('prepare');
      expect(separationFor('release', level)).toContain('prepare');
    }
  });
});

describe('maxDistinctAssignment', () => {
  const L4 = DISTINCT_SEATS[4];

  it('THE case a headcount check gets wrong: five people who can only prepare', () => {
    // A naive "5 people >= 4 needed" test would wrongly pass. Only a matching
    // sees that nobody is left to certify, approve or fund.
    const r = maxDistinctAssignment(L4, holders({
      prepare: ['a', 'b', 'c', 'd', 'e'],
      certify: ['a'], approve: ['a'], fund: ['a'],
    }));
    expect(r.size).toBe(2);
    expect(r.unmatched.sort()).toEqual(['approve', 'fund']);
  });

  it('four people who can each do everything staff level 4', () => {
    const r = maxDistinctAssignment(L4, everyone('a', 'b', 'c', 'd'));
    expect(r.size).toBe(4);
    expect(r.unmatched).toEqual([]);
  });

  it('three people cannot staff level 4 however capable they are', () => {
    const r = maxDistinctAssignment(L4, everyone('a', 'b', 'c'));
    expect(r.size).toBe(3);
    expect(r.unmatched).toEqual(['fund']);
  });

  it('exactly one specialist per seat is sufficient', () => {
    const r = maxDistinctAssignment(L4, holders({
      prepare: ['p'], certify: ['c'], approve: ['ap'], fund: ['f'],
    }));
    expect(r.size).toBe(4);
  });

  it('re-staffs an earlier seat to free a person for a constrained one (augmenting path)', () => {
    // 'a' is the only candidate for approve, but is also the first candidate for
    // prepare. A greedy pass would take 'a' for prepare and fail approve; the
    // matching must back out and give prepare to 'b'.
    const r = maxDistinctAssignment(['prepare', 'approve'], holders({
      prepare: ['a', 'b'], approve: ['a'],
    }));
    expect(r.size).toBe(2);
    expect(r.unmatched).toEqual([]);
  });

  it('reports every unstaffable seat when nobody holds anything', () => {
    const r = maxDistinctAssignment(L4, holders({}));
    expect(r.size).toBe(0);
    expect(r.unmatched).toEqual(L4);
  });
});

describe('computeFeasibility', () => {
  it('needs exactly N distinct people for level N', () => {
    for (const f of computeFeasibility(everyone('a', 'b', 'c', 'd'))) {
      expect(f.required).toBe(f.level);
    }
  });

  it('counts fund and release as ONE seat — the RPCs never separate them', () => {
    // Only two people, but level 2 is satisfiable: one prepares, the other does
    // BOTH fund and release.
    const [l2] = computeFeasibility(everyone('a', 'b'));
    expect(l2!.level).toBe(2);
    expect(l2!.feasible).toBe(true);
    expect(DISTINCT_SEATS[2]).not.toContain('release');
  });

  it('degrades gracefully as the team shrinks', () => {
    const three = computeFeasibility(everyone('a', 'b', 'c'));
    expect(three.map(f => f.feasible)).toEqual([true, true, false]);   // L2, L3 ok; L4 not
    const two = computeFeasibility(everyone('a', 'b'));
    expect(two.map(f => f.feasible)).toEqual([true, false, false]);
  });

  it('keeps feasible, available and shortfallSeats mutually consistent', () => {
    for (const set of [everyone('a'), everyone('a', 'b'), everyone('a', 'b', 'c', 'd')]) {
      for (const f of computeFeasibility(set)) {
        expect(f.feasible).toBe(f.available >= f.required);
        expect(f.shortfallSeats.length).toBe(f.required - f.available);
      }
    }
  });

  it('publishes the separations for every seat so the UI never re-derives them', () => {
    for (const f of computeFeasibility(everyone('a', 'b', 'c', 'd'))) {
      expect(f.separations.map(s => s.seat)).toEqual(CHAIN_SEATS.map(s => s.key));
      for (const s of f.separations) {
        expect(s.mustDifferFrom).toEqual(separationFor(s.seat, f.level));
      }
    }
  });
});
