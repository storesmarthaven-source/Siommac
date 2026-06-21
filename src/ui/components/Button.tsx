/**
 * src/ui/components/Button.tsx
 *
 * Typed wrapper over the existing button classes. No new CSS — it renders the
 * same `.inc-action-btn` / `.hse-btn` markup already styled in HSE.css, so
 * adopting it anywhere is a zero-visual-change swap.
 *
 * Variants (mapped 1:1 to existing CSS):
 *   primary   → .inc-action-btn.primary   (Siomac red, white text)   — main CTA
 *   blue      → .inc-action-btn.blue      (Siomac navy, white text)   — secondary CTA
 *   secondary → .inc-action-btn.secondary (subtle bg, bordered)       — neutral action
 *   outline   → .hse-btn                  (transparent, navy border)  — quiet action
 *   accent    → .hse-btn.accent           (red fill)                  — quiet destructive
 */

import { type VNode, type ComponentChildren } from 'preact';

export type ButtonVariant = 'primary' | 'blue' | 'secondary' | 'outline' | 'accent';

interface ButtonProps {
  variant?: ButtonVariant;
  /** FontAwesome icon class without the leading `fa-` family, e.g. "fa-plus". */
  icon?: string;
  onClick?: (e: MouseEvent) => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
  /** Extra classes appended after the variant class. */
  class?: string;
  children?: ComponentChildren;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:   'inc-action-btn primary',
  blue:      'inc-action-btn blue',
  secondary: 'inc-action-btn secondary',
  outline:   'hse-btn',
  accent:    'hse-btn accent',
};

export function Button({
  variant = 'secondary',
  icon,
  onClick,
  type = 'button',
  disabled,
  title,
  class: extra,
  children,
}: ButtonProps): VNode {
  const cls = `${VARIANT_CLASS[variant]}${extra ? ' ' + extra : ''}`;
  return (
    <button type={type} class={cls} onClick={onClick} disabled={disabled} title={title}>
      {icon && <i class={`fas ${icon}`} />}
      {children}
    </button>
  );
}
