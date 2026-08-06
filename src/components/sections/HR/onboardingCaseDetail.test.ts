/**
 * onboardingCaseDetail.test.ts — the seven-tab Case Detail shell contract.
 *
 * The pure mapping is tested directly. The shell's structure is asserted by reading the
 * SOURCE: RGL is CJS under preact/compat so vitest cannot render a WidgetBoard (documented
 * in vitest.config.ts), and the properties that matter here — which tabs exist, that only
 * Overview holds a board, that Audit is absent rather than disabled — are structural facts
 * a render test in this repo cannot reach.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CASE_TABS, CASE_FOCUS_TAB, DEFAULT_CASE_TAB,
  focusTab, focusRecordId, focusEvidenceId, type CaseFocusRequest,
} from './onboardingCaseFocus';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const has = (rel: string): boolean => existsSync(resolve(process.cwd(), rel));
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SRC = stripComments(read('src/components/sections/HR/OnboardingCaseDetail.tsx'));
const req = (o: Partial<CaseFocusRequest>): CaseFocusRequest =>
  ({ sourceType: 'task', sourceId: 's-1', ...o }) as CaseFocusRequest;

describe('the seven permanent tabs', () => {
  it('declares exactly the approved seven, in order', () => {
    expect([...CASE_TABS]).toEqual([
      'overview', 'tasks', 'handoffs', 'blockers', 'communications', 'timeline', 'audit',
    ]);
  });

  it('renders a real tablist with every tab', () => {
    expect(SRC).toMatch(/role="tablist"/);
    expect(SRC).toMatch(/role="tab"/);
    expect(SRC).toMatch(/role="tabpanel"/);
    for (const t of CASE_TABS) expect(SRC).toContain(`tab === '${t}'`);
  });

  it('opens on Overview by default', () => {
    expect(DEFAULT_CASE_TAB).toBe('overview');
    expect(focusTab(null)).toBe('overview');
    expect(focusTab(undefined)).toBe('overview');
  });
});

/**
 * SUPERSEDED CONTRACT — recorded openly rather than quietly deleted.
 *
 * This block previously asserted that Overview carried a customizable WidgetBoard whose
 * default layout was four approved widgets ("only Overview carries a WidgetBoard", "mounts
 * exactly one board", "defaults to the four approved widgets"). That came from an earlier
 * reading of ONBOARDING_UI_PAGES_SPEC §2.
 *
 * The approved design — docs/mockups/onboarding-case-detail-implementation-ready.html — is
 * the authority for this page, and it specifies Overview as a FIXED `work-area` composition:
 * Priority Tasks and Readiness by Domain in the primary column, Key Blockers in the rail.
 * There is no board, no customize strip and no widget library on Case Detail. Activation
 * Readiness is not a fourth tile either: the design reports it in the matrix summary strip
 * and in the profile strip's stage meter, which is where it now lives.
 *
 * The Command Centre remains a WidgetBoard. Only Case Detail changed.
 */
describe('Overview is the approved fixed composition, not a board', () => {
  it('mounts no WidgetBoard and imports nothing from the widget system', () => {
    expect(SRC).not.toContain('<WidgetBoard');
    expect(SRC).not.toContain('WidgetBoardToolbar');
    expect(SRC).not.toContain('WidgetLibraryModal');
    expect(SRC).not.toContain('useBoardLayout');
    expect(SRC).not.toContain('@ui/widgets');
  });

  it('renders the three approved Overview surfaces inside the mockup work-area', () => {
    expect(SRC).toMatch(/class="work-area"/);
    expect(SRC).toMatch(/class="case-primary-column"/);
    expect(SRC).toMatch(/class="rail"/);
    for (const surface of ['priorityTasksWidget()', 'readinessMatrixWidget()', 'keyBlockersWidget()']) {
      expect(SRC).toContain(surface);
    }
  });

  it('keeps no customize affordance, since there is nothing left to customize', () => {
    expect(SRC).not.toContain('Customize overview');
    expect(SRC).not.toContain('customize-strip');
    expect(SRC).not.toContain('setEditing');
  });
});

