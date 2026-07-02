// lib/hr/onboardingReports.ts — HR Onboarding Reports (Phase 6).
//
// Nine analytics/compliance reports computed LIVE from the onboarding tables (cases,
// tasks, blockers, handoffs) — no denormalized report tables, no cached aggregates.
// One shared filtered load (loadReportData) feeds pure per-report reducers, each
// returning the shared OnboardingReportResult contract (summary cards + optional chart
// + dynamic columns + rows). Export writes an audit row (data egress is audited) and
// returns the same rows for the client to serialise to CSV. Backend-only (service-role).

import { sb } from '../db';
import { packageLabelMap } from './onboardingPackageService';
import { taskCategory, READINESS_CATS, type TaskCategory } from './onboardingTaskCategory';
import { writeHrAudit } from './employeeCore';
import type {
  OnboardingReportKey, OnboardingReportMeta, OnboardingReportResult, RunOnboardingReportArgs,
  OnboardingReportColumn, OnboardingReportSummaryStat,
} from '../../../../types/hrOnboarding';

// ── catalogue ─────────────────────────────────────────────────────────────────────
export const REPORT_CATALOGUE: OnboardingReportMeta[] = [
  { key: 'cycle_time', title: 'Onboarding Cycle Time', description: 'Time from case start to completion, overall and by package.', icon: 'fa-stopwatch', chartType: 'bar', groupByOptions: ['package'] },
  { key: 'blocked_cases', title: 'Blocked Case Report', description: 'Active blockers by module, owner and age.', icon: 'fa-ban', chartType: 'bar', groupByOptions: ['package', 'owner'] },
  { key: 'task_owner_performance', title: 'Task Owner Performance', description: 'Assigned, completed, overdue and completion rate per owner.', icon: 'fa-user-gear', chartType: 'bar', groupByOptions: ['owner'] },
  { key: 'handoff_completion', title: 'Handoff Completion', description: 'Handoff throughput and completion by target module.', icon: 'fa-arrow-right-arrow-left', chartType: 'donut', groupByOptions: [] },
  { key: 'package_effectiveness', title: 'Package Effectiveness', description: 'Cycle time, blocked rate and readiness per package.', icon: 'fa-boxes-stacked', chartType: 'bar', groupByOptions: ['package'] },
  { key: 'activation_readiness', title: 'Activation Readiness', description: 'Readiness by category across active cases.', icon: 'fa-shield-halved', chartType: 'bar', groupByOptions: [] },
  { key: 'overdue_tasks', title: 'Overdue Tasks Report', description: 'Overdue tasks by owner, module and age bucket.', icon: 'fa-calendar-xmark', chartType: 'bar', groupByOptions: ['owner', 'package'] },
  { key: 'contractor_onboarding', title: 'Contractor Onboarding', description: 'Active contractor cases, readiness and blockers.', icon: 'fa-hard-hat', chartType: 'bar', groupByOptions: ['package'] },
  { key: 'safety_critical_onboarding', title: 'Safety-Critical Onboarding', description: 'HSE/training readiness and blocking gates for safety-critical hires.', icon: 'fa-helmet-safety', chartType: 'bar', groupByOptions: [] },
];

export function listOnboardingReports(): OnboardingReportMeta[] { return REPORT_CATALOGUE; }

// ── shared filtered load ────────────────────────────────────────────────────────--
interface CaseDB { id: string; case_no: string; employee_id: string | null; worker_type: string | null; package_key: string; status: string; owner_id: string | null; due_at: string | null; started_at: string | null; completed_at: string | null; reason: string | null }
interface TaskDB { id: string; case_id: string; task_key: string; task_title: string; owner_role: string | null; module_key: string | null; assigned_to: string | null; status: string; due_at: string | null; is_blocking: boolean | null; priority: string | null; completed_at: string | null }
interface BlockerDB { id: string; case_id: string; blocker_title: string; blocking_module: string; severity: string; status: string; owner_id: string | null; created_at: string }
interface HandoffDB { id: string; case_id: string; target_module: string; status: string; created_at: string; completed_at: string | null }
interface EmpDB { id: string; department_id: string | null; site_id: string | null }

