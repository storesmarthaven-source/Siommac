import { type VNode } from 'preact';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { Button, type ButtonVariant } from '../primitives/Button';
import { CreditsButton } from '../special/CreditsButton';
import { type ControlSize } from '../tokens';

export type ButtonPatternValue = string | boolean;
export type ButtonPatternValues = Record<string, ButtonPatternValue>;

export type ButtonPatternControl =
  | { name: string; label: string; type: 'select'; options: readonly { value: string; label: string }[] }
  | { name: string; label: string; type: 'icon'; recommendations: readonly LucideName[] }
  | { name: string; label: string; type: 'color' }
  | { name: string; label: string; type: 'boolean' };

export interface ButtonPatternExample {
  id: string;
  label: string;
  render: () => VNode;
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
  defaults: ButtonPatternValues;
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
const patternIcon = (values: ButtonPatternValues | undefined, fallback: string): VNode => {
  const treatment = text(values, 'iconTreatment', 'outline');
  return <span class={`sds-preview-icon sds-preview-icon--${treatment}`} style={{ color: text(values, 'iconColor', '#1b2d54') }}>
    <LucideIcon name={text(values, 'icon', fallback) as never} />
  </span>;
};

export const BUTTON_PATTERNS: readonly ButtonPattern[] = [
  {
    id: 'ai-action',
    name: 'AI Action',
    badge: 'Pattern',
    role: 'AI actions in product chrome',
    description: 'A recognizable entry point for SIOMAC AI in top bars and contextual toolbars.',
    foundationComponentId: 'button',
    guidance: 'Use Sparkles and a clear verb. The pattern inherits Action Button geometry, states and accessibility; it is not a seventh variant.',
    defaults: { emphasis: 'outline', size: 'sm', icon: 'Sparkles', iconTreatment: 'outline', iconColor: '#1b2d54' },
    controls: [
      { name: 'emphasis', label: 'Emphasis', type: 'select', options: [{ value: 'outline', label: 'Outline' }, { value: 'primary', label: 'Primary' }, { value: 'secondary', label: 'Secondary' }] },
      { name: 'size', label: 'Size', type: 'select', options: [{ value: 'sm', label: 'Compact' }, { value: 'md', label: 'Regular' }] },
      { name: 'icon', label: 'AI icon', type: 'icon', recommendations: ['Sparkles', 'WandSparkles', 'BrainCircuit', 'Bot'] },
      { name: 'iconTreatment', label: 'Icon treatment', type: 'select', options: [{ value: 'outline', label: 'Outline' }, { value: 'circle', label: 'Circle' }, { value: 'filled-circle', label: 'Filled circle' }] },
      { name: 'iconColor', label: 'Icon color', type: 'color' },
    ],
    preview: values => <Button variant={variant(text(values, 'emphasis', 'outline'))} size={size(text(values, 'size', 'sm'))} iconLeft={patternIcon(values, 'Sparkles')}>Ask SIOMAC</Button>,
    examples: [
      { id: 'top-bar', label: 'Top bar', render: () => <Button variant="outline" size="sm" iconLeft={<LucideIcon name="Sparkles" />}>Ask SIOMAC</Button> },
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
    defaults: { accentColor: '#f7b900', signalColor: '#c52a32', disabled: false },
    controls: [
      { name: 'accentColor', label: 'Accent color', type: 'color' },
      { name: 'signalColor', label: 'Signal color', type: 'color' },
      { name: 'disabled', label: 'Disabled state', type: 'boolean' },
    ],
    preview: values => <span class="sds-credits-preview" style={`--ui-credits-accent:${text(values, 'accentColor', '#f7b900')};--ui-credits-signal:${text(values, 'signalColor', '#c52a32')}`}>
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
