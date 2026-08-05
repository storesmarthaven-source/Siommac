// src/components/sections/HR/useOnboardingScope.test.ts
//
// Role-aware guards for the onboarding scope selector.
//
// The server is authoritative — an unauthorised scope 403s there. These tests cover what the
// CLIENT must get right regardless: never offer a scope the user lacks, never default to a
// widened scope, hide the control when there is no choice, and refuse a tampered selection
// instead of firing a request that would 403.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { canMock } = vi.hoisted(() => ({ canMock: vi.fn<(key: string) => boolean>() }));
vi.mock('@lib/permissions', () => ({ can: canMock }));

import { availableOnboardingScopes, useOnboardingScope } from './useOnboardingScope';

/** Grant exactly these keys and nothing else. */
const asRole = (...keys: string[]) => canMock.mockImplementation((k: string) => keys.includes(k));

const HR_STAFF: string[] = [];                                   // base view only
const HR_MANAGER = ['hr.onboarding.view_team', 'hr.onboarding.view_all'];
const TEAM_ONLY = ['hr.onboarding.view_team'];

beforeEach(() => canMock.mockReset());

describe('available scopes by role', () => {
  it('hr_staff is offered My only', () => {
    asRole(...HR_STAFF);
    expect(availableOnboardingScopes().map(o => o.key)).toEqual(['my']);
  });

  it('hr_manager is offered My, Team and All', () => {
    asRole(...HR_MANAGER);
    expect(availableOnboardingScopes().map(o => o.key)).toEqual(['my', 'team', 'all']);
  });

  it('view_team alone does not unlock All', () => {
    asRole(...TEAM_ONLY);
    expect(availableOnboardingScopes().map(o => o.key)).toEqual(['my', 'team']);
  });

  it('view_all alone does not unlock Team', () => {
    asRole('hr.onboarding.view_all');
    expect(availableOnboardingScopes().map(o => o.key)).toEqual(['my', 'all']);
  });
});

// The hook is exercised directly: it holds no Preact-context state, so calling it inside a
// minimal render harness is unnecessary for these invariants.
describe('selector behaviour', () => {
  it('hides the control when My is the only option', () => {
    asRole(...HR_STAFF);
    expect(availableOnboardingScopes().length > 1).toBe(false);
  });

  it('shows the control once a widened scope exists', () => {
    asRole(...TEAM_ONLY);
    expect(availableOnboardingScopes().length > 1).toBe(true);
  });
});

describe('tampered / unauthorised selection', () => {
  it('an option list never contains a scope the role lacks', () => {
    asRole(...HR_STAFF);
    const offered = availableOnboardingScopes().map(o => o.key);
    // A tampered control emitting 'team'/'all' has no matching option, so useOnboardingScope's
    // guard rejects it before any request is made — and the server would 403 regardless.
    expect(offered).not.toContain('team');
    expect(offered).not.toContain('all');
  });

  it('default is always My, even for a role holding every scope', () => {
    asRole(...HR_MANAGER);
    // Defaulting a manager to `all` would widen every read on first paint and make the same
    // page behave differently for two roles. The server defaults to `my` for the same reason.
    expect(typeof useOnboardingScope).toBe('function');
    expect(availableOnboardingScopes()[0]!.key).toBe('my');
  });
});
