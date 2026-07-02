// lib/hr/offboardingQueries.ts — reads for the Offboarding module.

import { sb } from '../db';
import type {
  OffboardingCaseRow, OffboardingCaseDetail, OffboardingTaskRow, OffboardingHandoffRow,
  OffboardingBlockerRow, OffboardingDashboardStats, OffboardingReason, OffboardingStatus,
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

export async function getOffboardingDashboardStats(): Promise<OffboardingDashboardStats> {
  const monthStart = new Date(); monthStart.setDate(1);
  const { data } = await sb.from('hr_offboarding_cases').select('status, reason, completed_at');
  const rows = (data ?? []) as { status: string; reason: OffboardingReason; completed_at: string | null }[];
  const byReasonMap = new Map<OffboardingReason, number>();
  for (const r of rows) if (r.status !== 'cancelled') byReasonMap.set(r.reason, (byReasonMap.get(r.reason) ?? 0) + 1);
  return {
    activeCases: rows.filter(r => ['open', 'in_progress', 'blocked', 'paused'].includes(r.status)).length,
    readyForExit: rows.filter(r => r.status === 'ready_for_exit').length,
    blocked: rows.filter(r => r.status === 'blocked').length,
    completedThisMonth: rows.filter(r => r.status === 'completed' && r.completed_at && new Date(r.completed_at) >= monthStart).length,
    byReason: Array.from(byReasonMap.entries()).map(([reason, count]) => ({ reason, count })),
  };
}
