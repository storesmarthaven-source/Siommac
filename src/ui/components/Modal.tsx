/**
 * src/ui/components/Modal.tsx
 *
 * The app-wide STANDARD WINDOW. Every modal in every module renders this exact
 * shell (`.ui-modal*` in assets/styles/uikit.css):
 *   • header: optional icon chip + title + sub on the left, close button top-right
 *   • body:   scrollable content (children)
 *   • footer: buttons bottom-right (Cancel + optional submit)
 *
 * Sizes: 'sm' | 'md' (default) | 'lg'. Footer buttons use the shared <Button>.
 * Legacy alias: `HseModal`.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { Button } from './Button';
import { useOverlayA11y } from '../lib/useOverlayA11y';

export interface ModalProps {
  open: boolean;
  title: string;
  sub?: string;
  /** Optional FontAwesome icon (e.g. "fa-triangle-exclamation") shown in the header chip. */
  icon?: string;
  size?: 'sm' | 'md' | 'lg';
  children: ComponentChildren;
  onClose: () => void;
  /** When provided, renders a primary submit button in the footer. */
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  cancelLabel?: string;
  /** Replace the default footer entirely (Cancel/Submit) with custom content. */
  footer?: ComponentChildren;
  /** Extra class on the backdrop — e.g. to raise z-index when nested over a wizard. */
  overlayClass?: string;
}

export function Modal({
  open, title, sub, icon, size = 'md', children, onClose,
  onSubmit, submitLabel = 'Submit', submitDisabled, cancelLabel = 'Cancel', footer, overlayClass,
}: ModalProps): VNode | null {
  const panelRef = useOverlayA11y(open, onClose);
  if (!open) return null;
  return (
    <div class={`ui-modal-backdrop${overlayClass ? ` ${overlayClass}` : ''}`} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={panelRef} class={`ui-modal${size !== 'md' ? ` ui-modal--${size}` : ''}`} role="dialog" aria-modal="true">
        <header class="ui-modal-head">
          <div class="ui-modal-headwrap">
            {icon && <span class="ui-modal-icon"><i class={`fas ${icon}`} /></span>}
            <div class="ui-modal-titles">
              <h3 class="ui-modal-title">{title}</h3>
              {sub && <p class="ui-modal-sub">{sub}</p>}
            </div>
          </div>
          <button class="ui-modal-close" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </header>

        <div class="ui-modal-body">{children}</div>

        <footer class="ui-modal-foot">
          {footer ?? (
            <>
              <Button variant="outline" onClick={onClose}>{cancelLabel}</Button>
              {onSubmit && (
                <Button variant="primary" onClick={onSubmit} disabled={submitDisabled}>{submitLabel}</Button>
              )}
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

/** Legacy alias used by HSE pages during migration. */
export const HseModal = Modal;

/**
 * A titled section inside a dialog body — a heading + optional description over
 * its content (typically a <FormGrid>). The standard way to group fields in the
 * richer governance dialogs (Contact, Change Status, Request Change, …). Styled
 * by `.ui-modal-section*` (assets/styles/uikit-overlay.css).
 */
export function ModalSection(
  { title, desc, children }:
  { title: string; desc?: string; children: ComponentChildren },
): VNode {
  return (
    <section class="ui-modal-section">
      <div class="ui-modal-section-head">
        <h4>{title}</h4>
        {desc && <p>{desc}</p>}
      </div>
      {children}
    </section>
  );
}
