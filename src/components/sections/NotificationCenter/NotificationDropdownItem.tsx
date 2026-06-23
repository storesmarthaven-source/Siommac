/**
 * src/components/sections/NotificationCenter/NotificationDropdownItem.tsx
 *
 * The SOFT bell-dropdown row — for quick awareness, not management. A soft
 * circular module icon (severity-toned), a bold title with an optional small
 * unread dot, and a single muted context line (module · ref · action · time).
 * No per-row archive, no big pills — those live in the full Notification Center.
 */

import { type VNode } from 'preact';
import { type CanonicalNotification } from '@api/communications';
import { SEV_COLOR, moduleMeta, relativeTime } from './notifMeta';

export function NotificationDropdownItem({ n, onOpen }: {
  n: CanonicalNotification;
  onOpen: (n: CanonicalNotification) => void;
}): VNode {
  const sev = SEV_COLOR[n.severity] ?? SEV_COLOR.info!;
  const mod = moduleMeta(n);
  const actionPending = n.action_required && n.action_status === 'pending';
  const muted = n.action_status === 'completed' || n.action_status === 'expired' || n.action_status === 'dismissed';
  const showDot = !n.is_read && !muted;

  // Context line parts: module · ref · [action required] · time.
  const parts: Array<{ text: string; tone?: string }> = [{ text: mod.label }];
  if (n.source_id) parts.push({ text: n.source_id });
  if (actionPending) parts.push({ text: 'Action required', tone: '#b45309' });
  parts.push({ text: relativeTime(n.created_at) });

  return (
    <div
      onClick={() => onOpen(n)}
      class={`nc-row${showDot ? ' is-unread' : ''}`}
      style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 14px',
        borderBottom: '1px solid var(--border)', opacity: muted ? 0.7 : 1, cursor: 'pointer' }}
    >
      {/* Soft circular icon */}
      <div style={{ width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: muted ? 'var(--border)' : `${sev}1f` }}>
        <i class={`fas ${mod.icon}`} style={{ color: muted ? 'var(--text-muted)' : sev, fontSize: '0.9rem' }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: n.is_read ? 500 : 600, color: 'var(--siomac-navy)',
            lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {n.title}
          </span>
          {showDot && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: sev, flexShrink: 0, marginLeft: 'auto' }} />}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {parts.map((p, i) => (
            <span key={i} style={{ color: p.tone ?? 'inherit' }}>
              {i > 0 ? ' · ' : ''}{p.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
