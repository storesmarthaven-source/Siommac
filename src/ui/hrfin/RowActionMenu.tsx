/**
 * src/ui/hrfin/RowActionMenu.tsx — a portalled, position-anchored menu for
 * HrfinTable's trailing ⋮ cell. State-aware items are supplied per row by the
 * caller; disabled items show a reason on hover. Positioned at the trigger rect.
 */

import { type VNode } from 'preact';
import { createPortal } from 'preact/compat';
import { useOverlayA11y } from '@ui/lib/useOverlayA11y';
import { HrfinIcon, type HrfinIconName } from './icon';

export interface RowActionItem {
  key: string;
  label: string;
  icon?: HrfinIconName;
  onClick: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  disabledReason?: string;
}

export function RowActionMenu({ items, x, y, onClose }: {
  items: RowActionItem[]; x: number; y: number; onClose: () => void;
}): VNode | null {
  const ref = useOverlayA11y<HTMLDivElement>(true, onClose);
  if (!items.length) return null;

  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.max(8, x - 200);
  const top = Math.min(y + 4, vh - items.length * 38 - 16);

  return createPortal(
    <div class="hrfin" style={{ position: 'fixed', inset: 0, zIndex: 75 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref} role="menu" aria-label="Row actions"
        style={{ position: 'fixed', left: `${left}px`, top: `${top}px`, minWidth: '196px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 12px 32px rgba(16,24,64,.18)', padding: '6px' }}
      >
        {items.map(it => (
          <button
            key={it.key} type="button" role="menuitem" disabled={it.disabled}
            title={it.disabled ? it.disabledReason : undefined}
            onClick={() => { if (!it.disabled) { onClose(); it.onClick(); } }}
            style={{ display: 'flex', alignItems: 'center', gap: '9px', width: '100%', padding: '8px 10px', border: 'none', background: 'transparent', borderRadius: '8px', cursor: it.disabled ? 'not-allowed' : 'pointer', fontSize: '13px', color: it.disabled ? 'var(--muted)' : it.tone === 'danger' ? 'var(--danger, #d33)' : 'var(--text)', textAlign: 'left', opacity: it.disabled ? 0.6 : 1 }}
          >
            {it.icon && <HrfinIcon name={it.icon} />}<span>{it.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
