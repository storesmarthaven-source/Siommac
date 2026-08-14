/**
 * Credits is a named special treatment, never a canonical ButtonVariant.
 * The supplied design is implemented in the existing CSS-recipe architecture,
 * without adding styled-components or another button implementation.
 */
import { type VNode } from 'preact';
import './credits.recipe.css';

export interface CreditsButtonProps {
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  class?: string;
}

const PARTICLES = 10;

export function CreditsButton({
  label = 'Credits', onClick, disabled = false, class: className,
}: CreditsButtonProps): VNode {
  return (
    <button type="button" class={`ui-credits${className ? ` ${className}` : ''}`}
      onClick={disabled ? undefined : onClick} disabled={disabled}>
      <span class="ui-credits__fold" aria-hidden="true" />
      <span class="ui-credits__particles" aria-hidden="true">
        {Array.from({ length: PARTICLES }, (_, index) => <i key={index} class="ui-credits__particle" />)}
      </span>
      <span class="ui-credits__inner">
        <svg class="ui-credits__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg" stroke-linecap="round" stroke-linejoin="round"
          stroke-width="2.5" aria-hidden="true">
          <polyline points="13.18 1.37 13.18 9.64 21.45 9.64 10.82 22.63 10.82 14.36 2.55 14.36 13.18 1.37" />
        </svg>
        {label}
      </span>
    </button>
  );
}
