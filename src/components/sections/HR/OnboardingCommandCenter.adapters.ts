// src/components/sections/HR/OnboardingCommandCenter.adapters.ts
// Pure mappers: real onboarding DTOs (types/hrOnboarding.ts) -> the Command Center's
// display-row shapes (OnboardingCommandCenter.helpers.ts). No fabricated fields — every
// value here traces back to a real column returned by the backend.
import type {
  OnboardingCaseRow, OnboardingTaskRow, OnboardingBlockerRow, OnboardingAuditRow, OnboardingDashboardStats,
} from '../../../../types/hrOnboarding';
import type { CaseRow, TaskRow, BlockerRow, ActivityRow, KpiRow, DashboardMode, Tone } from './OnboardingCommandCenter.helpers';
import { humanize } from './OnboardingCommandCenter.helpers';

export function adaptCase(row: OnboardingCaseRow): CaseRow {
  return {
    caseId: row.caseId, caseNo: row.caseNo,
    employeeName: row.employeeName ?? '—', employeeNo: row.employeeNo ?? '',
    employeePhotoUrl: row.employeePhotoUrl,
    packageKey: row.packageKey, packageLabel: row.packageLabel,
    ownerId: row.ownerId, ownerName: row.ownerName ?? 'Unassigned',
    status: row.status, progressPercent: row.progressPercent,
    openTasks: row.openTasks, blockingTasks: row.blockingTasks, activeBlockers: row.activeBlockers,
    ready: row.ready, dueAt: row.dueAt, startedAt: row.startedAt,
    workerType: row.workerType ?? 'employee',
  };
}

export function adaptTask(row: OnboardingTaskRow): TaskRow {
  return {
    taskId: row.taskId, caseId: row.caseId, caseNo: row.caseNo,
    employeeName: row.employeeName ?? '—', employeePhotoUrl: row.employeePhotoUrl, packageKey: row.packageKey,
    taskTitle: row.taskTitle, ownerRole: row.ownerRole ?? '—', moduleKey: row.moduleKey ?? '—',
    assignedTo: row.assignedTo, assignedToName: row.assignedToName ?? 'Unassigned',
    status: row.status, dueAt: row.dueAt, completedAt: row.completedAt,
    isBlocking: row.isBlocking, requiresEvidence: row.requiresEvidence,
    priority: row.priority ?? 'normal',
  };
}

export function adaptBlocker(row: OnboardingBlockerRow): BlockerRow {
  return {
    blockerId: row.blockerId, caseId: row.caseId, caseNo: row.caseNo,
    employeeName: row.employeeName ?? '—', employeePhotoUrl: row.employeePhotoUrl, blockerTitle: row.blockerTitle,
    blockingModule: row.blockingModule, severity: row.severity, status: row.status,
    ownerName: row.ownerName ?? 'Unassigned', dueAt: row.dueAt, ageDays: row.ageDays,
    taskId: row.taskId, handoffId: row.handoffId,
  };
}

const ACTIVITY_TONE_BY_KEYWORD: { test: RegExp; tone: Tone; icon: ActivityRow['icon'] }[] = [
  { test: /block/i, tone: 'amber', icon: 'shield' },
  { test: /fail|reject|cancel/i, tone: 'red', icon: 'alert' },
  { test: /complet|approv|ready|resolv/i, tone: 'green', icon: 'check' },
  { test: /start|creat|add/i, tone: 'blue', icon: 'plus' },
];

/** Recent-activity timestamps are real ISO instants — show a clock time for today,
 *  otherwise a short relative label, never a fabricated slot like "08:00 — 08:30". */
export function fmtActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const wasYesterday = date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate();
  if (wasYesterday) return 'Yesterday';
  const days = Math.round((now.getTime() - date.getTime()) / 86400000);
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function adaptActivity(row: OnboardingAuditRow): ActivityRow {
  const title = humanize(row.action.replace(/^hr\.onboarding\./, ''));
  const match = ACTIVITY_TONE_BY_KEYWORD.find(m => m.test.test(row.action));
  return {
    id: row.id, title, actorName: row.actorName ?? 'System',
    occurredAt: fmtActivityTime(row.createdAt), tone: match?.tone ?? 'slate', icon: match?.icon ?? 'arrow',
  };
}

export interface KpiInputs {
  stats: OnboardingDashboardStats | undefined;
  cases: OnboardingCaseRow[];
  openTasks: OnboardingTaskRow[];
  blockers: OnboardingBlockerRow[];
  failedHandoffCount: number;
  mode: DashboardMode;
  currentUserId: string | null;
}

/** Every KPI here traces to a real field. No "Avg Activation Time" tile (no real source for
 *  it), and no duplicate readiness tile — the mockup had both "Completion Rate" and "Day-1
 *  Readiness" pointing at the same underlying percent; consolidated to one real metric each. */
