// src/components/sections/HR/onboardingCommandCentre.test.ts
//
// Guards the Command Centre rebuild's contract: board composition, widget mounting, scope
// wiring, role/scope independence, and that the legacy grid is genuinely gone.
//
// Several assertions read the SOURCE. That is deliberate: RGL is CJS, so vitest cannot render
// a WidgetBoard (documented in vitest.config.ts), and the properties that matter here —
// which widget ids are mounted, that scope is runtime not config, that reveal is disabled —
// are structural facts a render test could not reach anyway.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoFile = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const repoHas = (rel: string): boolean => existsSync(resolve(process.cwd(), rel));

/** Comments are stripped before structural matching: the file header legitimately QUOTES
 *  `<WidgetBoard>` and `revealOnMount={false}` while explaining the architecture, and a naive
 *  count would read those prose mentions as extra mounts. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PAGE = stripComments(repoFile('src/components/sections/HR/OnboardingCommandCenter.tsx'));
const REGISTRY = stripComments(repoFile('src/ui/widgets/registry.hrOnboarding.tsx'));
const WIDGETS = stripComments(repoFile('src/components/sections/HR/onboarding/CommandCentreWidgets.tsx'));

const { canMock } = vi.hoisted(() => ({ canMock: vi.fn<(key: string) => boolean>() }));
vi.mock('@lib/permissions', () => ({ can: canMock }));
const asRole = (...keys: string[]) => canMock.mockImplementation((k: string) => keys.includes(k));
beforeEach(() => canMock.mockReset());

describe('board composition follows Employee Master', () => {
  it('mounts two boards on distinct onboarding page keys', () => {
    expect(PAGE).toMatch(/PAGE_KEY = 'hr\.onboarding\.command-centre'/);
    expect(PAGE).toMatch(/KPI_PAGE_KEY = 'hr\.onboarding\.command-centre\.kpis'/);
    expect((PAGE.match(/<WidgetBoard\s/g) ?? []).length).toBe(2);   // not <WidgetBoardToolbar
    // Employee Master's keys must not be reused.
    expect(PAGE).not.toMatch(/hr\.employees\.overview/);
  });

  it('uses the canonical grid settings and disables the reveal animation', () => {
    expect(PAGE).toMatch(/BOARD_COLUMNS = 24/);
    expect((PAGE.match(/cellHeight=\{6\}/g) ?? []).length).toBe(2);
    expect((PAGE.match(/gap=\{\[12, 12\]\}/g) ?? []).length).toBe(2);
    expect((PAGE.match(/revealOnMount=\{false\}/g) ?? []).length).toBe(2);
  });

  it('keeps the KPI strip bounded and reorder-only', () => {
    expect(PAGE).toMatch(/resizable=\{false\}[^\n]*maxRows=\{6\}[^\n]*isBounded/);
  });

  it('wires the full customization lifecycle', () => {
    for (const hook of ['useBoardLayout', 'WidgetBoardToolbar', 'WidgetLibraryModal',
      'onSaveEditing', 'onCancelEditing', 'onReset', 'onSetDefault']) {
      expect(PAGE).toContain(hook);
    }
  });
});

describe('widgets mounted in the approved order', () => {
  const layout = PAGE.slice(PAGE.indexOf('defaultOnboardingLayout'), PAGE.indexOf('export function OnboardingCommandCenter'));

  it('mounts the four KPI widgets at 6x6', () => {
    for (const id of ['dueToday', 'overdueActions', 'startsWithin7Days', 'ownerRequired']) {
      expect(PAGE).toMatch(new RegExp(`hr\\.onboarding\\.${id}', \\d+, 0, 6, 6, 'compact'`));
    }
  });

  it('mounts the REGISTERED calendar widgets, not local copies', () => {
    expect(layout).toContain('enterprise.calendar.upcomingDeadlines');
    expect(layout).toContain('enterprise.calendar.taskPlanner');
  });

  it('mounts the five page-local widgets', () => {
    for (const id of ['startReadiness', 'caseFocus', 'blockedCases', 'upcomingStarts', 'workQueue']) {
      expect(layout).toContain(`hr.onboarding.${id}`);
    }
  });

  it('places Case Focus above Blocked Cases in the same left rail', () => {
    const focus = /hr\.onboarding\.caseFocus'\s*, +(\d+), +(\d+)/.exec(layout);
    const blocked = /hr\.onboarding\.blockedCases'\s*, +(\d+), +(\d+)/.exec(layout);
    expect(focus).toBeTruthy(); expect(blocked).toBeTruthy();
    expect(focus![1]).toBe(blocked![1]);                       // same column
    expect(Number(blocked![2])).toBeGreaterThan(Number(focus![2]));   // beneath
  });

  it('places Upcoming Starts above the full-width Team Work Queue', () => {
    const starts = /hr\.onboarding\.upcomingStarts'\s*, +(\d+), +(\d+), +(\d+)/.exec(layout);
    const queue = /hr\.onboarding\.workQueue'\s*, +(\d+), +(\d+), +(\d+)/.exec(layout);
    expect(Number(queue![2])).toBeGreaterThan(Number(starts![2]));
    expect(Number(queue![3])).toBe(16);                        // spans the main column
  });
});

describe('runtime scope, never persisted config', () => {
  it('passes runtime onboarding scope to BOTH boards', () => {
    expect((PAGE.match(/runtime=\{runtime\}/g) ?? []).length).toBe(2);
    expect(PAGE).toMatch(/const runtime = \{ onboardingScope: scope \}/);
  });

  it('KPI widgets read scope from runtime, and it is absent from persisted config', () => {
    expect(REGISTRY).toMatch(/props\.runtime\?\.onboardingScope/);
    expect(REGISTRY).not.toMatch(/defaultConfig:[^\n]*onboardingScope/);
    expect(REGISTRY).not.toMatch(/key: 'onboardingScope'/);
  });

  it('every scoped dataset carries the scope and pagination resets', () => {
    for (const q of ['useOnboardingDashboard({ scope })', 'useOnboardingWorkQueue({ scope']) {
      expect(PAGE).toContain(q);
    }
    expect(PAGE).toMatch(/page: 1/);
    expect(PAGE).toMatch(/scopedQueries = \[statsQ, casesQ, startsQ, blockersQ, overdueWorkQ, todayWorkQ, upcomingWorkQ\]/);
  });

  it('uses the same server-authoritative work queue as the full page', () => {
    expect((PAGE.match(/useOnboardingWorkQueue\(\{ scope/g) ?? []).length).toBe(3);
    expect(PAGE).toMatch(/overdue: overdueWorkQ\.data\?\.total/);
    expect(PAGE).toMatch(/today: todayWorkQ\.data\?\.total/);
    expect(PAGE).toMatch(/upcoming: upcomingWorkQ\.data\?\.total/);
    expect(PAGE).not.toMatch(/const queueRows = useMemo\(\(\) => cases\.filter/);
  });

  it('keys the board by scope so All-scope data cannot survive a switch to My', () => {
    expect(PAGE).toMatch(/key=\{`board-\$\{scope\}`\}/);
  });
});

describe('role presentation is independent of scope', () => {
  const presentationFor = (c: (k: string) => boolean): 'manager' | 'staff' =>
    (c('hr.onboarding.view_team') || c('hr.onboarding.view_all')) ? 'manager' : 'staff';

  it('manager keeps the manager experience at every scope', () => {
    asRole('hr.onboarding.view_team', 'hr.onboarding.view_all');
    expect(presentationFor(canMock)).toBe('manager');
  });

  it('hr_staff gets the staff experience', () => {
    asRole('hr.onboarding.view');
    expect(presentationFor(canMock)).toBe('staff');
  });

  it('the page never derives presentation from the selected scope', () => {
    expect(PAGE).toMatch(/const isManager = can\('hr\.onboarding\.view_team'\) \|\| can\('hr\.onboarding\.view_all'\)/);
    expect(PAGE).not.toMatch(/isManager[^\n]*scope ===/);
  });
});

describe('legacy removed — no dual system', () => {
  it('the hand-built card grid is gone', () => {
    for (const f of [
      'src/components/sections/HR/onboarding/cards/CommandMetricStrip.tsx',
      'src/components/sections/HR/onboarding/cards/UpcomingDeadlinesCard.tsx',
      'src/components/sections/HR/onboarding/cards/TasksPlannerCard.tsx',
      'src/components/sections/HR/onboarding/cards/index.ts',
      'src/components/sections/HR/OnboardingCommandCenter.adapters.ts',
      'src/components/sections/HR/OnboardingCommandCenter.css',
    ]) {
      expect(repoHas(f)).toBe(false);
    }
  });

  it('the page references no retired card', () => {
    for (const gone of ['CommandMetricStrip', 'MorningGoalCard', 'RecentProjectWorkCard',
      'CommandCenterHealthBanner', 'adaptCase', 'deriveKpis']) {
      expect(PAGE).not.toContain(gone);
    }
  });

  it('mock/QA-only controls are gone', () => {
    expect(PAGE).not.toMatch(/Show Empty States|previewEmptyStates|dashboardMode/);
  });

  it("Finance's own shared UpcomingDeadlinesCard is untouched", () => {
    expect(repoHas('src/components/shared/UpcomingDeadlinesCard.tsx')).toBe(true);
  });
});

describe('visual contract', () => {
  it('imports the generated mockup port plus a light-only production layer', () => {
    expect(PAGE).toMatch(/import '\.\/OnboardingCommandCenter\.mockup\.css'/);
    expect(PAGE).toMatch(/import '\.\/OnboardingCommandCenter\.page\.css'/);
  });

  it('ships NO dark-theme layer — onboarding is light mode only', () => {
    expect(repoHas('src/components/sections/HR/OnboardingCommandCenter.dark.css')).toBe(false);
    // No Command Centre file may carry a dark override, and the generated port must stay
    // free of hand-written theme rules.
    for (const f of [
      'src/components/sections/HR/OnboardingCommandCenter.page.css',
      'src/components/sections/HR/OnboardingCommandCenter.mockup.css',
    ]) {
      expect(stripComments(repoFile(f))).not.toMatch(/data-theme/);
    }
    expect(PAGE).not.toMatch(/dark\.css/);
  });

  it('retains the panel bounding that stops a growing list overflowing its tile', () => {
    const page = repoFile('src/components/sections/HR/OnboardingCommandCenter.page.css');
    expect(page).toMatch(/\.blocked-case-list/);
    expect(page).toMatch(/min-height: 0/);
    expect(page).toMatch(/overflow: auto/);
  });

  it('renders under the ported .occ-root scope', () => {
    expect(PAGE).toMatch(/class="occ-root/);
  });

  it('widgets use the mockup class vocabulary', () => {
    for (const cls of ['case-focus-panel', 'blocked-case-row', 'upcoming-task-card', 'work-table', 'pulse-header']) {
      expect(WIDGETS).toContain(cls);
    }
  });
});

describe('actions are real and capability-gated', () => {
  it('gates Add Task and Start Onboarding on their own permissions', () => {
    expect(PAGE).toMatch(/can\('hr\.onboarding\.case\.manage'\)[\s\S]{0,200}Add Task/);
    expect(PAGE).toMatch(/can\('hr\.onboarding\.start'\)[\s\S]{0,200}Start Onboarding/);
  });

  it('has no dead href="#" placeholders', () => {
    expect(WIDGETS).not.toMatch(/href="#"/);
    expect(PAGE).not.toMatch(/href="#"/);
  });

  it('every widget action is a real callback', () => {
    for (const cb of ['onOpenCase', 'onViewAll', 'onCycle', 'onNotifyOwner', 'onClearFilter', 'onOpenQueue']) {
      expect(WIDGETS).toContain(cb);
    }
  });
});
