/**
 * src/ui/components/Drawer.tsx
 *
 * Right-side slide-in detail panel. Wraps the existing `.hse-drawer` /
 * `.hse-drawer-backdrop` classes (z-index from --z-drawer tokens) used by the
 * incident, investigation and dashboard drill-down drawers.
 *
 * Renders backdrop + panel with header (title/subtitle + close), a scrollable
 * body (children), and an optional footer. `open` drives the `.show` class.
 */

import { type VNode, type ComponentChildren } from 'preact';

interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Optional footer (action buttons). */
  footer?: ComponentChildren;
  /** Extra class on the panel (e.g. "inv-drawer" for width overrides). */
  panelClass?: string;
  children?: ComponentChildren;
}

export function Drawer({ open, title, subtitle, onClose, footer, panelClass, children }: DrawerProps): VNode {
  return (
    <>
      <div class={`hse-drawer-backdrop${open ? ' show' : ''}`} onClick={onClose} />
      <aside
        class={`hse-drawer${panelClass ? ' ' + panelClass : ''}${open ? ' show' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
      >
        <div class="hse-drawer-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button class="hse-icon-btn" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </div>
        <div class="hse-drawer-body">{children}</div>
        {footer && <div class="hse-drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}
