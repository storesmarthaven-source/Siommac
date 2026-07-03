// lib/hr/offboardingQueries.ts — reads for the Offboarding module.

import { sb } from '../db';
import type {
  OffboardingCaseRow, OffboardingCaseDetail, OffboardingTaskRow, OffboardingHandoffRow,
  OffboardingBlockerRow, OffboardingDashboardStats, OffboardingReason, OffboardingStatus,
  OffboardingModuleClearance,
} from '../../../../types/hrOffboarding';

interface CaseDbRow {
  id: string; case_no: string; employee_id: string | null; reason: string; package_key: string; status: string;
  owner_id: string | null; last_working_day: string | null; exit_date: string | null; notice_period_days: number | null;
  started_at: string; ready_at: string | null; completed_at: string | null;
}

async function nameMap(ids: Array<string | null>): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!uniq.length) return new Map();
  const { data } = await sb.from('app_users').select('id, full_name').in('id', uniq);
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name ?? u.id]));
}

function toCaseRow(c: CaseDbRow, names: Map<string, string>, taskCount: number, openTaskCount: number, blockerCount: number): OffboardingCaseRow {
  return {
    id: c.id, caseNo: c.case_no, employeeId: c.employee_id, employeeName: c.employee_id ? (names.get(c.employee_id) ?? null) : null,
    reason: c.reason as OffboardingReason, packageKey: c.package_key, status: c.status as OffboardingStatus,
    ownerId: c.owner_id, ownerName: c.owner_id ? (names.get(c.owner_id) ?? null) : null,
    lastWorkingDay: c.last_working_day, exitDate: c.exit_date, noticePeriodDays: c.notice_period_days,
    startedAt: c.started_at, readyAt: c.ready_at, completedAt: c.completed_at,
    taskCount, openTaskCount, blockerCount,
  };
}

export async function listOffboardingCases(filters: { status?: string } = {}): Promise<OffboardingCaseRow[]> {
  let q = sb.from('hr_offboarding_cases').select('*').order('started_at', { ascending: false });
  if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status);
  const { data } = await q;
  const cases = (data ?? []) as CaseDbRow[];
  const ids = cases.map(c => c.id);
  const names = await nameMap(cases.flatMap(c => [c.employee_id, c.owner_id]));
  const taskCounts = new Map<string, number>(), openCounts = new Map<string, number>(), blockerCounts = new Map<string, number>();
  if (ids.length) {
    const [{ data: tasks }, { data: blockers }] = await Promise.all([
      sb.from('hr_offboarding_tasks').select('case_id, status').in('case_id', ids),
      sb.from('hr_offboarding_blockers').select('case_id, status').in('case_id', ids).eq('status', 'open'),
    ]);
    for (const t of (tasks ?? []) as { case_id: string; status: string }[]) {
      taskCounts.set(t.case_id, (taskCounts.get(t.case_id) ?? 0) + 1);
      if (t.status !== 'completed' && t.status !== 'skipped') openCounts.set(t.case_id, (openCounts.get(t.case_id) ?? 0) + 1);
    }
    for (const b of (blockers ?? []) as { case_id: string }[]) blockerCounts.set(b.case_id, (blockerCounts.get(b.case_id) ?? 0) + 1);
  }
  return cases.map(c => toCaseRow(c, names, taskCounts.get(c.id) ?? 0, openCounts.get(c.id) ?? 0, blockerCounts.get(c.id) ?? 0));
}

export async function getOffboardingCase(caseId: string): Promise<OffboardingCaseDetail | null> {
  const { data: c } = await sb.from('hr_offboarding_cases').select('*').eq('id', caseId).maybeSingle<CaseDbRow>();
  if (!c) return null;
  const [{ data: tasks }, { data: handoffs }, { data: blockers }] = await Promise.all([
    sb.from('hr_offboarding_tasks').select('*').eq('case_id', caseId).order('sort_order'),
    sb.from('hr_offboarding_handoffs').select('*').eq('case_id', caseId).order('created_at'),
    sb.from('hr_offboarding_blockers').select('*').eq('case_id', caseId).order('created_at'),
  ]);
  const taskRows = (tasks ?? []) as Record<string, unknown>[];
  const names = await nameMap([c.employee_id, c.owner_id, ...taskRows.map(t => t.assigned_to as string | null)]);
  const openTasks = taskRows.filter(t => t.status !== 'completed' && t.status !== 'skipped').length;
  const blockerRows = (blockers ?? []) as Record<string, unknown>[];

  const caseRow = toCaseRow(c, names, taskRows.length, openTasks, blockerRows.filter(b => b.status === 'open').length);
  return {
    case: caseRow,
    tasks: taskRows.map(t => ({
      id: t.id as string, caseId, taskKey: t.task_key as string, taskTitle: t.task_title as string,
      ownerRole: (t.owner_role as string) ?? null, assignedTo: (t.assigned_to as string) ?? null,
      assignedToName: t.assigned_to ? (names.get(t.assigned_to as string) ?? null) : null,
      moduleKey: (t.module_key as string) ?? null, status: t.status as OffboardingTaskRow['status'],
      isBlocking: !!t.is_blocking, sortOrder: (t.sort_order as number) ?? 0,
      dueAt: (t.due_at as string) ?? null, completedAt: (t.completed_at as string) ?? null,
    })),
    handoffs: ((handoffs ?? []) as Record<string, unknown>[]).map(h => ({
      id: h.id as string, caseId, handoffKey: (h.handoff_key as string) ?? null, targetModule: h.target_module as string,
      handoffType: (h.handoff_type as string) ?? null, status: h.status as OffboardingHandoffRow['status'], createdAt: h.created_at as string,
    })),
    blockers: blockerRows.map(b => ({
      id: b.id as string, caseId, title: b.title as string, blockingModule: (b.blocking_module as string) ?? null,
      severity: b.severity as OffboardingBlockerRow['severity'], status: b.status as OffboardingBlockerRow['status'],
      ownerId: (b.owner_id as string) ?? null, dueAt: (b.due_at as string) ?? null,
    })),
  };
}

