// lib/hr/onboardingWorkQueue.ts — the unified Onboarding Work Queue read model.
//
// ONE call to the hr_onboarding_work_queue RPC, which UNION ALLs the four existing stores
// (tasks, handoffs, blockers, evidence submissions) and does ALL filtering, sorting,
// LIMIT/OFFSET and the exact count in Postgres.
//
// WHY NOTHING IS FILTERED OR SORTED HERE
// Merging the stores in JS would mean fetching each one, concatenating, then slicing — at
// which point `total`, search and every filter become approximations bounded by the fetch
// window. Only label resolution happens in this file, and only for the rows on the
// CURRENT PAGE (<= 200), so it can never change which rows or how many the user sees.
//
// AUTHORIZATION
// This module does not authorize. It receives an already-ResolvedOnboardingScope and
// forwards its case ids to the RPC, preserving the two distinct meanings:
//   caseIds === null -> authorized and unconstrained
//   caseIds === []   -> authorized but no visible cases -> zero rows
// The TypeScript resolver stays the single authorization authority.

import { sb } from '../db';
import { intersectScope, type ResolvedOnboardingScope } from './onboardingScope';
import type {
  OnboardingWorkItem, OnboardingWorkQueueArgs, OnboardingWorkQueueResult,
  OnboardingWorkLifecycle, OnboardingWorkSourceType,
} from '../../../../types/hrOnboarding';

/** Exactly the columns the RPC returns. snake_case, straight from Postgres. */
interface WorkQueueDB {
  source_type: OnboardingWorkSourceType;
  source_id: string;
  case_id: string;
  case_no: string;
  employee_id: string | null;
  employee_name: string | null;
  department_id: string | null;
  site_id: string | null;
  title: string;
  detail: string | null;
  owning_queue: string | null;
  accountable_id: string | null;
  source_status: string;
  normalized_status: OnboardingWorkLifecycle;
  due_at: string | null;
  severity: string | null;
  is_blocking: boolean | null;
  related_task_id: string | null;
  related_handoff_id: string | null;
  created_at: string;
  total_count: number | string;
}

const emptyPage = (args: OnboardingWorkQueueArgs): OnboardingWorkQueueResult => ({
  rows: [], total: 0,
  page: Math.max(1, args.page ?? 1),
  pageSize: Math.min(200, Math.max(1, args.pageSize ?? 25)),
});

/** Null when absent/empty so the RPC's `p_x is null` short-circuit means "no filter". */
const arrOrNull = (v: readonly string[] | undefined): string[] | null =>
  v && v.length ? [...v] : null;

/**
 * Labels for the rows on this page only. Department, site and accountable person are
 * stored as ids; the queue filters on those ids IN SQL, so this lookup is presentation
 * only and cannot affect the result set or the total.
 */
async function pageLabels(rows: WorkQueueDB[]): Promise<{
  dept: Record<string, string>; site: Record<string, string>; user: Record<string, string>;
}> {
  const userIds = [...new Set(rows.map(r => r.accountable_id).filter((v): v is string => !!v))];
  const deptIds = [...new Set(rows.map(r => r.department_id).filter((v): v is string => !!v))];
  const siteIds = [...new Set(rows.map(r => r.site_id).filter((v): v is string => !!v))];
  const [depts, sites, users] = await Promise.all([
    deptIds.length
      ? sb.from('departments').select('id, name').in('id', deptIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null }[], error: null }),
    siteIds.length
      ? sb.from('project_sites').select('id, name').in('id', siteIds)
      : Promise.resolve({ data: [] as { id: string; name: string | null }[], error: null }),
    userIds.length
      ? sb.from('app_users').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[], error: null }),
  ]);
  const failed = depts.error ?? sites.error ?? users.error;
  if (failed) throw Object.assign(new Error(failed.message), { status: 500 });
  const map = (d: unknown, key: 'name' | 'full_name'): Record<string, string> =>
    Object.fromEntries(((d ?? []) as Record<string, string | null>[])
      .filter(r => typeof r['id'] === 'string' && !!r[key])
      .map(r => [r['id'] as string, r[key] as string]));
  return { dept: map(depts.data, 'name'), site: map(sites.data, 'name'), user: map(users.data, 'full_name') };
}

