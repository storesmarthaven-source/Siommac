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
  /** Per-step completion driven by validation. When provided, a reachable step shows
   *  complete (green check + pop) as soon as its entry is true — no need to advance past
   *  it. Falls back to position (i < activeIndex) when omitted. */
  completed?: readonly boolean[];
  ariaLabel?: string;
}

export function Stepper({ steps, activeIndex, onStep, reachableIndex, completed, ariaLabel = 'Steps' }: StepperProps): VNode {
  const maxReach = reachableIndex ?? activeIndex;
  return (
    <nav class="ui-stepper" aria-label={ariaLabel}>
      {steps.map((s, i) => {
        const reachable = i <= maxReach;
        const done = completed ? (completed[i] === true && reachable) : i < activeIndex;
        const isActive = i === activeIndex;
        const cls = ['ui-stepper-step'];
        if (done) cls.push('is-complete');
        if (isActive) cls.push('is-active');
        if (!done && !isActive) cls.push('is-todo');
        if (!reachable) cls.push('is-locked');
        return (
          <button
            key={s.key}
            type="button"
            class={cls.join(' ')}
            disabled={!reachable || !onStep}
            aria-current={isActive ? 'step' : undefined}
            title={reachable ? undefined : 'Complete the previous steps first'}
            onClick={() => { if (reachable && onStep) onStep(i); }}
          >
            <span class="ui-stepper-marker">
              {done
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