// Fixed display order for the status donut (unknown statuses fall through to the end).
const STATUS_ORDER: OffboardingStatus[] = ['in_progress', 'ready_for_exit', 'blocked', 'paused', 'open', 'draft', 'completed', 'cancelled'];
const TERMINAL_STATUSES = new Set<string>(['completed', 'cancelled']);
const DONE_TASK_STATUSES = new Set<string>(['completed', 'skipped']);

export async function getOffboardingDashboardStats(): Promise<OffboardingDashboardStats> {
  const monthStart = new Date(); monthStart.setDate(1);

  const [{ data: caseData }, { data: taskData }, { data: handoffData }, { data: blockerData }] = await Promise.all([
    sb.from('hr_offboarding_cases').select('id, status, reason, started_at, ready_at, completed_at'),
    sb.from('hr_offboarding_tasks').select('case_id, status, is_blocking'),
    sb.from('hr_offboarding_handoffs').select('status, target_module, handoff_type'),
    sb.from('hr_offboarding_blockers').select('status, severity'),
  ]);
  const cases    = (caseData ?? [])    as { id: string; status: string; reason: OffboardingReason; started_at: string; ready_at: string | null; completed_at: string | null }[];
  const tasks    = (taskData ?? [])    as { case_id: string; status: string; is_blocking: boolean }[];
  const handoffs = (handoffData ?? []) as { status: string; target_module: string; handoff_type: string | null }[];
  const blockers = (blockerData ?? []) as { status: string; severity: string }[];

  // ── case status + reason mix ──
  const statusMap = new Map<string, number>();
  const reasonMap = new Map<OffboardingReason, number>();
  for (const c of cases) {
    statusMap.set(c.status, (statusMap.get(c.status) ?? 0) + 1);
    if (c.status !== 'cancelled') reasonMap.set(c.reason, (reasonMap.get(c.reason) ?? 0) + 1);
  }
  const byStatus = [...statusMap.entries()]
    .map(([status, count]) => ({ status: status as OffboardingStatus, count }))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  // ── task clearance across non-terminal cases (real ratio of exit work done) ──
  const activeCaseIds = new Set(cases.filter(c => !TERMINAL_STATUSES.has(c.status)).map(c => c.id));
  let taskDone = 0, taskTotal = 0, blockingTasksOpen = 0;
  for (const t of tasks) {
    if (!activeCaseIds.has(t.case_id)) continue;
    taskTotal++;
    if (DONE_TASK_STATUSES.has(t.status)) taskDone++;
    else if (t.is_blocking) blockingTasksOpen++;
  }

  // ── cross-module handoff clearance ──
  const handoffAgg = { pending: 0, delivered: 0, cancelled: 0, total: 0 };
  const moduleMap = new Map<string, { pending: number; delivered: number; total: number }>();
  let pendingAccessRemovals = 0;
  for (const h of handoffs) {
    handoffAgg.total++;
    if (h.status === 'pending') handoffAgg.pending++;
    else if (h.status === 'delivered') handoffAgg.delivered++;
    else if (h.status === 'cancelled') handoffAgg.cancelled++;
    const m = moduleMap.get(h.target_module) ?? { pending: 0, delivered: 0, total: 0 };
    m.total++;
    if (h.status === 'pending') m.pending++;
    else if (h.status === 'delivered') m.delivered++;
    moduleMap.set(h.target_module, m);
    if (h.status === 'pending' && h.handoff_type === 'access_removal') pendingAccessRemovals++;
  }
  const handoffsByModule: OffboardingModuleClearance[] = [...moduleMap.entries()]
    .map(([module, m]) => ({ module, ...m }))
    .sort((a, b) => b.total - a.total);

  // ── blockers ──
  let openBlockers = 0, criticalBlockers = 0;
  for (const b of blockers) {
    if (b.status !== 'open') continue;
    openBlockers++;
    if (b.severity === 'high' || b.severity === 'critical') criticalBlockers++;
  }

  // ── mean clearance time (start → ready/complete) ──
  const durations: number[] = [];
  for (const c of cases) {
    const end = c.completed_at ?? c.ready_at;
    if (!end || !c.started_at) continue;
    const days = (new Date(end).getTime() - new Date(c.started_at).getTime()) / 86_400_000;
    if (days >= 0) durations.push(days);
  }
  const avgClearanceDays = durations.length
    ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
    : null;

  return {
    activeCases: cases.filter(c => ['open', 'in_progress', 'blocked', 'paused'].includes(c.status)).length,
    readyForExit: cases.filter(c => c.status === 'ready_for_exit').length,
    blocked: cases.filter(c => c.status === 'blocked').length,
    completedThisMonth: cases.filter(c => c.status === 'completed' && c.completed_at && new Date(c.completed_at) >= monthStart).length,
    totalCases: cases.length,
    byReason: [...reasonMap.entries()].map(([reason, count]) => ({ reason, count })),
    byStatus,
    taskClearance: { done: taskDone, total: taskTotal },
    blockingTasksOpen,
    openBlockers,
    criticalBlockers,
    handoffs: handoffAgg,
    handoffsByModule,
    pendingAccessRemovals,
    avgClearanceDays,
  };
}
