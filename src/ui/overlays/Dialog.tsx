/**
 * src/ui/overlays/Dialog.tsx — the canonical dialog frame.
 *
 * ONE frame for every dialog in the app. The audit found six implementations
 * (`@ui/Modal`, `@shared/Modal`, `HrfinWizardModal`, the messenger's `Dialog`,
 * plus private ones in HR and Profile) and 225 distinct overlay class families.
 * No business module invents dialog chrome again.
 *
 * ── Composition ─────────────────────────────────────────────────────────────
 *   <Dialog open onClose={close} size="md">
 *     <Dialog.Header title="Approve payment" sub="PAY-0041" icon={<…/>} />
 *     <Dialog.Body>…</Dialog.Body>
 *     <Dialog.Footer>
 *       <Button variant="outline" onClick={close}>Cancel</Button>
 *       <Button variant="primary" onClick={submit}>Approve</Button>
 *     </Dialog.Footer>
 *   </Dialog>
 *
 * Compound rather than a props bag because footers are genuinely open-ended —
 * the old `Modal` had `onSubmit`/`submitLabel`/`submitDisabled`/`footer` props
 * that any non-trivial dialog immediately bypassed via `footer`.
 *
 * ── Why it is portalled ─────────────────────────────────────────────────────
 * A `position: fixed` descendant of a TRANSFORMED ancestor positions against
 * that ancestor and is clipped by its overflow. react-grid-layout translates
 * every board tile, so a dialog opened from a widget's settings gear rendered
 * *inside* a 96px tile. Portalling to <body> makes the sheet independent of
 * wherever it was invoked from.
 */

import { type VNode, type ComponentChildren, createContext } from 'preact';
import { createPortal } from 'preact/compat';
import { usePortalRoot } from './portalRoot';
import { useContext, useEffect, useId } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { useOverlayA11y } from '../lib/useOverlayA11y';
import './Dialog.recipe.css';
import '../primitives/control.recipe.css';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';
export type DialogVariant = 'standard' | 'form' | 'confirm' | 'destructive' | 'info' | 'workspace';
export type DialogLayout = 'standard' | 'sidebar-left' | 'sidebar-right' | 'split' | 'wide';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  size?: DialogSize;
  variant?: DialogVariant;
  /** Governed body arrangement. Header, footer and accessibility never change. */
  layout?: DialogLayout;

  /**
   * Blocks interaction with the sheet while a submit is in flight. The close
   * button stays reachable on purpose — a user must always be able to escape a
   * request that has hung.
   */
  busy?: boolean;

  /** Clicking the backdrop closes. Turn OFF for dialogs holding unsaved input. */
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;

  /** Extra class on the backdrop — e.g. to raise z-index when nested. */
  overlayClass?: string;
  class?: string;
  children: ComponentChildren;
}

/**
 * Carries the generated title id from the sheet down to its Header.
 *
 * A context rather than a module-level variable: two dialogs can be mounted at
 * once (a confirm over a form), and a shared mutable would give both sheets the
 * same `aria-labelledby`, so the second would announce the first one's title.
 */
const DialogTitleId = createContext<string>('');

interface DialogComponent {
  (props: DialogProps): VNode | null;
  Header: typeof DialogHeader;
  Body: typeof DialogBody;
  Footer: typeof DialogFooter;
  Layout: typeof DialogLayoutRegion;
  Sidebar: typeof DialogSidebar;
  Content: typeof DialogContent;
  Section: typeof DialogSection;
}

