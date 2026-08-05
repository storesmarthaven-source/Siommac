// lib/hr/onboardingScope.ts — the ONE server-side resolver for onboarding read scope.
//
// Every onboarding read (cases, dashboard stats, tasks, handoffs, blockers, upcoming
// starts, deadlines, work queue) resolves its visible case population through this
// module. Counts, charts and widget totals are therefore computed from the SAME scoped
// case set as the register — a number can never be derived from rows the actor may not
// list. The frontend never receives out-of-scope rows to hide.
//
// Scope ladder (approved 2026-08-02):
//   my   — base `hr.onboarding.view`. Owned, started, assigned, participant, or an
//          explicitly permitted direct-report case.
//   team — requires `hr.onboarding.view_team`. The actor's department population.
//   all  — requires `hr.onboarding.view_all`. Every case.
//
// An unauthorised requested scope is a 403. It is NEVER silently downgraded: quietly
// serving `my` to someone who asked for `all` would make the UI lie about what it is
// showing, and would mask a broken permission grant during testing.

import { sb } from '../db';
import { userCan } from '../auth';

export type OnboardingScope = 'my' | 'team' | 'all';

export interface ScopeActor { id: string; role?: string | null }

/** The permission key each scope requires beyond the route's base `hr.onboarding.view`. */
const SCOPE_KEY: Record<OnboardingScope, string | null> = {
  my: null,                                // base view, already enforced by the route
  team: 'hr.onboarding.view_team',
  all: 'hr.onboarding.view_all',
};

export const ONBOARDING_SCOPES: readonly OnboardingScope[] = ['my', 'team', 'all'];

export function isOnboardingScope(v: unknown): v is OnboardingScope {
  return typeof v === 'string' && (ONBOARDING_SCOPES as readonly string[]).includes(v);
}

/**
 * The resolved population.
 *
 * `caseIds: null` means UNCONSTRAINED (scope `all`) — callers must skip the id filter
 * entirely rather than passing an empty array, which would return nothing.
 * `caseIds: []` is a real, meaningful result: the actor has no visible cases.
 */
export interface ResolvedOnboardingScope {
  scope: OnboardingScope;
  caseIds: string[] | null;
}

function forbidden(scope: OnboardingScope): Error {
  return Object.assign(
    new Error(`Not permitted to read onboarding at "${scope}" scope.`),
    { status: 403 },
  );
}

/**
 * Permission predicate. Routes pass the async `userCan`; the calendar adapters pass their
 * synchronous, already-superadmin-aware `ctx.can`. Both therefore evaluate the SAME scope
 * rules — there is no second client- or adapter-side rules engine.
 */
export type CanCheck = (key: string) => boolean | Promise<boolean>;

/**
 * The default scope for EVERY request is `my`.
 *
 * Deliberately not "the widest scope the actor may use": defaulting a manager to `all`
 * would silently widen reads that never asked to be widened, and would make an omitted
 * argument behave differently for two roles hitting the same endpoint. Widening is always
 * an explicit, permission-checked request.
 */
export const DEFAULT_ONBOARDING_SCOPE: OnboardingScope = 'my';

/** Case ids the actor owns, started, is assigned work on, or supervises. */
async function myCaseIds(actorId: string): Promise<string[]> {
  const ids = new Set<string>();

  // Owned or started by the actor.
  const { data: owned, error: ownedError } = await sb
    .from('hr_onboarding_cases')
    .select('id')
    .or(`owner_id.eq.${actorId},started_by.eq.${actorId}`);
  if (ownedError) throw Object.assign(new Error(ownedError.message), { status: 500 });
  for (const r of owned ?? []) ids.add(r.id as string);

  // Assigned onboarding work makes the actor a participant in that case.
  const { data: tasks, error: tasksError } = await sb
    .from('hr_onboarding_tasks')
    .select('case_id')
    .eq('assigned_to', actorId);
  if (tasksError) throw Object.assign(new Error(tasksError.message), { status: 500 });
  for (const r of tasks ?? []) if (r.case_id) ids.add(r.case_id as string);

  // Explicitly permitted direct reports — the actor supervises the case's employee.
  // `supervisor_id` is the ONLY reporting column on app_users; there is no `manager_id`.
  const { data: reports, error: reportsError } = await sb
    .from('app_users')
    .select('id')
    .eq('supervisor_id', actorId);
  if (reportsError) throw Object.assign(new Error(reportsError.message), { status: 500 });
  const reportIds = (reports ?? []).map(r => r.id as string).filter(Boolean);
  if (reportIds.length) {
    const { data: reportCases, error: reportCasesError } = await sb
      .from('hr_onboarding_cases')
      .select('id')
      .in('employee_id', reportIds);
    if (reportCasesError) throw Object.assign(new Error(reportCasesError.message), { status: 500 });
    for (const r of reportCases ?? []) ids.add(r.id as string);
  }

  return [...ids];
}

