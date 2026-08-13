/**
 * src/ui/components/Drawer.tsx
 *
 * Right-side slide-in detail panel: backdrop + panel with header (title/sub +
 * close), an optional detail grid, a scrollable body (children), and an optional
 * footer. Wraps the existing `.hse-drawer*` classes — zero visual change.
 *
 * Unified superset of the old `@ui` Drawer and the HSE `_shared.tsx` `HseDrawer`:
 *   • `sub` (preferred) or `subtitle` (alias) for the subtitle
 *   • `foot` (preferred) or `footer` (alias) for the footer; omit for none
 *   • optional `details` → renders the `.hse-drawer-grid` label/value cards
 *   • `headActions` → slot beside the close button (a kebab <Menu>, etc.)
 *
 * RICH MODE: this is the app's canonical rich slide-in detail panel. Compose the
 * body from the @ui panel primitives — <EntityHead>, <PanelStats>, <PanelTabs>,
 * <InfoCard>/<FieldList>/<MiniTable> — and pass a kebab <Menu> via `headActions`.
 * The HR Employee Profile and the HSE Incident/Risk/CAPA panels share this one
 * component. (The unrelated `SidePanel` export is the navy signals right-rail.)
 *
 * Legacy aliases: `HseDrawer`, `DetailDrawer`.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useId } from 'preact/hooks';
import { useOverlayA11y } from '../lib/useOverlayA11y';
import { usePortalRoot } from '../overlays/portalRoot';
import './Drawer.recipe.css';

export type DrawerSide = 'left' | 'right';
export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl';

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
  /** Suppress the footer entirely (rich panels carry their actions inline). */
  noFooter?: boolean;
  /** Slot rendered beside the close button (e.g. a kebab <Menu>). */
  headActions?: ComponentChildren;
  /** Render the v36-faithful RICH shell (entity panel) instead of the standard
      `.hse-drawer`: a slide-in with a title bar, no backdrop, no footer — the
      body composes <EntityHead>/<PanelStats>/<PanelTabs>/<InfoCard> etc. */
  rich?: boolean;
  /** Extra class on the panel (e.g. width override). */
  panelClass?: string;
  /** Opt into the adaptive light/dark UI-kit: puts `data-theme-scope="adaptive"` on
   *  the (portaled) panel so it reads `--surface-*` tokens — light by default, dark
   *  under `body[data-theme="dark"]`. The panel must consume the tokens to adapt. */
  adaptive?: boolean;
  /** Viewport edge the panel enters from. */
  side?: DrawerSide;
  /** Canonical width scale. Omit to preserve a domain composition's existing width. */
  size?: DrawerSize;
  /** Backdrop dismissal is on by default. */
  closeOnBackdrop?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- createPortal() returns VNode<any>
export function Drawer({ open, title, sub, subtitle, details, children, onClose, foot, footer, noFooter, headActions, rich, panelClass, adaptive, side = 'right', size, closeOnBackdrop = true }: DrawerProps): VNode<any> {
  const themeScope = adaptive ? 'adaptive' : undefined;
  const subText = sub ?? subtitle;
  const panelRef = useOverlayA11y(open, onClose);
  const portalRoot = usePortalRoot();
  const uid = useId();
  const titleId = `ui-drawer-title-${uid}`;
  const sideStyle = [
    size ? `width:min(var(--ui-drawer-width-${size}),100vw)` : '',
    side === 'left' ? `left:0;right:auto;transform:translateX(${open ? '0' : '-100%'})` : '',
  ].filter(Boolean).join(';');

  if (rich) {
    // v36 rich entity panel: portal to <body>. A transparent backdrop (no dimming) sits
    // behind the panel so a click anywhere outside closes it — the app-wide standard.
    // An optional `foot` renders as a pinned action bar (e.g. lifecycle Submit/Approve/
    // Activate); omitted entirely when no foot is passed (rich panels default to inline actions).
    const richFoot = noFooter ? null : (foot ?? footer ?? null);
    return createPortal(
      <>
        <div class={`ui-rdrawer-backdrop${open ? ' open' : ''}`} onClick={closeOnBackdrop ? onClose : undefined} aria-hidden="true" data-theme-scope={themeScope} />
        <aside
          ref={panelRef}
          class={`ui-drawer ui-rdrawer${panelClass ? ' ' + panelClass : ''}${open ? ' open' : ''}`}
          role="dialog" aria-modal="true" aria-hidden={!open} aria-labelledby={titleId}
          data-theme-scope={themeScope}
          data-side={side}
          data-size={size}
          style={sideStyle}
        >
          <div class="ui-rdrawer-top">
            <div>
              <div class="ui-rdrawer-title" id={titleId}>{title}</div>
              {subText && <div class="ui-rdrawer-sub">{subText}</div>}
            </div>
            <div class="ui-rdrawer-icons">
              {headActions}
              <button class="ui-icon-action" onClick={onClose} aria-label="Close">×</button>
            </div>
          </div>
          <div class="ui-rdrawer-scroll">{children}</div>
          {richFoot && <div class="ui-rdrawer-foot">{richFoot}</div>}
        </aside>
      </>,
      portalRoot,
    );
  }

  const footContent = noFooter ? null : (foot ?? footer ?? <button class="hse-btn" onClick={onClose}>Close</button>);
  // Portal to <body> so the fixed-position panel is anchored to the viewport, not
  // to an ancestor that establishes a containing block for fixed descendants
  // (e.g. `.hse-dash { container-type: inline-size }`, or any `transform`).
  return createPortal(
    <>
      <div class={`hse-drawer-backdrop${open ? ' show' : ''}`} onClick={closeOnBackdrop ? onClose : undefined} aria-hidden="true" />
      <aside
        ref={panelRef}
        class={`ui-drawer hse-drawer${panelClass ? ' ' + panelClass : ''}${open ? ' show' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-labelledby={titleId}
        data-side={side}
        data-size={size}
        style={sideStyle}
      >
        <div class="hse-drawer-head">
          <div><h3 id={titleId}>{title}</h3>{subText && <p>{subText}</p>}</div>
          <div class="ui-drawer-head-actions">
            {headActions}
            <button class="hse-icon-btn" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
          </div>
        </div>
        <div class="hse-drawer-body">
          {details && (
            <div class="hse-drawer-grid">
              {details.map(d => <div class="hse-drawer-card" key={d.label}><span>{d.label}</span><strong>{d.value}</strong></div>)}
            </div>
          )}
          {children}
        </div>
        {footContent && <div class="hse-drawer-foot">{footContent}</div>}
      </aside>
    </>,
    portalRoot,
  );
}
