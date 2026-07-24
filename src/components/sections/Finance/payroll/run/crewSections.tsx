/**
 * src/components/sections/Finance/payroll/run/crewSections.tsx
 *
 * CP8 (spec §14.7) — the three conditional crew sections of the NORMAL run
 * workspace: CrewPopulationControls, CrewInputReconciliation, CrewCostAllocation.
 * They render ONLY when the resolved policy version enabled the crew capability
 * (workspace.crew != null) — no crew route, no crew nav, no second run page.
 *
 * Everything shown is typed workspace data frozen at input lock (CP6/CP7):
 * nothing here fabricates, re-derives, or re-reads live sources. Employee names
 * come from workspace.crewEmployeeNames (server-resolved — no raw ids in the UI).
 * Styling reuses the `.prw` run-workspace design system these panels live inside.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { type CrewRunEvidence } from '@api/finance/payroll';
import { fmtMoney, humanize } from '../../financeShared';

interface CrewProps {
  crew: CrewRunEvidence;
  names: Record<string, string>;
}

const name = (names: Record<string, string>, id: string): string => names[id] ?? id;

function Sec({ ico, title, sub, children }: {
  ico: string; title: string; sub?: string; children: ComponentChildren;
}): VNode {
  return (
    <section class="card crew-sec">
      <div class="sec-head">
        <div class="sec-ico">{ico}</div>
        <div><div class="sec-title">{title}</div>{sub && <div class="sec-sub">{sub}</div>}</div>
      </div>
      {children}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Crew population — capability facts + frozen population control totals
// ═══════════════════════════════════════════════════════════════════════════════

export function CrewPopulationControls({ crew }: Pick<CrewProps, 'crew'>): VNode {
  const movementChips = Object.entries(crew.movementsByType).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Sec ico="⚓" title="Crew population"
         sub="Frozen at input lock from crew assignments and movements — the policy capability that enabled this run.">
      <div class="lc-stats">
        <div class="lc-stat"><div class="v">{crew.expectedCrew}</div><div class="k">Expected crew</div></div>
        <div class="lc-stat"><div class="v">{crew.assignmentCount}</div><div class="k">Active assignments</div></div>
        <div class="lc-stat"><div class="v">{crew.movementCount}</div><div class="k">Movements in period</div></div>
        <div class="lc-stat"><div class="v">{crew.approvedTimeEmployeeCount}</div><div class="k">With approved time</div></div>
        <div class="lc-stat"><div class="v">{crew.approvedLeaveEmployeeCount}</div><div class="k">With approved leave</div></div>
      </div>
      <div class="rh-chips crew-chips">
        <span class="chip">{humanize(crew.policyType)}</span>
        {crew.dayBoundary && <span class="chip">Day boundary: {humanize(crew.dayBoundary)}</span>}
        {movementChips.map(([type, count]) => (
          <span class="chip" key={type}>{humanize(type)} × {count}</span>
        ))}
        {movementChips.length === 0 && <span class="chip grey">No movements recorded</span>}
      </div>
    </Sec>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Crew input reconciliation — roster vs movement vs statutory vs payment blockers
// ═══════════════════════════════════════════════════════════════════════════════

interface ReconRow {
  key: string;
  label: string;
  detail: string;
  count: number;
  severity: 'blocker' | 'warning';
  who: string[];
}

export function CrewInputReconciliation({ crew, names }: CrewProps): VNode {
  const b = crew.blockers;
  const otEntries = crew.excludedUnapprovedOvertime?.entries ?? [];
  const otWho = [...new Set(otEntries.map(e => name(names, e.employeeId)))];
  const rows: ReconRow[] = [
    {
      key: 'incomplete_statutory', label: 'Incomplete statutory profile',
      detail: 'Excluded at input lock until HR completes PAYE/NIS/Health Surcharge verification.',
      count: b.incompleteStatutoryProfile?.count ?? 0, severity: 'blocker',
      who: (b.incompleteStatutoryProfile?.employeeIds ?? []).map(id => name(names, id)),
    },
    {
      key: 'roster_without_movement', label: 'Roster without movement',
      detail: 'Active crew assignment but no movement recorded in the period.',
      count: b.rosterWithoutMovement.count, severity: 'warning',
      who: b.rosterWithoutMovement.employeeIds.map(id => name(names, id)),
    },
    {
      key: 'movement_without_assignment', label: 'Movement without assignment',
      detail: `${b.movementWithoutAssignment.count} movement record(s) not covered by any active assignment on the movement date.`,
      count: b.movementWithoutAssignment.count, severity: 'warning', who: [],
    },
    {
      key: 'overlapping_assignments', label: 'Overlapping assignments',
      detail: 'Employee holds overlapping active crew assignments in the period.',
      count: b.overlappingAssignments.count, severity: 'warning',
      who: b.overlappingAssignments.employeeIds.map(id => name(names, id)),
    },
    {
      key: 'missing_payment_destination', label: 'Missing payment destination',
      detail: 'No active primary TTD bank account — blocks release.',
      count: b.missingPaymentDestination.count, severity: 'blocker',
      who: b.missingPaymentDestination.employeeIds.map(id => name(names, id)),
    },
    {
      key: 'unapproved_overtime', label: 'Unapproved overtime excluded',
      detail: 'Submitted overtime not approved by lock — excluded from this run; approve and recalculate or carry to the next run.',
      count: crew.excludedUnapprovedOvertime?.count ?? 0, severity: 'warning',
      who: otWho,
    },
  ];
  const open = rows.filter(r => r.count > 0);
  return (
    <Sec ico="⇄" title="Crew input reconciliation"
         sub="Roster vs movement vs statutory vs payment evidence, frozen at input lock.">
      {open.length === 0
        ? <div class="prw-empty">All crew sources reconciled — no blockers or review items.</div>
        : (
          <div class="attention-list">
            {open.map(r => (
              <div class="attention-row" key={r.key}>
                <span class={`pill ${r.severity === 'blocker' ? 'red' : 'amber'}`}>
                  {r.severity === 'blocker' ? 'Blocker' : 'Review'}
                </span>
                <div class="row-copy">
                  <div class="act-t">{r.label} · {r.count}</div>
                  <div class="act-s">{r.detail}</div>
                  {r.who.length > 0 && <div class="row-meta">{r.who.join(', ')}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
    </Sec>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Crew cost allocation — frozen contract day-rate distribution
// ═══════════════════════════════════════════════════════════════════════════════

export function CrewCostAllocation({ crew, names }: CrewProps): VNode {
  const dr = crew.dayRate;
  return (
    <Sec ico="▤" title="Crew cost distribution"
         sub={dr
           ? `Contract day-rate earnings frozen at input lock — component ${dr.componentCode}, TTD.`
           : 'Contract day-rate earnings per employee and assignment.'}>
      {!dr || dr.perEmployee.length === 0
        ? (
          <div class="prw-empty">
            This policy version binds no qualifying-day component — costing dimensions
            appear per line in the calculation results instead.
          </div>
        )
        : (
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Employee</th><th>Qualifying dates</th>
                  <th class="num">Days</th><th class="num">Day rate (TTD)</th><th class="num">Earnings (TTD)</th>
                </tr>
              </thead>
              <tbody>
                {dr.perEmployee.flatMap(emp => emp.allocations.map((a, i) => (
                  <tr key={`${emp.employeeId}-${a.assignmentId}`}>
                    <td>{i === 0 ? name(names, emp.employeeId) : ''}</td>
                    <td>{a.qualifyingDates[0]}{a.qualifyingDates.length > 1 ? ` → ${a.qualifyingDates[a.qualifyingDates.length - 1]}` : ''}</td>
                    <td class="num">{a.qualifyingDays}</td>
                    <td class="num">{fmtMoney(a.compensationAmount)}</td>
                    <td class="num">{fmtMoney(a.earningAmount)}</td>
                  </tr>
                )))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td><td />
                  <td class="num">{dr.perEmployee.reduce((s, e) => s + e.totalDays, 0)}</td>
                  <td class="num" />
                  <td class="num">{fmtMoney(dr.perEmployee.reduce((s, e) => s + e.totalAmount, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
    </Sec>
  );
}
