/**
 * src/components/sections/HSE/risk-jsa/shared/QueueItem.tsx
 *
 * A single clickable row in a right-side queue / supporting panel (High Risk
 * Queue, Overdue Reviews, Approval Queue, …). Icon + ref/category + short
 * description + a right-aligned status tag.
 */

import { type VNode } from 'preact';

export interface QueueItemProps {
  icon?: string;
  ref?: string;
  category?: string;
  title: string;
  /** Right-aligned tag text (e.g. "High", "Overdue", "Due tomorrow"). */
  tag?: string;
  tagTone?: 'danger' | 'warning' | 'info' | 'neutral';
  /** Render for the dark navy panel. */
  onDark?: boolean;
  onClick?: () => void;
}

const TAG_BG: Record<NonNullable<QueueItemProps['tagTone']>, { light: string; dark: string }> = {
  danger:  { light: 'rgba(239,68,68,.12)',  dark: 'rgba(239,68,68,.22)' },
  warning: { light: 'rgba(245,158,11,.14)', dark: 'rgba(245,158,11,.22)' },
  info:    { light: 'rgba(37,99,235,.12)',  dark: 'rgba(96,165,250,.22)' },
  neutral: { light: 'var(--bg-subtle)',     dark: 'rgba(255,255,255,.12)' },
};
const TAG_FG: Record<NonNullable<QueueItemProps['tagTone']>, { light: string; dark: string }> = {
  danger:  { light: '#b91c1c', dark: '#fca5a5' },
  warning: { light: '#b45309', dark: '#fcd34d' },
  info:    { light: '#1d4ed8', dark: '#93c5fd' },
  neutral: { light: 'var(--text-muted)', dark: 'rgba(255,255,255,.6)' },
};

export function QueueItem({ icon, ref, category, title, tag, tagTone = 'neutral', onDark, onClick }: QueueItemProps): VNode {
  const mode = onDark ? 'dark' : 'light';
  const textMain = onDark ? '#fff' : 'var(--siomac-navy)';
  const textSub = onDark ? 'rgba(255,255,255,.55)' : 'var(--text-muted)';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left',
        padding: '9px 11px', borderRadius: '10px', cursor: onClick ? 'pointer' : 'default',
        border: onDark ? '1px solid rgba(255,255,255,.1)' : '1px solid var(--border)',
        background: onDark ? 'rgba(255,255,255,.06)' : 'var(--bg-card)',
      }}
    >
      {icon && (
        <span style={{ width: '30px', height: '30px', flexShrink: 0, borderRadius: '9px', display: 'grid', placeItems: 'center', background: onDark ? 'rgba(255,255,255,.1)' : 'rgba(27,45,84,.08)', color: onDark ? 'rgba(255,255,255,.75)' : 'var(--siomac-navy)', fontSize: '0.8rem' }}>
          <i class={`fas ${icon}`} />
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.74rem', fontWeight: 700, color: textMain, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {ref}{ref && category ? ' — ' : ''}{category}
        </div>
        <div style={{ fontSize: '0.66rem', color: textSub, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      </div>
      {tag && (
        <span style={{ flexShrink: 0, fontSize: '0.6rem', fontWeight: 700, borderRadius: '6px', padding: '3px 8px', background: TAG_BG[tagTone][mode], color: TAG_FG[tagTone][mode] }}>{tag}</span>
      )}
    </button>
  );
}
