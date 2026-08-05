// lib/hr/onboardingQueries.ts — HR Onboarding management-module READ queries (Phase 2).
//
// Powers the Onboarding page's dashboard KPIs + Cases / Tasks / Handoffs / Blocked tabs.
// All progress / open / blocking / readiness numbers are COMPUTED here from the live
// task + blocker rows — never denormalized columns (no stale-state band-aid). Package
// labels come from the DB packages (lib/hr/onboardingPackageService.packageLabelMap).
// Backend-only (service-role); routes gate with hr.onboarding.view.

import { sb } from '../db';
import { packageLabelMap } from './onboardingPackageService';
import { taskCategory, READINESS_CATS, type TaskCategory } from './onboardingTaskCategory';
import { intersectScope, type ResolvedOnboardingScope } from './onboardingScope';
/**
 * Scope helpers — every read below funnels through these so a surface cannot invent its
 * own rule. `caseIds === null` is UNCONSTRAINED (scope `all`); `[]` is a real "no visible
 * cases" and MUST yield zero/empty aggregates rather than falling through to every row.
 */
function scopeIsEmpty(scope: ResolvedOnboardingScope): boolean {
  return scope.caseIds !== null && scope.caseIds.length === 0;
}

/** Case ids to filter on, after narrowing by any caller-supplied ids. Null = no filter. */
function scopedCaseIds(scope: ResolvedOnboardingScope, requested?: string[] | null): string[] | null {
  return intersectScope(scope, requested);
}

import type {
  OnboardingCaseListArgs, OnboardingCaseListResult, OnboardingCaseRow, OnboardingCaseStatus,
  OnboardingDashboardStats, OnboardingDashboardStatsArgs,
  OnboardingTaskListArgs, OnboardingTaskRow, OnboardingTaskStatus, OnboardingTaskDetail,
  OnboardingTaskNote, OnboardingTaskEvidence, OnboardingEvidenceReviewStatus,
  OnboardingHandoffListArgs, OnboardingHandoffRow, OnboardingHandoffStatus,
  OnboardingBlockerListArgs, OnboardingBlockerRow, OnboardingBlockerStatus, OnboardingSeverity,
  OnboardingAuditRow, DueState,
} from '../../../../types/hrOnboarding';

// ── DB row shapes (the columns we actually select) ──────────────────────────────
interface CaseDB { id: string; case_no: string; employee_id: string | null; worker_type: string | null; package_key: string; status: string; owner_id: string | null; due_at: string | null; started_at: string | null; reason: string | null; target_start_date: string | null }
interface TaskDB { id: string; case_id: string; task_key: string; task_title: string; owner_role: string | null; module_key: string | null; assigned_to: string | null; status: string; due_at: string | null; completed_at: string | null; is_blocking: boolean | null; requires_evidence: boolean | null; priority: string | null }
interface HandoffDB { id: string; case_id: string; target_module: string; handoff_type: string | null; handoff_key: string | null; status: string; owner_id: string | null; due_at: string | null; failure_reason: string | null; payload: unknown; created_at: string; last_event_at: string | null }
interface BlockerDB { id: string; case_id: string; blocker_key: string; blocker_title: string; blocking_module: string; severity: string; status: string; owner_id: string | null; due_at: string | null; created_at: string; task_id: string | null; handoff_id: string | null }
interface EmpDB { id: string; full_name: string | null; employee_number: string | null; department_id: string | null; site_id: string | null; contractor_flag: boolean | null; profile_image_url: string | null }
interface CaseLite { id: string; case_no: string; employee_id: string | null; package_key?: string }

const ACTIVE_BLOCKER = new Set(['active', 'acknowledged', 'waiting_on_owner', 'escalated']);
const CLOSED_TASK = new Set(['completed', 'skipped', 'cancelled']);
const DONE_TASK = new Set(['completed', 'skipped']);
const ACTIVE_CASE = ['draft', 'open', 'in_progress', 'blocked', 'paused', 'ready_for_activation'];
const isOpenTask = (s: string): boolean => !CLOSED_TASK.has(s);

/** Canonical inclusive date window [today, today+days] as YYYY-MM-DD keys. */
function startWindow(days: number, now = new Date()): { from: string; to: string } {
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + days);
  return { from: isoDate(from), to: isoDate(to) };
}


/**
 * Every scoped ACTIVE case, loaded in pages — no row ceiling.
 *
 * The dashboard's aggregates (trend, blocking mix, readiness split, cohort counts) are only
 * correct over the COMPLETE population. A fixed `.limit(1000)` silently produced capped
 * totals on a larger tenant: the number looked plausible, reconciled with nothing, and got
 * worse as the tenant grew. Documenting that ceiling would not have made the KPI accurate.
 *
 * Ordering is stable (`id`) so `.range()` windows cannot overlap or skip rows between pages —
 * ordering by a mutable column such as `started_at` can shift a row across a page boundary
 * mid-read. Every page's error is checked; a partial read must fail, never silently truncate.
 */
const CASE_PAGE = 1000;

