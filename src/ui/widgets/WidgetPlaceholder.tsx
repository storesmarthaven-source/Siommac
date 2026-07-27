import type { VNode } from 'preact';
import type { WidgetRuntimeState } from './types';

const content: Record<Extract<WidgetRuntimeState, 'restricted' | 'disabled' | 'missing'>, { icon: string; title: string }> = {
  restricted: { icon: 'fa-lock', title: 'Restricted widget' },
  disabled: { icon: 'fa-circle-pause', title: 'Widget disabled' },
  missing: { icon: 'fa-puzzle-piece', title: 'Widget unavailable' },
};
export function WidgetPlaceholder({ state, reason }: { state: 'restricted' | 'disabled' | 'missing'; reason?: string }): VNode {
  const value = content[state];
  return <div class={`wbi-placeholder wbi-placeholder--${state}`} role="status" data-widget-state={state}>
    <i class={`fas ${value.icon}`} aria-hidden="true" /><strong>{value.title}</strong>
    <span>{reason ?? 'Its saved position has been preserved.'}</span>
  </div>;
}
