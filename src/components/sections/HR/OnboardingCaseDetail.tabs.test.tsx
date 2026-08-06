/**
 * OnboardingCaseDetail.tabs.test.tsx — REGRESSION GUARD for the tab-state defect that once
 * made six of the seven operational tabs unreachable.
 *
 * Live on the dev server, Case Detail rendered and polled normally but every `setTab` was a
 * no-op: clicking Tasks left `aria-selected="false"`, only `casePanel-overview` ever existed,
 * and the click produced zero DOM mutations while the same subtree logged ~47 mutations over
 * 7 idle seconds. Two distinct causes were found and fixed — a `focus`-identity-keyed effect
 * that forced the tab back on every parent re-render, and a TDZ read of `blockerOpen` that
 * threw during render and aborted every repaint. Both are guarded below.
 *
 * This test renders the component DIRECTLY, bypassing the HR module mount path entirely, so
 * a failure here is unambiguously inside Case Detail.
 *
 * No board stub is needed any more: the Overview tab is the approved fixed `work-area`
 * composition, not a react-grid-layout board, so nothing in this page is CJS-only under
 * vitest/jsdom.
 */
import { act, render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingCaseDetail } from './OnboardingCaseDetail';
import type { CaseFocusRequest } from './onboardingCaseFocus';
import type { OnboardingCaseRow } from '../../../../types/hrOnboarding';

// ── stubs ────────────────────────────────────────────────────────────────────────────
// Stubbed only so the component can mount without a QueryClient or network. None of it
// touches tab state.
// Per-test data. `vi.hoisted` so the mock factory (which is hoisted above every top-level
// binding) can close over it while the tests below still mutate it by reference.
const fixtures = vi.hoisted(() => ({ tasks: [] as unknown[], blockers: [] as unknown[] }));

// Names live INSIDE the factory: vi.mock is hoisted above every top-level binding.
vi.mock('@api/hr/onboarding', () => {
  const queryHooks = [
    'useOnboardingCaseActions', 'useOnboardingCommunications', 'useOnboardingTimeline',
    'useOnboardingAudit', 'useOnboardingHandoffsList',
  ];
  const mutationHooks = [
    'useOnboardingCompleteTask', 'useOnboardingReassignTask', 'useOnboardingBlockTask',
    'useOnboardingUnblockTask', 'useOnboardingRetryHandoff', 'useOnboardingAcceptHandoff',
    'useOnboardingCompleteHandoff', 'useOnboardingCancelHandoff', 'useOnboardingResolveBlocker',
    'useOnboardingEscalateBlocker', 'useOnboardingWaiveBlocker', 'useOnboardingNotifyBlockerOwner',
    'useOnboardingPauseCase',
    'useOnboardingResumeCase', 'useOnboardingMarkReady', 'useOnboardingCompleteCase',
    'useOnboardingCancelCase', 'useOnboardingReassignOwner', 'useOnboardingProvisionAccount',
    'useOnboardingAddCaseAction', 'useOnboardingUpdateCaseAction', 'useOnboardingCompleteCaseAction',
    'useOnboardingCancelCaseAction', 'useOnboardingSendCommunication', 'useOnboardingResendCommunication',
  ];
  const mod: Record<string, unknown> = {};
  for (const h of queryHooks) mod[h] = () => ({ data: [], isLoading: false, isError: false });
  for (const h of mutationHooks) mod[h] = () => ({ mutateAsync: vi.fn(), isPending: false });
  mod['useOnboardingTasksList'] = () => ({ data: fixtures.tasks, isLoading: false, isError: false });
  mod['useOnboardingBlockersList'] = () => ({ data: fixtures.blockers, isLoading: false, isError: false });
  return mod;
});
vi.mock('@api/hr/employees', () => ({ useHrEmployees: () => ({ data: [], isLoading: false }) }));
// Audit must be VISIBLE here — the seventh tab is permission-gated and absent without it.
vi.mock('@lib/permissions', () => ({ can: () => true }));
vi.mock('@store/onboardingCase', () => ({
  useOnboardingCaseStore: (sel: (s: unknown) => unknown) => sel({ setCase: vi.fn(), clear: vi.fn() }),
}));
vi.mock('./OnboardingAddTaskModal', () => ({ OnboardingAddTaskModal: () => null }));

const caseRow = {
  caseId: 'case-1', caseNo: 'ONB-2026-0001', employeeName: 'Damani Baptiste',
  employeePhotoUrl: null, packageLabel: 'Office / Admin', ownerId: 'usr-1',
  ownerName: 'Lila Auguste', departmentName: 'Administration', workerType: 'employee',
  status: 'in_progress',
} as unknown as OnboardingCaseRow;

function renderCaseDetail(): void {
  // No `focus` — a direct open, which must land on Overview.
  render(<OnboardingCaseDetail caseRow={caseRow} onBack={vi.fn()} onToast={vi.fn()} />);
}

afterEach(() => { cleanup(); fixtures.tasks = []; fixtures.blockers = []; });

