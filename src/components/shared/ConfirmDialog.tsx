/**
 * src/components/shared/ConfirmDialog.tsx
 *
 * Accessible confirmation dialog for destructive actions.
 * Wraps <Modal> with a standard layout: icon + message + Cancel / Confirm.
 *
 * Usage:
 *   <ConfirmDialog
 *     open={showConfirm}
 *     onClose={() => setShowConfirm(false)}
 *     onConfirm={handleDelete}
 *     title="Delete Employee"
 *     message="This will permanently remove Jane Doe and all her records. This cannot be undone."
 *     variant="danger"
 *     confirmLabel="Delete"
 *     loading={isDeleting}
 *   />
 *
 * Imperative helper (no JSX needed for simple cases):
 *   import { confirm } from '@shared/ConfirmDialog';
 *   const ok = await confirm({ title: 'Delete?', message: '...' });
 *   if (ok) await deleteEmployee(id);
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { render as preactRender, type VNode } from 'preact';
import { useState, useCallback }              from 'preact/hooks';
import { Modal }                              from './Modal';
import { Spinner }                            from './Spinner';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConfirmVariant = 'danger' | 'warning' | 'info';

export interface ConfirmDialogProps {
  open:          boolean;
  onClose:       () => void;
  onConfirm:     () => void | Promise<void>;
  title:         string;
  message:       string;
  variant?:      ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?:  string;
  /** Show a spinner on the confirm button while an async onConfirm is running */
  loading?:      boolean;
}

// ── Style maps ────────────────────────────────────────────────────────────────

const VARIANT_ICON: Record<ConfirmVariant, string> = {
  danger:  'fa-exclamation-triangle',
  warning: 'fa-exclamation-circle',
  info:    'fa-info-circle',
};

const VARIANT_ICON_COLOR: Record<ConfirmVariant, string> = {
  danger:  '#dc2626',
  warning: '#d97706',
  info:    '#2563eb',
};

const VARIANT_BTN_STYLE: Record<ConfirmVariant, { background: string; hover: string }> = {
  danger:  { background: '#dc2626', hover: '#b91c1c' },
  warning: { background: '#d97706', hover: '#b45309' },
  info:    { background: '#2563eb', hover: '#1d4ed8' },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  variant      = 'danger',
  confirmLabel = 'Confirm',
  cancelLabel  = 'Cancel',
  loading      = false,
}: ConfirmDialogProps): VNode {
  const [internalLoading, setInternalLoading] = useState(false);

  const isLoading = loading || internalLoading;

  const handleConfirm = useCallback(async () => {
    const result = onConfirm();
    if (result instanceof Promise) {
      setInternalLoading(true);
      try { await result; } finally { setInternalLoading(false); }
    }
  }, [onConfirm]);

  const btnStyle = VARIANT_BTN_STYLE[variant];

  const footer = (
    <>
      <button
        type="button"
        onClick={onClose}
        disabled={isLoading}
        style={{
          padding:      '8px 20px',
          background:   '#f3f4f6',
          color:        '#374151',
          border:       '1px solid #d1d5db',
          borderRadius: '6px',
          cursor:       isLoading ? 'not-allowed' : 'pointer',
          fontSize:     '14px',
          fontWeight:   '500',
        }}
      >
        {cancelLabel}
      </button>

      <button
        type="button"
        onClick={() => void handleConfirm()}
        disabled={isLoading}
        style={{
          display:      'inline-flex',
          alignItems:   'center',
          gap:          '6px',
          padding:      '8px 20px',
          background:   isLoading ? '#9ca3af' : btnStyle.background,
          color:        '#fff',
          border:       'none',
          borderRadius: '6px',
          cursor:       isLoading ? 'not-allowed' : 'pointer',
          fontSize:     '14px',
          fontWeight:   '500',
          minWidth:     '90px',
          justifyContent: 'center',
        }}
      >
        {isLoading ? <Spinner size={14} color="#fff" label="Processing…" /> : confirmLabel}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={isLoading ? () => { /* noop */ } : onClose}
      closeOnBackdrop={!isLoading}
      closeOnEscape={!isLoading}
      size="sm"
      footer={footer}
    >
      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        {/* Icon */}
        <div
          style={{
            width:          '40px',
            height:         '40px',
            borderRadius:   '50%',
            background:     `${VARIANT_ICON_COLOR[variant]}18`,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            flexShrink:     0,
          }}
        >
          <i
            class={`fas ${VARIANT_ICON[variant]}`}
            aria-hidden="true"
            style={{ color: VARIANT_ICON_COLOR[variant], fontSize: '18px' }}
          />
        </div>

        {/* Text */}
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: '600', color: '#111827' }}>
            {title}
          </h3>
          <p style={{ margin: 0, fontSize: '14px', color: '#6b7280', lineHeight: '1.5' }}>
            {message}
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ── Imperative helper ─────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title:         string;
  message:       string;
  variant?:      ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?:  string;
}

/**
 * Show a confirm dialog imperatively and await the user's choice.
 * Returns true if the user confirmed, false if they cancelled.
 *
 * @example
 * const ok = await confirm({ title: 'Delete employee?', message: 'Cannot be undone.' });
 * if (ok) await api.deleteEmployee(id);
 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    function cleanup(result: boolean): void {
      resolve(result);
      // Allow close animation to finish before unmounting
      setTimeout(() => {
        preactRender(null, container);
        container.remove();
      }, 250);
    }

    function Dialog(): VNode {
      const [open, setOpen] = useState(true);
      return (
        <ConfirmDialog
          open={open}
          onClose={() => { setOpen(false); cleanup(false); }}
          onConfirm={() => { setOpen(false); cleanup(true);  }}
          title={opts.title}
          message={opts.message}
          variant={opts.variant}
          confirmLabel={opts.confirmLabel}
          cancelLabel={opts.cancelLabel}
        />
      );
    }

    preactRender(<Dialog />, container);
  });
}
