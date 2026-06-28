/**
 * src/store/onboardingCase.ts — current onboarding case (for the case-detail widget board).
 *
 * The case-detail widgets render into DETACHED gridstack roots (see WidgetBoardZone) that do
 * NOT inherit React context — only the re-provided QueryClient. So the active case can't be
 * passed via a context provider; instead the case-detail page publishes it here and each
 * registry widget reads `caseId` from this module store, then fetches with the caseId-scoped
 * onboarding hooks. One shared board layout serves every case; the data swaps via this store.
 */
import { create } from 'zustand';
import type { OnboardingCaseRow } from '../../types/hrOnboarding';

interface OnboardingCaseState {
  caseId: string | null;
  /** Snapshot of the open case row (header fields a widget may show without an extra fetch). */
  caseRow: OnboardingCaseRow | null;
  setCase: (row: OnboardingCaseRow) => void;
  clear: () => void;
}

export const useOnboardingCaseStore = create<OnboardingCaseState>(set => ({
  caseId: null,
  caseRow: null,
  setCase: row => set({ caseId: row.caseId, caseRow: row }),
  clear: () => set({ caseId: null, caseRow: null }),
}));

// Selectors (stable references — avoid re-renders from unrelated store changes).
export const selectCaseId = (s: OnboardingCaseState): string | null => s.caseId;
export const selectCaseRow = (s: OnboardingCaseState): OnboardingCaseRow | null => s.caseRow;
