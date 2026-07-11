/**
 * src/ui/components/NewMenu.tsx
 *
 * The app-wide STANDARD page action — a navy "New ▾" dropdown that sits to the
 * right of the page nav/tabs (and in the PageHeader actions). Each page passes
 * its own create items (the submenu) and the workflow each one triggers:
 *
 *   <NewMenu items={[
 *     { label: 'New Hazard',          icon: 'Radiation',   onSelect: openHazard },
 *     { label: 'New Risk Assessment', icon: 'LayoutGrid',  onSelect: openRa },
 *     { label: 'New JSA',             icon: 'ListOrdered', onSelect: openJsa },
 *   ]} />
 *
 * STANDARD (page-header rules): the trigger button is NAVY (the standard header
 * button colour), and every dropdown-item `icon` is a LUCIDE name rendered in
 * #667085. One item → a plain navy button (no chevron). Many → the "New ▾"
 * dropdown. Manages its own open state + outside-click close.
 */

import { type VNode, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { LucideIcon, type LucideName } from '../LucideIcon';

/** Standard muted colour for header dropdown-item icons (Lucide, page-header standard). */
export const MENU_ICON_COLOR = '#667085';

export interface NewMenuItem {
  label: string;
  /** Lucide icon name (page-header standard). Rendered in #667085. */
  icon?: LucideName;
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
  /** Override the leading Lucide icon (default 'Plus'). */
  icon?: LucideName;
  /** Stretch the button to fill its container's height (e.g. to match an adjacent tab bar). */
  fill?: boolean;
}

export function NewMenu({ items, label, align = 'right', icon = 'Plus', fill = false }: NewMenuProps): VNode {
  const [open, setOpen] = useState(false);

  // When `fill`, override the 40px min-height so the button matches its row's height.
  const fillStyle = fill ? { height: '100%', minHeight: 0 } : undefined;

  // Single action → plain navy button (no dropdown).
  if (items.length === 1) {
    const only = items[0]!;
    return (
      <button class="hse-btn primary" style={fillStyle} onClick={only.onSelect}>
        <LucideIcon name={only.icon ?? icon} size={15} /> {label ?? only.label}
      </button>
    );
  }

  return (
    <div style={{ position: 'relative', height: fill ? '100%' : undefined }}>
      <button class="hse-btn primary" style={fillStyle} onClick={() => setOpen(o => !o)}>
        <LucideIcon name={icon} size={15} /> {label ?? 'New'}{' '}
        <LucideIcon name="ChevronDown" size={12} style={{ marginLeft: '2px' }} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div class="ui-menu ui-menu-pop" style={{ top: 'calc(100% + 6px)', [align]: 0 }}>
            {items.map(it => (
              <Fragment key={it.label}>
                {it.divider && <div class="ui-menu-divider" />}
                <button
                  type="button" class="ui-menu-item"
                  style={{ alignItems: it.sub ? 'flex-start' : 'center' }}
                  onClick={() => { it.onSelect(); setOpen(false); }}
                >
                  <LucideIcon name={it.icon ?? 'Plus'} size={16} style={{ color: MENU_ICON_COLOR, flexShrink: 0, marginTop: it.sub ? '1px' : 0 }} />
                  <span style={{ display: 'grid', gap: '1px', minWidth: 0 }}>
                    <span>{it.label}</span>
                    {it.sub && <span style={{ fontSize: '0.68rem', fontWeight: 500, color: 'var(--text-muted)' }}>{it.sub}</span>}
                  </span>
                </button>
              </Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
