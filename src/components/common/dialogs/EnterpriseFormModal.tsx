/**
 * src/components/common/dialogs/EnterpriseFormModal.tsx
 *
 * The two-pane enterprise form shell: form fields on the left, a live
 * <DialogContextPanel> on the right, Cancel / primary in the footer. Wraps any
 * create/edit form so it gains placement, preview, validation, side-effects and
 * approval routing without each page rebuilding that structure.
 * Preact — `class`, `ComponentChildren`; Escape + backdrop close.
 */

import { type ComponentChildren, type VNode } from 'preact';
import { useEffect } from 'preact/hooks';
import { DialogContextPanel } from './DialogContextPanel';
import type { DialogContextPanelConfig } from './dialogContextTypes';
import './dialogContextStyles.css';

interface EnterpriseFormModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  icon?: ComponentChildren;
  children: ComponentChildren;
  context: DialogContextPanelConfig;
  primaryLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
}

export function EnterpriseFormModal({
  open,
  title,
  subtitle,
  icon,
  children,
  context,
  primaryLabel,
  cancelLabel = 'Cancel',
  loading,
  disabled,
  onCancel,
  onSubmit,
}: EnterpriseFormModalProps): VNode | null {
  // Escape closes (unless a save is in flight).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !loading) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div class="efm-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !loading) onCancel(); }}>
      <div class="efm-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header class="efm-header">
          <div class="efm-title-row">
            {icon && <div class="efm-icon">{icon}</div>}
            <div>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          <button class="efm-close" type="button" onClick={onCancel} disabled={loading} aria-label="Close">×</button>
        </header>

        <main class="efm-body">
          <section class="efm-form-pane">{children}</section>
          <DialogContextPanel {...context} />
        </main>

        <footer class="efm-footer">
          <button type="button" class="efm-btn efm-btn-ghost" onClick={onCancel} disabled={loading}>{cancelLabel}</button>
          <button type="button" class="efm-btn efm-btn-primary" onClick={() => void onSubmit()} disabled={disabled ?? loading}>
            {loading ? 'Saving…' : primaryLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
