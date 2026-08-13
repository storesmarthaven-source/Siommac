/**
 * src/ui/special/CreditsButton.tsx — a SPECIAL TREATMENT, not a Button variant.
 *
 * ⛔ `Credits` is NOT in `ButtonVariant` and must never be added to it. The six
 * canonical variants are semantic roles — primary, secondary, outline, ghost,
 * danger, link — and a designer picks one by asking "what does this action
 * mean?". This is the opposite: one specific decorated control for one specific
 * place. Putting it in the enum would let someone choose "Credits" for a Save
 * button, which is exactly the fragmentation the canonical family removes.
 *
 * ⭐ It still COMPOSES the canonical foundations rather than reinventing them —
 * the same height, radius, padding, gap, font and focus ring, all read from
 * `--ui-button-*`. So it stays in step with the kit's rhythm automatically; only
 * the decoration is its own.
 *
 * ── Ported, not copied ──────────────────────────────────────────────────────
 * The source used React + styled-components with a fixed purple gradient. Both
 * were dropped deliberately:
 *
 *   styled-components  a second styling system in a codebase built on CSS
 *                      recipes in `@layer`. Nothing in the design needed it —
 *                      the fold, particles and stroke animation are plain CSS.
 *   purple gradient    ignored the brand entirely and could not be themed.
 *                      Replaced with SIOMAC navy, with restrained gold accents.
 *
 * Everything animated is decoration ON TOP of a token-driven surface, so a
 * rebrand moves it and it never fights the theme.
 */

import { type VNode } from 'preact';
import './credits.recipe.css';

export interface CreditsButtonProps {
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  class?: string;
}

/** How many drifting motes the particle field renders. */
const PARTICLES = 10;

export function CreditsButton({
  label = 'Credits', onClick, disabled = false, class: className,
}: CreditsButtonProps): VNode {
  return (
    <button
      type="button"
      class={`ui-credits${className ? ` ${className}` : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {/* Four flat token-coloured edges trace the silhouette. Separate spans,
          not a conic/linear gradient, so animation never invents a palette. */}
      <span class="ui-credits__border" aria-hidden="true">
        <i class="ui-credits__edge ui-credits__edge--top" />
        <i class="ui-credits__edge ui-credits__edge--right" />
        <i class="ui-credits__edge ui-credits__edge--bottom" />
        <i class="ui-credits__edge ui-credits__edge--left" />
      </span>

      {/* Peeling corner. `aria-hidden` throughout: none of the decoration
          carries meaning, and announcing it would bury the label. */}
      <span class="ui-credits__fold" aria-hidden="true" />

      <span class="ui-credits__particles" aria-hidden="true">
        {Array.from({ length: PARTICLES }, (_, i) => (
          <i key={i} class="ui-credits__particle" />
        ))}
      </span>

      <span class="ui-credits__inner">
        {/* Stroked, then filled by the hover animation — so the outline draws
            itself before the shape lands. */}
        <svg
          class="ui-credits__icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
          fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
        >
          <polyline points="13.18 1.37 13.18 9.64 21.45 9.64 10.82 22.63 10.82 14.36 2.55 14.36 13.18 1.37" />
        </svg>
        {label}
      </span>
    </button>
  );
}