const CLOSED_TASK = new Set(['completed', 'skipped', 'cancelled']);
const DONE_TASK = new Set(['completed', 'skipped']);
const ACTIVE_BLOCKER = new Set(['active', 'acknowledged', 'waiting_on_owner', 'escalated']);
const ACTIVE_CASE = new Set(['draft', 'open', 'in_progress', 'blocked', 'paused', 'ready_for_activation']);
const isOpenTask = (s: string): boolean => !CLOSED_TASK.has(s);
const DAY = 86_400_000;
const daysBetween = (a: string, b: string): number => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY));
const isOverdue = (due: string | null, status: string, now: number): boolean => !!due && isOpenTask(status) && new Date(due).getTime() < now;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const median = (xs: number[]): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };

interface ReportData {
  cases: CaseDB[]; tasks: TaskDB[]; blockers: BlockerDB[]; handoffs: HandoffDB[];
  labels: Record<string, string>; names: Record<string, string | null>; now: number;
}

async function nameMap(ids: (string | null)[]): Promise<Record<string, string | null>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return {};
  const { data } = await sb.from('app_users').select('id, full_name').in('id', uniq);
  return Object.fromEntries(((data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name]));
}

async function loadReportData(args: RunOnboardingReportArgs, extra?: { workerTypes?: string[]; packageKeys?: string[] }): Promise<ReportData> {
  let q = sb.from('hr_onboarding_cases')
    .select('id, case_no, employee_id, worker_type, package_key, status, owner_id, due_at, started_at, completed_at, reason')
    .order('started_at', { ascending: false }).limit(5000);
  if (args.dateFrom) q = q.gte('started_at', args.dateFrom);
  if (args.dateTo)   q = q.lte('started_at', args.dateTo);
  const pkgKeys = extra?.packageKeys ?? args.packageKeys;
  if (pkgKeys?.length)         q = q.in('package_key', pkgKeys);
  if (args.ownerIds?.length)   q = q.in('owner_id', args.ownerIds);
  if (args.status?.length)     q = q.in('status', args.status);
  const workerTypes = extra?.workerTypes ?? args.workerTypes;
  if (workerTypes?.length)     q = q.in('worker_type', workerTypes);
  const { data: casesRaw, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  let cases = (casesRaw ?? []) as CaseDB[];

  // department / site filters need the employee join (same pattern as the dashboard).
  if (args.departmentIds?.length || args.siteIds?.length) {
    const empIds = [...new Set(cases.map(c => c.employee_id).filter((x): x is string => !!x))];
    const { data: emps } = empIds.length ? await sb.from('app_users').select('id, department_id, site_id').in('id', empIds) : { data: [] };
    const empMap = Object.fromEntries(((emps ?? []) as EmpDB[]).map(e => [e.id, e]));
    const depts = args.departmentIds?.length ? new Set(args.departmentIds) : null;
    const sites = args.siteIds?.length ? new Set(args.siteIds) : null;
    cases = cases.filter(c => {
      const e = c.employee_id ? empMap[c.employee_id] : undefined;
      if (depts && !(e?.department_id && depts.has(e.department_id))) return false;
      if (sites && !(e?.site_id && sites.has(e.site_id))) return false;
      return true;
    });
  }

  const caseIds = cases.map(c => c.id);
  const [{ data: tasks }, { data: blockers }, { data: handoffs }, labels] = await Promise.all([
    caseIds.length ? sb.from('hr_onboarding_tasks').select('id, case_id, task_key, task_title, owner_role, module_key, assigned_to, status, due_at, is_blocking, priority, completed_at').in('case_id', caseIds) : Promise.resolve({ data: [] }),
    caseIds.length ? sb.from('hr_onboarding_blockers').select('id, case_id, blocker_title, blocking_module, severity, status, owner_id, created_at').in('case_id', caseIds) : Promise.resolve({ data: [] }),
    caseIds.length ? sb.from('hr_onboarding_handoffs').select('id, case_id, target_module, status, created_at, completed_at').in('case_id', caseIds) : Promise.resolve({ data: [] }),
    packageLabelMap(),
  ]);
  const names = await nameMap([...cases.map(c => c.owner_id), ...((tasks ?? []) as TaskDB[]).map(t => t.assigned_to), ...((blockers ?? []) as BlockerDB[]).map(b => b.owner_id)]);
  return { cases, tasks: (tasks ?? []) as TaskDB[], blockers: (blockers ?? []) as BlockerDB[], handoffs: (handoffs ?? []) as HandoffDB[], labels, names, now: Date.now() };
}

// ── shared result helpers ──────────────────────────────────────────────────────--
const pkgLabel = (d: ReportData, key: string): string => d.labels[key] ?? key;
const ownerLabel = (d: ReportData, id: string | null): string => id ? d.names[id] ?? id : 'Unassigned';
function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); }
  return m;
}