async function loadAllActiveCases(
  scopedIds: string[] | null,
  args: OnboardingDashboardStatsArgs,
): Promise<CaseDB[]> {
  const out: CaseDB[] = [];
  for (let from = 0; ; from += CASE_PAGE) {
    let q = sb.from('hr_onboarding_cases')
      .select('id, case_no, employee_id, worker_type, package_key, status, owner_id, due_at, started_at, reason, target_start_date')
      .in('status', ACTIVE_CASE)
      .order('id', { ascending: true })
      .range(from, from + CASE_PAGE - 1);
    if (scopedIds !== null)       q = q.in('id', scopedIds);
    if (args.packageKeys?.length) q = q.in('package_key', args.packageKeys);
    if (args.ownerIds?.length)    q = q.in('owner_id', args.ownerIds);

    const { data, error } = await q;
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    const page = (data ?? []) as CaseDB[];
    out.push(...page);
    if (page.length < CASE_PAGE) return out;
  }
}

/** Complete case population for the register. Search and joined/computed filters happen
 * after this load, so a fixed SQL limit would make both `total` and later pages lie. */
async function loadAllCasesForList(
  scopedIds: string[] | null,
  args: OnboardingCaseListArgs,
  now: Date,
): Promise<CaseDB[]> {
  const out: CaseDB[] = [];
  for (let from = 0; ; from += CASE_PAGE) {
    let q = sb.from('hr_onboarding_cases')
      .select('id, case_no, employee_id, worker_type, package_key, status, owner_id, due_at, started_at, reason, target_start_date')
      .order('id', { ascending: true })
      .range(from, from + CASE_PAGE - 1);
    if (scopedIds !== null)        q = q.in('id', scopedIds);
    if (args.statuses?.length)     q = q.in('status', args.statuses);
    if (args.packageKeys?.length)  q = q.in('package_key', args.packageKeys);
    if (args.ownerIds?.length)     q = q.in('owner_id', args.ownerIds);
    if (args.employeeIds?.length)  q = q.in('employee_id', args.employeeIds);
    if (args.workerTypes?.length)  q = q.in('worker_type', args.workerTypes);
    if (args.reasons?.length)      q = q.in('reason', args.reasons);
    if (typeof args.startsWithinDays === 'number') {
      const w = startWindow(args.startsWithinDays, now);
      q = q.not('target_start_date', 'is', null).gte('target_start_date', w.from).lte('target_start_date', w.to);
    }
    if (args.unassignedOwner) q = q.is('owner_id', null);

    const { data, error } = await q;
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    const page = (data ?? []) as CaseDB[];
    out.push(...page);
    if (page.length < CASE_PAGE) return out;
  }
}

// ── per-case task aggregate ──────────────────────────────────────────────────────
interface CaseAgg { total: number; done: number; open: number; blocking: number; cats: Map<TaskCategory, { total: number; openTasks: number }> }
const emptyAgg = (): CaseAgg => ({ total: 0, done: 0, open: 0, blocking: 0, cats: new Map() });

function aggregateTasks(tasks: TaskDB[]): Map<string, CaseAgg> {
  const m = new Map<string, CaseAgg>();
  for (const t of tasks) {
    const agg = m.get(t.case_id) ?? emptyAgg();
    agg.total += 1;
    if (DONE_TASK.has(t.status)) agg.done += 1;
    const open = isOpenTask(t.status);
    if (open) agg.open += 1;
    if (open && t.is_blocking) agg.blocking += 1;
    const cat = taskCategory(t);
    const c = agg.cats.get(cat) ?? { total: 0, openTasks: 0 };
    c.total += 1; if (open) c.openTasks += 1;
    agg.cats.set(cat, c);
    m.set(t.case_id, agg);
  }
  return m;
}

// ── lookups ──────────────────────────────────────────────────────────────────────
async function loadTasks(caseIds: string[]): Promise<TaskDB[]> {
  if (!caseIds.length) return [];
  const { data, error } = await sb.from('hr_onboarding_tasks')
    .select('id, case_id, task_key, task_title, owner_role, module_key, assigned_to, status, due_at, completed_at, is_blocking, requires_evidence, priority')
    .in('case_id', caseIds);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return (data ?? []) as TaskDB[];
}

async function activeBlockerCounts(caseIds: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!caseIds.length) return m;
  const { data, error } = await sb.from('hr_onboarding_blockers').select('case_id, status').in('case_id', caseIds);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  for (const b of (data ?? []) as { case_id: string; status: string }[]) {
    if (ACTIVE_BLOCKER.has(b.status)) m.set(b.case_id, (m.get(b.case_id) ?? 0) + 1);
  }
  return m;
}

async function nameMap(ids: string[]): Promise<Record<string, string | null>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data, error } = await sb.from('app_users').select('id, full_name').in('id', uniq);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return Object.fromEntries(((data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name]));
}

/** Profile photos (app_users.profile_image_url — the same field ProfileDrawer/Messages/
 *  EntityHead already display) alongside the name-only nameMap(), so every avatar in the
 *  onboarding module can show a real photo instead of always falling back to initials. */
async function photoMap(ids: string[]): Promise<Record<string, string | null>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data, error } = await sb.from('app_users').select('id, profile_image_url').in('id', uniq);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return Object.fromEntries(((data ?? []) as { id: string; profile_image_url: string | null }[]).map(u => [u.id, u.profile_image_url]));
}

