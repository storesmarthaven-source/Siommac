import { type VNode } from 'preact';
import { Button } from '../primitives/Button';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { type ControlSize, type UiState } from '../tokens';
import './aiActionButton.recipe.css';

export type AiActionIconTreatment = 'outline' | 'circle' | 'filled-circle';
export type AiActionShape = 'rounded' | 'soft' | 'circle';

const AI_PARTICLES = 8;

export interface AiActionButtonProps {
  label?: string;
  /** Omit for the original SIOMAC sparkle; pass null for no icon. */
  icon?: LucideName | null;
  iconTreatment?: AiActionIconTreatment;
  iconColor?: string;
  surfaceStart?: string;
  surfaceEnd?: string;
  glowColor?: string;
  borderColor?: string;
  shape?: AiActionShape;
  size?: Extract<ControlSize, 'sm' | 'md'>;
  disabled?: boolean;
  loading?: boolean;
  forceState?: UiState;
  onClick?: (event: MouseEvent) => void;
  class?: string;
}

/**
 * Governed AI action used in SIOMAC product chrome.
 *
 * This is a composition of the canonical Button—not a seventh Button variant.
 * Its named visual treatment is owned by the AI Action pattern and can evolve
 * without weakening ButtonVariant or creating another button implementation.
 */
export function AiActionButton({
  label = 'AI Assistant',
  icon,
  iconTreatment = 'outline',
  iconColor,
  surfaceStart,
  surfaceEnd,
  glowColor,
  borderColor,
  shape = 'rounded',
  size = 'sm',
  disabled = false,
  loading = false,
  forceState,
  onClick,
  class: className,
}: AiActionButtonProps): VNode {
  const variables = [
    surfaceStart && `--ui-ai-action-surface-start:${surfaceStart}`,
    surfaceEnd && `--ui-ai-action-surface-end:${surfaceEnd}`,
    glowColor && `--ui-ai-action-glow:${glowColor}`,
    borderColor && `--ui-ai-action-border:${borderColor}`,
    iconColor && `--ui-ai-action-icon:${iconColor}`,
  ].filter(Boolean).join(';');
  return <span class={`ui-ai-action-scope${className ? ` ${className}` : ''}`} style={variables || undefined}>
    <Button variant="outline" size={size} iconOnly aria-label={label} title={label}
      class={`ui-ai-action-button ui-ai-action-button--${shape}`}
      disabled={disabled} loading={loading} forceState={forceState} onClick={onClick}
      iconLeft={icon === null ? undefined : <span class={`ui-ai-action-button__icon ui-ai-action-button__icon--${iconTreatment}`}>
        <span class="ui-ai-action-button__particles" aria-hidden="true">
          {Array.from({ length: AI_PARTICLES }, (_, index) => <i key={index} />)}
        </span>
        {icon ? <LucideIcon name={icon} size={size === 'sm' ? 19 : 21} /> : <span class="ui-ai-action-button__brand-glyph" aria-hidden="true" />}
      </span>} />
  </span>;
}
