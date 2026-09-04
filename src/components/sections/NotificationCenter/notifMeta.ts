/**
 * src/components/sections/NotificationCenter/notifMeta.ts
 *
 * Shared presentation helpers for notification rows — severity colour, module
 * icon + label, and relative time. Used by both the dense Center row
 * (NotificationItem) and the soft dropdown row (NotificationDropdownItem).
 */

import { type CanonicalNotification } from '@api/communications';
import { type IconTileTone, type LucideName, type NotificationIconVariant } from '@ui';

export const SEV_COLOR: Record<string, string> = {
  critical: '#ef4444', warning: '#f59e0b', success: '#16a34a', info: '#3b82f6',
};

const MODULE_META: [RegExp, string, LucideName, string, IconTileTone][] = [
  // [matcher, legacy Font Awesome icon, canonical Lucide icon, human label, visual tone]
  [/incident/,                'fa-triangle-exclamation',   'TriangleAlert',  'Incidents',      'danger'],
  [/capa/,                    'fa-list-check',             'ListChecks',     'CAPA',           'amber'],
  [/risk|jsa/,                'fa-radiation',              'ShieldAlert',    'Risk / JSA',     'danger'],
  [/permit|ptw/,              'fa-file-shield',            'FileCheck2',     'Permit to Work', 'amber'],
  [/investigation/,           'fa-magnifying-glass-chart', 'SearchCheck',    'Investigations', 'blue'],
  [/inspection/,              'fa-clipboard-check',        'ClipboardCheck', 'Inspections',    'teal'],
  [/document/,                'fa-file-lines',             'FileText',       'Documents',      'blue'],
  [/workflow/,                'fa-diagram-project',        'Workflow',       'Workflow',       'teal'],
  [/broadcast|communications/,'fa-bullhorn',               'Megaphone',      'Announcements',  'violet'],
  [/payroll/,                 'fa-money-bill',             'WalletCards',    'Payroll',        'violet'],
  [/finance/,                 'fa-money-bill',             'Landmark',       'Finance',        'navy'],
  [/\bhr\b|human/,            'fa-user-group',             'Users',          'HR',             'blue'],
];

export function notificationIconVariant(n: CanonicalNotification): NotificationIconVariant {
  const hay = `${n.module ?? ''} ${n.type}`.toLowerCase();

  // Severity leads only when it communicates an urgent or terminal state.
  if (n.severity === 'critical') return 'critical';
  if (n.severity === 'success' || /approved|completed|resolved|ready/.test(hay)) return 'success';

  // Otherwise the event meaning determines the visual—not the source module.
  if (/broadcast|announcement/.test(hay)) return 'announcement';
  if (/comment|message|mention|reply/.test(hay)) return 'message';
  if (/reminder|calendar|due_soon|deadline/.test(hay)) return 'reminder';
  if (/evidence|document|payslip|attachment|file/.test(hay)) return 'document';
  if (/approval|review_required|decision/.test(hay)) return 'approval';
  if (/assign|task/.test(hay)) return 'assignment';
  if (/payroll|finance|expense|payment/.test(hay)) return 'finance';
  if (/workflow|handoff/.test(hay)) return 'workflow';
  if (n.severity === 'warning') return 'warning';
  return 'general';
}

export function moduleMeta(n: CanonicalNotification): {
  icon: string;
  lucideIcon: LucideName;
  label: string;
  visualTone: IconTileTone;
  notificationVariant: NotificationIconVariant;
} {
  const hay = `${n.module ?? ''} ${n.type}`.toLowerCase();
  const hit = MODULE_META.find(([re]) => re.test(hay));
  return hit
    ? {
        icon: hit[1], lucideIcon: hit[2], label: hit[3], visualTone: hit[4],
        notificationVariant: notificationIconVariant(n),
      }
    : {
        icon: 'fa-bell', lucideIcon: 'Bell', label: n.module ?? 'General', visualTone: 'neutral',
        notificationVariant: notificationIconVariant(n),
      };
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
