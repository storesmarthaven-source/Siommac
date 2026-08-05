// netlify/functions/lib/hr/onboardingScope.test.ts
//
// Guards the two properties that make the onboarding scope ladder safe:
//
//  1. The `null` vs `[]` sentinel. `null` means UNCONSTRAINED (scope `all`); `[]` means a
//     real "this actor has no visible cases". Confusing them fails open (everyone sees
//     everything) or fails blind (nobody sees anything), and both look plausible in the UI.
//  2. Explicit `caseIds` cannot widen access. A client naming case ids must never see a
//     case outside its resolved scope.
//
// Scope DECISION is tested through the injected predicate, which is the same code path the
// calendar adapters use — so a regression there is caught here too.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveOnboardingScopeWith, intersectScope, DEFAULT_ONBOARDING_SCOPE } from './onboardingScope';

// The resolver's case-id lookups hit PostgREST. Every builder method returns `this`, and the
// object is thenable, so `await sb.from(t).select(c).or(f)` resolves to a queued result.
// Built inside vi.hoisted: vi.mock factories are hoisted above normal declarations, so a
// plain const would still be in its temporal dead zone when the factory runs.
const { queue, builder } = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'or', 'eq', 'in', 'maybeSingle']) {
    builder[m] = () => builder;
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve(queue.shift() ?? { data: [], error: null });
  return { queue, builder };
});

vi.mock('../db', () => ({ sb: builder }));
vi.mock('../auth', () => ({ userCan: vi.fn(async () => false) }));

const allow = (...keys: string[]) => (key: string) => keys.includes(key);
const denyAll = () => false;

beforeEach(() => { queue.length = 0; });

describe('scope decision', () => {
  it('defaults to `my` — never the widest scope the actor happens to hold', async () => {
    // Holding both widening keys must NOT change what an unspecified request returns.
    const r = await resolveOnboardingScopeWith('u1', allow('hr.onboarding.view_team', 'hr.onboarding.view_all'));
    expect(DEFAULT_ONBOARDING_SCOPE).toBe('my');
    expect(r.scope).toBe('my');
    expect(r.caseIds).not.toBeNull();          // `my` is always constrained
  });

  it('403s on an unauthorised scope instead of silently downgrading it', async () => {
    await expect(resolveOnboardingScopeWith('u1', denyAll, 'team')).rejects.toMatchObject({ status: 403 });
    await expect(resolveOnboardingScopeWith('u1', denyAll, 'all')).rejects.toMatchObject({ status: 403 });
  });

  it('does not let view_team satisfy view_all', async () => {
    await expect(
      resolveOnboardingScopeWith('u1', allow('hr.onboarding.view_team'), 'all'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('returns the null sentinel — not an empty array — for authorised `all`', async () => {
    const r = await resolveOnboardingScopeWith('u1', allow('hr.onboarding.view_all'), 'all');
    expect(r.scope).toBe('all');
    expect(r.caseIds).toBeNull();
  });
});

describe('null vs [] sentinel', () => {
  it('distinguishes "unconstrained" from "no visible cases"', async () => {
    // `all` → unconstrained.
    const wide = await resolveOnboardingScopeWith('u1', allow('hr.onboarding.view_all'), 'all');
    expect(wide.caseIds).toBeNull();

    // `my` with nothing owned/assigned/supervised → a real empty set, NOT null.
    const narrow = await resolveOnboardingScopeWith('u2', denyAll);
    expect(narrow.caseIds).toEqual([]);
    expect(narrow.caseIds).not.toBeNull();
  });

  it('an empty scope stays empty when intersected — it must not fall back to unconstrained', () => {
    const empty = { scope: 'my' as const, caseIds: [] };
    expect(intersectScope(empty, ['c1', 'c2'])).toEqual([]);
  });
});

describe('explicit caseIds cannot widen access', () => {
  it('drops requested ids outside the resolved scope', () => {
    const scoped = { scope: 'team' as const, caseIds: ['c1', 'c2'] };
    expect(intersectScope(scoped, ['c2', 'c3', 'c9'])).toEqual(['c2']);
  });

  it('returns the resolved scope untouched when no ids are requested', () => {
    const scoped = { scope: 'my' as const, caseIds: ['c1'] };
    expect(intersectScope(scoped, undefined)).toEqual(['c1']);
    expect(intersectScope(scoped, [])).toEqual(['c1']);
  });

  it('narrows — never widens — an unconstrained scope', () => {
    const wide = { scope: 'all' as const, caseIds: null };
    expect(intersectScope(wide, undefined)).toBeNull();          // still unconstrained
    expect(intersectScope(wide, ['c1'])).toEqual(['c1']);        // narrowed to the request
  });

  it('cannot resurrect a case the scope excluded, however it is requested', () => {
    const scoped = { scope: 'my' as const, caseIds: ['mine'] };
    for (const attempt of [['other'], ['other', 'other'], ['mine', 'other']]) {
      expect(intersectScope(scoped, attempt)).not.toContain('other');
    }
  });
});