// ════════════════════════════════════════════════════════════════════════════════
// Report reducers
// ════════════════════════════════════════════════════════════════════════════════

function reportCycleTime(d: ReportData): OnboardingReportResult {
  const completed = d.cases.filter(c => c.status === 'completed' && c.started_at && c.completed_at);
  const cycleDays = completed.map(c => daysBetween(c.started_at!, c.completed_at!));
  const open = d.cases.filter(c => ACTIVE_CASE.has(c.status) && c.started_at);
  const byPkg = groupBy(completed, c => c.package_key);
  const chartLabels: string[] = [], chartVals: number[] = [];
  const pkgRows: Record<string, unknown>[] = [];
  for (const [key, list] of byPkg) {
    const days = list.map(c => daysBetween(c.started_at!, c.completed_at!));
    const avg = round1(days.reduce((s, x) => s + x, 0) / days.length);
    chartLabels.push(pkgLabel(d, key)); chartVals.push(avg);
    pkgRows.push({ package: pkgLabel(d, key), completedCases: list.length, avgDays: avg, medianDays: median(days) });
  }
  const summary: OnboardingReportSummaryStat[] = [
    { label: 'Completed cases', value: completed.length },
    { label: 'Avg days to complete', value: cycleDays.length ? round1(cycleDays.reduce((s, x) => s + x, 0) / cycleDays.length) : 0, state: 'neutral' },
    { label: 'Median days', value: median(cycleDays) },
    { label: 'Open cases aging', value: open.length ? round1(open.reduce((s, c) => s + daysBetween(c.started_at!, new Date(d.now).toISOString()), 0) / open.length) : 0, state: 'warning' },
  ];
  const columns: OnboardingReportColumn[] = [
    { key: 'package', label: 'Package' }, { key: 'completedCases', label: 'Completed', type: 'number' },
    { key: 'avgDays', label: 'Avg days', type: 'number' }, { key: 'medianDays', label: 'Median days', type: 'number' },
  ];
  return { reportKey: 'cycle_time', title: 'Onboarding Cycle Time', summary, chart: chartLabels.length ? { type: 'bar', labels: chartLabels, series: [{ name: 'Avg days', values: chartVals }] } : null, columns, rows: pkgRows, totalRows: pkgRows.length };
}

function reportBlockedCases(d: ReportData): OnboardingReportResult {
  const active = d.blockers.filter(b => ACTIVE_BLOCKER.has(b.status));
  const byModule = groupBy(active, b => b.blocking_module);
  const chartLabels: string[] = [], chartVals: number[] = [];
  for (const [mod, list] of byModule) { chartLabels.push(mod); chartVals.push(list.length); }
  const caseNo = new Map(d.cases.map(c => [c.id, c.case_no]));
  const rows = active.map(b => ({
    blocker: b.blocker_title, module: b.blocking_module, severity: b.severity,
    case: caseNo.get(b.case_id) ?? '', owner: ownerLabel(d, b.owner_id), ageDays: daysBetween(b.created_at, new Date(d.now).toISOString()),
  })).sort((a, b) => b.ageDays - a.ageDays);
  const summary: OnboardingReportSummaryStat[] = [
    { label: 'Active blockers', value: active.length, state: active.length ? 'warning' : 'good' },
    { label: 'Critical', value: active.filter(b => b.severity === 'critical').length, state: 'critical' },
    { label: 'Escalated', value: active.filter(b => b.status === 'escalated').length },
    { label: 'Avg age (days)', value: rows.length ? round1(rows.reduce((s, r) => s + r.ageDays, 0) / rows.length) : 0 },
  ];
  const columns: OnboardingReportColumn[] = [
    { key: 'blocker', label: 'Blocker' }, { key: 'module', label: 'Module' }, { key: 'severity', label: 'Severity', type: 'status' },
    { key: 'case', label: 'Case' }, { key: 'owner', label: 'Owner' }, { key: 'ageDays', label: 'Age (days)', type: 'number' },
  ];
  return { reportKey: 'blocked_cases', title: 'Blocked Case Report', summary, chart: chartLabels.length ? { type: 'bar', labels: chartLabels, series: [{ name: 'Blockers', values: chartVals }] } : null, columns, rows, totalRows: rows.length };
}