/** Case ids whose employee sits in the actor's department, plus everything in `my`. */
async function teamCaseIds(actorId: string): Promise<string[]> {
  const ids = new Set<string>(await myCaseIds(actorId));

  const { data: me, error: meError } = await sb
    .from('app_users')
    .select('department_id')
    .eq('id', actorId)
    .maybeSingle();
  if (meError) throw Object.assign(new Error(meError.message), { status: 500 });

  const departmentId = me?.department_id as string | null | undefined;
  // No department on the actor is not an error — the team set is simply their own work.
  if (departmentId) {
    const { data: peers, error: peersError } = await sb
      .from('app_users')
      .select('id')
      .eq('department_id', departmentId);
    if (peersError) throw Object.assign(new Error(peersError.message), { status: 500 });
    const peerIds = (peers ?? []).map(r => r.id as string).filter(Boolean);
    if (peerIds.length) {
      const { data: teamCases, error: teamCasesError } = await sb
        .from('hr_onboarding_cases')
        .select('id')
        .in('employee_id', peerIds);
      if (teamCasesError) throw Object.assign(new Error(teamCasesError.message), { status: 500 });
      for (const r of teamCases ?? []) ids.add(r.id as string);
    }
  }

  return [...ids];
}

/**
 * Resolve the requested scope for this actor.
 *
 * Throws 403 when the actor lacks the requested scope's key. Pass `requested`
 * undefined to use the actor's widest available scope.
 */
export async function resolveOnboardingScope(
  actor: ScopeActor,
  requested?: OnboardingScope,
): Promise<ResolvedOnboardingScope> {
  return resolveOnboardingScopeWith(actor.id, key => userCan(actor, key), requested);
}

/**
 * Scope resolution against an injected permission predicate.
 *
 * This is the single implementation of the ladder. `resolveOnboardingScope` (routes) and
 * the calendar adapters both funnel through it, so the reused Upcoming Deadlines and Task
 * Planner widgets cannot resolve scope differently from the Command Centre register.
 */
export async function resolveOnboardingScopeWith(
  actorId: string,
  can: CanCheck,
  requested?: OnboardingScope,
): Promise<ResolvedOnboardingScope> {
  const scope = requested ?? DEFAULT_ONBOARDING_SCOPE;

  const key = SCOPE_KEY[scope];
  if (key && !(await can(key))) throw forbidden(scope);

  if (scope === 'all')  return { scope, caseIds: null };
  if (scope === 'team') return { scope, caseIds: await teamCaseIds(actorId) };
  return { scope, caseIds: await myCaseIds(actorId) };
}

/**
 * Intersect a caller-supplied caseIds filter with the resolved scope.
 *
 * Used by read models that already accept a caseIds argument, so a client cannot widen
 * its own visibility by naming case ids directly.
 */
export function intersectScope(
  resolved: ResolvedOnboardingScope,
  requestedCaseIds?: string[] | null,
): string[] | null {
  if (!requestedCaseIds?.length) return resolved.caseIds;
  if (resolved.caseIds === null) return requestedCaseIds;
  const allowed = new Set(resolved.caseIds);
  return requestedCaseIds.filter(id => allowed.has(id));
}
