// ============================================================================
// Finance Payroll — Overtime rule RESOLVER (pure, no DB) — Wave 4b
// Split out from overtimeRules.ts so unit tests import zero DB/audit deps.
// ============================================================================

export type OvertimeEventType = 'regular_overtime' | 'public_holiday' | 'rest_day' | 'callout' | 'night_shift';

export interface OvertimeRule {
  id: string;
  code: string;
  eventType: OvertimeEventType;
  multiplier: number;
  minimumHours: number | null;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

/**
 * Resolve the effective OT rule for an event type on a given work date. Active rules
 * whose window covers the date; the one with the LATEST effective_from wins. Returns
 * null when no rule applies (caller falls back to the entry's own multiplier).
 */
export function resolveOvertimeMultiplier(
  rules: OvertimeRule[],
  eventType: string,
  workDate: string,
): { multiplier: number; minimumHours: number | null } | null {
  const candidates = rules.filter(r =>
    r.active && r.eventType === eventType &&
    r.effectiveFrom <= workDate &&
    (r.effectiveTo == null || r.effectiveTo >= workDate),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
  const r = candidates[0]!;
  return { multiplier: r.multiplier, minimumHours: r.minimumHours };
}
