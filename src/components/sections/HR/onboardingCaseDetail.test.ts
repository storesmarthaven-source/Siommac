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

describe('only Overview carries a WidgetBoard', () => {
  it('gates the board and its customize controls on the Overview tab', () => {
    // Paren/whitespace-tolerant; the assertion is that the board is gated on Overview.
    expect(SRC).toMatch(/tab === 'overview' && \(\s*<WidgetBoard/);
    expect(SRC).toMatch(/tab === 'overview' && canEdit && \(/);
  });

  it('mounts exactly one board', () => {
    expect((SRC.match(/<WidgetBoard\s/g) ?? []).length).toBe(1);
  });

  it('defaults to the four approved widgets and nothing else', () => {
    const layout = SRC.slice(SRC.indexOf('defaultCaseLayout'), SRC.indexOf('export function OnboardingCaseDetail'));
    for (const id of ['activeTasks', 'activationReadiness', 'readinessByDomain', 'blockersTable']) {
      expect(layout).toContain(`hr.onboarding.case.${id}`);
    }
    // Handoffs has its own permanent tab; case actions are rows inside Tasks.
    expect(layout).not.toContain('handoffsTable');
    expect(layout).not.toContain('customActions');
    expect((layout.match(/defInst\(/g) ?? []).length).toBe(4);
  });

  it('keeps the existing production widget keys (not the mockup data-* names)', () => {
    expect(SRC).not.toContain('hr.onboarding.case.active-tasks');
    expect(SRC).not.toContain('hr.onboarding.case.readiness-matrix');
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

  it('highlights the focused row by class, with no DOM polling', () => {
    expect(SRC).toMatch(/focusedRecordId === t\.taskId \? "ocd-focused"/);
    expect(SRC).toMatch(/focusedRecordId === b\.blockerId \? "ocd-focused"/);
    expect(SRC).toMatch(/focusedRecordId === h\.handoffId \? "ocd-focused"/);
    expect(SRC).not.toContain('scrollIntoView');
    expect(SRC).not.toContain('setTimeout(tick');
  });

  it('re-targets the tab when the focus changes', () => {
    expect(SRC).toMatch(/useEffect\(\(\) => \{ setTab\(focusTab\(focus\)\); \}, \[focus\]\)/);
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

  it('reuses the existing renderers for the three work tabs', () => {
    for (const body of ['tasksBody()', 'handoffsBody()', 'blockersBody()']) {
      expect(SRC).toContain(body);
    }
  });

  it('keeps routing queues distinct from accountable people', () => {
    expect(SRC).toContain('Queue · Accountable');
    expect(SRC).toContain('queueLabel(t.moduleKey ?? t.ownerRole)');
    expect(SRC).toContain("t.assignedToName ?? 'Unassigned'");
  });

  it('provides real handoff and communication actions with permission gates', () => {
    for (const action of ['handleRetryHandoff', 'handleAcceptHandoff', 'handleCompleteHandoff', 'handleCancelHandoff']) {
      expect(SRC).toContain(action);
    }
    expect(SRC).toMatch(/canManageCase && c\.status === 'failed'/);
    expect(SRC).toContain('Send Message');
    expect(SRC).toContain('submitCommunication');
  });

  it('keeps the Overview priority list concise and links to the full Tasks workspace', () => {
    expect(SRC).toMatch(/\.slice\(0, 5\)/);
    expect(SRC).toContain('priorityTasksBody()');
    expect(SRC).toMatch(/onClick=\{\(\) => setTab\('tasks'\)\}>View all/);
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