export function deriveKpis({ stats, cases, openTasks, blockers, failedHandoffCount, mode, currentUserId }: KpiInputs): KpiRow[] {
  const evidenceNeeded = openTasks.filter(t => t.requiresEvidence && t.status !== 'completed').length;

  if (mode === 'staff') {
    const myCases = cases.filter(c => c.ownerId === currentUserId);
    const myBlockedTasks = openTasks.filter(t => (t.status === 'blocked' || t.isBlocking) && t.assignedTo === currentUserId).length;
    const dueToday = openTasks.filter(t => t.dueAt === new Date().toISOString().slice(0, 10)).length;
    const waitingHr = blockers.filter(b => b.blockingModule === 'HR').length;
    const readyCases = cases.filter(c => c.ready).length;
    return [
      { key: 'my_cases', title: 'My Cases', subtitle: 'Assigned HR work', value: String(myCases.length), change: '', trend: 'up', tone: 'blue', gaugePercent: Math.min(100, myCases.length * 10), variant: 'compact', icon: 'people' },
      { key: 'due_today', title: 'Due Today', subtitle: 'Work queue', value: String(dueToday), change: '', trend: 'up', tone: 'amber', gaugePercent: Math.min(100, dueToday * 10), variant: 'compact', icon: 'calendar' },
      { key: 'blocked_tasks', title: 'Blocked Tasks', subtitle: 'Assigned blockers', value: String(myBlockedTasks), change: '', trend: myBlockedTasks ? 'down' : 'up', tone: 'red', gaugePercent: Math.min(100, myBlockedTasks * 15), variant: 'compact', icon: 'alert' },
      { key: 'evidence_needed', title: 'Need Evidence', subtitle: 'Uploads required', value: String(evidenceNeeded), change: '', trend: 'down', tone: 'cyan', gaugePercent: Math.min(100, evidenceNeeded * 10), variant: 'compact', icon: 'upload' },
      { key: 'waiting_hr', title: 'Waiting On HR', subtitle: 'Ownership needed', value: String(waitingHr), change: '', trend: 'down', tone: 'amber', gaugePercent: Math.min(100, waitingHr * 10), variant: 'compact', icon: 'document' },
      { key: 'ready_review', title: 'Ready Review', subtitle: 'Can activate soon', value: String(readyCases), change: '', trend: 'up', tone: 'green', gaugePercent: stats?.activationReadiness.readyPercent ?? 0, variant: 'compact', icon: 'check' },
    ];
  }

  const readyPercent = stats?.activationReadiness.readyPercent ?? 0;
  const activeTotal = stats?.activeCases.total ?? 0;
  const readyCount = Math.round((activeTotal * readyPercent) / 100);
  return [
    { key: 'activation_completion', title: 'Completion Rate', subtitle: 'Activation readiness', value: `${readyPercent}%`, change: '', trend: 'up', tone: 'green', gaugePercent: readyPercent, variant: 'gauge', icon: 'check' },
    { key: 'documents_readiness', title: 'Documents Readiness', subtitle: 'Docs on file', value: `${stats?.activationReadiness.documentsReadyPercent ?? 0}%`, change: '', trend: 'up', tone: 'slate', gaugePercent: stats?.activationReadiness.documentsReadyPercent ?? 0, variant: 'gauge', icon: 'document' },
    { key: 'training_readiness', title: 'Training Readiness', subtitle: 'Required training complete', value: `${stats?.activationReadiness.trainingReadyPercent ?? 0}%`, change: '', trend: 'up', tone: 'amber', gaugePercent: stats?.activationReadiness.trainingReadyPercent ?? 0, variant: 'gauge', icon: 'percent' },
    { key: 'total_cases', title: 'Active Cases', subtitle: 'Open workload', value: String(activeTotal), change: '', trend: 'up', tone: 'blue', variant: 'compact', icon: 'people' },
    { key: 'due_this_week', title: 'Due This Week', subtitle: 'Deadline queue', value: String(stats?.dueThisWeek.dueIn7Days ?? 0), change: '', trend: 'up', tone: 'amber', variant: 'compact', icon: 'calendar' },
    { key: 'blocked_cases', title: 'Blocked Cases', subtitle: 'Need intervention', value: String(stats?.blockingTasks.blockedCases ?? 0), change: '', trend: (stats?.blockingTasks.blockedCases ?? 0) ? 'down' : 'up', tone: 'red', variant: 'compact', icon: 'alert' },
    { key: 'ready_activation', title: 'Ready To Activate', subtitle: 'Can start work', value: String(readyCount), change: '', trend: 'up', tone: 'green', variant: 'compact', icon: 'check' },
    { key: 'handoff_failures', title: 'Failed Handoffs', subtitle: 'Critical review', value: String(failedHandoffCount), change: '', trend: failedHandoffCount ? 'down' : 'up', tone: 'red', variant: 'compact', icon: 'handoffFailed' },
    { key: 'evidence_needed', title: 'Need Evidence', subtitle: 'Staff action', value: String(evidenceNeeded), change: '', trend: 'down', tone: 'cyan', variant: 'compact', icon: 'upload' },
  ];
}

export interface PrioritySnapshot {
  packageLabel: string;
  stage: string;
  readinessPercent: number;
}

/** The Morning Goal / critical-path card needs a "who/what/how-ready" snapshot per priority
 *  blocker. Every field here is a real blocker→case join — no invented role/avatar/stage. */
export function derivePrioritySnapshot(blocker: BlockerRow, cases: CaseRow[]): PrioritySnapshot {
  const linkedCase = cases.find(c => c.caseId === blocker.caseId);
  return {
    packageLabel: linkedCase?.packageLabel ?? '—',
    stage: humanize(blocker.blockingModule),
    readinessPercent: linkedCase?.progressPercent ?? 0,
  };
}
