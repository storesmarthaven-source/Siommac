/**
 * src/components/sections/HR/onboardingStatus.ts
 *
 * Shared status-pill presentation + tiny formatters for the HR Onboarding management
 * UI (overview board + case-detail workspace). One source of truth so both screens
 * render statuses identically (and no circular import between the two components).
 */
import type {
  OnboardingCaseStatus, OnboardingTaskStatus, OnboardingHandoffStatus,
  OnboardingBlockerStatus, OnboardingSeverity, OnboardingCaseActionStatus,
} from '../../../../types/hrOnboarding';

export interface Pill { label: string; c: string; b: string }
const T = {
  gray:  { c: '#475569', b: '#eef2f7' }, blue:  { c: '#1d4ed8', b: '#eaf2ff' },
  green: { c: '#15803d', b: '#dcfce7' }, amber: { c: '#b45309', b: '#fef3c7' },
  red:   { c: '#b91c1c', b: '#fee2e2' }, purple:{ c: '#6d28d9', b: '#f1efff' },
};

export const CASE_STATUS: Record<OnboardingCaseStatus, Pill> = {
  draft:                { label: 'Draft', ...T.gray },   open:        { label: 'Open', ...T.gray },
  in_progress:          { label: 'In Progress', ...T.blue }, blocked:  { label: 'Blocked', ...T.red },
  paused:               { label: 'Paused', ...T.amber },  ready_for_activation: { label: 'Ready', ...T.green },
  completed:            { label: 'Completed', ...T.green }, cancelled: { label: 'Cancelled', ...T.gray },
};
export const TASK_STATUS: Record<OnboardingTaskStatus, Pill> = {
  pending: { label: 'Pending', ...T.gray }, open: { label: 'Open', ...T.gray },
  in_progress: { label: 'In Progress', ...T.blue }, blocked: { label: 'Blocked', ...T.red },
  completed: { label: 'Completed', ...T.green }, skipped: { label: 'Skipped', ...T.gray },
  cancelled: { label: 'Cancelled', ...T.gray },
};
export const HANDOFF_STATUS: Record<OnboardingHandoffStatus, Pill> = {
  pending: { label: 'Pending', ...T.gray }, sent: { label: 'Sent', ...T.blue },
  accepted: { label: 'Accepted', ...T.blue }, blocked: { label: 'Blocked', ...T.red },
  delivered: { label: 'Delivered', ...T.green }, completed: { label: 'Completed', ...T.green },
  failed: { label: 'Failed', ...T.red }, cancelled: { label: 'Cancelled', ...T.gray },
};
export const BLOCKER_STATUS: Record<OnboardingBlockerStatus, Pill> = {
  active: { label: 'Active', ...T.red }, acknowledged: { label: 'Acknowledged', ...T.amber },
  waiting_on_owner: { label: 'Waiting', ...T.amber }, escalated: { label: 'Escalated', ...T.red },
  resolved: { label: 'Resolved', ...T.green }, waived: { label: 'Waived', ...T.gray },
};
export const SEVERITY: Record<OnboardingSeverity, Pill> = {
  low: { label: 'Low', ...T.gray }, medium: { label: 'Medium', ...T.blue },
  high: { label: 'High', ...T.amber }, critical: { label: 'Critical', ...T.red },
};
export const CASE_ACTION_STATUS: Record<OnboardingCaseActionStatus, Pill> = {
  open: { label: 'Open', ...T.gray }, in_progress: { label: 'In Progress', ...T.blue },
  completed: { label: 'Completed', ...T.green }, cancelled: { label: 'Cancelled', ...T.gray },
  blocked: { label: 'Blocked', ...T.red },
};

const fallback = (s: string): Pill => ({ label: humanize(s), ...T.gray });
export const caseStatusPill    = (s: OnboardingCaseStatus): Pill => CASE_STATUS[s] ?? fallback(s);
export const taskStatusPill    = (s: OnboardingTaskStatus): Pill => TASK_STATUS[s] ?? fallback(s);
export const handoffStatusPill = (s: OnboardingHandoffStatus): Pill => HANDOFF_STATUS[s] ?? fallback(s);
export const blockerStatusPill = (s: OnboardingBlockerStatus): Pill => BLOCKER_STATUS[s] ?? fallback(s);
export const severityPill      = (s: OnboardingSeverity): Pill => SEVERITY[s] ?? fallback(s);
export const caseActionPill    = (s: OnboardingCaseActionStatus): Pill => CASE_ACTION_STATUS[s] ?? fallback(s);

export const CASE_STATUS_OPTIONS = Object.keys(CASE_STATUS) as OnboardingCaseStatus[];

const BG_TO_CLS: Record<string, string> = {
  [T.gray.b]: 'gray', [T.blue.b]: 'blue', [T.green.b]: 'green',
  [T.amber.b]: 'amber', [T.red.b]: 'red', [T.purple.b]: 'purple',
};
export const pillClass = (p: Pill): string => BG_TO_CLS[p.b] ?? 'gray';

export function humanize(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/[_.]+/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}
function ordinal(day: number): string {
  const mod100 = day % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th'
    : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
  return `${day}${suffix}`;
}
export const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  // Date-only values represent local business dates. Noon avoids shifting them to the
  // previous day in western time zones when the browser parses an ISO date as UTC.
  const date = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  const month = date.toLocaleDateString(undefined, { month: 'long' });
  const year = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${ordinal(date.getDate())} ${month}${year}`;
};
export const fmtDateTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
