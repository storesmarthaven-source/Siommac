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
/** CP7 (CPE-19): submitted-but-unapproved overtime in the period for crew
 *  employees — excluded from pay by construction (lock only takes approved OT);
 *  frozen here so calculation can materialize the review finding from evidence. */
export interface CrewExcludedOvertime {
  count: number;
  entries: Array<{ id: string; employeeId: string; workDate: string }>;
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
  /** CP7: unapproved OT excluded at lock (absent on pre-CP7 snapshots). */
  excludedUnapprovedOvertime?: CrewExcludedOvertime;
  blockers: {
    /** CPE-16: active assignment (roster) but no movement recorded in the period. */
    rosterWithoutMovement: CrewEmployeeBlocker;
    /** CPE-17: movement whose employee has no assignment covering the movement date. */
    movementWithoutAssignment: CrewMovementBlocker;
    /** CPE-18: employee holding overlapping active assignments in the period. */
    overlappingAssignments: CrewEmployeeBlocker;
    /** CPE-22: crew employee without an active primary TTD payment destination. */
    missingPaymentDestination: CrewEmployeeBlocker;
    /** CP7/CPE-21 (§14.8): crew employee without a complete VERIFIED TT statutory
     *  profile — rejected (excluded at input lock), never accepted-and-ignored.
     *  Absent on pre-CP7 snapshots. */
    incompleteStatutoryProfile?: CrewEmployeeBlocker;
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

  // CP7/CPE-21 (§14.8): only crew employees with a complete VERIFIED local
  // statutory profile pass; the rest are excluded at input lock (frozen here).
  const verifiedIds = new Set<string>();
  for (const ids of chunk(crewEmployeeIds, 300)) {
    if (ids.length === 0) continue;
    const { data, error } = await sb.from('hr_employee_statutory_profiles')
      .select('employee_id, nis_number, nis_status')
      .eq('jurisdiction', 'TT')
      .in('employee_id', ids);
    if (error) throw httpError('buildCrewRunEvidence/statutory: ' + error.message);
    for (const r of (data ?? []) as { employee_id: string; nis_number: string | null; nis_status: string }[]) {
      if (r.nis_number && r.nis_status === 'verified') verifiedIds.add(r.employee_id);
    }
  }
  const incompleteStatutoryProfile = crewEmployeeIds.filter(id => !verifiedIds.has(id));

  // CP7 (CPE-19): submitted-but-unapproved OT in the period for crew employees.
  // Lock only ingests APPROVED entries, so these are excluded from pay by
  // construction — frozen as evidence so calc can raise the review finding.
  const excludedOt: CrewExcludedOvertime['entries'] = [];
  for (const ids of chunk(crewEmployeeIds, 300)) {
    if (ids.length === 0) continue;
    const { data, error } = await sb.from('hr_overtime_entries')
      .select('id, employee_id, work_date')
      .eq('status', 'submitted')
      .gte('work_date', periodStart)
      .lte('work_date', periodEnd)
      .in('employee_id', ids);
    if (error) throw httpError('buildCrewRunEvidence/unapproved-ot: ' + error.message);
    for (const r of (data ?? []) as { id: string; employee_id: string; work_date: string }[]) {
      excludedOt.push({ id: r.id, employeeId: r.employee_id, workDate: r.work_date });
    }
  }
  excludedOt.sort((a, b) => a.id.localeCompare(b.id));

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
    excludedUnapprovedOvertime: { count: excludedOt.length, entries: excludedOt },
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
      incompleteStatutoryProfile: {
        count: incompleteStatutoryProfile.length,
        employeeIds: incompleteStatutoryProfile,
      },
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// CP7 — calculation-stage crew evidence (spec §14.5, CPE-19/20/21/23/25/26)
// ═════════════════════════════════════════════════════════════════════════════
// Calculation reads ONLY the ids frozen in the input snapshot's crew block.
// Movements are immutable (corrections create NEW rows), so re-reading a frozen
// id set is reading frozen data: a movement or correction recorded AFTER lock is
// not in the set and cannot change the result (CPE-25).

interface FrozenAssignmentRow {
  id: string;
  employee_id: string;
  client_id: string | null;
  contract_id: string | null;
  asset_id: string | null;
  work_order_id: string | null;
  cost_center: string | null;
  effective_from: string;
  effective_to: string | null;
}
interface FrozenMovementRow {
  id: string;
  employee_id: string;
  movement_type: string;
  occurred_at: string;
  operational_timezone: string;
  asset_id: string | null;
}

/** Per-assignment day attribution — the costing dimensions ride the assignment. */
export interface CrewLineAllocation {
  assignmentId: string;
  clientId: string | null;
  contractId: string | null;
  assetId: string | null;
  workOrderId: string | null;
  costCenter: string | null;
  days: number;
}

/** Per-line crew calculation evidence, persisted in the line's breakdown.crew. */
export interface CrewLineEvidence {
  policyType: string;
  dayBoundary: string | null;
  qualifyingDays: number;
  qualifyingDates: string[];
  movementIds: string[];
  assignmentIds: string[];
  allocations: CrewLineAllocation[];
}

export interface CrewCalculationPrep {
  /** Employees holding a frozen crew assignment — subject to the §14.8 statutory gate. */
  expectedCrewIds: Set<string>;
  /** Per-crew-employee qualifying-day evidence (present even at 0 days). */
  perEmployee: Map<string, CrewLineEvidence>;
  excludedUnapprovedOvertime: CrewExcludedOvertime;
  /** Crew employees excluded at lock for an incomplete statutory profile (CPE-21). */
  statutoryExcludedIds: string[];
}

/** Local calendar date of an instant in an IANA timezone (movement's operational
 *  timezone — the §14.4 offshore-day/operational-timezone attribution rule). */
function localDate(isoInstant: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(isoInstant));
  } catch {
    // Unknown tz string on an imported row — fall back to UTC rather than fail the run.
    return isoInstant.slice(0, 10);
  }
}

function eachDateInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Derive one employee's qualifying dates from their frozen movements.
 * embark/mobilize OPEN presence, disembark/demobilize CLOSE it, transfer keeps
 * presence continuous. Dates are attributed in each movement's operational
 * timezone and collected into a SET — a mobilize + embark on the same day, or a
 * cross-midnight closing movement, can never double-count a day (CPE-20). An
 * interval still open at period end clamps to the period end.
 */
export function deriveQualifyingDates(
  movements: FrozenMovementRow[],
  periodStart: string,
  periodEnd: string,
): Set<string> {
  const sorted = [...movements].sort((a, b) =>
    a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
  const dates = new Set<string>();
  let openFrom: string | null = null;
  const add = (from: string, to: string): void => {
    const lo = from < periodStart ? periodStart : from;
    const hi = to > periodEnd ? periodEnd : to;
    if (lo > hi) return;
    for (const d of eachDateInclusive(lo, hi)) dates.add(d);
  };
  for (const m of sorted) {
    const day = localDate(m.occurred_at, m.operational_timezone);
    if (m.movement_type === 'embark' || m.movement_type === 'mobilize') {
      if (openFrom === null) openFrom = day;      // re-open on same presence = no-op
    } else if (m.movement_type === 'transfer') {
      if (openFrom === null) openFrom = day;      // presence continues across assets
    } else { // disembark | demobilize
      if (openFrom !== null) {
        add(openFrom, day);
        openFrom = null;
      }
    }
  }
  if (openFrom !== null) add(openFrom, periodEnd); // still aboard at period end
  return dates;
}

/**
 * Build the calculation-stage crew prep from a snapshot's frozen crew block.
 * Returns null when the snapshot carries no crew evidence (non-crew run).
 */
export async function prepareCrewCalculation(
  frozen: CrewRunEvidence,
  periodStart: string,
  periodEnd: string,
): Promise<CrewCalculationPrep> {
  const loadByIds = async <T>(table: string, cols: string, ids: string[]): Promise<T[]> => {
    const out: T[] = [];
    for (const part of chunk(ids, 300)) {
      if (part.length === 0) continue;
      const { data, error } = await sb.from(table).select(cols).in('id', part);
      if (error) throw httpError(`prepareCrewCalculation/${table}: ` + error.message);
      out.push(...((data ?? []) as T[]));
    }
    return out;
  };
  const [assignments, movements] = await Promise.all([
    loadByIds<FrozenAssignmentRow>('hr_crew_assignments',
      'id, employee_id, client_id, contract_id, asset_id, work_order_id, cost_center, effective_from, effective_to',
      frozen.assignmentIds),
    loadByIds<FrozenMovementRow>('hr_crew_movements',
      'id, employee_id, movement_type, occurred_at, operational_timezone, asset_id',
      frozen.movementIds),
  ]);

  const byEmployeeAsg = new Map<string, FrozenAssignmentRow[]>();
  for (const a of assignments) {
    const list = byEmployeeAsg.get(a.employee_id) ?? [];
    list.push(a);
    byEmployeeAsg.set(a.employee_id, list);
  }
  const byEmployeeMov = new Map<string, FrozenMovementRow[]>();
  for (const m of movements) {
    const list = byEmployeeMov.get(m.employee_id) ?? [];
    list.push(m);
    byEmployeeMov.set(m.employee_id, list);
  }

  const perEmployee = new Map<string, CrewLineEvidence>();
  for (const [employeeId, asgList] of byEmployeeAsg) {
    const movList = byEmployeeMov.get(employeeId) ?? [];
    const rawDates = deriveQualifyingDates(movList, periodStart, periodEnd);
    // Roster ∧ movement: a date qualifies only when a frozen assignment covers it.
    const covered = [...rawDates].filter(d => asgList.some(a =>
      a.effective_from <= d && (a.effective_to === null || a.effective_to >= d))).sort();

    // Attribute each qualifying date to the covering assignment (latest
    // effective_from wins when several cover — the most specific roster row).
    const allocationDays = new Map<string, number>();
    for (const d of covered) {
      const cover = asgList
        .filter(a => a.effective_from <= d && (a.effective_to === null || a.effective_to >= d))
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || a.id.localeCompare(b.id))[0]!;
      allocationDays.set(cover.id, (allocationDays.get(cover.id) ?? 0) + 1);
    }
    const allocations: CrewLineAllocation[] = [...allocationDays.entries()]
      .map(([assignmentId, days]) => {
        const a = asgList.find(x => x.id === assignmentId)!;
        return {
          assignmentId,
          clientId: a.client_id,
          contractId: a.contract_id,
          assetId: a.asset_id,
          workOrderId: a.work_order_id,
          costCenter: a.cost_center,
          days,
        };
      })
      .sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));

    perEmployee.set(employeeId, {
      policyType: frozen.policyType,
      dayBoundary: frozen.dayBoundary,
      qualifyingDays: covered.length,
      qualifyingDates: covered,
      movementIds: movList.map(m => m.id).sort(),
      assignmentIds: asgList.map(a => a.id).sort(),
      allocations,
    });
  }

  return {
    expectedCrewIds: new Set(byEmployeeAsg.keys()),
    perEmployee,
    excludedUnapprovedOvertime: frozen.excludedUnapprovedOvertime ?? { count: 0, entries: [] },
    statutoryExcludedIds: frozen.blockers.incompleteStatutoryProfile?.employeeIds ?? [],
  };
}
