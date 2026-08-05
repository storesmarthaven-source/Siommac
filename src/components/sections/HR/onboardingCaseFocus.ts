/**
 * onboardingCaseFocus.ts — the Work Queue → Case Detail drill-through contract.
 *
 * Case Detail is a fixed seven-tab operating shell, so a drill-through resolves to a TAB
 * plus the record to select inside it. There is no scrolling-to-a-widget any more: that was
 * a temporary consumer written against the pre-rebuild board and has been removed.
 *
 * A direct case open passes no focus and must land on Overview.
 */

import type { OnboardingWorkSourceType } from '../../../../types/hrOnboarding';

/** The seven tabs, in their approved order. `audit` is permission-gated by the shell. */
export const CASE_TABS = [
  'overview', 'tasks', 'handoffs', 'blockers', 'communications', 'timeline', 'audit',
] as const;
export type CaseTab = typeof CASE_TABS[number];

/** Case Detail opens here when it is opened directly, with no drill-through context. */
export const DEFAULT_CASE_TAB: CaseTab = 'overview';

export interface CaseFocusRequest {
  sourceType: OnboardingWorkSourceType;
  sourceId: string;
  /** Set for an evidence row: evidence is reviewed under its parent task. */
  relatedTaskId?: string | null;
}

/** Which tab owns each kind of work. Evidence is reviewed on the Tasks tab. */
export const CASE_FOCUS_TAB: Record<OnboardingWorkSourceType, CaseTab> = {
  task:     'tasks',
  evidence: 'tasks',
  handoff:  'handoffs',
  blocker:  'blockers',
};

export function focusTab(focus: CaseFocusRequest | null | undefined): CaseTab {
  return focus ? CASE_FOCUS_TAB[focus.sourceType] : DEFAULT_CASE_TAB;
}

/**
 * The record to select in that tab.
 *
 * Evidence resolves to its PARENT TASK — the Tasks tab lists tasks, not submissions, so the
 * evidence id would select nothing. Returns null when an evidence row arrives without a
 * parent, which the shell reports rather than selecting the wrong record.
 */
export function focusRecordId(focus: CaseFocusRequest | null | undefined): string | null {
  if (!focus) return null;
  if (focus.sourceType === 'evidence') return focus.relatedTaskId ?? null;
  return focus.sourceId;
}

/** The evidence submission itself, so the Tasks tab can open it within its parent task. */
export function focusEvidenceId(focus: CaseFocusRequest | null | undefined): string | null {
  return focus?.sourceType === 'evidence' ? focus.sourceId : null;
}
