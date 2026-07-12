/**
 * src/components/sections/NotificationCenter/notifMeta.ts
 *
 * Shared presentation helpers for notification rows — severity colour, module
 * icon + label, and relative time. Used by both the dense Center row
 * (NotificationItem) and the soft dropdown row (NotificationDropdownItem).
 */

import { type CanonicalNotification } from '@api/communications';

export const SEV_COLOR: Record<string, string> = {
  critical: '#ef4444', warning: '#f59e0b', success: '#16a34a', info: '#3b82f6',
};

const MODULE_META: [RegExp, string, string][] = [
  // [matcher, icon, human label]
  [/incident/,                'fa-triangle-exclamation',  'Incidents'],
  [/capa/,                    'fa-list-check',            'CAPA'],
  [/risk|jsa/,                'fa-radiation',             'Risk / JSA'],
  [/permit|ptw/,              'fa-file-shield',           'Permit to Work'],
  [/investigation/,           'fa-magnifying-glass-chart','Investigations'],
  [/inspection/,              'fa-clipboard-check',       'Inspections'],
  [/document/,                'fa-file-lines',            'Documents'],
  [/workflow/,                'fa-diagram-project',       'Workflow'],
  [/broadcast|communications/,'fa-bullhorn',              'Announcements'],
  [/payroll/,                 'fa-money-bill',            'Payroll'],
  [/finance/,                 'fa-money-bill',            'Finance'],
  [/\bhr\b|human/,            'fa-user-group',            'HR'],
];

export function moduleMeta(n: CanonicalNotification): { icon: string; label: string } {
  const hay = `${n.module ?? ''} ${n.type}`.toLowerCase();
  const hit = MODULE_META.find(([re]) => re.test(hay));
  return hit ? { icon: hit[1], label: hit[2] } : { icon: 'fa-bell', label: n.module ?? 'General' };
}

export function relativeTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}
