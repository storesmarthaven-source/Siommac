import { type VNode } from 'preact';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { type ControlSize, type UiState } from '../tokens';
import './backActionButton.recipe.css';

export type BackActionIconTreatment = 'outline' | 'circle' | 'filled-circle';

export interface BackActionButtonProps {
  label?: string;
  /** Set to null for the text-only treatment. */
  icon?: LucideName | null;
  iconTreatment?: BackActionIconTreatment;
  iconColor?: string;
  size?: ControlSize;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (event: MouseEvent) => void;
  forceState?: UiState;
  class?: string;
}

export function BackActionIcon({ name = 'ArrowLeft', treatment = 'outline', color }: {
  name?: LucideName;
  treatment?: BackActionIconTreatment;
  color?: string;
}): VNode {
  return <span class={`ui-back-action-button__icon ui-back-action-button__icon--${treatment}`} style={color ? `--ui-back-action-icon:${color}` : undefined} aria-hidden="true"><LucideIcon name={name} /></span>;
}

/** Non-interactive artwork used by catalogue selectors without nesting buttons. */
export function BackActionArtwork({ label = 'Back', icon = 'ArrowLeft', iconTreatment = 'outline', iconColor }: {
  label?: string;
  icon?: LucideName | null;
  iconTreatment?: BackActionIconTreatment;
  iconColor?: string;
}): VNode {
  return <>{icon && <BackActionIcon name={icon} treatment={iconTreatment} color={iconColor} />}<span class="ui-btn-label">{label}</span></>;
}

/** Ghost Button usage pattern with a governed left-arrow hover cue. */
export function BackActionButton({
  label = 'Back', icon = 'ArrowLeft', iconTreatment = 'outline', iconColor,
  size = 'md', disabled = false, type = 'button', onClick,
  forceState, class: className,
}: BackActionButtonProps): VNode {
  return (
    <Button
      variant="ghost"
      size={size}
      disabled={disabled}
      type={type}
      onClick={onClick}
      forceState={forceState}
      class={`ui-back-action-button${className ? ` ${className}` : ''}`}
      iconLeft={icon ? <BackActionIcon name={icon} treatment={iconTreatment} color={iconColor} /> : undefined}
    >
      {label}
    </Button>
  );
}
