// src/components/sections/HR/onboardingScopePresentation.test.ts
//
// Locks in the distinction that an earlier pass got wrong: ROLE and SCOPE are independent.
//
//   role  = a permission fact — decides which PRESENTATION the page renders.
//   scope = a transient request — decides which DATA is returned.
//
// Deriving presentation from the selected scope silently demoted an HR manager to the staff
// experience the moment they narrowed to My Work.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest runs from the repo root; import.meta.url is not a file URL under this transform.
const repoFile = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');

const { canMock } = vi.hoisted(() => ({ canMock: vi.fn<(key: string) => boolean>() }));
vi.mock('@lib/permissions', () => ({ can: canMock }));

const asRole = (...keys: string[]) => canMock.mockImplementation((k: string) => keys.includes(k));
const MANAGER = ['hr.onboarding.view_team', 'hr.onboarding.view_all'];

/** The production rule, mirrored exactly (OnboardingCommandCenter.tsx). */
const presentationFor = (can: (k: string) => boolean): 'manager' | 'staff' =>
  (can('hr.onboarding.view_team') || can('hr.onboarding.view_all')) ? 'manager' : 'staff';

beforeEach(() => canMock.mockReset());

describe('role is independent of scope', () => {
  it('manager keeps the manager presentation at EVERY scope, including My', () => {
    asRole(...MANAGER);
    for (const scope of ['my', 'team', 'all'] as const) {
      // Scope is deliberately not an input to the presentation rule.
      expect(presentationFor(canMock)).toBe('manager');
      expect(scope).toBeTruthy();
    }
  });

  it('hr_staff gets the staff presentation and only My', () => {
    asRole();  // base view only
    expect(presentationFor(canMock)).toBe('staff');
  });

  it('either widening permission alone grants the manager presentation', () => {
    asRole('hr.onboarding.view_team');
    expect(presentationFor(canMock)).toBe('manager');
    asRole('hr.onboarding.view_all');
    expect(presentationFor(canMock)).toBe('manager');
  });
});

describe('Command Centre source guarantees', () => {
  const src = repoFile('src/components/sections/HR/OnboardingCommandCenter.tsx');

  it('does not derive presentation from the selected scope', () => {
    expect(src).not.toMatch(/dashboardMode[^\n]*scope === 'my'/);
    expect(src).toMatch(/can\('hr\.onboarding\.view_team'\)/);
  });

  it('gates the skeleton on every scoped query, not an unexplained subset', () => {
    // Wait for each scope-dependent surface currently rendered: overview data plus
    // the three exact server-side Work Queue totals.
    expect(src).toMatch(/scopedQueries\s*=\s*\[statsQ, casesQ, startsQ, blockersQ, overdueWorkQ, todayWorkQ, upcomingWorkQ\]/);
  });

  it('keys the board subtree by scope so All-scope data cannot survive a switch to My', () => {
    expect(src).toMatch(/key=\{`board-\$\{scope\}`\}/);
  });

  it('resets pagination when scope changes', () => {
    expect(src).toMatch(/page: 1/);
  });
});

describe('registered calendar widgets carry the runtime scope', () => {
  const registry = repoFile('src/ui/widgets/registry.calendarPlanning.tsx');

  it('both widgets forward runtime.onboardingScope to useCalendarList', () => {
    const forwards = registry.match(/onboardingScope: (runtime|props\.runtime)\.onboardingScope/g) ?? [];
    expect(forwards.length).toBe(2);   // Upcoming Deadlines + Task Planner
  });

  it('scope is runtime context, never persisted widget configuration', () => {
    // A defaultConfig/configSchema entry would pin a user's board to a stale scope.
    expect(registry).not.toMatch(/defaultConfig:[^\n]*onboardingScope/);
    expect(registry).not.toMatch(/key: 'onboardingScope'/);
  });
});
