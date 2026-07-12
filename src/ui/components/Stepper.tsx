/**
 * src/ui/components/Stepper.tsx
 *
 * Standard horizontal wizard stepper — a separate boxed nav (not inside the form
 * card) with a numbered/checked marker + title + subtext per step. Ported from the
 * Onboarding wizard's `.ob-stepper` so every multi-step flow shares one look.
 *
 * Styled by `.ui-stepper*` in assets/styles/uikit-layout.css. Steps flex to fill the
 * width, keep a min-width, and scroll horizontally if the container is too narrow
 * (so labels never squish).
 */

import { type VNode } from 'preact';

export interface StepperStep {
  key: string;
  label: string;
  /** Short subtext under the label. */
  description?: string;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  /** Index of the current step (0-based). */
  activeIndex: number;
  /** Click handler for a reachable step (omit for a non-interactive stepper). */
  onStep?: (index: number) => void;
  /** Highest reachable step index; later steps are locked. Defaults to activeIndex. */
  reachableIndex?: number;
  ariaLabel?: string;
}

export function Stepper({ steps, activeIndex, onStep, reachableIndex, ariaLabel = 'Steps' }: StepperProps): VNode {
  const maxReach = reachableIndex ?? activeIndex;
  return (
    <nav class="ui-stepper" aria-label={ariaLabel}>
      {steps.map((s, i) => {
        const status = i < activeIndex ? 'complete' : i === activeIndex ? 'active' : 'todo';
        const reachable = i <= maxReach;
        return (
          <button
            key={s.key}
            type="button"
            class={`ui-stepper-step is-${status}${reachable ? '' : ' is-locked'}`}
            disabled={!reachable || !onStep}
            aria-current={status === 'active' ? 'step' : undefined}
            title={reachable ? undefined : 'Complete the previous steps first'}
            onClick={() => { if (reachable && onStep) onStep(i); }}
          >
            <span class="ui-stepper-marker">
              {status === 'complete'
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                : i + 1}
            </span>
            <span class="ui-stepper-copy">
              <strong>{s.label}</strong>
              {s.description && <span>{s.description}</span>}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
