/**
 * src/api/hr/roster.ts
 *
 * Typed client + TanStack hooks for the HR Shift / Roster Scheduling backend
 * (routes/hrRoster.ts — POST `hr/roster/*`, camelCase `body.args`).
 * `call<T>` throws on `success:false` — callers surface errors via @lib/dialog or toast.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import type {
  ShiftTemplate, RotationPattern, CoverageRequirement, RosterRow, RosterDetail,
  ShiftAssignment, CoverageGap, MyShift, RosterStats, EmployeeHoursSummary,
  UpsertShiftTemplateArgs, UpsertRotationPatternArgs, UpsertCoverageRequirementArgs,
  CreateRosterArgs, UpsertAssignmentArgs, BulkUpsertAssignmentsArgs,
} from '../../../types/hrRoster';

// ── Core call helper ──────────────────────────────────────────────────────────

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

// ── API object ────────────────────────────────────────────────────────────────

export const hrRosterApi = {
  // Templates
  listTemplates:   (a: { siteId?: string; activeOnly?: boolean } = {}) => call<ShiftTemplate[]>('hr/roster/templates/list', a),
  upsertTemplate:  (a: UpsertShiftTemplateArgs)                        => call<ShiftTemplate>('hr/roster/templates/upsert', a),
  removeTemplate:  (a: { id: string })                                 => call<Record<string, never>>('hr/roster/templates/remove', a),

  // Rotations
  listRotations:   (a: { activeOnly?: boolean } = {})                  => call<RotationPattern[]>('hr/roster/rotations/list', a),
  upsertRotation:  (a: UpsertRotationPatternArgs)                      => call<RotationPattern>('hr/roster/rotations/upsert', a),

  // Coverage requirements
  listCoverage:    (a: { siteId?: string; activeOnly?: boolean } = {}) => call<CoverageRequirement[]>('hr/roster/coverage/list', a),
  upsertCoverage:  (a: UpsertCoverageRequirementArgs)                  => call<CoverageRequirement>('hr/roster/coverage/upsert', a),
  coverageGaps:    (a: { rosterId: string })                           => call<CoverageGap[]>('hr/roster/coverage/gaps', a),

  // Rosters
  listRosters: (a: {
    siteId?: string; departmentId?: string; status?: string;
    from?: string; to?: string; limit?: number;
  } = {}) => call<RosterRow[]>('hr/roster/rosters/list', a),
  getRoster:     (a: { rosterId: string })           => call<RosterDetail>('hr/roster/rosters/get', a),
  createRoster:  (a: CreateRosterArgs)               => call<{ rosterId: string; rosterNo: string }>('hr/roster/rosters/create', a),
  generate:      (a: { rosterId: string; patternId?: string })         => call<{ generated: number }>('hr/roster/rosters/generate', a),
  syncLeave:     (a: { rosterId: string })           => call<{ synced: number }>('hr/roster/rosters/sync-leave', a),
  publish:       (a: { rosterId: string })           => call<RosterRow>('hr/roster/rosters/publish', a),
  reopen:        (a: { rosterId: string; reason?: string })            => call<{ rosterId: string; status: string }>('hr/roster/rosters/reopen', a),

  // Assignments
  upsertAssignment: (a: UpsertAssignmentArgs)         => call<ShiftAssignment>('hr/roster/assignments/upsert', a),
  removeAssignment: (a: { assignmentId: string })     => call<Record<string, never>>('hr/roster/assignments/remove', a),
  bulkAssignments:  (a: BulkUpsertAssignmentsArgs)    => call<{ count: number }>('hr/roster/assignments/bulk', a),

  // Self-view
  myShifts: (a: { from: string; to: string }) => call<MyShift[]>('hr/roster/my-shifts', a),

  // Attendance feed
  expectedShift: (a: { employeeId: string; workDate: string }) => call<{ kind: string; shiftCode: string | null; startsAt: string | null; endsAt: string | null; paidHours: number | null } | null>('hr/roster/expected-shift', a),

  // Reports
  stats:        (a: { siteId?: string; departmentId?: string } = {}) => call<RosterStats>('hr/roster/reports/stats', a),
  hoursReport:  (a: { rosterId: string })           => call<EmployeeHoursSummary[]>('hr/roster/reports/hours', a),
};

// ── Query keys ────────────────────────────────────────────────────────────────

export const rosterKeys = {
  root:       ['hr', 'roster'] as const,
  templates:  ['hr', 'roster', 'templates'] as const,
  rotations:  ['hr', 'roster', 'rotations'] as const,
  coverage:   ['hr', 'roster', 'coverage'] as const,
  list:       (filters?: object) => ['hr', 'roster', 'list', filters ?? {}] as const,
  detail:     (id: string) => ['hr', 'roster', 'detail', id] as const,
  gaps:       (id: string) => ['hr', 'roster', 'gaps', id] as const,
  myShifts:   (from: string, to: string) => ['hr', 'roster', 'my-shifts', from, to] as const,
  stats:      ['hr', 'roster', 'stats'] as const,
  hours:      (id: string) => ['hr', 'roster', 'hours', id] as const,
};

// ── Query hooks ───────────────────────────────────────────────────────────────

export function useShiftTemplates(filters: { siteId?: string; activeOnly?: boolean } = {}) {
  return useQuery({ queryKey: rosterKeys.templates, queryFn: () => hrRosterApi.listTemplates(filters) });
}

export function useRotationPatterns() {
  return useQuery({ queryKey: rosterKeys.rotations, queryFn: () => hrRosterApi.listRotations() });
}

export function useCoverageRequirements(filters: { siteId?: string } = {}) {
  return useQuery({ queryKey: rosterKeys.coverage, queryFn: () => hrRosterApi.listCoverage(filters) });
}

export function useRosters(filters: {
  siteId?: string; departmentId?: string; status?: string;
  from?: string; to?: string;
} = {}) {
  return useQuery({ queryKey: rosterKeys.list(filters), queryFn: () => hrRosterApi.listRosters(filters) });
}

export function useRoster(rosterId: string | null) {
  return useQuery({
    queryKey: rosterKeys.detail(rosterId ?? ''),
    queryFn: () => hrRosterApi.getRoster({ rosterId: rosterId! }),
    enabled: !!rosterId,
  });
}

export function useCoverageGaps(rosterId: string | null) {
  return useQuery({
    queryKey: rosterKeys.gaps(rosterId ?? ''),
    queryFn: () => hrRosterApi.coverageGaps({ rosterId: rosterId! }),
    enabled: !!rosterId,
  });
}

export function useMyShifts(from: string, to: string) {
  return useQuery({ queryKey: rosterKeys.myShifts(from, to), queryFn: () => hrRosterApi.myShifts({ from, to }) });
}

export function useRosterStats(filters: { siteId?: string; departmentId?: string } = {}) {
  return useQuery({ queryKey: rosterKeys.stats, queryFn: () => hrRosterApi.stats(filters) });
}

export function useEmployeeHours(rosterId: string | null) {
  return useQuery({
    queryKey: rosterKeys.hours(rosterId ?? ''),
    queryFn: () => hrRosterApi.hoursReport({ rosterId: rosterId! }),
    enabled: !!rosterId,
  });
}

// ── Mutation hook ─────────────────────────────────────────────────────────────

/** Generic roster mutation — invalidates the whole roster query tree. */
export function useRosterMutation<TArgs, TResult>(fn: (a: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rosterKeys.root });
    },
  });
}