function reportTaskOwnerPerformance(d: ReportData): OnboardingReportResult {
  const assigned = d.tasks.filter(t => t.assigned_to);
  const byOwner = groupBy(assigned, t => t.assigned_to!);
  const rows: Record<string, unknown>[] = [];
  for (const [owner, list] of byOwner) {
    const done = list.filter(t => DONE_TASK.has(t.status));
    const overdue = list.filter(t => isOverdue(t.due_at, t.status, d.now));
    rows.push({
      owner: ownerLabel(d, owner), assigned: list.length, completed: done.length,
      overdue: overdue.length, completionRate: list.length ? Math.round((done.length / list.length) * 100) : 0,
    });
  }
  rows.sort((a, b) => (b.completed as number) - (a.completed as number));
  const chartLabels = rows.slice(0, 12).map(r => r.owner as string);
  const summary: OnboardingReportSummaryStat[] = [
    { label: 'Owners', value: rows.length },
    { label: 'Tasks assigned', value: assigned.length },
    { label: 'Completed', value: assigned.filter(t => DONE_TASK.has(t.status)).length, state: 'good' },
    { label: 'Overdue', value: assigned.filter(t => isOverdue(t.due_at, t.status, d.now)).length, state: 'warning' },
  ];
  const columns: OnboardingReportColumn[] = [
    { key: 'owner', label: 'Owner' }, { key: 'assigned', label: 'Assigned', type: 'number' }, { key: 'completed', label: 'Completed', type: 'number' },
    { key: 'overdue', label: 'Overdue', type: 'number' }, { key: 'completionRate', label: 'Completion', type: 'percent' },
  ];
  return { reportKey: 'task_owner_performance', title: 'Task Owner Performance', summary, chart: chartLabels.length ? { type: 'bar', labels: chartLabels, series: [{ name: 'Completed', values: rows.slice(0, 12).map(r => r.completed as number) }, { name: 'Overdue', values: rows.slice(0, 12).map(r => r.overdue as number) }] } : null, columns, rows, totalRows: rows.length };
}

function reportHandoffCompletion(d: ReportData): OnboardingReportResult {
  const statuses = ['pending', 'sent', 'accepted', 'blocked', 'delivered', 'completed', 'failed', 'cancelled'];
  const counts = Object.fromEntries(statuses.map(s => [s, d.handoffs.filter(h => h.status === s).length]));
  const completedTimes = d.handoffs.filter(h => h.status === 'completed' && h.completed_at).map(h => daysBetween(h.created_at, h.completed_at!));
  const byModule = groupBy(d.handoffs, h => h.target_module);
  const rows: Record<string, unknown>[] = [];
  for (const [mod, list] of byModule) {
    const done = list.filter(h => h.status === 'completed');
    rows.push({ module: mod, total: list.length, completed: done.length, failed: list.filter(h => h.status === 'failed').length, completionRate: list.length ? Math.round((done.length / list.length) * 100) : 0 });
  }
  rows.sort((a, b) => (b.total as number) - (a.total as number));
  const summary: OnboardingReportSummaryStat[] = [
    { label: 'Total handoffs', value: d.handoffs.length },
    { label: 'Completed', value: counts['completed'], state: 'good' },
    { label: 'Failed', value: counts['failed'], state: counts['failed'] ? 'critical' : 'good' },
    { label: 'Avg completion (days)', value: completedTimes.length ? round1(completedTimes.reduce((s, x) => s + x, 0) / completedTimes.length) : 0 },
  ];
  const columns: OnboardingReportColumn[] = [
    { key: 'module', label: 'Target module' }, { key: 'total', label: 'Total', type: 'number' }, { key: 'completed', label: 'Completed', type: 'number' },
    { key: 'failed', label: 'Failed', type: 'number' }, { key: 'completionRate', label: 'Completion', type: 'percent' },
  ];
  const nonZero = statuses.filter(s => counts[s]! > 0);
  return { reportKey: 'handoff_completion', title: 'Handoff Completion', summary, chart: nonZero.length ? { type: 'donut', labels: nonZero, series: [{ name: 'Handoffs', values: nonZero.map(s => counts[s]!) }] } : null, columns, rows, totalRows: rows.length };
}