async function employeeMaps(ids: string[]): Promise<{ emp: Record<string, EmpDB>; deptMap: Record<string, string>; siteMap: Record<string, string> }> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return { emp: {}, deptMap: {}, siteMap: {} };
  const [empRes, deptRes, siteRes] = await Promise.all([
    sb.from('app_users').select('id, full_name, employee_number, department_id, site_id, contractor_flag, profile_image_url').in('id', uniq),
    sb.from('departments').select('id, name'),
    sb.from('project_sites').select('id, name'),
  ]);
  const failed = empRes.error ?? deptRes.error ?? siteRes.error;
  if (failed) throw Object.assign(new Error(failed.message), { status: 500 });
  const emps = empRes.data, depts = deptRes.data, sites = siteRes.data;
  return {
    emp: Object.fromEntries(((emps ?? []) as EmpDB[]).map(e => [e.id, e])),
    deptMap: Object.fromEntries(((depts ?? []) as { id: string; name: string }[]).map(d => [d.id, d.name])),
    siteMap: Object.fromEntries(((sites ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name])),
  };
}

async function caseLiteMap(caseIds: string[], withPackage = false): Promise<Record<string, CaseLite>> {
  if (!caseIds.length) return {};
  const cols = withPackage ? 'id, case_no, employee_id, package_key' : 'id, case_no, employee_id';
  const { data, error } = await sb.from('hr_onboarding_cases').select(cols).in('id', caseIds);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return Object.fromEntries(((data ?? []) as unknown as CaseLite[]).map(c => [c.id, c]));
}

// ── due-date bucketing ─────────────────────────────────────────────────────────--
type DueBucket = 'overdue' | 'due_today' | 'due_this_week' | 'future' | null;
function dueBucket(due: string | null, now: Date): DueBucket {
  if (!due) return null;
  const d = new Date(due);
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(startToday); endToday.setDate(endToday.getDate() + 1);
  const in7 = new Date(startToday); in7.setDate(in7.getDate() + 7);
  if (d < startToday) return 'overdue';
  if (d < endToday) return 'due_today';
  if (d < in7) return 'due_this_week';
  return 'future';
}
function matchDue(due: string | null, state: DueState, now: Date, status: string): boolean {
  if (status === 'completed' || status === 'cancelled') return false;
  const b = dueBucket(due, now);
  if (state === 'overdue') return b === 'overdue';
  if (state === 'due_today') return b === 'due_today';
  if (state === 'due_this_week') return b === 'overdue' || b === 'due_today' || b === 'due_this_week';
  return true;
}

function weekStart(d: Date): Date { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - day); return x; }
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

// ════════════════════════════════════════════════════════════════════════════════
// 1. Cases list
// ════════════════════════════════════════════════════════════════════════════════
export async function listOnboardingCases(
  args: OnboardingCaseListArgs,
  scope: ResolvedOnboardingScope,
): Promise<OnboardingCaseListResult> {
  const now = new Date();
  // An empty scope returns an empty page — never an unfiltered query.
  if (scopeIsEmpty(scope)) {
    return { rows: [], total: 0, page: Math.max(1, args.page ?? 1), pageSize: Math.min(200, Math.max(1, args.pageSize ?? 25)) };
  }
  // Explicit caseIds may only NARROW the resolved scope, never widen it.
  const visibleIds = scopedCaseIds(scope, args.caseIds);
  if (visibleIds !== null && !visibleIds.length) {
    return { rows: [], total: 0, page: Math.max(1, args.page ?? 1), pageSize: Math.min(200, Math.max(1, args.pageSize ?? 25)) };
  }
  // Upcoming Starts: a real server-side window on target_start_date, not a client filter over
  // a due-date-sorted page.
  // The complete loader applies the date window and owner predicate server-side on every
  // page, then the joined/computed filters below operate on the complete population.
  // Owner Required drill-through — the same predicate the KPI counts.
  const cases = await loadAllCasesForList(visibleIds, args, now);
  const caseIds = cases.map(c => c.id);

  const [tasks, blockers, maps, ownerNames, labels] = await Promise.all([
    loadTasks(caseIds),
    activeBlockerCounts(caseIds),
    employeeMaps(cases.map(c => c.employee_id).filter((x): x is string => !!x)),
    nameMap(cases.map(c => c.owner_id).filter((x): x is string => !!x)),
    packageLabelMap(),
  ]);
  const agg = aggregateTasks(tasks);

  let rows: OnboardingCaseRow[] = cases.map(c => {
    const a = agg.get(c.id) ?? emptyAgg();
    const e = c.employee_id ? maps.emp[c.employee_id] : undefined;
    const ready = c.status === 'ready_for_activation' || (a.total > 0 && a.open === 0);
    return {
      caseId: c.id,
      caseNo: c.case_no,
      employeeId: c.employee_id ?? null,
      employeeName: e?.full_name ?? null,
      employeeNo: e?.employee_number ?? null,
      employeePhotoUrl: e?.profile_image_url ?? null,
      workerType: c.worker_type ?? null,
      departmentName: e?.department_id ? maps.deptMap[e.department_id] ?? null : null,
      siteName: e?.site_id ? maps.siteMap[e.site_id] ?? null : null,
      packageKey: c.package_key,
      packageLabel: labels[c.package_key] ?? c.package_key,
      reason: c.reason ?? null,
      ownerId: c.owner_id ?? null,
      ownerName: c.owner_id ? ownerNames[c.owner_id] ?? null : null,
      status: c.status as OnboardingCaseStatus,
      progressPercent: a.total ? Math.round((a.done / a.total) * 100) : 0,
      openTasks: a.open,
      blockingTasks: a.blocking,
      activeBlockers: blockers.get(c.id) ?? 0,
      ready,
      dueAt: c.due_at ?? null,
      startedAt: c.started_at ?? null,
      targetStartDate: c.target_start_date ?? null,
    };
  });

  // JS-side filters that depend on joined / computed data
  if (args.query) {
    const s = args.query.toLowerCase();
    rows = rows.filter(r => r.caseNo.toLowerCase().includes(s) || (r.employeeName ?? '').toLowerCase().includes(s) || (r.employeeNo ?? '').toLowerCase().includes(s));
  }
  if (args.departmentIds?.length) {
    const set = new Set(args.departmentIds);
    rows = rows.filter(r => { const e = r.employeeId ? maps.emp[r.employeeId] : undefined; return !!e?.department_id && set.has(e.department_id); });
  }
  if (args.siteIds?.length) {
    const set = new Set(args.siteIds);
    rows = rows.filter(r => { const e = r.employeeId ? maps.emp[r.employeeId] : undefined; return !!e?.site_id && set.has(e.site_id); });
  }
  if (args.dueState && args.dueState !== 'all') rows = rows.filter(r => matchDue(r.dueAt, args.dueState!, now, r.status));
  if (args.blockingState && args.blockingState !== 'all') {
    const blocked = (r: OnboardingCaseRow) => r.blockingTasks > 0 || r.activeBlockers > 0 || r.status === 'blocked';
    rows = rows.filter(r => args.blockingState === 'blocked' ? blocked(r) : !blocked(r));
  }
  if (args.readinessState && args.readinessState !== 'all') rows = rows.filter(r => args.readinessState === 'ready' ? r.ready : !r.ready);

  if (args.sort) {
    const dir = args.sort.direction === 'asc' ? 1 : -1;
    const field = args.sort.field;
    rows.sort((a2, b2) => {
      switch (field) {
        case 'case_no':    return dir * a2.caseNo.localeCompare(b2.caseNo);
        case 'status':     return dir * a2.status.localeCompare(b2.status);
        case 'progress':   return dir * (a2.progressPercent - b2.progressPercent);
        case 'due_at':     return dir * ((a2.dueAt ?? '').localeCompare(b2.dueAt ?? ''));
        case 'target_start_date': {
          // Cases without a planned start sort last in either direction — an absent date is
          // not "earliest".
          const av = a2.targetStartDate ?? '', bv = b2.targetStartDate ?? '';
          if (!av && !bv) return 0;
          if (!av) return 1;
          if (!bv) return -1;
          return dir * av.localeCompare(bv);
        }
        case 'started_at':
        default:           return dir * ((a2.startedAt ?? '').localeCompare(b2.startedAt ?? ''));
      }
    });
  }

  const total = rows.length;
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, args.pageSize ?? 25));
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total, page, pageSize };
}