describe('Audit is permission-gated', () => {
  it('is filtered out of the tab list without hr.onboarding.audit.view', () => {
    expect(SRC).toMatch(/can\('hr\.onboarding\.audit\.view'\)/);
    expect(SRC).toMatch(/CASE_TABS\.filter\(t => t !== 'audit' \|\| showAudit\)/);
  });

  it('renders its panel only when permitted, and never merely disabled', () => {
    expect(SRC).toMatch(/tab === 'audit' && showAudit/);
    expect(SRC).not.toMatch(/disabled=\{!showAudit\}/);
  });

  it('falls back to Overview if a hidden tab is somehow selected', () => {
    expect(SRC).toMatch(/if \(!visibleTabs\.includes\(tab\)\) setTab\(DEFAULT_CASE_TAB\)/);
  });

  it('does not query audit data without the permission', () => {
    expect(SRC).toMatch(/useOnboardingAudit\(tab === 'audit' && showAudit \? caseId : null\)/);
  });
});

describe('Work Queue drill-through', () => {
  it('routes each work type to its owning tab', () => {
    expect(CASE_FOCUS_TAB.task).toBe('tasks');
    expect(CASE_FOCUS_TAB.evidence).toBe('tasks');
    expect(CASE_FOCUS_TAB.handoff).toBe('handoffs');
    expect(CASE_FOCUS_TAB.blocker).toBe('blockers');
  });

  it('selects the row itself for task, handoff and blocker', () => {
    expect(focusRecordId(req({ sourceType: 'task', sourceId: 't-1' }))).toBe('t-1');
    expect(focusRecordId(req({ sourceType: 'handoff', sourceId: 'h-1' }))).toBe('h-1');
    expect(focusRecordId(req({ sourceType: 'blocker', sourceId: 'b-1' }))).toBe('b-1');
  });

  it('resolves evidence to its PARENT TASK, keeping the submission id separately', () => {
    const f = req({ sourceType: 'evidence', sourceId: 'ev-1', relatedTaskId: 't-9' });
    expect(focusRecordId(f)).toBe('t-9');
    expect(focusEvidenceId(f)).toBe('ev-1');
  });

  it('returns null for parentless evidence instead of selecting the wrong row', () => {
    expect(focusRecordId(req({ sourceType: 'evidence', sourceId: 'ev-1' }))).toBeNull();
    expect(SRC).toMatch(/no longer linked to a task/);
  });

  it('highlights the focused record by class, with no DOM polling', () => {
    // Tasks is a table; Handoffs and Blockers are card lists in the approved design — all
    // three carry the same class, applied by comparison rather than by a DOM query.
    expect(SRC).toMatch(/focusedRecordId === r\.id \? 'ocd-focused'/);
    expect(SRC).toMatch(/focusedRecordId === b\.blockerId \? ' ocd-focused'/);
    expect(SRC).toMatch(/focusedRecordId === h\.handoffId \? ' ocd-focused'/);
    expect(SRC).not.toContain('scrollIntoView');
    expect(SRC).not.toContain('setTimeout(tick');
  });

  // Behaviour (re-target on a new target, KEEP the user's tab on an equivalent re-render) is
  // asserted for real in OnboardingCaseDetail.tabs.test.tsx. This guards the one structural
  // property a render test cannot see: that the effect keys on the drill-through TARGET and
  // not on `focus` object identity. Identity-keying re-ran on every parent re-render and
  // silently forced the tab back, which read as "clicking a tab does nothing".
  it('re-targets on a new focus TARGET, never on focus object identity', () => {
    expect(SRC).toMatch(/const focusKey = focus \? `\$\{focus\.sourceType\}:\$\{focus\.sourceId\}/);
    expect(SRC).toMatch(/lastAppliedFocusKey\.current === focusKey/);
    expect(SRC).toMatch(/\}, \[focusKey, focusTabValue\]\)/);
    // The old identity-keyed effect must not come back.
    expect(SRC).not.toMatch(/setTab\(focusTab\(focus\)\); \}, \[focus\]\)/);
  });
});

describe('states and data reuse', () => {
  it('loads the three tab workspaces only when their tab is open', () => {
    expect(SRC).toMatch(/useOnboardingCommunications\(tab === 'communications' \? caseId : null\)/);
    expect(SRC).toMatch(/useOnboardingTimeline\(tab === 'timeline' \? caseId : null\)/);
  });

  it('distinguishes loading, empty and error in one shared helper', () => {
    expect(SRC).toMatch(/if \(q\.isLoading\) return/);
    expect(SRC).toMatch(/if \(q\.isError\) return/);
    expect(SRC).toMatch(/ocd-panel-state is-error/);
  });

  it('derives readiness from the tasks already loaded — no new endpoint', () => {
    expect(SRC).toMatch(/const readiness = useMemo\(/);
    expect(SRC).toMatch(/t\.moduleKey \?\? t\.ownerRole/);
    expect(SRC).not.toMatch(/useOnboardingReadiness|readiness\/list|case\/readiness/);
  });

  it('gives every tab its own workspace renderer, all on the existing hooks', () => {
    for (const body of [
      'overviewWorkspace()', 'tasksWorkspace()', 'handoffsWorkspace()', 'blockersWorkspace()',
      'communicationsWorkspace()', 'timelineWorkspace()', 'auditWorkspace()',
    ]) {
      expect(SRC).toContain(body);
    }
  });

  it('keeps routing queues distinct from accountable people', () => {
    // "HSE Queue" is where work routes; the assignee is who is personally accountable. The
    // design shows the short domain in a column header and the queue where a person would
    // route to it — they must never collapse into one label.
    expect(SRC).toContain('queueLabel(t.moduleKey ?? t.ownerRole)');
    expect(SRC).toContain('domainLabel(t.moduleKey ?? t.ownerRole)');
    expect(SRC).toContain("t.assignedToName ?? 'Unassigned'");
    expect(SRC).toMatch(/Routing stays with \{queueLabel/);
  });

  it('provides real handoff, blocker and communication actions with permission gates', () => {
    for (const action of [
      'handleRetryHandoff', 'handleAcceptHandoff', 'handleCompleteHandoff', 'handleCancelHandoff',
      'handleResolve', 'handleEscalate', 'handleWaive', 'handleNotifyBlockerOwner',
    ]) {
      expect(SRC).toContain(action);
    }
    expect(SRC).toMatch(/canManageCase && c\.status === 'failed'/);
    expect(SRC).toContain('New Message');
    expect(SRC).toContain('submitCommunication');
  });

  it('keeps the Overview priority list concise and links to the full Tasks workspace', () => {
    expect(SRC).toMatch(/\.slice\(0, 5\)/);
    expect(SRC).toContain('priorityTasksWidget()');
    expect(SRC).toMatch(/onClick=\{\(\) => setTab\('tasks'\)\}>View all/);
  });

  it('makes every toolbar filter real — each one applies AND can be cleared', () => {
    // A filter that renders but never narrows anything is a dead control. Each workspace
    // filters the rows it already holds, and each offers a Clear once it is engaged.
    for (const state of [
      'taskFiltersActive', 'blockerFiltersActive', 'commFiltersActive',
      'filteredWorkRows', 'filteredHandoffs', 'filteredBlockers',
    ]) {
      expect(SRC).toContain(state);
    }
    expect(SRC).toContain('clearTaskFilters');
    expect((SRC.match(/>Clear</g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe('the ported design owns the whole page body', () => {
  it('emits the mockup vocabulary for every workspace', () => {
    for (const cls of [
      'work-area', 'case-primary-column', 'priority-task-list', 'readiness-matrix',
      'case-blocker-compact-list', 'tab-workspace', 'workspace-grid', 'workspace-main',
      'workspace-rail', 'table-wrap', 'blocker-work-item', 'handoff-work-item',
      'thread', 'timeline-full', 'audit-change',
    ]) {
      expect(SRC).toContain(cls);
    }
  });

  it('carries no legacy Case Detail presentation', () => {
    // The `obx-*` vocabulary belonged to the pre-rebuild body. onboardingCase.css is imported
    // by 11 other files and must never be deleted — it is simply no longer imported HERE.
    expect(SRC).not.toMatch(/\bobx-/);
    expect(SRC).not.toContain("import './onboardingCase.css'");
    expect(SRC).not.toContain('ocd-workspace');
  });

  it('never emits data-tab-panel, which the port hides by default', () => {
    // `.ocd-root [data-tab-panel]{display:none}` comes straight from the mockup's own JS tab
    // switcher. Panels here are rendered conditionally, so emitting it would hide every one.
    expect(SRC).not.toContain('data-tab-panel');
    const css = read('src/components/sections/HR/OnboardingCaseDetail.mockup.css');
    expect(css).toContain('[data-tab-panel]');
  });
});

describe('superseded code is gone', () => {
  it('deleted the unreferenced .onb-cd stylesheet', () => {
    expect(has('src/components/sections/HR/onboardingCaseDetailPage.css')).toBe(false);
    expect(stripComments(read('scripts/port-mockup-css.mjs'))).not.toContain('onboardingCaseDetailPage.css');
  });

  it('carries the ported mockup under its own root scope', () => {
    expect(SRC).toMatch(/import '\.\/OnboardingCaseDetail\.mockup\.css'/);
    expect(SRC).toMatch(/class="hr-onboarding-case ocd-root"/);
  });
});