// per-case task aggregate reused by package/readiness/contractor/safety reports
interface Agg { total: number; done: number; open: number; blocking: number; cats: Map<TaskCategory, { total: number; open: number }> }
function aggregateByCase(tasks: TaskDB[]): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const t of tasks) {
    const a = m.get(t.case_id) ?? { total: 0, done: 0, open: 0, blocking: 0, cats: new Map() };
    a.total += 1; const open = isOpenTask(t.status);
    if (DONE_TASK.has(t.status)) a.done += 1; if (open) a.open += 1; if (open && t.is_blocking) a.blocking += 1;
    const cat = taskCategory(t); const c = a.cats.get(cat) ?? { total: 0, open: 0 }; c.total += 1; if (open) c.open += 1; a.cats.set(cat, c);
    m.set(t.case_id, a);
  }
  return m;
}
const caseReady = (c: CaseDB, agg: Map<string, Agg>): boolean => { const a = agg.get(c.id); return c.status === 'ready_for_activation' || (!!a && a.total > 0 && a.open === 0); };

function reportPackageEffectiveness(d: ReportData): OnboardingReportResult {
  const agg = aggregateByCase(d.tasks);
  const activeBlockedCases = new Set(d.blockers.filter(b => ACTIVE_BLOCKER.has(b.status)).map(b => b.case_id));
  const byPkg = groupBy(d.cases, c => c.package_key);
  const rows: Record<string, unknown>[] = [];
  const chartLabels: string[] = [], readyVals: number[] = [];
  for (const [key, list] of byPkg) {
    const completed = list.filter(c => c.status === 'completed' && c.started_at && c.completed_at);
    const cycle = completed.map(c => daysBetween(c.started_at!, c.completed_at!));
    const blocked = list.filter(c => c.status === 'blocked' || activeBlockedCases.has(c.id)).length;
    const ready = list.filter(c => caseReady(c, agg)).length;
    const taskVol = list.reduce((s, c) => s + (agg.get(c.id)?.total ?? 0), 0);
    const readyPct = list.length ? Math.round((ready / list.length) * 100) : 0;
    rows.push({ package: pkgLabel(d, key), cases: list.length, avgCycleDays: cycle.length ? round1(cycle.reduce((s, x) => s + x, 0) / cycle.length) : 0, blockedRate: list.length ? Math.round((blocked / list.length) * 100) : 0, readinessRate: readyPct, taskVolume: taskVol });
    chartLabels.push(pkgLabel(d, key)); readyVals.push(readyPct);
  }
  rows.sort((a, b) => (b.cases as number) - (a.cases as number));
  const summary: OnboardingReportSummaryStat[] = [
    { label: 'Packages in use', value: rows.length },
    { label: 'Total cases', value: d.cases.length },
    { label: 'Blocked cases', value: activeBlockedCases.size, state: 'warning' },
    { label: 'Ready to activate', value: d.cases.filter(c => caseReady(c, agg)).length, state: 'good' },
  ];
  const columns: OnboardingReportColumn[] = [
    { key: 'package', label: 'Package' }, { key: 'cases', label: 'Cases', type: 'number' }, { key: 'avgCycleDays', label: 'Avg cycle (d)', type: 'number' },
    { key: 'blockedRate', label: 'Blocked', type: 'percent' }, { key: 'readinessRate', label: 'Ready', type: 'percent' }, { key: 'taskVolume', label: 'Tasks', type: 'number' },
  ];
  return { reportKey: 'package_effectiveness', title: 'Package Effectiveness', summary, chart: chartLabels.length ? { type: 'bar', labels: chartLabels, series: [{ name: 'Readiness %', values: readyVals }] } : null, columns, rows, totalRows: rows.length };
}