// ════════════════════════════════════════════════════════════════════════════════
// 2. Dashboard stats
// ════════════════════════════════════════════════════════════════════════════════
export async function getOnboardingDashboardStats(
  args: OnboardingDashboardStatsArgs,
  scope: ResolvedOnboardingScope,
): Promise<OnboardingDashboardStats> {
  const now = new Date();
  const scopedIds = scopedCaseIds(scope, null);
  // Complete scoped population — every aggregate below is computed over ALL rows.
  let cases = await loadAllActiveCases(scopedIds, args);

  // department / site filters need the employee join
  if (args.departmentIds?.length || args.siteIds?.length) {
    const maps = await employeeMaps(cases.map(c => c.employee_id).filter((x): x is string => !!x));
    const depts = args.departmentIds?.length ? new Set(args.departmentIds) : null;
    const sites = args.siteIds?.length ? new Set(args.siteIds) : null;
    cases = cases.filter(c => {
      const e = c.employee_id ? maps.emp[c.employee_id] : undefined;
      if (depts && !(e?.department_id && depts.has(e.department_id))) return false;
      if (sites && !(e?.site_id && sites.has(e.site_id))) return false;
      return true;
    });
  }
  const caseIds = cases.map(c => c.id);
  const [tasks, blockerCounts] = await Promise.all([loadTasks(caseIds), activeBlockerCounts(caseIds)]);
  const tasksByCase = new Map<string, TaskDB[]>();
  for (const t of tasks) { const l = tasksByCase.get(t.case_id) ?? []; l.push(t); tasksByCase.set(t.case_id, l); }
  const agg = aggregateTasks(tasks);

  // active cases breakdown
  const total = cases.length;
  const newHires = cases.filter(c => c.reason === 'new_hire').length;
  const transfers = cases.filter(c => !!c.reason && c.reason.includes('transfer')).length;
  const contractors = cases.filter(c => c.worker_type === 'contractor' || c.worker_type === 'contractor_worker').length;

  // weekly trend — cases started in each of the last 8 weeks (all cases, not just active)
  const eightWeeksAgo = weekStart(now); eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 7 * 7);
  // Scoped like every other aggregate: an unfiltered trend would leak organisation-wide
  // start counts into the chart even when the register beside it is correctly scoped.
  let trendQ = sb.from('hr_onboarding_cases').select('started_at').gte('started_at', eightWeeksAgo.toISOString());
  if (scopedIds !== null) trendQ = trendQ.in('id', scopedIds);
  const { data: startedRaw } = await trendQ;
  const buckets: { week: string; count: number }[] = [];
  for (let i = 0; i < 8; i++) { const w = new Date(eightWeeksAgo); w.setDate(w.getDate() + i * 7); buckets.push({ week: isoDate(w), count: 0 }); }
  const bucketIndex = new Map(buckets.map((b, i) => [b.week, i]));
  for (const s of (startedRaw ?? []) as { started_at: string | null }[]) {
    if (!s.started_at) continue;
    const wk = isoDate(weekStart(new Date(s.started_at)));
    const i = bucketIndex.get(wk); if (i !== undefined) buckets[i]!.count += 1;
  }

  // ── Starts Within 7 Days + Owner Required ──────────────────────────────────────
  // Computed over the COMPLETE, fully-filtered population above — exact for every accepted
  // filter combination, including department/site. These previously used separate count
  // queries that could not honour the employee-join filters, so a filtered request returned
  // an unfiltered (and therefore wrong) total.
  const startWin = startWindow(7, now);
  const startsWithin7Days = cases.filter(c =>
    !!c.target_start_date && c.target_start_date >= startWin.from && c.target_start_date <= startWin.to).length;
  const ownerRequired = cases.filter(c => !c.owner_id).length;

  // blocking — count OPEN BLOCKING tasks by category across active cases
  const blockingByCat = { documents: 0, training: 0, hse: 0, payroll: 0 };
  for (const t of tasks) {
    if (!t.is_blocking || !isOpenTask(t.status)) continue;
    const cat = taskCategory(t);
    if (cat === 'documents' || cat === 'training' || cat === 'hse' || cat === 'payroll') blockingByCat[cat] += 1;
  }
  const blockedCases = cases.filter(c => c.status === 'blocked' || (blockerCounts.get(c.id) ?? 0) > 0 || (agg.get(c.id)?.blocking ?? 0) > 0).length;

  // due this week — over OPEN tasks of active cases
  const due = { dueToday: 0, overdue: 0, dueIn7Days: 0, criticalOverdue: 0 };
  for (const t of tasks) {
    if (!isOpenTask(t.status)) continue;
    const b = dueBucket(t.due_at, now);
    if (b === 'overdue') { due.overdue += 1; if (t.is_blocking || t.priority === 'critical') due.criticalOverdue += 1; }
    else if (b === 'due_today') due.dueToday += 1;
    else if (b === 'due_this_week') due.dueIn7Days += 1;
  }

  // activation readiness — % of active cases ready overall + per category
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const isReady = (c: CaseDB): boolean => { const a = agg.get(c.id); return c.status === 'ready_for_activation' || (!!a && a.total > 0 && a.open === 0); };
  const readyCount = cases.filter(isReady).length;

  // Three-way activation split, defined on TASK STATE so every active case lands in
  // exactly one bucket and the three sum to `total`. A case with no tasks is
  // notStarted — an empty checklist is not evidence of readiness.
  let inProgressCases = 0;
  let notStartedCases = 0;
  for (const c of cases) {
    if (isReady(c)) continue;
    const a = agg.get(c.id);
    if ((a?.done ?? 0) > 0) inProgressCases += 1;
    else notStartedCases += 1;
  }
  const catReady: Record<TaskCategory, number> = { profile: 0, documents: 0, training: 0, access: 0, payroll: 0, hse: 0, other: 0 };
  for (const c of cases) {
    const a = agg.get(c.id);
    for (const cat of READINESS_CATS) {
      const cc = a?.cats.get(cat);
      if (!cc || cc.openTasks === 0) catReady[cat] += 1;   // no pending in category ⇒ ready for it
    }
  }

  // per-package readiness — same active-case set, grouped by package
  const labels = await packageLabelMap();
  const byPkg = new Map<string, { active: number; ready: number }>();
  for (const c of cases) {
    const e = byPkg.get(c.package_key) ?? { active: 0, ready: 0 };
    e.active += 1;
    if (isReady(c)) e.ready += 1;
    byPkg.set(c.package_key, e);
  }
  const packageReadiness = Array.from(byPkg.entries())
    .map(([packageKey, v]) => ({ packageKey, packageLabel: labels[packageKey] ?? packageKey, activeCount: v.active, readyPercent: v.active ? Math.round((v.ready / v.active) * 100) : 0 }))
    .sort((a2, b2) => b2.activeCount - a2.activeCount);

  return {
    activeCases: { total, newHires, transfers, contractors, weeklyTrend: buckets },
    blockingTasks: { blockedCases, documents: blockingByCat.documents, training: blockingByCat.training, hse: blockingByCat.hse, payroll: blockingByCat.payroll },
    dueThisWeek: due,
    startsWithin7Days,
    ownerRequired,
    activationReadiness: {
      readyPercent: pct(readyCount),
      profileReadyPercent: pct(catReady.profile),
      documentsReadyPercent: pct(catReady.documents),
      trainingReadyPercent: pct(catReady.training),
      accessReadyPercent: pct(catReady.access),
      readyCases: readyCount,
      inProgressCases,
      notStartedCases,
    },
    packageReadiness,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// 2b. Recent activity (Overview widget) — cross-case feed, reuses the case Audit
// tab's DTO. hr_audit_log already captures every onboarding mutation (cases, tasks,
// blockers, custom actions, packages) via writeHrAudit — nothing new to instrument.
// ════════════════════════════════════════════════════════════════════════════════
export async function listRecentOnboardingActivity(
  limit = 15,
  scope: ResolvedOnboardingScope,
): Promise<OnboardingAuditRow[]> {
  // The cross-case activity feed is scoped like every other surface. Unscoped, the Command
  // Centre's Recent Activity would narrate work on cases the actor cannot open — a leak of
  // employee names and actions through an aggregate rather than through the register.
  // `record_id` carries the onboarding case id (see writeHrAudit in employeeCore.ts).
  // The feed carries TWO kinds of row: case-linked activity (record_id = case id) and
  // package/governance activity (record_id = package id, no case). Scope constrains the
  // CASE-linked rows only. Filtering the whole feed by case id silently deleted every
  // package event for any scope except `all` — the feed is not purely case-scoped.
  const { data: raw, error: auditError } = await sb.from('hr_audit_log')
    .select('id, actor_id, action, previous_state, new_state, reason, created_at, record_id')
    .eq('submodule_key', 'onboarding')
    .order('created_at', { ascending: false }).limit(Math.max(limit * 4, limit));
  if (auditError) throw Object.assign(new Error(auditError.message), { status: 500 });

  const candidates = (raw ?? []) as { record_id: string | null }[] as Array<Record<string, unknown>>;
  let data = candidates;
  if (scope.caseIds !== null) {
    const allowed = new Set(scope.caseIds);
    // Which of these record_ids are onboarding CASES? Anything else is not case-scoped.
    const recordIds = [...new Set(candidates.map(r => r.record_id as string | null).filter((x): x is string => !!x))];
    const caseRecordIds = new Set<string>();
    if (recordIds.length) {
      const { data: knownCases, error: caseError } = await sb.from('hr_onboarding_cases').select('id').in('id', recordIds);
      if (caseError) throw Object.assign(new Error(caseError.message), { status: 500 });
      for (const c of knownCases ?? []) caseRecordIds.add(c.id as string);
    }
    data = candidates.filter(r => {
      const rid = r.record_id as string | null;
      if (rid && caseRecordIds.has(rid)) return allowed.has(rid);  // case row → must be in scope
      return true;                                                  // non-case governance row
    });
  }
  data = data.slice(0, limit);
  const rows = (data ?? []) as { id: string; actor_id: string | null; action: string; previous_state: unknown; new_state: unknown; reason: string | null; created_at: string }[];
  const names = await nameMap(rows.map(r => r.actor_id).filter((x): x is string => !!x));
  return rows.map(r => ({
    id: r.id, action: r.action, actorId: r.actor_id ?? null, actorName: r.actor_id ? names[r.actor_id] ?? null : null,
    reason: r.reason ?? null, previousState: r.previous_state ?? null, newState: r.new_state ?? null, createdAt: r.created_at,
  }));
}

// ════════════════════════════════════════════════════════════════════════════════
// 3. Tasks list
// ════════════════════════════════════════════════════════════════════════════════
export async function listOnboardingTasks(
  args: OnboardingTaskListArgs,
  scope: ResolvedOnboardingScope,
): Promise<OnboardingTaskRow[]> {
  if (scopeIsEmpty(scope)) return [];
  const visibleIds = scopedCaseIds(scope, args.caseId ? [args.caseId] : null);
  if (visibleIds !== null && !visibleIds.length) return [];
  let q = sb.from('hr_onboarding_tasks')
    .select('id, case_id, task_key, task_title, owner_role, module_key, assigned_to, status, due_at, completed_at, is_blocking, requires_evidence, priority')
    .order('sort_order').limit(2000);
  if (visibleIds !== null)    q = q.in('case_id', visibleIds);
  if (args.caseId)            q = q.eq('case_id', args.caseId);
  if (args.statuses?.length)  q = q.in('status', args.statuses);
  if (args.ownerRoles?.length)q = q.in('owner_role', args.ownerRoles);
  if (args.moduleKeys?.length)q = q.in('module_key', args.moduleKeys);
  if (args.assignedTo)        q = q.eq('assigned_to', args.assignedTo);
  if (args.blockingOnly)      q = q.eq('is_blocking', true);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  const tasks = (data ?? []) as TaskDB[];

  const caseMap = await caseLiteMap([...new Set(tasks.map(t => t.case_id))], true);
  const empIds = Object.values(caseMap).map(c => c.employee_id).filter((x): x is string => !!x);
  const [names, photos] = await Promise.all([
    nameMap([...empIds, ...tasks.map(t => t.assigned_to).filter((x): x is string => !!x)]),
    photoMap(empIds),
  ]);

  let rows: OnboardingTaskRow[] = tasks.map(t => {
    const c = caseMap[t.case_id];
    return {
      taskId: t.id,
      caseId: t.case_id,
      caseNo: c?.case_no ?? '',
      employeeId: c?.employee_id ?? null,
      employeeName: c?.employee_id ? names[c.employee_id] ?? null : null,
      employeePhotoUrl: c?.employee_id ? photos[c.employee_id] ?? null : null,
      packageKey: c?.package_key ?? '',
      taskKey: t.task_key,
      taskTitle: t.task_title,
      ownerRole: t.owner_role ?? null,
      moduleKey: t.module_key ?? null,
      assignedTo: t.assigned_to ?? null,
      assignedToName: t.assigned_to ? names[t.assigned_to] ?? null : null,
      status: t.status as OnboardingTaskStatus,
      dueAt: t.due_at ?? null,
      completedAt: t.completed_at ?? null,
      isBlocking: !!t.is_blocking,
      requiresEvidence: !!t.requires_evidence,
      priority: t.priority ?? null,
    };
  });
  if (args.query) { const s = args.query.toLowerCase(); rows = rows.filter(r => r.taskTitle.toLowerCase().includes(s) || (r.employeeName ?? '').toLowerCase().includes(s) || r.caseNo.toLowerCase().includes(s)); }
  if (args.packageKeys?.length) { const set = new Set(args.packageKeys); rows = rows.filter(r => set.has(r.packageKey)); }
  if (args.dueState && args.dueState !== 'all') { const now = new Date(); rows = rows.filter(r => matchDue(r.dueAt, args.dueState!, now, r.status)); }
  return rows;
}

// ── single-task detail (Tasks Workspace drawer) ──────────────────────────────────
interface TaskDetailDB extends TaskDB {
  blocked_reason: string | null; dependency_keys: unknown; sort_order: number;
  completed_by: string | null; completed_at: string | null; created_at: string; metadata: unknown;
}
const asNoteArr = (v: unknown): OnboardingTaskNote[] => (Array.isArray(v) ? v.filter((x): x is OnboardingTaskNote => !!x && typeof x === 'object' && typeof (x as { note?: unknown }).note === 'string') : []);
/**
 * Evidence now comes from hr_onboarding_task_evidence, NOT task metadata. The old JSON array
 * carried no review decision, so a document could only ever be shown as "attached" — the
 * table is what lets an approval or a return be a recorded fact. Legacy entries were copied
 * into the table as pending_review, so this single read covers both old and new submissions
 * and there is no second read path to keep in step.
 */
interface EvidenceDB {
  id: string; file_name: string | null; file_path: string | null; mime_type: string | null;
  file_size: number | string | null; submitted_by: string | null; submitted_at: string;
  review_status: OnboardingEvidenceReviewStatus; reviewed_by: string | null;
  reviewed_at: string | null; review_note: string | null; is_legacy: boolean | null;
}

async function loadTaskEvidence(taskId: string): Promise<EvidenceDB[]> {
  const { data, error } = await sb.from('hr_onboarding_task_evidence')
    .select('id, file_name, file_path, mime_type, file_size, submitted_by, submitted_at, review_status, reviewed_by, reviewed_at, review_note, is_legacy')
    .eq('task_id', taskId)
    .order('submitted_at', { ascending: true });
  // A failed evidence read must not masquerade as "no evidence attached" on a task whose
  // completion may be gated on it.
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return (data ?? []) as EvidenceDB[];
}

export async function getOnboardingTaskDetail(taskId: string): Promise<OnboardingTaskDetail> {
  const { data: t, error } = await sb.from('hr_onboarding_tasks')
    .select('id, case_id, task_key, task_title, owner_role, module_key, assigned_to, status, due_at, is_blocking, requires_evidence, priority, blocked_reason, dependency_keys, sort_order, completed_by, completed_at, created_at, metadata')
    .eq('id', taskId).maybeSingle<TaskDetailDB>();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (!t) throw Object.assign(new Error('Onboarding task not found.'), { status: 404 });

  const meta = (t.metadata && typeof t.metadata === 'object' ? t.metadata : {}) as Record<string, unknown>;
  const notes = asNoteArr(meta['notes']);
  const evidenceRows = await loadTaskEvidence(t.id);

  const caseMap = await caseLiteMap([t.case_id], true);
  const c = caseMap[t.case_id];
  const names = await nameMap([
    c?.employee_id ?? '', t.assigned_to ?? '', t.completed_by ?? '',
    ...notes.map(n => n.byId ?? ''),
    ...evidenceRows.map(e => e.submitted_by ?? ''), ...evidenceRows.map(e => e.reviewed_by ?? ''),
  ].filter(Boolean));

  const evidence: OnboardingTaskEvidence[] = evidenceRows.map(e => ({
    id: e.id,
    // A legacy row may have neither, and is labelled rather than hidden.
    fileName: e.file_name ?? 'Legacy evidence',
    filePath: e.file_path ?? '',
    mimeType: e.mime_type,
    fileSize: e.file_size === null ? null : Number(e.file_size),
    byId: e.submitted_by,
    byName: e.submitted_by ? names[e.submitted_by] ?? null : null,
    at: e.submitted_at,
    reviewStatus: e.review_status,
    reviewedById: e.reviewed_by,
    reviewedByName: e.reviewed_by ? names[e.reviewed_by] ?? null : null,
    reviewedAt: e.reviewed_at,
    reviewNote: e.review_note,
    isLegacy: !!e.is_legacy,
  }));

  return {
    taskId: t.id,
    caseId: t.case_id,
    caseNo: c?.case_no ?? '',
    employeeId: c?.employee_id ?? null,
    employeeName: c?.employee_id ? names[c.employee_id] ?? null : null,
    employeePhotoUrl: null,
    packageKey: c?.package_key ?? '',
    taskKey: t.task_key,
    taskTitle: t.task_title,
    ownerRole: t.owner_role ?? null,
    moduleKey: t.module_key ?? null,
    assignedTo: t.assigned_to ?? null,
    assignedToName: t.assigned_to ? names[t.assigned_to] ?? null : null,
    status: t.status as OnboardingTaskStatus,
    dueAt: t.due_at ?? null,
    isBlocking: !!t.is_blocking,
    requiresEvidence: !!t.requires_evidence,
    priority: t.priority ?? null,
    blockedReason: t.blocked_reason ?? null,
    dependencyKeys: Array.isArray(t.dependency_keys) ? t.dependency_keys.filter((x): x is string => typeof x === 'string') : [],
    sortOrder: t.sort_order,
    completedBy: t.completed_by ?? null,
    completedByName: t.completed_by ? names[t.completed_by] ?? null : null,
    completedAt: t.completed_at ?? null,
    createdAt: t.created_at,
    notes: notes.map(n => ({ ...n, byName: n.byId ? names[n.byId] ?? null : null })),
    evidence: evidence.map(e => ({ ...e, byName: e.byId ? names[e.byId] ?? null : null })),
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// 4. Handoffs list
// ════════════════════════════════════════════════════════════════════════════════
export async function listOnboardingHandoffs(
  args: OnboardingHandoffListArgs,
  scope: ResolvedOnboardingScope,
): Promise<OnboardingHandoffRow[]> {
  if (scopeIsEmpty(scope)) return [];
  const visibleIds = scopedCaseIds(scope, args.caseId ? [args.caseId] : null);
  if (visibleIds !== null && !visibleIds.length) return [];
  let q = sb.from('hr_onboarding_handoffs')
    .select('id, case_id, target_module, handoff_type, handoff_key, status, owner_id, due_at, failure_reason, payload, created_at, last_event_at')
    .order('created_at', { ascending: false }).limit(2000);
  if (visibleIds !== null)      q = q.in('case_id', visibleIds);
  if (args.caseId)              q = q.eq('case_id', args.caseId);
  if (args.targetModules?.length) q = q.in('target_module', args.targetModules);
  if (args.statuses?.length)    q = q.in('status', args.statuses);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  const hs = (data ?? []) as HandoffDB[];

  const caseMap = await caseLiteMap([...new Set(hs.map(h => h.case_id))]);
  const empIds = Object.values(caseMap).map(c => c.employee_id).filter((x): x is string => !!x);
  const names = await nameMap([...empIds, ...hs.map(h => h.owner_id).filter((x): x is string => !!x)]);

  return hs.map(h => {
    const c = caseMap[h.case_id];
    return {
      handoffId: h.id,
      caseId: h.case_id,
      caseNo: c?.case_no ?? '',
      employeeName: c?.employee_id ? names[c.employee_id] ?? null : null,
      targetModule: h.target_module,
      handoffType: h.handoff_type ?? null,
      handoffKey: h.handoff_key ?? null,
      status: h.status as OnboardingHandoffStatus,
      ownerId: h.owner_id ?? null,
      ownerName: h.owner_id ? names[h.owner_id] ?? null : null,
      dueAt: h.due_at ?? null,
      failureReason: h.failure_reason ?? null,
      payload: (h.payload && typeof h.payload === 'object' ? h.payload : {}) as Record<string, unknown>,
      createdAt: h.created_at,
      lastEventAt: h.last_event_at ?? null,
    };
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// 5. Blockers list
// ════════════════════════════════════════════════════════════════════════════════
export async function listOnboardingBlockers(
  args: OnboardingBlockerListArgs,
  scope: ResolvedOnboardingScope,
): Promise<OnboardingBlockerRow[]> {
  if (scopeIsEmpty(scope)) return [];
  const visibleIds = scopedCaseIds(scope, args.caseId ? [args.caseId] : null);
  if (visibleIds !== null && !visibleIds.length) return [];
  let q = sb.from('hr_onboarding_blockers')
    .select('id, case_id, blocker_key, blocker_title, blocking_module, severity, status, owner_id, due_at, created_at, task_id, handoff_id')
    .order('created_at', { ascending: true }).limit(2000);
  if (visibleIds !== null)       q = q.in('case_id', visibleIds);
  if (args.caseId)               q = q.eq('case_id', args.caseId);
  if (args.blockingModules?.length) q = q.in('blocking_module', args.blockingModules);
  if (args.statuses?.length)     q = q.in('status', args.statuses);
  if (args.severities?.length)   q = q.in('severity', args.severities);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  const bs = (data ?? []) as BlockerDB[];

  const caseMap = await caseLiteMap([...new Set(bs.map(b => b.case_id))]);
  const empIds = Object.values(caseMap).map(c => c.employee_id).filter((x): x is string => !!x);
  const [names, photos] = await Promise.all([
    nameMap([...empIds, ...bs.map(b => b.owner_id).filter((x): x is string => !!x)]),
    photoMap(empIds),
  ]);
  const now = new Date();

  return bs.map(b => {
    const c = caseMap[b.case_id];
    return {
      blockerId: b.id,
      caseId: b.case_id,
      caseNo: c?.case_no ?? '',
      employeeName: c?.employee_id ? names[c.employee_id] ?? null : null,
      employeePhotoUrl: c?.employee_id ? photos[c.employee_id] ?? null : null,
      blockerKey: b.blocker_key,
      blockerTitle: b.blocker_title,
      blockingModule: b.blocking_module,
      severity: b.severity as OnboardingSeverity,
      status: b.status as OnboardingBlockerStatus,
      ownerId: b.owner_id ?? null,
      ownerName: b.owner_id ? names[b.owner_id] ?? null : null,
      dueAt: b.due_at ?? null,
      ageDays: Math.max(0, Math.floor((now.getTime() - new Date(b.created_at).getTime()) / 86_400_000)),
      taskId: b.task_id ?? null,
      handoffId: b.handoff_id ?? null,
    };
  });
}
