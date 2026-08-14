import { type VNode } from 'preact';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { Button, type ButtonVariant } from '../primitives/Button';
import { AiActionButton, type AiActionIconTreatment, type AiActionShape } from '../patterns/AiActionButton';
import { CreditsButton } from '../special/CreditsButton';
import { type ControlSize } from '../tokens';

export type ButtonPatternValue = string | boolean;
export type ButtonPatternValues = Record<string, ButtonPatternValue>;

export type ButtonPatternControl =
  | { name: string; label: string; type: 'select'; options: readonly { value: string; label: string }[]; token?: string; tokenValues?: Readonly<Record<string, string>> }
  | { name: string; label: string; type: 'icon'; recommendations: readonly LucideName[]; token?: never }
  | { name: string; label: string; type: 'color'; token?: string }
  | { name: string; label: string; type: 'boolean'; token?: never };

export interface ButtonPatternExample {
  id: string;
  label: string;
  render: () => VNode;
}

export interface ButtonPatternPreset {
  id: string;
  label: string;
  values: ButtonPatternValues;
}

/**
 * A governed use of Button, not another component or ButtonVariant.
 * Patterns lock a product context while inheriting the canonical recipe.
 */
export interface ButtonPattern {
  id: string;
  name: string;
  badge: 'Pattern' | 'Special';
  role: string;
  description: string;
  foundationComponentId: 'button';
  guidance: string;
  inheritance: string;
  defaults: ButtonPatternValues;
  presets?: readonly ButtonPatternPreset[];
  controls: readonly ButtonPatternControl[];
  preview: (values?: ButtonPatternValues) => VNode;
  examples: readonly ButtonPatternExample[];
}

const text = (values: ButtonPatternValues | undefined, name: string, fallback: string): string =>
  typeof values?.[name] === 'string' ? values[name] : fallback;
const yes = (values: ButtonPatternValues | undefined, name: string): boolean => values?.[name] === true;
const size = (value: string): ControlSize => value === 'sm' || value === 'lg' ? value : 'md';
const variant = (value: string): ButtonVariant =>
  ['primary', 'secondary', 'outline', 'ghost', 'danger', 'link'].includes(value) ? value as ButtonVariant : 'outline';
const aiSize = (value: string): 'sm' | 'md' => value === 'md' ? 'md' : 'sm';
const patternIcon = (values: ButtonPatternValues | undefined, fallback: string): VNode => {
  const treatment = text(values, 'iconTreatment', 'outline');
  return <span class={`sds-preview-icon sds-preview-icon--${treatment}`} style={{ color: text(values, 'iconColor', '#1b2d54') }}>
    <LucideIcon name={text(values, 'icon', fallback) as never} />
  </span>;
};
const aiAction = (values?: ButtonPatternValues): VNode => <AiActionButton
  size={aiSize(text(values, 'size', 'sm'))}
  icon={text(values, 'iconSource', 'siomac') === 'siomac' ? undefined : text(values, 'icon', 'Sparkles') === 'None' ? null : text(values, 'icon', 'Sparkles') as LucideName}
  iconTreatment={text(values, 'iconTreatment', 'outline') as AiActionIconTreatment}
  iconColor={text(values, 'iconColor', '#ffffff')}
  surfaceStart={text(values, 'surfaceStart', '#f7c63d')}
  surfaceEnd={text(values, 'surfaceEnd', '#d88900')}
  glowColor={text(values, 'glowColor', '#fff0a5')}
  borderColor={text(values, 'borderColor', '#d99608')}
  shape={text(values, 'shape', 'rounded') as AiActionShape}
/>;