export async function listOnboardingWorkQueue(
  args: OnboardingWorkQueueArgs,
  scope: ResolvedOnboardingScope,
): Promise<OnboardingWorkQueueResult> {
  // An empty scope is a real "no visible cases" — return an empty page without querying,
  // never an unfiltered read.
  const caseIds = intersectScope(scope, null);
  if (caseIds !== null && caseIds.length === 0) return emptyPage(args);

  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, args.pageSize ?? 25));

  const { data, error } = await sb.rpc('hr_onboarding_work_queue', {
    p_case_ids: caseIds,                                   // null stays null: unconstrained
    p_source_types: arrOrNull(args.sourceTypes),
    p_lifecycles: arrOrNull(args.lifecycles),
    p_due_state: args.dueState ?? 'all',
    p_department_ids: arrOrNull(args.departmentIds),
    p_queues: arrOrNull(args.queues),
    p_accountable_ids: arrOrNull(args.accountableIds),
    p_unassigned: args.unassigned ?? false,
    p_search: args.query?.trim() || null,
    p_sort: args.sort?.field ?? 'due_at',
    p_sort_dir: args.sort?.direction ?? 'asc',
    p_page: page,
    p_page_size: pageSize,
  });

  // A failed read is surfaced, never swallowed into an empty queue — an empty queue and a
  // broken queue must not look identical to the user.
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  const dbRows = (data ?? []) as WorkQueueDB[];

  // total_count rides on every row of the page (a window count), so an empty page carries
  // no total. On page 1 that genuinely means zero. PAST page 1 it means the caller asked
  // for a page beyond the end — the total is NOT zero, and reporting it as zero would make
  // the pager collapse and tell the user their queue is empty. Re-read page 1 for the
  // count in that case only: one extra round trip, never on the common path.
  let total = dbRows.length ? Number(dbRows[0]?.total_count ?? 0) : 0;
  if (!dbRows.length && page > 1) {
    const { data: first, error: countErr } = await sb.rpc('hr_onboarding_work_queue', {
      p_case_ids: caseIds,
      p_source_types: arrOrNull(args.sourceTypes),
      p_lifecycles: arrOrNull(args.lifecycles),
      p_due_state: args.dueState ?? 'all',
      p_department_ids: arrOrNull(args.departmentIds),
      p_queues: arrOrNull(args.queues),
      p_accountable_ids: arrOrNull(args.accountableIds),
      p_unassigned: args.unassigned ?? false,
      p_search: args.query?.trim() || null,
      p_sort: args.sort?.field ?? 'due_at',
      p_sort_dir: args.sort?.direction ?? 'asc',
      p_page: 1,
      p_page_size: 1,
    });
    if (countErr) throw Object.assign(new Error(countErr.message), { status: 500 });
    total = Number(((first ?? []) as WorkQueueDB[])[0]?.total_count ?? 0);
  }

  const labels = await pageLabels(dbRows);

  const rows: OnboardingWorkItem[] = dbRows.map(r => ({
    sourceType: r.source_type,
    sourceId: r.source_id,
    caseId: r.case_id,
    caseNo: r.case_no,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    departmentId: r.department_id,
    departmentName: r.department_id ? labels.dept[r.department_id] ?? null : null,
    siteId: r.site_id,
    siteName: r.site_id ? labels.site[r.site_id] ?? null : null,
    title: r.title,
    detail: r.detail,
    owningQueue: r.owning_queue,
    accountableId: r.accountable_id,
    accountableName: r.accountable_id ? labels.user[r.accountable_id] ?? null : null,
    sourceStatus: r.source_status,
    normalizedStatus: r.normalized_status,
    dueAt: r.due_at,
    severity: r.severity,
    isBlocking: !!r.is_blocking,
    relatedTaskId: r.related_task_id,
    relatedHandoffId: r.related_handoff_id,
    createdAt: r.created_at,
  }));

  return { rows, total, page, pageSize };
}
