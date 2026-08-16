import { type VNode } from 'preact';
import { LucideIcon } from '../../LucideIcon';
import './progressSteps.recipe.css';

export type ProgressStepsVariant =
  | 'icon-centered-number'
  | 'icon-with-text'
  | 'icon-with-number';

export type ProgressStepStatus = 'complete' | 'current' | 'upcoming' | 'disabled';

export interface ProgressStepItem {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ProgressStepsProps {
  steps: readonly ProgressStepItem[];
  /** Id of the current step. */
  value: string;
  /** Accessible name for the ordered step navigation. */
  label: string;
  variant?: ProgressStepsVariant;
  /** Completed ids override the default positional completion rule. */
  completed?: readonly string[];
  /** Enables backward navigation. Future steps remain unavailable. */
  onChange?: (id: string) => void;
  showDescriptions?: boolean;
  /** Connectors are part of every reference layout, but may be hidden when the
   *  component is placed in a very dense application surface. */
  showConnectors?: boolean;
  class?: string;
}

function statusFor(
  step: ProgressStepItem,
  index: number,
  currentIndex: number,
  currentId: string,
  completed?: readonly string[],
): ProgressStepStatus {
  if (step.disabled) return 'disabled';
  if (step.id === currentId) return 'current';
  if (completed) return completed.includes(step.id) ? 'complete' : 'upcoming';
  return index < currentIndex ? 'complete' : 'upcoming';
}

export function ProgressSteps({
  steps,
  value,
  label,
  variant = 'icon-centered-number',
  completed,
  onChange,
  showDescriptions = true,
  showConnectors = true,
  class: extra,
}: ProgressStepsProps): VNode {
  const currentIndex = Math.max(0, steps.findIndex(step => step.id === value));
  const className = [
    'ui-progress-steps',
    `ui-progress-steps--${variant}`,
    showConnectors ? '' : 'ui-progress-steps--no-connectors',
    extra,
  ].filter(Boolean).join(' ');

  return (
    <nav class={className} aria-label={label}>
      <ol class="ui-progress-steps__list" style={`--ui-progress-step-count:${Math.max(steps.length, 1)}`}>
        {steps.map((step, index) => {
          const status = statusFor(step, index, currentIndex, value, completed);
          const canNavigate = Boolean(onChange) && status !== 'disabled' && index <= currentIndex;
          const marker = status === 'complete'
            ? <LucideIcon name="Check" size={16} strokeWidth={2.5} />
            : variant === 'icon-with-text'
              ? <span class="ui-progress-steps__dot" />
              : index + 1;

          return (
            <li key={step.id} class={`ui-progress-steps__item is-${status}`}>
              <button
                type="button"
                class="ui-progress-steps__step"
                aria-current={status === 'current' ? 'step' : undefined}
                disabled={!canNavigate}
                onClick={() => { if (canNavigate) onChange?.(step.id); }}
              >
                <span class="ui-progress-steps__marker" aria-hidden="true">{marker}</span>
                <span class="ui-progress-steps__copy">
                  <strong>{step.label}</strong>
                  {showDescriptions && step.description && <small>{step.description}</small>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
