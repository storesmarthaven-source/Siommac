/**
 * netlify/functions/lib/finance/payroll/crewRun.ts
 *
 * Crew Payroll — CP6: the conditional crew capability of the NORMAL payroll run
 * (spec §14.5 / contract §7, EP-RUN). No crew route, no crew run state — this module
 * only (a) resolves whether the run's pinned pay-policy version enables the crew
 * capability, and (b) builds the typed crew preflight/snapshot evidence block that
 * rides the EXISTING input-readiness, input-snapshot and run-workspace contracts.
 *
 * Timezone note: preflight/blocker matching uses the movement's UTC calendar date;
 * operational-timezone/offshore-day boundary attribution is calculation evidence (CP7).
 */

import { sb } from '../../db';

/** Policy types whose resolved version enables the crew capability (§14.4). */
const CREW_POLICY_TYPES: readonly string[] = ['offshore_rotation', 'marine_voyage'];

export interface CrewCapability {
  enabled: boolean;
  policyType: string | null;
  rotationPatternId: string | null;
  dayBoundary: string | null;
}

const CAPABILITY_DISABLED: CrewCapability = {
  enabled: false,
  policyType: null,
  rotationPatternId: null,
  dayBoundary: null,
};

export interface CrewEmployeeBlocker {
  count: number;
  employeeIds: string[];
}
export interface CrewMovementBlocker {
  count: number;
  movementIds: string[];
}

/** Typed crew evidence — identical shape for pre-lock preflight and the frozen snapshot. */
export interface CrewRunEvidence {
  policyType: string;
  rotationPatternId: string | null;
  dayBoundary: string | null;
  /** Distinct employees holding an active crew assignment overlapping the period. */
  expectedCrew: number;
  assignmentCount: number;
  movementCount: number;
  movementsByType: Record<string, number>;
  /** Crew employees with an approved timesheet starting in the period. */
  approvedTimeEmployeeCount: number;
  /** Crew employees with approved leave overlapping the period. */
  approvedLeaveEmployeeCount: number;
  /** Frozen source ids (sorted — deterministic snapshot content). */
  assignmentIds: string[];
  movementIds: string[];
  blockers: {
    /** CPE-16: active assignment (roster) but no movement recorded in the period. */
    rosterWithoutMovement: CrewEmployeeBlocker;
    /** CPE-17: movement whose employee has no assignment covering the movement date. */
    movementWithoutAssignment: CrewMovementBlocker;
    /** CPE-18: employee holding overlapping active assignments in the period. */
    overlappingAssignments: CrewEmployeeBlocker;
    /** CPE-22: crew employee without an active primary TTD payment destination. */
    missingPaymentDestination: CrewEmployeeBlocker;
  };
}