function DialogRoot({
  open, onClose, size = 'md', variant = 'standard', layout = 'standard', busy = false,
  closeOnBackdrop = true, closeOnEscape = true,
  overlayClass, class: extra, children,
}: DialogProps): VNode | null {
  const uid = useId();
  const titleId = `dlg${uid}-title`;

  // Escape is handled by the a11y hook; pass a no-op when the caller has opted
  // out so the hook still traps focus.
  const panelRef = useOverlayA11y(open, closeOnEscape && !busy ? onClose : () => { /* Esc disabled */ });

  // Lock body scroll while open, or the page behind the sheet scrolls under the
  // pointer and the user loses their place in a long register.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const portalRoot = usePortalRoot();

  if (!open) return null;

  return createPortal(
    <div
      class={`ui-dialog-backdrop${overlayClass ? ` ${overlayClass}` : ''}`}
      onClick={e => {
        if (!closeOnBackdrop || busy) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        class={`ui-dialog ui-dialog--${size} ui-dialog--${variant} ui-dialog--layout-${layout}${extra ? ` ${extra}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy ? 'true' : undefined}
      >
        <DialogTitleId.Provider value={titleId}>{children}</DialogTitleId.Provider>
        {busy && (
          <div class="ui-dialog-busy" role="status" aria-label="Working">
            <span class="ui-ctrl-spinner" />
          </div>
        )}
      </section>
    </div>,
    // See AnchoredPopup: a themed region may provide its own portal root.
    portalRoot,
  );
}

export interface DialogHeaderProps {
  title: string;
  sub?: string;
  icon?: VNode;
  /** Omit the close button for a dialog that must be resolved by its actions. */
  onClose?: () => void;
  /** Right-aligned extras beside the close button (e.g. a status pill). */
  actions?: ComponentChildren;
}

function DialogHeader({ title, sub, icon, onClose, actions }: DialogHeaderProps): VNode {
  const titleId = useContext(DialogTitleId);
  return (
    <header class="ui-dialog-head">
      {icon && <span class="ui-dialog-icon" aria-hidden="true">{icon}</span>}
      <div class="ui-dialog-titles">
        {/* id matches the sheet's aria-labelledby, so the dialog announces its
            own title on open instead of "dialog". */}
        <h2 class="ui-dialog-title" id={titleId}>{title}</h2>
        {sub && <p class="ui-dialog-sub">{sub}</p>}
      </div>
      {actions}
      {onClose && (
        <button type="button" class="ui-dialog-close" onClick={onClose} aria-label="Close">
          <LucideIcon name="X" />
        </button>
      )}
    </header>
  );
}

function DialogBody({ children, class: extra }: { children: ComponentChildren; class?: string }): VNode {
  return <div class={`ui-dialog-body${extra ? ` ${extra}` : ''}`}>{children}</div>;
}

function DialogFooter({ children, left }: { children: ComponentChildren; left?: ComponentChildren }): VNode {
  return (
    <footer class="ui-dialog-foot">
      {left && <div class="ui-dialog-foot-left">{left}</div>}
      {children}
    </footer>
  );
}

/** The governed body grid. Sidebars and content stack automatically on mobile. */
function DialogLayoutRegion({ children, class: extra }: { children: ComponentChildren; class?: string }): VNode {
  return <div class={`ui-dialog-layout${extra ? ` ${extra}` : ''}`}>{children}</div>;
}

function DialogSidebar({ children, class: extra }: { children: ComponentChildren; class?: string }): VNode {
  return <aside class={`ui-dialog-sidebar${extra ? ` ${extra}` : ''}`}>{children}</aside>;
}

function DialogContent({ children, class: extra }: { children: ComponentChildren; class?: string }): VNode {
  return <div class={`ui-dialog-content${extra ? ` ${extra}` : ''}`}>{children}</div>;
}

/** A titled group inside a dialog body — the standard way to structure a form. */
function DialogSection(
  { title, desc, children }: { title: string; desc?: string; children: ComponentChildren },
): VNode {
  return (
    <section class="ui-dialog-section">
      <div class="ui-dialog-section-head">
        <h4>{title}</h4>
        {desc && <p>{desc}</p>}
      </div>
      {children}
    </section>
  );
}

export const Dialog = DialogRoot as DialogComponent;
Dialog.Header = DialogHeader;
Dialog.Body = DialogBody;
Dialog.Footer = DialogFooter;
Dialog.Layout = DialogLayoutRegion;
Dialog.Sidebar = DialogSidebar;
Dialog.Content = DialogContent;
Dialog.Section = DialogSection;
