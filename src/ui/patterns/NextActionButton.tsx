import { type VNode } from 'preact';
import { Button } from '../primitives/Button';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { type ControlSize, type UiState } from '../tokens';
import './nextActionButton.recipe.css';

export type NextActionIconTreatment = 'outline' | 'circle' | 'filled-circle';

export interface NextActionButtonProps {
  label?: string;
  size?: ControlSize;
  iconTreatment?: NextActionIconTreatment;
  iconColor?: string;
  leadingIcon?: LucideName | null;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (event: MouseEvent) => void;
  forceState?: UiState;
  class?: string;
}

/**
 * Governed Next action pattern.
 *
 * The role maps to canonical Button `primary`; the animated directional cue is
 * pattern-owned and therefore does not add a seventh ButtonVariant.
 */
export function NextActionButton({
  label = 'Next',
  size = 'md',
  iconTreatment = 'outline',
  iconColor,
  leadingIcon = null,
  disabled = false,
  loading = false,
  type = 'button',
  onClick,
  forceState,
  class: className,
}: NextActionButtonProps): VNode {
  return (
    <Button
      variant="primary"
      size={size}
      disabled={disabled}
      loading={loading}
      type={type}
      onClick={onClick}
      forceState={forceState}
      class={`ui-next-action-button${className ? ` ${className}` : ''}`}
      iconLeft={leadingIcon ? <span
        class={`ui-next-action-button__leading ui-next-action-button__leading--${iconTreatment}`}
        style={iconColor ? `--ui-next-action-icon:${iconColor}` : undefined}
      ><LucideIcon name={leadingIcon} /></span> : undefined}
      iconRight={<span
        class={`ui-next-action-button__icon ui-next-action-button__icon--${iconTreatment}`}
        style={iconColor ? `--ui-next-action-icon:${iconColor}` : undefined}
        aria-hidden="true"
      ><i /></span>}
    >
      {label}
    </Button>
  );
}
