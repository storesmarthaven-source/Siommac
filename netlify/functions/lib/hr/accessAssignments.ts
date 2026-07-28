/**
 * lib/hr/accessAssignments.ts — employee access assignments and their scopes.
 *
 * READS resolve every id to a label server-side, so no raw uuid or department id
 * reaches the UI. WRITES go through the transactional commands
 * `hr_access_assignment_grant_tx` / `hr_access_assignment_revoke_tx`: the
 * assignment row, its scope rows, `app_events` and `hr_audit_log` must commit
 * together or not at all. supabase-js issues a separate PostgREST call per
 * statement, so this cannot be assembled in the app layer — a half-applied grant
 * would be an access record claiming more reach than was authorised.
 */

import { sb } from '../db';
import { getEmployerProfile } from '../finance/employerProfile';
import type {
  EmployeeAccessAssignment, EmployeeAccessScope, AccessScopeType,
  AccessAssignmentType, AccessAssignmentStatus,
} from '../../../../types/hrEmployeeProfile';

interface AssignmentRow {
  id: string;
  employee_id: string;
  access_profile_id: string;
  assignment_type: string;
  status: string;
  effective_from: string;
  effective_to: string | null;
  granted_by: string | null;
  granted_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
}

interface ScopeRow {
  assignment_id: string;
  scope_type: string;
  scope_id: string | null;
}

export interface GrantAccessAssignmentInput {
  actorId: string;
  employeeId: string;
  accessProfileId: string;
  assignmentType?: AccessAssignmentType;
  effectiveFrom?: string | null;
  scopes: { scopeType: AccessScopeType; scopeId?: string | null }[];
  correlationId: string;
}

/** Shape returned by hr_access_assignment_grant_tx. */
export interface GrantResult {
  assignmentId: string;
  accessProfileLabel: string;
  scopeCount: number;
  correlationId: string;
}

/** Shape returned by hr_access_assignment_revoke_tx. */
export interface RevokeResult {
  assignmentId: string;
  employeeId: string;
  status: string;
  correlationId: string;
}

export interface RevokeAccessAssignmentInput {
  actorId: string;
  assignmentId: string;
  reason?: string | null;
  correlationId: string;
}

/**
 * Resolve every scope id to a human label in one pass.
 *
 * An id that no longer resolves renders as "Unknown …" rather than leaking the
 * raw id — a deleted department must not turn into a uuid on screen.
 */
