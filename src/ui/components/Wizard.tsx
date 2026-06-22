/**
 * src/ui/components/Wizard.tsx
 *
 * A multi-step dialog built on the STANDARD WINDOW (`.ui-modal*`) plus a step
 * indicator bar (`.ui-wizard-steps`). Used for every "create" flow in the app
 * (New Hazard, New Assessment, New JSA, …) so they all look and behave the same:
 *   • header:  icon + title + auto "Step X of Y — <step name>" subtitle
 *   • body:    the current step's content (caller renders by `step`)
 *   • footer:  Back (left) · Cancel + Next/Submit (right)
 *
 * The wizard is controlled: the page owns `step` and renders the matching body.
 * `canAdvance(from)` optionally gates the Next button (return false to block).
 */

import { type VNode, type ComponentChildren } from 'preact';
import { Button } from './Button';

export interface WizardProps {
  open: boolean;
  title: string;
  icon?: string;
  steps: string[];
  step: number;
  onStepChange: (step: number) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  /** Return false to block advancing from the given step index. */
  canAdvance?: (from: number) => boolean;
  size?: 'sm' | 'md' | 'lg';
  children: ComponentChildren;
}

export function Wizard({
  open, title, icon, steps, step, onStepChange, onClose, onSubmit,
  submitLabel = 'Submit', submitDisabled, canAdvance, size = 'lg', children,
}: WizardProps): VNode | null {
  if (!open) return null;
  const last = steps.length - 1;
  const isLast = step >= last;
  const stepName = steps[step] ?? '';

  const next = () => {
    if (canAdvance && !canAdvance(step)) return;
    onStepChange(Math.min(step + 1, last));
  };
  const back = () => onStepChange(Math.max(step - 1, 0));

  return (
    <div class="ui-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section class={`ui-modal${size !== 'md' ? ` ui-modal--${size}` : ''}`} role="dialog" aria-modal="true">
        <header class="ui-modal-head">
          <div class="ui-modal-headwrap">
            {icon && <span class="ui-modal-icon"><i class={`fas ${icon}`} /></span>}
            <div class="ui-modal-titles">
              <h3 class="ui-modal-title">{title}</h3>
              <p class="ui-modal-sub">Step {step + 1} of {steps.length} — {stepName}</p>
            </div>
          </div>
          <button class="ui-modal-close" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </header>

        <div class="ui-wizard-steps">
          {steps.map((s, i) => <div key={s + i} class={`ui-wizard-step${i <= step ? ' is-done' : ''}`} />)}
        </div>

        <div class="ui-modal-body">{children}</div>

        <footer class="ui-modal-foot">
          {step > 0 && (
            <span class="ui-foot-left">
              <Button variant="outline" icon="fa-arrow-left" onClick={back}>Back</Button>
            </span>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {isLast
            ? <Button variant="primary" onClick={onSubmit} disabled={submitDisabled}>{submitLabel}</Button>
            : <Button variant="blue" onClick={next}>Next</Button>}
        </footer>
      </section>
    </div>
  );
}
