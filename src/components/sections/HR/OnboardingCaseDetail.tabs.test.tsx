/**
 * OnboardingCaseDetail.tabs.test.tsx — ISOLATION TEST for the blocking tab-state defect.
 *
 * Live on the dev server, Case Detail renders and polls normally but every `setTab` is a
 * no-op: clicking Tasks leaves `aria-selected="false"`, only `casePanel-overview` ever
 * exists, and the click produces zero DOM mutations while the same subtree logs ~47
 * mutations over 7 idle seconds. Six of the seven operational tabs are unreachable.
 *
 * This test renders the component DIRECTLY, bypassing the HR module mount path entirely.
 * That is the whole point: it is the discriminator.
 *
 *   FAILS  → the defect is inside Case Detail (inspect only what can write `tab`:
 *            the `focus` synchronisation effect and the visible-tab effect).
 *   PASSES → the component is sound; the defect is introduced by the module mount path,
 *            which justifies a separate shell-level investigation.
 *
 * The RGL-backed WidgetBoard is stubbed because react-grid-layout is CJS and cannot render
 * under vitest/jsdom (documented in vitest.config.ts and relied on by
 * PayrollCommandCenter.loadingGate.test.tsx). Stubbing the BOARD does not stub the tab
 * state — `tab`, `setTab` and both effects that can write it are the component's own and
 * run exactly as they do in the browser.
 */
import { act, render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingCaseDetail } from './OnboardingCaseDetail';
import type { CaseFocusRequest } from './onboardingCaseFocus';
import type { OnboardingCaseRow } from '../../../../types/hrOnboarding';

// ── stubs ────────────────────────────────────────────────────────────────────────────
// The board is CJS-only under vitest; everything else is stubbed only so the component can
// mount without a QueryClient or network. None of it touches tab state.
vi.mock('@ui/widgets', () => ({
  WidgetBoard: () => null,
  WidgetBoardToolbar: () => null,
  WidgetLibraryModal: () => null,
  useBoardLayout: (pageKey: string) => ({
    layout: { pageKey, zones: { main: [] } },
    addWidget: vi.fn(), updateZoneLayout: vi.fn(), saveLayout: vi.fn(), cancelLayout: vi.fn(),
    setAsDefault: vi.fn(), resetLayout: vi.fn(),
    isDefaultDirty: false, isDirty: false, isSaving: false,
  }),
  WIDGET_REGISTRY: [],
  commitPreviewWidget: vi.fn(),
  placeWidgetsAtBottom: (w: unknown) => w,
}));

// Names live INSIDE the factory: vi.mock is hoisted above every top-level binding.
vi.mock('@api/hr/onboarding', () => {
  const queryHooks = [
    'useOnboardingTasksList', 'useOnboardingHandoffsList', 'useOnboardingBlockersList',
    'useOnboardingCaseActions', 'useOnboardingCommunications', 'useOnboardingTimeline',
    'useOnboardingAudit',
  ];
  const mutationHooks = [
    'useOnboardingCompleteTask', 'useOnboardingReassignTask', 'useOnboardingBlockTask',
    'useOnboardingUnblockTask', 'useOnboardingRetryHandoff', 'useOnboardingAcceptHandoff',
    'useOnboardingCompleteHandoff', 'useOnboardingCancelHandoff', 'useOnboardingResolveBlocker',
    'useOnboardingEscalateBlocker', 'useOnboardingWaiveBlocker', 'useOnboardingPauseCase',
    'useOnboardingResumeCase', 'useOnboardingMarkReady', 'useOnboardingCompleteCase',
    'useOnboardingCancelCase', 'useOnboardingReassignOwner', 'useOnboardingProvisionAccount',
    'useOnboardingAddCaseAction', 'useOnboardingUpdateCaseAction', 'useOnboardingCompleteCaseAction',
    'useOnboardingCancelCaseAction', 'useOnboardingSendCommunication', 'useOnboardingResendCommunication',
  ];
  const mod: Record<string, unknown> = {};
  for (const h of queryHooks) mod[h] = () => ({ data: [], isLoading: false, isError: false });
  for (const h of mutationHooks) mod[h] = () => ({ mutateAsync: vi.fn(), isPending: false });
  return mod;
});
vi.mock('@api/hr/employees', () => ({ useHrEmployees: () => ({ data: [], isLoading: false }) }));
// Audit must be VISIBLE here — the seventh tab is permission-gated and absent without it.
vi.mock('@lib/permissions', () => ({ can: () => true }));
vi.mock('@store/session', () => ({
  useSessionStore: (sel: (s: unknown) => unknown) => sel({ isManager: true, isAdmin: true }),
  selectIsManager: () => true,
  selectIsAdmin: () => true,
}));
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

afterEach(cleanup);

describe('Case Detail tab state — isolation of the blocking defect', () => {
  it('lands on Overview when opened directly', () => {
    renderCaseDetail();
    expect(screen.getByRole('tab', { name: /Overview/ }).getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('casePanel-overview')).not.toBeNull();
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
