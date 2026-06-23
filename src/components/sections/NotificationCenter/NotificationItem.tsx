/**
 * src/components/sections/NotificationCenter/NotificationItem.tsx
 *
 * One notification row — shared by the Notification Center list and the bell
 * dropdown. Severity rail · module icon · title/body · ref · relative time ·
 * unread dot · action badge · mark-read / archive.
 */

import { type VNode } from 'preact';
import { type CanonicalNotification } from '@api/communications';

const SEV_COLOR: Record<string, string> = {
  critical: '#ef4444', warning: '#f59e0b', success: '#16a34a', info: '#60a5fa',
};
const MODULE_META: Array<[RegExp, string, string]> = [
  // [matcher, icon, human label]
  [/incident/,                'fa-triangle-exclamation', 'Incidents'],
  [/capa/,                    'fa-list-check',           'CAPA'],
  [/risk|jsa/,                'fa-radiation',            'Risk / JSA'],
  [/permit|ptw/,              'fa-file-shield',          'Permit to Work'],
  [/investigation/,           'fa-magnifying-glass-chart','Investigations'],
  [/inspection/,              'fa-clipboard-check',      'Inspections'],
  [/document/,                'fa-file-lines',           'Documents'],
  [/workflow/,                'fa-diagram-project',      'Workflow'],
  [/broadcast|communications/,'fa-bullhorn',             'Announcements'],
  [/payroll/,                 'fa-money-bill',           'Payroll'],
  [/finance/,                 'fa-money-bill',           'Finance'],
  [/\bhr\b|human/,            'fa-user-group',           'HR'],
];
function moduleMeta(n: CanonicalNotification): { icon: string; label: string } {
  const hay = `${n.module ?? ''} ${n.type}`.toLowerCase();
  const hit = MODULE_META.find(([re]) => re.test(hay));
  return hit ? { icon: hit[1], label: hit[2] } : { icon: 'fa-bell', label: n.module ?? 'General' };
}
function relativeTime(iso: string): string {
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

export function NotificationItem({ n, compact, onOpen, onArchive }: {
  n: CanonicalNotification;
  compact?: boolean;
  onOpen: (n: CanonicalNotification) => void;
  onArchive?: (n: CanonicalNotification) => void;
}): VNode {
  const sev = SEV_COLOR[n.severity] ?? SEV_COLOR.info!;
  const mod = moduleMeta(n);
  const actionPending   = n.action_required && n.action_status === 'pending';
  const actionCompleted = n.action_required && n.action_status === 'completed';
  const isArchived      = n.action_status === 'expired' || n.action_status === 'dismissed';
  // Archived/handled rows read as "done" — muted, no accent weight.
  const muted = actionCompleted || isArchived;

  return (
    <div
      onClick={() => onOpen(n)}
      style={{
        display: 'flex', gap: '10px', alignItems: 'flex-start',
        padding: compact ? '9px 10px' : '12px 14px',
        borderLeft: `3px solid ${muted ? 'var(--border)' : sev}`,
        borderBottom: '1px solid var(--border)',
        background: n.is_read ? 'var(--bg-card)' : 'rgba(27,45,85,0.035)',
        opacity: muted ? 0.66 : 1,
        cursor: 'pointer',
      }}
    >
      <i class={`fas ${mod.icon}`} style={{ color: muted ? 'var(--text-muted)' : sev, marginTop: '2px', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          {!n.is_read && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: sev, flexShrink: 0 }} />}
          <span style={{ fontSize: compact ? '0.8rem' : '0.85rem', fontWeight: n.is_read ? 500 : 700, color: 'var(--siomac-navy)' }}>{n.title}</span>
          {actionPending   && <span class="vt-pill is-warn" style={{ fontSize: '0.6rem' }}>Action</span>}
          {actionCompleted && <span class="vt-pill is-on" style={{ fontSize: '0.6rem' }}><i class="fas fa-check" style={{ marginRight: '3px' }} />Done</span>}
          <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>{relativeTime(n.created_at)}</span>
        </div>
        {n.body && !compact && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>{n.body}</div>}
        {!compact && (
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '3px' }}>
            <span>{mod.label}</span>{n.source_id && <span> · {n.source_id}</span>}
          </div>
        )}
      </div>
      {onArchive && (
        <button class="hse-btn-icon-remove" style={{ flexShrink: 0 }} title="Archive"
          onClick={e => { e.stopPropagation(); onArchive(n); }}>
          <i class="fas fa-box-archive" />
        </button>
      )}
    </div>
  );
}
