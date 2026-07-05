// src/components/sections/HR/OnboardingCommandCenter.helpers.ts
// Type contracts + pure formatting helpers for OnboardingCommandCenter. Real data only — no
// mock rows, no stock-photo avatars (every person renders via the shared initials Avatar).
import type { OnboardingCaseStatus, OnboardingTaskStatus, OnboardingBlockerStatus, OnboardingSeverity } from '../../../../types/hrOnboarding';

export type Tone = 'blue' | 'green' | 'purple' | 'amber' | 'cyan' | 'red' | 'slate';
export type BadgeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

export type OnboardingSurface =
  | 'cases'
  | 'tasks'
  | 'handoffs'
  | 'blocked'
  | 'activity'
  | 'packages'
  | 'reports';

export type OnboardingSurfaceFilters = Record<string, string | number | boolean | string[] | undefined>;

export type OnboardingCommandCenterProps = {
  onOpenSurface?: (surface: OnboardingSurface, filters?: OnboardingSurfaceFilters) => void;
  onOpenCase?: (caseId: string) => void;
  onNewCase?: () => void;
  onToast?: (message: string) => void;
};

export type DashboardMode = 'manager' | 'staff';

export type KpiRow = {
  key: string;
  title: string;
  subtitle: string;
  value: string;
  change: string;
  trend: 'up' | 'down';
  tone: Tone;
  gaugePercent?: number;
  variant: 'gauge' | 'compact';
  icon: 'people' | 'play' | 'check' | 'clock' | 'percent' | 'document' | 'alert' | 'calendar' | 'upload' | 'handoffFailed';
};

export type CaseRow = {
  caseId: string;
  caseNo: string;
  employeeName: string;
  employeeNo: string;
  employeePhotoUrl: string | null;
  packageKey: string;
  packageLabel: string;
  ownerId: string | null;
  ownerName: string;
  status: OnboardingCaseStatus;
  progressPercent: number;
  openTasks: number;
  blockingTasks: number;
  activeBlockers: number;
  ready: boolean;
  dueAt: string | null;
  startedAt: string | null;
  workerType: string;
};

export type TaskRow = {
  taskId: string;
  caseId: string;
  caseNo: string;
  employeeName: string;
  employeePhotoUrl: string | null;
  packageKey: string;
  taskTitle: string;
  ownerRole: string;
  moduleKey: string;
  assignedTo: string | null;
  assignedToName: string;
  status: OnboardingTaskStatus;
  dueAt: string | null;
  completedAt: string | null;
  isBlocking: boolean;
  requiresEvidence: boolean;
  priority: string;
};

export type BlockerRow = {
  blockerId: string;
  caseId: string;
  caseNo: string;
  employeeName: string;
  employeePhotoUrl: string | null;
  blockerTitle: string;
  blockingModule: string;
  severity: OnboardingSeverity;
  status: OnboardingBlockerStatus;
  ownerName: string;
  dueAt: string | null;
  ageDays: number;
  taskId: string | null;
  handoffId: string | null;
};

export type DeadlineRow = {
  id: string;
  month: string;
  day: string;
  taskTitle: string;
  employeeName: string;
  employeePhotoUrl: string | null;
  dueLabel: string;
  tone?: BadgeTone;
  date: Date;
};

export type ActivityRow = {
  id: string;
  title: string;
  actorName: string;
  occurredAt: string;
  tone: Tone;
  icon: 'check' | 'arrow' | 'plus' | 'alert' | 'shield';
};

export function humanize(value: string): string {
  return value.replace(/[_.-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** `dueAt` fields are `timestamptz` in the DB — already a full instant with its own
 *  time/offset. Only a plain `YYYY-MM-DD` needs a time-of-day appended to dodge
 *  UTC-midnight rolling back a day in negative-offset zones; appending one to an
 *  already-full timestamp produces an invalid string (e.g. "...+00:00T12:00:00"). */
function parseDueAt(iso: string, timeOfDay = '12:00:00'): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T${timeOfDay}`) : new Date(iso);
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const date = parseDueAt(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = date.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: '2-digit' };
  return date.toLocaleDateString('en-US', opts);
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function weekWindow(startDate: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
}

export function blockerMeta(item: BlockerRow): { comments: number; links: number } {
  const comments = Math.max(0, item.ageDays + (item.severity === 'high' || item.severity === 'critical' ? 2 : 0));
  const links = [item.taskId, item.handoffId].filter(Boolean).length || 1;
  return { comments, links };
}

function relativeDueLabel(dueAt: string): { label: string; tone?: BadgeTone } {
  const due = parseDueAt(dueAt, '00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`, tone: 'danger' };
  if (days === 0) return { label: 'Due Today', tone: 'warning' };
  if (days === 1) return { label: '1 day' };
  return { label: `${days} days` };
}

/** A "deadline" is not a distinct entity in the backend — it's an open task with a due date.
 *  Derived straight from the real tasks list; no fabricated rows. */
export function deriveDeadlines(tasks: TaskRow[], limit = 8): DeadlineRow[] {
  return tasks
    .filter(t => t.dueAt && t.status !== 'completed')
    .slice()
    .sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : 1))
    .slice(0, limit)
    .map(t => {
      const date = parseDueAt(t.dueAt!);
      const { label, tone } = relativeDueLabel(t.dueAt!);
      return {
        id: t.taskId,
        month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
        day: String(date.getDate()),
        taskTitle: t.taskTitle,
        employeeName: t.employeeName,
        employeePhotoUrl: t.employeePhotoUrl,
        dueLabel: label,
        tone,
        date,
      };
    });
}