function reportActivationReadiness(d: ReportData): OnboardingReportResult {
  const active = d.cases.filter(c => ACTIVE_CASE.has(c.status));
  const agg = aggregateByCase(d.tasks);
  const total = active.length;
  const pct = (n: number): number => total ? Math.round((n / total) * 100) : 0;
  const catReady: Record<TaskCategory, number> = { profile: 0, documents: 0, training: 0, access: 0, payroll: 0, hse: 0, other: 0 };
  for (const c of active) { const a = agg.get(c.id); for (const cat of READINESS_CATS) { const cc = a?.cats.get(cat); if (!cc || cc.open === 0) catReady[cat] += 1; } }
  const cats: TaskCategory[] = ['profile', 'documents', 'training', 'access'];
  const rows = cats.map(cat => ({ category: cat, readyCases: catReady[cat], readyPercent: pct(catReady[cat]) }));
  const overallReady = active.filter(c => caseReady(c, agg)).length;
  const summary: OnboardingReportSummaryStat[] = [
    { label: 'Active cases', value: total },
    { label: 'Ready to activate', value: pct(overallReady) + '%', state: 'good' },
    { label: 'Documents ready', value: pct(catReady.documents) + '%' },
    { label: 'Training ready', value: pct(catReady.training) + '%' },
  ];
  const columns: OnboardingReportColumn[] = [
    { key: 'category', label: 'Category' }, { key: 'readyCases', label: 'Ready cases', type: 'number' }, { key: 'readyPercent', label: 'Ready', type: 'percent' },
  ];
  return { reportKey: 'activation_readiness', title: 'Activation Readiness', summary, chart: { type: 'bar', labels: cats, series: [{ name: 'Ready %', values: cats.map(cat => pct(catReady[cat])) }] }, columns, rows, totalRows: rows.length };
}

function reportOverdueTasks(d: ReportData): OnboardingReportResult {
  const overdue = d.tasks.filter(t => isOverdue(t.due_at, t.status, d.now));
  const caseNo = new Map(d.cases.map(c => [c.id, c.case_no]));
  const ageOf = (due: string): number => daysBetween(due, new Date(d.now).toISOString());
  const bucket = (days: number): string => days <= 3 ? '1-3d' : days <= 7 ? '4-7d' : days <= 14 ? '8-14d' : '15d+';
  const byBucket = groupBy(overdue, t => bucket(ageOf(t.due_at!)));
  const order = ['1-3d', '4-7d', '8-14d', '15d+'];
  const chartLabels = order.filter(b => byBucket.has(b));
  const rows = overdue.map(t => ({
    task: t.task_title, case: caseNo.get(t.case_id) ?? '', owner: ownerLabel(d, t.assigned_to),
    module: t.module_key ?? t.owner_role ?? '—', overdueDays: ageOf(t.due_at!), blocking: t.is_blocking ? 'Yes' : 'No',
  })).sort((a, b) => (b.overdueDays as number) - (a.overdueDays as number));
  const summary: OnboardingReportSummaryStat[] = [
    { label: 'Overdue tasks', value: overdue.length, state: overdue.length ? 'warning' : 'good' },
    { label: 'Critical / blocking', value: overdue.filter(t => t.is_blocking || t.priority === 'critical').length, state: 'critical' },
    { label: 'Oldest (days)', value: rows.length ? (rows[0]!.overdueDays as number) : 0 },
    { label: '15d+ overdue', value: overdue.filter(t => ageOf(t.due_at!) > 14).length },
  ];
  const columns: OnboardingReportColumn[] = [
    { key: 'task', label: 'Task' }, { key: 'case', label: 'Case' }, { key: 'owner', label: 'Owner' },
    { key: 'module', label: 'Module' }, { key: 'overdueDays', label: 'Overdue (days)', type: 'number' }, { key: 'blocking', label: 'Blocking' },
  ];
  return { reportKey: 'overdue_tasks', title: 'Overdue Tasks Report', summary, chart: chartLabels.length ? { type: 'bar', labels: chartLabels, series: [{ name: 'Overdue', values: chartLabels.map(b => byBucket.get(b)!.length) }] } : null, columns, rows, totalRows: rows.length };
}

