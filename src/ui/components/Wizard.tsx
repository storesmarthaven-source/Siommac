/**
 * src/ui/components/Wizard.tsx
 *
 * The app-wide STANDARD multi-step dialog — one design for every "create" flow
 * (New Hazard, New Assessment, New JSA, Report Incident, …). Renders the `wz-*`
 * shell (assets/styles/uikit-layout.css):
 *   • header:   icon chip + title + description + close (top-right)
 *   • step bar: numbered, labelled step tabs with done/active states; click a
 *               completed step to jump back
 *   • body:     the current step's content, with an optional dark side panel
 *   • footer:   Cancel (left) · Back · Next / Submit (right)
 *
 * Controlled: the page owns `step` and renders the matching body.
 * `canAdvance(from)` optionally gates Next (return false to block).
 */

import { type VNode, type ComponentChildren } from 'preact';

export type WizardStep = string | { label: string; sub?: string };

export interface WizardProps {
  open: boolean;
  title: string;
  icon?: string;
  /** Header description line under the title. */
  sub?: string;
  steps: WizardStep[];
  step: number;
  onStepChange: (step: number) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  /** Return false to block advancing from the given step index. */
  canAdvance?: (from: number) => boolean;
  /** Optional dark side panel (guidance, live summary). */
  side?: ComponentChildren;
  size?: 'sm' | 'md' | 'lg';
  children: ComponentChildren;
}

const WIDTH: Record<NonNullable<WizardProps['size']>, number> = { sm: 680, md: 880, lg: 1100 };

export function Wizard({
  open, title, icon, sub, steps, step, onStepChange, onClose, onSubmit,
  submitLabel = 'Submit', submitDisabled, canAdvance, side, size = 'lg', children,
}: WizardProps): VNode | null {
  if (!open) return null;
  const last = steps.length - 1;
  const isLast = step >= last;

  const next = () => {
    if (canAdvance && !canAdvance(step)) return;
    onStepChange(Math.min(step + 1, last));
  };
  const back = () => onStepChange(Math.max(step - 1, 0));

  return (
    <div class="wz-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('wz-backdrop')) onClose(); }}>
      <div class="wz-modal" role="dialog" aria-modal="true" aria-label={title} style={{ width: `min(${WIDTH[size]}px, 100%)` }}>

        <div class="wz-header">
          <div class="wz-header-left">
            {icon && <div class="wz-header-icon"><i class={`fas ${icon}`} /></div>}
            <div>
              <div class="wz-header-title">{title}</div>
              {/* Subtext is standard: a description if given, else the step indicator. */}
              <div class="wz-header-sub">{sub ?? `Step ${step + 1} of ${steps.length}`}</div>
            </div>
          </div>
          <button class="wz-close" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </div>

        <div class="wz-step-bar" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((s, i) => {
            const label = typeof s === 'string' ? s : s.label;
            const stepSub = typeof s === 'string' ? undefined : s.sub;
            const state = i === step ? ' active' : i < step ? ' done' : '';
            return (
              <div key={i} class={`wz-step-tab${state}`} onClick={() => { if (i < step) onStepChange(i); }}>
                <b class="wz-step-num">{i < step ? <i class="fas fa-check" style={{ fontSize: '0.6rem' }} /> : i + 1}</b>
                <strong class="wz-step-tab-label">{label}</strong>
                {stepSub && <span class="wz-step-tab-sub">{stepSub}</span>}
              </div>
            );
          })}
        </div>

        <div class="wz-body" style={side ? undefined : { gridTemplateColumns: '1fr' }}>
          <div class="wz-main">{children}</div>
          {side && <aside class="wz-side">{side}</aside>}
        </div>

        <div class="wz-footer">
          <button class="hse-btn" onClick={onClose}><i class="fas fa-xmark" /> Cancel</button>
          <div class="wz-footer-nav">
            {step > 0 && <button class="hse-btn" onClick={back}><i class="fas fa-arrow-left" /> Back</button>}
            {!isLast && <button class="hse-btn primary" onClick={next}>Next <i class="fas fa-arrow-right" /></button>}
            {isLast && (
              <button class="hse-btn primary" onClick={onSubmit} disabled={submitDisabled}>
                <i class="fas fa-paper-plane" /> {submitLabel}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
