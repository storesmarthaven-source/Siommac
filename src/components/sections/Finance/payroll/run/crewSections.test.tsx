/**
 * crewSections.test.tsx — CP8 (§14.7) conditional crew sections.
 *
 *  C1  CrewPopulationControls renders the frozen control totals + capability chips.
 *  C2  CrewInputReconciliation renders each non-zero blocker with severity and
 *      RESOLVED employee names — never raw ids.
 *  C3  CrewInputReconciliation shows the all-reconciled empty state at zero counts.
 *  C4  CrewCostAllocation renders per-allocation contract day-rate rows + totals.
 *  C5  CrewCostAllocation shows the honest empty state when no day-rate component
 *      is bound (no fabricated costing data).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { CrewPopulationControls, CrewInputReconciliation, CrewCostAllocation } from './crewSections';
import { type CrewRunEvidence } from '@api/finance/payroll';

const NAMES = { 'emp-uuid-1': 'Andre Baptiste', 'emp-uuid-2': 'Keisha Mohammed' };

function makeCrew(over: Partial<CrewRunEvidence> = {}): CrewRunEvidence {
  return {
    policyType: 'offshore_rotation', rotationPatternId: null, dayBoundary: 'offshore_day',
    expectedCrew: 2, assignmentCount: 3, movementCount: 4,
    movementsByType: { embark: 2, disembark: 2 },
    approvedTimeEmployeeCount: 1, approvedLeaveEmployeeCount: 0,
    assignmentIds: ['asg-1', 'asg-2', 'asg-3'], movementIds: ['mov-1', 'mov-2', 'mov-3', 'mov-4'],
    excludedUnapprovedOvertime: { count: 0, entries: [] },
    blockers: {
      rosterWithoutMovement:     { count: 0, employeeIds: [] },
      movementWithoutAssignment: { count: 0, movementIds: [] },
      overlappingAssignments:    { count: 0, employeeIds: [] },
      missingPaymentDestination: { count: 0, employeeIds: [] },
      incompleteStatutoryProfile: { count: 0, employeeIds: [] },
    },
    ...over,
  };
}

describe('CP8 crew sections (§14.7)', () => {
  it('C1 — population controls render frozen totals + capability chips', () => {
    render(<CrewPopulationControls crew={makeCrew()} />);
    expect(screen.getByText('Crew population')).toBeTruthy();
    expect(screen.getByText('Expected crew')).toBeTruthy();
    expect(screen.getByText('Offshore Rotation')).toBeTruthy();
    expect(screen.getByText('Day boundary: Offshore Day')).toBeTruthy();
    expect(screen.getByText('Embark × 2')).toBeTruthy();
  });

  it('C2 — reconciliation renders non-zero blockers with severity + resolved names', () => {
    const crew = makeCrew({
      blockers: {
        rosterWithoutMovement:     { count: 1, employeeIds: ['emp-uuid-1'] },
        movementWithoutAssignment: { count: 0, movementIds: [] },
        overlappingAssignments:    { count: 0, employeeIds: [] },
        missingPaymentDestination: { count: 1, employeeIds: ['emp-uuid-2'] },
        incompleteStatutoryProfile: { count: 1, employeeIds: ['emp-uuid-2'] },
      },
      excludedUnapprovedOvertime: { count: 1, entries: [{ id: 'ot-1', employeeId: 'emp-uuid-1', workDate: '2026-06-15' }] },
    });
    const { container } = render(<CrewInputReconciliation crew={crew} names={NAMES} />);
    expect(screen.getByText('Incomplete statutory profile · 1')).toBeTruthy();
    expect(screen.getByText('Missing payment destination · 1')).toBeTruthy();
    expect(screen.getByText('Roster without movement · 1')).toBeTruthy();
    expect(screen.getByText('Unapproved overtime excluded · 1')).toBeTruthy();
    expect(screen.getAllByText('Blocker').length).toBe(2);   // statutory + payment
    expect(screen.getAllByText('Review').length).toBe(2);    // roster + OT
    expect(screen.getAllByText('Andre Baptiste').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('emp-uuid-1');
    expect(container.textContent).not.toContain('emp-uuid-2');
  });

  it('C3 — reconciliation empty state when everything reconciles', () => {
    render(<CrewInputReconciliation crew={makeCrew()} names={NAMES} />);
    expect(screen.getByText(/All crew sources reconciled/)).toBeTruthy();
  });

  it('C4 — cost allocation renders frozen contract day-rate rows + totals', () => {
    const crew = makeCrew({
      dayRate: {
        policyComponentId: 'pc-1', componentId: 'comp-1', componentCode: 'CRWDAY', isTaxable: true,
        perEmployee: [{
          employeeId: 'emp-uuid-1', totalDays: 3, totalAmount: 3703.68,
          allocations: [{
            assignmentId: 'asg-1', contractId: 'con-1', compensationAmount: 1234.56,
            currency: 'TTD', period: 'daily', effectiveFrom: '2026-06-01', effectiveTo: null,
            qualifyingDates: ['2026-06-10', '2026-06-11', '2026-06-12'], qualifyingDays: 3,
            earningAmount: 3703.68,
          }],
        }],
      },
    });
    const { container } = render(<CrewCostAllocation crew={crew} names={NAMES} />);
    expect(screen.getByText('Andre Baptiste')).toBeTruthy();
    expect(screen.getByText('2026-06-10 → 2026-06-12')).toBeTruthy();
    expect(container.textContent).toContain('1,234.56');   // TTD day rate
    expect(container.textContent).toContain('3,703.68');   // rounded earning + total
    expect(container.textContent).not.toContain('emp-uuid-1');
    expect(container.textContent).not.toContain('con-1');
  });

  it('C5 — cost allocation honest empty state without a day-rate component', () => {
    render(<CrewCostAllocation crew={makeCrew()} names={NAMES} />);
    expect(screen.getByText(/binds no qualifying-day component/)).toBeTruthy();
  });
});