function httpError(message: string, status = 500): Error {
  return Object.assign(new Error(message), { status });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Resolve the crew capability of a pinned pay-policy version. Disabled (never an
 * error) for legacy runs without a pin or for non-crew policy types.
 */
export async function resolveCrewCapability(
  policyVersionId: string | null | undefined,
): Promise<CrewCapability> {
  if (!policyVersionId) return CAPABILITY_DISABLED;
  const { data: ver, error: verErr } = await sb
    .from('finance_pay_policy_versions')
    .select('policy_id, rotation_pattern_id, day_boundary')
    .eq('id', policyVersionId)
    .maybeSingle<{ policy_id: string; rotation_pattern_id: string | null; day_boundary: string }>();
  if (verErr) throw httpError('resolveCrewCapability/version: ' + verErr.message);
  if (!ver) return CAPABILITY_DISABLED;
  const { data: pol, error: polErr } = await sb
    .from('finance_pay_policies')
    .select('policy_type')
    .eq('id', ver.policy_id)
    .maybeSingle<{ policy_type: string }>();
  if (polErr) throw httpError('resolveCrewCapability/policy: ' + polErr.message);
  const policyType = pol?.policy_type ?? null;
  if (!policyType || !CREW_POLICY_TYPES.includes(policyType)) return CAPABILITY_DISABLED;
  return {
    enabled: true,
    policyType,
    rotationPatternId: ver.rotation_pattern_id,
    dayBoundary: ver.day_boundary,
  };
}

/**
 * Pre-create resolution: the pay group's active policy version whose assignment AND
 * version effective ranges cover the WHOLE period — mirrors finance_payroll_create_run_tx.
 * Returns null when no single unambiguous match exists (the create RPC owns the
 * 422/409 contract; preflight simply has no crew block to show).
 */
export async function resolvePayGroupPolicyVersionId(
  payGroupId: string,
  periodStart: string,
  periodEnd: string,
): Promise<string | null> {
  const { data: assignments, error: aErr } = await sb
    .from('finance_pay_group_policy_assignments')
    .select('policy_version_id, effective_from, effective_to')
    .eq('pay_group_id', payGroupId)
    .eq('status', 'active')
    .lte('effective_from', periodStart)
    .or(`effective_to.is.null,effective_to.gte.${periodEnd}`);
  if (aErr) throw httpError('resolvePayGroupPolicyVersionId/assignments: ' + aErr.message);
  const versionIds = [...new Set(((assignments ?? []) as { policy_version_id: string }[])
    .map(a => a.policy_version_id))];
  if (versionIds.length === 0) return null;
  const { data: versions, error: vErr } = await sb
    .from('finance_pay_policy_versions')
    .select('id, status, effective_from, effective_to')
    .in('id', versionIds)
    .eq('status', 'active')
    .lte('effective_from', periodStart)
    .or(`effective_to.is.null,effective_to.gte.${periodEnd}`);
  if (vErr) throw httpError('resolvePayGroupPolicyVersionId/versions: ' + vErr.message);
  const covering = ((versions ?? []) as { id: string }[]).map(v => v.id);
  return covering.length === 1 ? (covering[0] ?? null) : null;
}

interface CrewAssignmentRow {
  id: string;
  employee_id: string;
  effective_from: string;
  effective_to: string | null;
}
interface CrewMovementRow {
  id: string;
  employee_id: string;
  movement_type: string;
  occurred_at: string;
}

function nextDay(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the typed crew evidence block for a crew-capable population + period.
 * Used identically by pre-lock preflight (advisory blockers) and by lockInputs
 * (frozen into the input snapshot's source_summary — CPE-25/27 immutability).
 */
export async function buildCrewRunEvidence(
  capability: CrewCapability,
  employeeIds: string[],
  periodStart: string,
  periodEnd: string,
): Promise<CrewRunEvidence> {
  if (!capability.enabled || !capability.policyType) {
    throw httpError('buildCrewRunEvidence requires an enabled crew capability.', 500);
  }
  const periodEndExclusive = nextDay(periodEnd);

  const assignments: CrewAssignmentRow[] = [];
  const movements: CrewMovementRow[] = [];
  for (const ids of chunk(employeeIds, 300)) {
    if (ids.length === 0) continue;
    const [aRes, mRes] = await Promise.all([
      sb.from('hr_crew_assignments')
        .select('id, employee_id, effective_from, effective_to')
        .eq('status', 'active')
        .lte('effective_from', periodEnd)
        .or(`effective_to.is.null,effective_to.gte.${periodStart}`)
        .in('employee_id', ids),
      sb.from('hr_crew_movements')
        .select('id, employee_id, movement_type, occurred_at')
        .gte('occurred_at', periodStart)
        .lt('occurred_at', periodEndExclusive)
        .in('employee_id', ids),
    ]);
    if (aRes.error) throw httpError('buildCrewRunEvidence/assignments: ' + aRes.error.message);
    if (mRes.error) throw httpError('buildCrewRunEvidence/movements: ' + mRes.error.message);
    assignments.push(...((aRes.data ?? []) as CrewAssignmentRow[]));
    movements.push(...((mRes.data ?? []) as CrewMovementRow[]));
  }

  const crewEmployeeIds = [...new Set(assignments.map(a => a.employee_id))].sort();
  const movementEmployeeIds = new Set(movements.map(m => m.employee_id));

  // CPE-16 — roster (active assignment) with no movement recorded in the period.
  const rosterWithoutMovement = crewEmployeeIds.filter(id => !movementEmployeeIds.has(id));

  // CPE-17 — movement not covered by any active assignment on its (UTC) date.
  const assignmentsByEmployee = new Map<string, CrewAssignmentRow[]>();
  for (const a of assignments) {
    const list = assignmentsByEmployee.get(a.employee_id) ?? [];
    list.push(a);
    assignmentsByEmployee.set(a.employee_id, list);
  }
  const movementWithoutAssignment = movements
    .filter(m => {
      const date = m.occurred_at.slice(0, 10);
      return !(assignmentsByEmployee.get(m.employee_id) ?? []).some(a =>
        a.effective_from <= date && (a.effective_to === null || a.effective_to >= date));
    })
    .map(m => m.id)
    .sort();

  // CPE-18 — employees holding overlapping active assignments (cross-asset rows
  // predating the policy, or imported data — the DB invariant only blocks same-asset).
  const overlappingEmployees: string[] = [];
  for (const [employeeId, list] of assignmentsByEmployee) {
    const sorted = [...list].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (prev.effective_to === null || prev.effective_to >= cur.effective_from) {
        overlappingEmployees.push(employeeId);
        break;
      }
    }
  }
  overlappingEmployees.sort();

  // CPE-22 — crew employees without an active primary payment destination.
  const bankedIds = new Set<string>();
  for (const ids of chunk(crewEmployeeIds, 300)) {
    if (ids.length === 0) continue;
    const { data, error } = await sb.from('finance_employee_bank_accounts')
      .select('employee_id')
      .eq('is_primary', true)
      .eq('is_active', true)
      .in('employee_id', ids);
    if (error) throw httpError('buildCrewRunEvidence/banks: ' + error.message);
    for (const r of (data ?? []) as { employee_id: string }[]) bankedIds.add(r.employee_id);
  }
  const missingPaymentDestination = crewEmployeeIds.filter(id => !bankedIds.has(id));

  // Reconciliation totals — approved time and leave presence for the crew population.
  const timedIds = new Set<string>();
  const leaveIds = new Set<string>();
  for (const ids of chunk(crewEmployeeIds, 300)) {
    if (ids.length === 0) continue;
    const [tRes, lRes] = await Promise.all([
      sb.from('hr_timesheets')
        .select('employee_id')
        .eq('status', 'approved')
        .gte('period_start', periodStart)
        .lte('period_start', periodEnd)
        .in('employee_id', ids),
      sb.from('hr_leave_requests')
        .select('employee_id')
        .eq('status', 'approved')
        .lte('from_date', periodEnd)
        .gte('to_date', periodStart)
        .in('employee_id', ids),
    ]);
    if (tRes.error) throw httpError('buildCrewRunEvidence/timesheets: ' + tRes.error.message);
    if (lRes.error) throw httpError('buildCrewRunEvidence/leave: ' + lRes.error.message);
    for (const r of (tRes.data ?? []) as { employee_id: string }[]) timedIds.add(r.employee_id);
    for (const r of (lRes.data ?? []) as { employee_id: string }[]) leaveIds.add(r.employee_id);
  }

  const movementsByType: Record<string, number> = {};
  for (const m of movements) {
    movementsByType[m.movement_type] = (movementsByType[m.movement_type] ?? 0) + 1;
  }

  return {
    policyType: capability.policyType,
    rotationPatternId: capability.rotationPatternId,
    dayBoundary: capability.dayBoundary,
    expectedCrew: crewEmployeeIds.length,
    assignmentCount: assignments.length,
    movementCount: movements.length,
    movementsByType,
    approvedTimeEmployeeCount: timedIds.size,
    approvedLeaveEmployeeCount: leaveIds.size,
    assignmentIds: assignments.map(a => a.id).sort(),
    movementIds: movements.map(m => m.id).sort(),
    blockers: {
      rosterWithoutMovement: {
        count: rosterWithoutMovement.length,
        employeeIds: rosterWithoutMovement,
      },
      movementWithoutAssignment: {
        count: movementWithoutAssignment.length,
        movementIds: movementWithoutAssignment,
      },
      overlappingAssignments: {
        count: overlappingEmployees.length,
        employeeIds: overlappingEmployees,
      },
      missingPaymentDestination: {
        count: missingPaymentDestination.length,
        employeeIds: missingPaymentDestination,
      },
    },
  };
}