async function resolveScopeLabels(
  scopes: ScopeRow[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const departmentIds = [...new Set(scopes.filter(s => s.scope_type === 'department' && s.scope_id).map(s => s.scope_id!))];
  const siteIds = [...new Set(scopes.filter(s => s.scope_type === 'site' && s.scope_id).map(s => s.scope_id!))];

  const [deptRes, siteRes] = await Promise.all([
    departmentIds.length
      ? sb.from('departments').select('id, name').in('id', departmentIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    siteIds.length
      ? sb.from('project_sites').select('id, name').in('id', siteIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  if (deptRes.error) throw new Error(`Access scope department read failed: ${deptRes.error.message}`);
  if (siteRes.error) throw new Error(`Access scope site read failed: ${siteRes.error.message}`);

  for (const d of deptRes.data as { id: string; name: string }[]) labels.set(`department:${d.id}`, d.name);
  for (const s of siteRes.data as { id: string; name: string }[]) labels.set(`site:${s.id}`, s.name);
  return labels;
}

function scopeLabelFor(
  scope: ScopeRow,
  labels: Map<string, string>,
  organisationName: string,
): string {
  if (scope.scope_type === 'organisation') return organisationName;
  if (!scope.scope_id) return 'Unknown Scope';
  return labels.get(`${scope.scope_type}:${scope.scope_id}`)
    ?? (scope.scope_type === 'department' ? 'Unknown Department' : 'Unknown Location');
}

/**
 * List an employee's access assignments with their scopes.
 *
 * Revoked assignments are included by default because the Access tab shows the
 * assignment history, not just what is live; callers wanting only live grants
 * pass `activeOnly`.
 */
export async function listAccessAssignments(
  employeeId: string,
  activeOnly = false,
): Promise<EmployeeAccessAssignment[]> {
  let query = sb.from('hr_employee_access_assignments')
    .select('id, employee_id, access_profile_id, assignment_type, status, effective_from, effective_to, granted_by, granted_at, revoked_by, revoked_at')
    .eq('employee_id', employeeId)
    .order('granted_at', { ascending: false });
  if (activeOnly) query = query.eq('status', 'active');

  const { data: assignmentData, error } = await query;
  if (error) throw new Error(`Access assignment read failed: ${error.message}`);
  const assignments = assignmentData as AssignmentRow[];
  if (!assignments.length) return [];

  const ids = assignments.map(a => a.id);
  const profileIds = [...new Set(assignments.map(a => a.access_profile_id))];
  const actorIds = [...new Set(assignments.flatMap(a => [a.granted_by, a.revoked_by]).filter((x): x is string => !!x))];

  const [scopeRes, profileRes, actorRes, employer] = await Promise.all([
    sb.from('hr_employee_access_scopes').select('assignment_id, scope_type, scope_id').in('assignment_id', ids),
    sb.from('hr_access_profiles').select('id, code, label, requires_mfa').in('id', profileIds),
    actorIds.length
      ? sb.from('app_users').select('id, full_name').in('id', actorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[], error: null }),
    getEmployerProfile(),
  ]);
  if (scopeRes.error) throw new Error(`Access scope read failed: ${scopeRes.error.message}`);
  if (profileRes.error) throw new Error(`Access profile read failed: ${profileRes.error.message}`);
  if (actorRes.error) throw new Error(`Access actor read failed: ${actorRes.error.message}`);

  const scopeRows = scopeRes.data as ScopeRow[];
  const scopeLabels = await resolveScopeLabels(scopeRows);
  const organisationName = employer.legalName.trim() || 'Whole Organisation';

  const profiles = new Map(
    (profileRes.data as { id: string; code: string; label: string; requires_mfa: boolean }[])
      .map(p => [p.id, p]),
  );
  const actors = new Map(
    (actorRes.data as { id: string; full_name: string | null }[]).map(a => [a.id, a.full_name]),
  );

  const scopesByAssignment = new Map<string, EmployeeAccessScope[]>();
  for (const s of scopeRows) {
    const list = scopesByAssignment.get(s.assignment_id) ?? [];
    list.push({
      scopeType: s.scope_type as AccessScopeType,
      scopeId: s.scope_id,
      scopeLabel: scopeLabelFor(s, scopeLabels, organisationName),
    });
    scopesByAssignment.set(s.assignment_id, list);
  }

  return assignments.map(a => {
    const profile = profiles.get(a.access_profile_id);
    return {
      id: a.id,
      accessProfileId: a.access_profile_id,
      accessProfileCode: profile?.code ?? 'unknown',
      accessProfileLabel: profile?.label ?? 'Unknown Access Profile',
      requiresMfa: profile?.requires_mfa ?? false,
      assignmentType: a.assignment_type as AccessAssignmentType,
      status: a.status as AccessAssignmentStatus,
      effectiveFrom: a.effective_from,
      effectiveTo: a.effective_to,
      grantedByName: a.granted_by ? (actors.get(a.granted_by) ?? null) : null,
      grantedAt: a.granted_at,
      revokedByName: a.revoked_by ? (actors.get(a.revoked_by) ?? null) : null,
      revokedAt: a.revoked_at,
      scopes: scopesByAssignment.get(a.id) ?? [],
    };
  });
}

/** RPC error → HTTP-shaped error, preserving the database's own message. */
function rpcFailure(prefix: string, error: { message: string; code?: string }): never {
  // A raised `22023` is a validation refusal from inside the command; anything
  // else is a genuine failure. Either way the transaction wrote nothing.
  const status = error.code === '22023' ? 422 : error.code === 'P0002' ? 404 : 500;
  throw Object.assign(new Error(`${prefix}: ${error.message}`), { status });
}

/**
 * Call a transactional command and return its jsonb result.
 *
 * supabase-js types `rpc()` loosely, so destructuring it directly leaks `any`.
 * Narrowing here once keeps every caller typed.
 */
async function callCommand<T>(fn: string, args: Record<string, unknown>, failurePrefix: string): Promise<T> {
  const result = await sb.rpc(fn, args) as unknown as {
    data: unknown;
    error: { message: string; code?: string } | null;
  };
  if (result.error) rpcFailure(failurePrefix, result.error);
  return result.data as T;
}

/**
 * Grant an access assignment.
 *
 * Everything — assignment, scopes, event, audit — commits inside
 * `hr_access_assignment_grant_tx` under one correlation id.
 */
export async function grantAccessAssignment(input: GrantAccessAssignmentInput): Promise<GrantResult> {
  return callCommand<GrantResult>('hr_access_assignment_grant_tx', {
    p_actor_id: input.actorId,
    p_employee_id: input.employeeId,
    p_access_profile_id: input.accessProfileId,
    p_assignment_type: input.assignmentType ?? 'profile',
    p_effective_from: input.effectiveFrom ?? null,
    p_scopes: input.scopes.map(s => ({ scopeType: s.scopeType, scopeId: s.scopeId ?? null })),
    p_correlation_id: input.correlationId,
  }, 'Access assignment grant failed');
}

/** Revoke an access assignment; status, event and audit commit together. */
export async function revokeAccessAssignment(input: RevokeAccessAssignmentInput): Promise<RevokeResult> {
  return callCommand<RevokeResult>('hr_access_assignment_revoke_tx', {
    p_actor_id: input.actorId,
    p_assignment_id: input.assignmentId,
    p_reason: input.reason ?? null,
    p_correlation_id: input.correlationId,
  }, 'Access assignment revoke failed');
}
