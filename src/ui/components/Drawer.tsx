/**
 * src/ui/components/Drawer.tsx
 *
 * Right-side slide-in detail panel: backdrop + panel with header (title/sub +
 * close), an optional detail grid, a scrollable body (children), and an optional
 * footer. Wraps the existing `.hse-drawer*` classes — zero visual change.
 *
 * Unified superset of the old `@ui` Drawer and the HSE `_shared.tsx` `HseDrawer`:
 *   • `sub` (preferred) or `subtitle` (alias) for the subtitle
 *   • `foot` (preferred) or `footer` (alias) for the footer; defaults to a Close button
 *   • optional `details` → renders the `.hse-drawer-grid` label/value cards
 *
 * Legacy aliases: `HseDrawer`, `DetailDrawer`.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';

export interface DrawerDetail { label: string; value: VNode | string; }

export interface DrawerProps {
  open: boolean;
  title: string;
  sub?: string;
  /** Alias for `sub`. */
  subtitle?: string;
  details?: DrawerDetail[];
  children?: ComponentChildren;
  onClose: () => void;
  /** Footer content; defaults to a Close button. */
  foot?: ComponentChildren;
  /** Alias for `foot`. */
  footer?: ComponentChildren;
  /** Extra class on the panel (e.g. width override). */
  panelClass?: string;
}

export function Drawer({ open, title, sub, subtitle, details, children, onClose, foot, footer, panelClass }: DrawerProps): VNode {
  const subText = sub ?? subtitle;
  const footContent = foot ?? footer ?? <button class="hse-btn" onClick={onClose}>Close</button>;
  // Portal to <body> so the fixed-position panel is anchored to the viewport, not
  // to an ancestor that establishes a containing block for fixed descendants
  // (e.g. `.hse-dash { container-type: inline-size }`, or any `transform`).
  return createPortal(
    <>
      <div class={`hse-drawer-backdrop${open ? ' show' : ''}`} onClick={onClose} />
      <aside
        class={`hse-drawer${panelClass ? ' ' + panelClass : ''}${open ? ' show' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
      >
        <div class="hse-drawer-head">
          <div><h3>{title}</h3>{subText && <p>{subText}</p>}</div>
          <button class="hse-icon-btn" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </div>
        <div class="hse-drawer-body">
          {details && (
            <div class="hse-drawer-grid">
              {details.map(d => <div class="hse-drawer-card" key={d.label}><span>{d.label}</span><strong>{d.value}</strong></div>)}
            </div>
          )}
          {children}
        </div>
        <div class="hse-drawer-foot">{footContent}</div>
      </aside>
    </>,
    document.body,
  );
}

/** Legacy aliases used by HSE pages during migration. */
export const HseDrawer = Drawer;
export const DetailDrawer = Drawer;
