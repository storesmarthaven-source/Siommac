/**
 * src/components/sections/NotificationCenter/NotificationItem.tsx
 *
 * One notification row — shared by the Notification Center list and the bell
 * dropdown. Soft circular module icon · bold title · muted ·-separated subtitle
 * (context + relative time) · action badge · archive. Unread rows tint; handled
 * rows mute.
 */

import { type VNode } from 'preact';
import { type CanonicalNotification } from '@api/communications';
import { SEV_COLOR, moduleMeta, relativeTime } from './notifMeta';

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
  // Handled rows (completed / expired / dismissed) read as done — neutral + dimmed.
  const muted = actionCompleted || isArchived;

  const ring = compact ? 38 : 46;
  const meta = [mod.label, n.source_id, relativeTime(n.created_at)].filter(Boolean) as string[];

  return (
    <div
      onClick={() => onOpen(n)}
      class={`nc-row${!n.is_read && !muted ? ' is-unread' : ''}`}
      style={{
        display: 'flex', gap: compact ? '11px' : '13px', alignItems: 'flex-start',
        padding: compact ? '11px 12px' : '14px 16px',
        borderBottom: '1px solid var(--border)',
        opacity: muted ? 0.7 : 1, cursor: 'pointer',
      }}
    >
      {/* Soft circular module icon */}
      <div style={{
        width: `${ring}px`, height: `${ring}px`, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: muted ? 'var(--border)' : `${sev}1f`,
      }}>
        <i class={`fas ${mod.icon}`} style={{ color: muted ? 'var(--text-muted)' : sev, fontSize: compact ? '0.85rem' : '0.98rem' }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ fontSize: compact ? '0.84rem' : '0.92rem', fontWeight: n.is_read ? 600 : 700, color: 'var(--siomac-navy)', lineHeight: 1.25 }}>
            {n.title}
          </span>
          {actionPending   && <span class="vt-pill is-warn" style={{ fontSize: '0.6rem', flexShrink: 0 }}>Action</span>}
          {actionCompleted && <span class="vt-pill is-on" style={{ fontSize: '0.6rem', flexShrink: 0 }}><i class="fas fa-check" style={{ marginRight: '3px' }} />Done</span>}
          {!n.is_read && !muted && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: sev, flexShrink: 0, marginLeft: 'auto' }} />}
        </div>

        {/* Body (full mode only) */}
        {n.body && !compact && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '3px',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {n.body}
          </div>
        )}

        {/* Subtitle — module · ref · time */}
        <div style={{ fontSize: compact ? '0.7rem' : '0.74rem', color: 'var(--text-muted)', marginTop: '3px' }}>
          {meta.join(' · ')}
        </div>
      </div>

      {onArchive && (
        <button class="nc-archive" title="Archive"
          onClick={e => { e.stopPropagation(); onArchive(n); }}>
          <i class="fas fa-box-archive" />
        </button>
      )}
    </div>
  );
}