// contractor + safety-critical share the "cases + readiness + blockers" shape
function reportCohort(d: ReportData, key: OnboardingReportKey, title: string): OnboardingReportResult {
  const agg = aggregateByCase(d.tasks);
  const activeBlockedCases = new Set(d.blockers.filter(b => ACTIVE_BLOCKER.has(b.status)).map(b => b.case_id));
  const active = d.cases.filter(c => ACTIVE_CASE.has(c.status));
  const completed = d.cases.filter(c => c.status === 'completed' && c.started_at && c.completed_at);
  const cycle = completed.map(c => daysBetween(c.started_at!, c.completed_at!));
  const catPct = (cat: TaskCategory): number => { let ready = 0; for (const c of active) { const cc = agg.get(c.id)?.cats.get(cat); if (!cc || cc.open === 0) ready += 1; } return active.length ? Math.round((ready / active.length) * 100) : 0; };
  const rows = d.cases.map(c => {
    const a = agg.get(c.id);
    return { case: c.case_no, package: pkgLabel(d, c.package_key), status: c.status, progress: a && a.total ? Math.round((a.done / a.total) * 100) : 0, blocking: a?.blocking ?? 0, blocked: activeBlockedCases.has(c.id) ? 'Yes' : 'No' };
  });
  const summary: OnboardingReportSummaryStat[] = [
    { label: 'Active cases', value: active.length },
    { label: 'HSE ready', value: catPct('hse') + '%', state: 'neutral' },
    { label: 'Training ready', value: catPct('training') + '%' },
    { label: 'Avg cycle (days)', value: cycle.length ? round1(cycle.reduce((s, x) => s + x, 0) / cycle.length) : 0 },
  ];
  const columns: OnboardingReportColumn[] = [
    { key: 'case', label: 'Case' }, { key: 'package', label: 'Package' }, { key: 'status', label: 'Status', type: 'status' },
    { key: 'progress', label: 'Progress', type: 'percent' }, { key: 'blocking', label: 'Blocking tasks', type: 'number' }, { key: 'blocked', label: 'Blocked' },
  ];
  const chartCats: TaskCategory[] = ['hse', 'training', 'documents', 'access'];
  return { reportKey: key, title, summary, chart: { type: 'bar', labels: chartCats, series: [{ name: 'Ready %', values: chartCats.map(catPct) }] }, columns, rows, totalRows: rows.length };
}

// ── dispatch ──────────────────────────────────────────────────────────────────────
export async function runOnboardingReport(args: RunOnboardingReportArgs): Promise<OnboardingReportResult> {
  switch (args.reportKey) {
    case 'cycle_time':                 return reportCycleTime(await loadReportData(args));
    case 'blocked_cases':              return reportBlockedCases(await loadReportData(args));
    case 'task_owner_performance':     return reportTaskOwnerPerformance(await loadReportData(args));
    case 'handoff_completion':         return reportHandoffCompletion(await loadReportData(args));
    case 'package_effectiveness':      return reportPackageEffectiveness(await loadReportData(args));
    case 'activation_readiness':       return reportActivationReadiness(await loadReportData(args));
    case 'overdue_tasks':              return reportOverdueTasks(await loadReportData(args));
    case 'contractor_onboarding':      return reportCohort(await loadReportData(args, { workerTypes: ['contractor', 'contractor_worker'] }), 'contractor_onboarding', 'Contractor Onboarding');
    case 'safety_critical_onboarding': return reportCohort(await loadReportData(args, { packageKeys: ['safety_critical_employee'] }), 'safety_critical_onboarding', 'Safety-Critical Onboarding');
    default: throw Object.assign(new Error(`Unknown report: ${args.reportKey as string}`), { status: 400 });
  }
}

/** Run + audit the export (data egress). Returns the same result the client serialises. */
export async function exportOnboardingReport(actorId: string, args: RunOnboardingReportArgs): Promise<OnboardingReportResult> {
  const result = await runOnboardingReport(args);
  await writeHrAudit({ submoduleKey: 'onboarding', actorId, action: 'hr.onboarding.report_exported', newState: { reportKey: args.reportKey, rowCount: result.totalRows, filters: { dateFrom: args.dateFrom ?? null, dateTo: args.dateTo ?? null, packageKeys: args.packageKeys ?? [], status: args.status ?? [] } } });
  return result;
}