export const BUTTON_PATTERNS: readonly ButtonPattern[] = [
  {
    id: 'ai-action',
    name: 'AI Action',
    badge: 'Pattern',
    role: 'AI actions in product chrome',
    description: 'A recognizable entry point for SIOMAC AI in top bars and contextual toolbars.',
    foundationComponentId: 'button',
    guidance: 'Use Sparkles and a clear verb. The pattern inherits Action Button geometry, states and accessibility; it is not a seventh variant.',
    inheritance: 'Composes the canonical Action Button',
    defaults: { size: 'sm', iconSource: 'siomac', icon: 'Sparkles', iconTreatment: 'outline', iconColor: '#ffffff', surfaceStart: '#f7c63d', surfaceEnd: '#d88900', glowColor: '#fff0a5', borderColor: '#d99608', shape: 'rounded' },
    presets: [
      { id: 'yellow', label: 'Yellow', values: { iconColor: '#ffffff', surfaceStart: '#f7c63d', surfaceEnd: '#d88900', glowColor: '#fff0a5', borderColor: '#d99608' } },
      { id: 'purple', label: 'Purple', values: { iconColor: '#ffffff', surfaceStart: '#9b7cff', surfaceEnd: '#6f42db', glowColor: '#e3a6ff', borderColor: '#7651d4' } },
      { id: 'navy', label: 'Blue', values: { iconColor: '#ffffff', surfaceStart: '#4b78d1', surfaceEnd: '#204a9a', glowColor: '#9fc0ff', borderColor: '#2f5ba8' } },
      { id: 'green', label: 'Green', values: { iconColor: '#ffffff', surfaceStart: '#646d40', surfaceEnd: '#2f3d1a', glowColor: '#9aa878', borderColor: '#4d5931' } },
    ],
    controls: [
      { name: 'size', label: 'Size', type: 'select', options: [{ value: 'sm', label: 'Compact' }, { value: 'md', label: 'Regular' }] },
      { name: 'iconSource', label: 'Icon style', type: 'select', options: [{ value: 'siomac', label: 'Original SIOMAC sparkle' }, { value: 'lucide', label: 'Lucide icon' }] },
      { name: 'icon', label: 'AI icon', type: 'icon', recommendations: ['Sparkles', 'WandSparkles', 'BrainCircuit', 'Bot'] },
      { name: 'iconTreatment', label: 'Icon treatment', type: 'select', options: [{ value: 'outline', label: 'Outline' }, { value: 'circle', label: 'Circle' }, { value: 'filled-circle', label: 'Filled circle' }] },
      { name: 'iconColor', label: 'Icon color', type: 'color', token: '--ui-ai-action-icon' },
      { name: 'surfaceStart', label: 'Gradient start', type: 'color', token: '--ui-ai-action-surface-start' },
      { name: 'surfaceEnd', label: 'Gradient end', type: 'color', token: '--ui-ai-action-surface-end' },
      { name: 'glowColor', label: 'Glow color', type: 'color', token: '--ui-ai-action-glow' },
      { name: 'borderColor', label: 'Focus ring color', type: 'color', token: '--ui-ai-action-border' },
      { name: 'shape', label: 'Shape', type: 'select', token: '--ui-ai-action-radius', tokenValues: { rounded: '7px', soft: '5px', circle: '999px' }, options: [{ value: 'rounded', label: 'Standard' }, { value: 'soft', label: 'Tight corners' }, { value: 'circle', label: 'Circle' }] },
    ],
    preview: aiAction,
    examples: [
      { id: 'top-bar', label: 'Top bar control', render: () => <AiActionButton /> },
      { id: 'ask', label: 'Ask SIOMAC', render: () => <Button variant="outline" size="sm" iconLeft={<LucideIcon name="Sparkles" />}>Ask SIOMAC</Button> },
      { id: 'generate', label: 'Generate assistance', render: () => <Button variant="primary" iconLeft={<LucideIcon name="WandSparkles" />}>Generate summary</Button> },
    ],
  },
  {
    id: 'icon-button',
    name: 'Icon Button',
    badge: 'Pattern',
    role: 'Compact toolbar action',
    description: 'A canonical Button with icon-only content and a mandatory accessible label.',
    foundationComponentId: 'button',
    guidance: 'Reserve icon-only actions for familiar symbols in constrained toolbars. Every instance requires a specific accessible name.',
    inheritance: 'Inherits the published Action Button recipe',
    defaults: { accessibleLabel: 'Notifications', emphasis: 'ghost', size: 'md', icon: 'Bell', iconTreatment: 'outline', iconColor: '#1b2d54' },
    controls: [
      { name: 'emphasis', label: 'Emphasis', type: 'select', options: [{ value: 'ghost', label: 'Ghost' }, { value: 'outline', label: 'Outline' }, { value: 'secondary', label: 'Secondary' }] },
      { name: 'size', label: 'Size', type: 'select', options: [{ value: 'sm', label: 'Compact' }, { value: 'md', label: 'Regular' }, { value: 'lg', label: 'Large' }] },
      { name: 'icon', label: 'Icon', type: 'icon', recommendations: ['Bell', 'RefreshCw', 'Settings', 'X'] },
      { name: 'iconTreatment', label: 'Icon treatment', type: 'select', options: [{ value: 'outline', label: 'Outline' }, { value: 'circle', label: 'Circle' }, { value: 'filled-circle', label: 'Filled circle' }] },
      { name: 'iconColor', label: 'Icon color', type: 'color' },
    ],
    preview: values => <Button variant={variant(text(values, 'emphasis', 'ghost'))} size={size(text(values, 'size', 'md'))} iconOnly
      aria-label={text(values, 'accessibleLabel', 'Notifications')} iconLeft={patternIcon(values, 'Bell')} />,
    examples: [
      { id: 'refresh', label: 'Refresh', render: () => <Button variant="ghost" iconOnly aria-label="Refresh data" iconLeft={<LucideIcon name="RefreshCw" />} /> },
      { id: 'settings', label: 'Settings', render: () => <Button variant="ghost" iconOnly aria-label="Open settings" iconLeft={<LucideIcon name="Settings" />} /> },
      { id: 'close', label: 'Close', render: () => <Button variant="ghost" iconOnly aria-label="Close" iconLeft={<LucideIcon name="X" />} /> },
    ],
  },
  {
    id: 'special-treatments',
    name: 'Special Treatments',
    badge: 'Special',
    role: 'Named, approved exceptions',
    description: 'Rare product-specific treatments that remain outside the canonical variant enum.',
    foundationComponentId: 'button',
    guidance: 'Special treatments require a named owner and product context. Credits remains non-canonical and never enters ButtonVariant.',
    inheritance: 'Named standalone treatment',
    defaults: { accentColor: '#7a5af8', signalColor: '#df71ff', disabled: false },
    controls: [
      { name: 'accentColor', label: 'Base color', type: 'color' },
      { name: 'signalColor', label: 'Glow color', type: 'color' },
      { name: 'disabled', label: 'Disabled state', type: 'boolean' },
    ],
    preview: values => <span class="sds-credits-preview" style={`--ui-credits-bg:${text(values, 'accentColor', '#7a5af8')};--ui-credits-glow:${text(values, 'signalColor', '#df71ff')}`}>
      <CreditsButton disabled={yes(values, 'disabled')} />
    </span>,
    examples: [
      { id: 'credits', label: 'Credits', render: () => <CreditsButton /> },
    ],
  },
];

export function findButtonPattern(id: string): ButtonPattern | undefined {
  return BUTTON_PATTERNS.find(pattern => pattern.id === id);
}
