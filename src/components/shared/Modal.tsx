/**
 * src/components/shared/Modal.tsx
 *
 * Accessible, portal-rendered modal dialog.
 *
 * Enterprise guarantees:
 *   ✓ Focus trapped inside while open (Tab / Shift+Tab cycle within modal)
 *   ✓ Focus restored to the trigger element on close
 *   ✓ Closes on Escape key
 *   ✓ Closes on backdrop click (opt-out via closeOnBackdrop={false})
 *   ✓ ARIA: role="dialog", aria-modal, aria-labelledby, aria-describedby
 *   ✓ Body scroll locked while open
 *   ✓ Portal-rendered to document.body — never clipped
 *   ✓ Reduced-motion: skips entrance animation
 *   ✓ Sizes: sm (400px) | md (560px) | lg (720px) | xl (960px)
 *
 * Usage:
 *   <Modal
 *     open={isOpen}
 *     onClose={() => setIsOpen(false)}
 *     title="Edit Employee"
 *     size="lg"
 *   >
 *     <EmployeeForm ... />
 *   </Modal>
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useEffect, useRef, useCallback, useId } from 'preact/hooks';
import { createPortal } from 'preact/compat';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open:               boolean;
  onClose:            () => void;
  title?:             string;
  /** Extra description shown below title (accessible via aria-describedby) */
  description?:       string;
  children:           ComponentChildren;
  size?:              ModalSize;
  /** Render custom header content instead of the default title bar */
  header?:            VNode;
  /** Render custom footer (action buttons) */
  footer?:            VNode;
  /** Allow clicking the backdrop to close. Default: true */
  closeOnBackdrop?:   boolean;
  /** Allow pressing Escape to close. Default: true */
  closeOnEscape?:     boolean;
  /** Extra class on the dialog panel */
  className?:         string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SIZE_WIDTH: Record<ModalSize, string> = {
  sm: '400px',
  md: '560px',
  lg: '720px',
  xl: '960px',
};

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

// ── Focus trap ────────────────────────────────────────────────────────────────

function trapFocus(dialog: HTMLElement, e: KeyboardEvent): void {
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusable.length === 0) return;

  const first = focusable[0]!;
  const last  = focusable[focusable.length - 1]!;

  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

// ── Body scroll lock ──────────────────────────────────────────────────────────

let _lockCount = 0;

function lockBody(): void {
  if (_lockCount === 0) {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow        = 'hidden';
    document.body.style.paddingRight    = `${scrollbarWidth}px`;
  }
  _lockCount++;
}

function unlockBody(): void {
  _lockCount = Math.max(0, _lockCount - 1);
  if (_lockCount === 0) {
    document.body.style.overflow     = '';
    document.body.style.paddingRight = '';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size              = 'md',
  header,
  footer,
  closeOnBackdrop   = true,
  closeOnEscape     = true,
  className         = '',
}: ModalProps): VNode | null {
  const dialogRef    = useRef<HTMLDivElement>(null);
  const triggerRef   = useRef<Element | null>(null);
  const titleId      = useId();
  const descId       = useId();

  // Remember the element that opened the modal so we can restore focus
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
      lockBody();

      // Move focus into the dialog on the next tick so the DOM is painted
      requestAnimationFrame(() => {
        const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
        (first ?? dialogRef.current)?.focus();
      });
    } else {
      unlockBody();
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    }
  }, [open]);

  // Keyboard handler — trap focus + Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && closeOnEscape) { e.stopPropagation(); onClose(); return; }
    if (e.key === 'Tab' && dialogRef.current) trapFocus(dialogRef.current, e);
  }, [closeOnEscape, onClose]);

  // Backdrop click
  const handleBackdropClick = useCallback((e: MouseEvent) => {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose();
  }, [closeOnBackdrop, onClose]);

  // Cleanup scroll lock if component unmounts while open
  useEffect(() => () => { if (open) unlockBody(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return createPortal(
    <>
      {/* Inject modal styles once */}
      <style>{`
        @keyframes siomac-modal-in {
          from { opacity: 0; transform: scale(0.96) translateY(-8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        @media (prefers-reduced-motion: reduce) {
          .siomac-modal-panel { animation: none !important; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        class="siomac-modal-backdrop"
        onClick={handleBackdropClick}
        onKeyDown={handleKeyDown}
        style={{
          position:        'fixed',
          inset:           0,
          zIndex:          1050,
          background:      'rgba(0,0,0,0.55)',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          padding:         '16px',
          overflowY:       'auto',
        }}
      >
        {/* Dialog panel */}
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          class={`siomac-modal-panel ${className}`}
          style={{
            position:     'relative',
            width:        '100%',
            maxWidth:     SIZE_WIDTH[size],
            background:   '#fff',
            borderRadius: '12px',
            boxShadow:    '0 20px 60px rgba(0,0,0,0.25)',
            display:      'flex',
            flexDirection:'column',
            maxHeight:    'calc(100vh - 32px)',
            animation:    'siomac-modal-in 0.18s ease',
            outline:      'none',
          }}
        >
          {/* Header */}
          {(header ?? title) && (
            <div
              style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'space-between',
                padding:        '18px 20px 14px',
                borderBottom:   '1px solid #e5e7eb',
                flexShrink:     0,
              }}
            >
              {header ?? (
                <div>
                  <h2
                    id={titleId}
                    style={{ margin: 0, fontSize: '17px', fontWeight: '600', color: '#111827' }}
                  >
                    {title}
                  </h2>
                  {description && (
                    <p id={descId} style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>
                      {description}
                    </p>
                  )}
                </div>
              )}

              <button
                type="button"
                aria-label="Close dialog"
                onClick={onClose}
                style={{
                  background:   'none',
                  border:       'none',
                  cursor:       'pointer',
                  color:        '#6b7280',
                  fontSize:     '18px',
                  lineHeight:   '1',
                  padding:      '4px',
                  borderRadius: '4px',
                  flexShrink:   0,
                  marginLeft:   '12px',
                }}
              >
                <i class="fas fa-times" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Body */}
          <div
            style={{
              padding:    '20px',
              overflowY:  'auto',
              flex:       1,
            }}
          >
            {children}
          </div>

          {/* Footer */}
          {footer && (
            <div
              style={{
                padding:      '14px 20px',
                borderTop:    '1px solid #e5e7eb',
                display:      'flex',
                justifyContent: 'flex-end',
                gap:          '8px',
                flexShrink:   0,
              }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
