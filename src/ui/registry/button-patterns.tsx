import { type VNode } from 'preact';
import { LucideIcon } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { CreditsButton } from '../special/CreditsButton';

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
  preview: () => VNode;
  examples: readonly ButtonPatternExample[];
}

export const BUTTON_PATTERNS: readonly ButtonPattern[] = [
  {
    id: 'ai-action',
    name: 'AI Action',
    badge: 'Pattern',
    role: 'AI actions in product chrome',
    description: 'A recognizable entry point for SIOMAC AI in top bars and contextual toolbars.',
    foundationComponentId: 'button',
    guidance: 'Use Sparkles and a clear verb. The pattern inherits Action Button geometry, states and accessibility; it is not a seventh variant.',
    preview: () => <Button variant="outline" iconLeft={<LucideIcon name="Sparkles" />}>Ask SIOMAC</Button>,
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
    preview: () => <Button variant="ghost" iconOnly aria-label="Notifications" iconLeft={<LucideIcon name="Bell" />} />,
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
    preview: () => <CreditsButton />,
    examples: [
      { id: 'credits', label: 'Credits', render: () => <CreditsButton /> },
    ],
  },
];

export function findButtonPattern(id: string): ButtonPattern | undefined {
  return BUTTON_PATTERNS.find(pattern => pattern.id === id);
}
