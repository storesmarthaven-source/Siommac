// Unit tests for the pure overtime-rule resolver (no DB).
import { resolveOvertimeMultiplier, type OvertimeRule } from '../../netlify/functions/lib/finance/overtimeResolver';

function rule(p: Partial<OvertimeRule> & { eventType: OvertimeRule['eventType']; multiplier: number; effectiveFrom: string }): OvertimeRule {
  return {
    id: 'r-' + Math.round(p.multiplier * 100),
    code: p.code ?? p.eventType.toUpperCase(),
    eventType: p.eventType, multiplier: p.multiplier,
    minimumHours: p.minimumHours ?? null,
    active: p.active ?? true,
    effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo ?? null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

const RULES: OvertimeRule[] = [
  rule({ eventType: 'regular_overtime', multiplier: 1.5, effectiveFrom: '2000-01-01' }),
  rule({ eventType: 'public_holiday',   multiplier: 2.0, effectiveFrom: '2000-01-01' }),
  rule({ eventType: 'callout',          multiplier: 1.5, minimumHours: 3, effectiveFrom: '2000-01-01' }),
];

describe('resolveOvertimeMultiplier', () => {
  it('returns null when no rule matches the event type', () => {
    expect(resolveOvertimeMultiplier(RULES, 'night_shift', '2026-07-01')).toBeNull();
  });

  it('resolves the multiplier for a matching event type + date', () => {
    expect(resolveOvertimeMultiplier(RULES, 'public_holiday', '2026-07-01')).toEqual({ multiplier: 2.0, minimumHours: null });
  });

  it('returns the minimum billable hours (callout)', () => {
    expect(resolveOvertimeMultiplier(RULES, 'callout', '2026-07-01')).toEqual({ multiplier: 1.5, minimumHours: 3 });
  });

  it('the LATEST effective_from wins when windows overlap', () => {
    const rules = [
      rule({ eventType: 'public_holiday', multiplier: 2.0, effectiveFrom: '2000-01-01' }),
      rule({ eventType: 'public_holiday', multiplier: 2.5, effectiveFrom: '2026-01-01' }),
    ];
    expect(resolveOvertimeMultiplier(rules, 'public_holiday', '2026-07-01')!.multiplier).toBe(2.5);
    // before the new rule's start, the old one applies
    expect(resolveOvertimeMultiplier(rules, 'public_holiday', '2025-06-01')!.multiplier).toBe(2.0);
  });

  it('respects effective_to (rule not applicable after its end date)', () => {
    const rules = [rule({ eventType: 'rest_day', multiplier: 2.0, effectiveFrom: '2000-01-01', effectiveTo: '2025-12-31' })];
    expect(resolveOvertimeMultiplier(rules, 'rest_day', '2025-06-01')!.multiplier).toBe(2.0);
    expect(resolveOvertimeMultiplier(rules, 'rest_day', '2026-06-01')).toBeNull();
  });

  it('ignores inactive rules', () => {
    const rules = [rule({ eventType: 'callout', multiplier: 1.5, effectiveFrom: '2000-01-01', active: false })];
    expect(resolveOvertimeMultiplier(rules, 'callout', '2026-07-01')).toBeNull();
  });
});