describe('Case Detail tab state — isolation of the blocking defect', () => {
  it('lands on Overview when opened directly', () => {
    renderCaseDetail();
    expect(screen.getByRole('tab', { name: /Overview/ }).getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('casePanel-overview')).not.toBeNull();
  });

  /**
   * REGRESSION GUARD for the TDZ crash that froze the page (`f2c633d4`).
   *
   * `blockerOpen` was a `const` declared ~166 lines BELOW the `blocked` useMemo that calls
   * it. An EMPTY blocker list hid it completely — `[].filter(cb)` never invokes `cb` — so
   * every test above passed while a real case threw "Cannot access 'blockerOpen' before
   * initialization" on its first render with data. A throw during render aborts the update,
   * which is why clicks ran their handlers and nothing ever repainted.
   *
   * So this case must carry NON-EMPTY blockers and tasks: that is the only shape that
   * exercises the callback at all.
   */
  it('renders and switches tabs with real blockers loaded (TDZ guard)', () => {
    fixtures.blockers = [{
      blockerId: 'blk-1', caseId: 'case-1', caseNo: 'ONB-2026-0001', employeeName: 'Damani Baptiste',
      employeePhotoUrl: null, blockerKey: 'hse.induction', blockerTitle: 'Site induction not completed',
      blockingModule: 'hse', severity: 'critical', status: 'active', ownerId: null,
      ownerName: 'System Admin', dueAt: null, ageDays: 23, taskId: null, handoffId: null,
    }];
    fixtures.tasks = [{
      taskId: 'tsk-1', caseId: 'case-1', caseNo: 'ONB-2026-0001', employeeId: null, employeeName: null,
      employeePhotoUrl: null, packageKey: 'office_admin', taskKey: 'hse.induction',
      taskTitle: 'Complete site induction', ownerRole: 'hse', moduleKey: 'hse', assignedTo: null,
      assignedToName: null, status: 'blocked', dueAt: null, completedAt: null,
      isBlocking: true, requiresEvidence: true, priority: 'high',
    }];

    renderCaseDetail();

    // The Overview composition painted at all — the crash aborted every render.
    expect(screen.getByText('Key Blockers')).toBeTruthy();
    expect(screen.getByText('Site induction not completed')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Blockers/ }));
    expect(document.getElementById('casePanel-blockers')).not.toBeNull();
    expect(document.getElementById('casePanel-overview')).toBeNull();
  });

  /**
   * REGRESSION GUARD for the actual defect.
   *
   * The focus effect must react to a genuinely NEW drill-through target, not to `focus`
   * object identity. A parent that re-renders and hands down an equivalent-but-new focus
   * object silently discarded the user's tab selection and forced them back to the focus
   * tab — which is exactly the "clicking a tab does nothing" symptom.
   *
   * Focus resolves to `blockers` here so that clicking Tasks is a real transition.
   */
  it('keeps the user\'s tab when the parent re-renders with an equivalent focus object', async () => {
    const focusA: CaseFocusRequest = { sourceType: 'blocker', sourceId: 'blk-1' };
    // Same target, different object — what a re-rendering parent produces.
    const focusB: CaseFocusRequest = { sourceType: 'blocker', sourceId: 'blk-1' };

    const { rerender } = render(
      <OnboardingCaseDetail caseRow={caseRow} onBack={vi.fn()} onToast={vi.fn()} focus={focusA} />,
    );
    // The drill-through lands on its own tab.
    expect(screen.getByRole('tab', { name: /Blockers/ }).getAttribute('aria-selected')).toBe('true');

    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Tasks/ })); });
    expect(screen.getByRole('tab', { name: /Tasks/ }).getAttribute('aria-selected')).toBe('true');

    // Parent re-renders. Nothing about the drill-through changed — only the object identity.
    await act(async () => {
      rerender(
        <OnboardingCaseDetail caseRow={caseRow} onBack={vi.fn()} onToast={vi.fn()} focus={focusB} />,
      );
    });

    expect(screen.getByRole('tab', { name: /Tasks/ }).getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('casePanel-tasks')).not.toBeNull();
  });

  it('still re-targets when a genuinely different record is drilled into', async () => {
    const { rerender } = render(
      <OnboardingCaseDetail caseRow={caseRow} onBack={vi.fn()} onToast={vi.fn()}
        focus={{ sourceType: 'blocker', sourceId: 'blk-1' }} />,
    );
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /Tasks/ })); });

    // A NEW target must still win — the guard must not freeze the tab.
    await act(async () => {
      rerender(
        <OnboardingCaseDetail caseRow={caseRow} onBack={vi.fn()} onToast={vi.fn()}
          focus={{ sourceType: 'handoff', sourceId: 'hnd-9' }} />,
      );
    });

    expect(screen.getByRole('tab', { name: /Handoffs/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('switches to Tasks on click — selected tab and rendered panel both follow', () => {
    renderCaseDetail();

    fireEvent.click(screen.getByRole('tab', { name: /Tasks/ }));

    // 1. Tasks becomes the selected tab.
    expect(screen.getByRole('tab', { name: /Tasks/ }).getAttribute('aria-selected')).toBe('true');
    // 2. Its panel renders.
    expect(document.getElementById('casePanel-tasks')).not.toBeNull();
    // 3. Overview's panel is gone — the tabs are exclusive, not additive.
    expect(document.getElementById('casePanel-overview')).toBeNull();
  });
});
