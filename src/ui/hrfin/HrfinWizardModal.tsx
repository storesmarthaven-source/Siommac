/**
 * src/ui/hrfin/HrfinWizardModal.tsx — a lightweight centred, stepped modal for
 * short creation flows (New bill, New invoice…). Controlled: the caller owns
 * `activeStep` and renders that step's content. Styled by `.hrfin-wiz-*`.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useOverlayA11y } from '@ui/lib/useOverlayA11y';
import { HrfinIcon } from './icon';

export interface HrfinWizardModalProps {
  open: boolean;
  title: string;
  stepCount: number;
  activeStep: number;
  onClose: () => void;
  children: ComponentChildren;
  onBack?: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
}

export function HrfinWizardModal({
  open, title, stepCount, activeStep, onClose, children,
  onBack, primaryLabel, onPrimary, primaryDisabled, primaryLoading,
}: HrfinWizardModalProps): VNode | null {
  const panelRef = useOverlayA11y<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return createPortal(
    <div class="hrfin hrfin-wiz-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} class="hrfin-wiz-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div class="hrfin-wiz-head">
          <strong>{title}</strong>
          <button type="button" class="hrfin-wiz-close" onClick={onClose} aria-label="Close"><HrfinIcon name="close" /></button>
        </div>
        {stepCount > 1 && (
          <div class="hrfin-wiz-steps">
            {Array.from({ length: stepCount }, (_, i) => <div key={i} class={`hrfin-wiz-step-bar${i <= activeStep ? ' on' : ''}`} />)}
          </div>
        )}
        <div class="hrfin-wiz-body">{children}</div>
        <div class="hrfin-wiz-foot">
          <button type="button" class="hrfin-action" onClick={onBack} style={{ visibility: onBack ? 'visible' : 'hidden' }}>Back</button>
          <button type="button" class="hrfin-action is-primary" onClick={onPrimary} disabled={primaryDisabled || primaryLoading}>
            {primaryLoading ? 'Saving…' : primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
