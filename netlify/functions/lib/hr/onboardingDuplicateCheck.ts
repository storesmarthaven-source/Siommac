// lib/hr/onboardingDuplicateCheck.ts — internal duplicate DETECTION for onboarding intake.
//
// WHY THIS IS NOT A SCOPED READ
// A case the actor cannot see is still a duplicate. If duplicate detection honoured display
// scope, a second onboarding case could be launched for an employee whose existing case sits
// in another team — a data-integrity defect created by a permission rule.
//
// WHY THIS IS NOT `listOnboardingCases({...}, { scope: 'all', caseIds: null })`
// That form hands a fully-unconstrained scope object to a GENERAL-PURPOSE read that returns
// complete case rows (employee names, owners, progress, blockers). It works, but it is an
// authorisation-bypass pattern: the next caller copies it somewhere it does not belong, and
// the bypass is invisible at the call site. This module instead:
//
//   • runs its own narrow query — it cannot be widened into a case list;
//   • returns ONLY a decision plus the minimum conflict facts the wizard renders;
//   • is imported solely by the intake/launch service and is exposed by NO route.
//
// It deliberately never returns caseId. An opaque id for a case the caller may not open is
// not needed to render "this worker already has onboarding in progress", and handing one out
// invites a follow-up fetch that the read gate would then have to refuse.
//
// FAILS CLOSED. A query error throws rather than returning "no duplicate": treating an
// unreadable database as "safe to launch" is exactly the swallowed-error defect that lets a
// duplicate case through.

import { sb } from '../db';
import type { OnboardingCaseStatus } from '../../../../types/hrOnboarding';

/** Statuses that represent a live onboarding case for the same worker. */
const ACTIVE_DUPLICATE_STATUSES: readonly OnboardingCaseStatus[] = [
  'draft', 'open', 'in_progress', 'blocked', 'paused', 'ready_for_activation',
];

/** The minimum safe conflict projection: enough to name the clash, nothing more. */
export interface OnboardingDuplicateConflict {
  caseNo: string;
}

export interface OnboardingDuplicateDecision {
  hasDuplicate: boolean;
  checkedAt: string;
  /** Empty when `hasDuplicate` is false. Never an organisation-wide case list. */
  cases: OnboardingDuplicateConflict[];
}

/**
 * Detect an active onboarding case for `employeeId`, independent of display scope.
 *
 * INTERNAL ONLY — call from the intake preview and the launch command. Do not expose this
 * through a route, and do not widen its projection.
 */
export async function detectActiveOnboardingDuplicate(
  employeeId: string,
): Promise<OnboardingDuplicateDecision> {
  const checkedAt = new Date().toISOString();

  if (!employeeId) return { hasDuplicate: false, checkedAt, cases: [] };

  // Narrow projection on purpose: `case_no` is the only field that leaves this module.
  const { data, error } = await sb
    .from('hr_onboarding_cases')
    .select('case_no')
    .eq('employee_id', employeeId)
    .in('status', ACTIVE_DUPLICATE_STATUSES as unknown as string[])
    .limit(10);

  // Fail closed: an unreadable duplicate check must block launch, not silently allow it.
  if (error) {
    throw Object.assign(
      new Error(`Duplicate onboarding check failed: ${error.message}`),
      { status: 500 },
    );
  }

  const rows = (data ?? []) as { case_no: string | null }[];
  const cases = rows
    .map(r => r.case_no)
    .filter((n): n is string => !!n)
    .map(caseNo => ({ caseNo }));

  return { hasDuplicate: cases.length > 0, checkedAt, cases };
}
