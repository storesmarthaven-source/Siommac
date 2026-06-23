/**
 * src/ui/components/NewMenu.tsx
 *
 * The app-wide STANDARD page action — a "New ▾" dropdown that sits to the right
 * of the page nav/tabs. Each page passes its own create items (the submenu) and
 * the workflow each one triggers:
 *
 *   <NewMenu items={[
 *     { label: 'New Hazard',          icon: 'fa-radiation',          onSelect: openHazard },
 *     { label: 'New Risk Assessment', icon: 'fa-table-cells-large',  onSelect: openRa },
 *     { label: 'New JSA',             icon: 'fa-list-ol',            onSelect: openJsa },
 *   ]} />
 *
 * One item → renders a plain primary button (no chevron). Many items → the
 * "New ▾" dropdown. Manages its own open state + outside-click close.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';

export interface NewMenuItem {
  label: string;
  icon?: string;
  /** Optional one-line description shown under the label. */
  sub?: string;
  onSelect: () => void;
  /** Render a divider above this item. */
  divider?: boolean;
}

export interface NewMenuProps {
  items: NewMenuItem[];
  /** Button label (default "New"). For a single item, defaults to that item's label. */
  label?: string;
  /** Dropdown alignment relative to the button. */
  align?: 'left' | 'right';
  /** Override the leading icon (default fa-circle-plus). */
  icon?: string;
  /** Stretch the button to fill its container's height (e.g. to match an adjacent tab bar). */
  fill?: boolean;
}

export function NewMenu({ items, label, align = 'right', icon = 'fa-circle-plus', fill = false }: NewMenuProps): VNode {
  const [open, setOpen] = useState(false);

  // When `fill`, override the 40px min-height so the button matches its row's height.
  const fillStyle = fill ? { height: '100%', minHeight: 0 } : undefined;

  // Single action → plain primary button (no dropdown).
  if (items.length === 1) {
    const only = items[0]!;
    return (
      <button class="hse-btn accent" style={fillStyle} onClick={only.onSelect}>
        <i class={`fas ${only.icon ?? icon}`} /> {label ?? only.label}
      </button>
    );
  }

  return (
    <div style={{ position: 'relative', height: fill ? '100%' : undefined }}>
      <button class="hse-btn accent" style={fillStyle} onClick={() => setOpen(o => !o)}>
        <i class={`fas ${icon}`} /> {label ?? 'New'}{' '}
        <i class="fas fa-chevron-down" style={{ fontSize: '0.6rem', marginLeft: '2px' }} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', zIndex: 41, minWidth: '220px',
              [align]: 0,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', boxShadow: 'var(--elev-4)', overflow: 'hidden', display: 'grid',
            }}
          >
            {items.map(it => (
              <button
                key={it.label}
                onClick={() => { it.onSelect(); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
                  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                  borderTop: it.divider ? '1px solid var(--border)' : 'none',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <i class={`fas ${it.icon ?? 'fa-circle-plus'}`} style={{ width: '16px', color: 'var(--siomac-red)', flexShrink: 0 }} />
                <span style={{ display: 'grid', gap: '1px', minWidth: 0 }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--siomac-navy)', fontWeight: 600 }}>{it.label}</span>
                  {it.sub && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{it.sub}</span>}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
