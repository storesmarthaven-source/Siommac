/**
 * src/ui/components/EmptyState.tsx
 *
 * The standard "nothing here yet" panel for a section/card: a tonal icon disc, a
 * title, a short description, an optional smaller note, and optional actions.
 * Replaces bare one-line empty text for sections that deserve guidance (documents,
 * statutory, history, …). Light by default; the navy drawer overrides live in
 * assets/styles/uikit-overlay.css. `tone` defaults to the standard brand blue.
 */

import { type VNode, type ComponentChildren } from 'preact';

export type EmptyTone = 'blue' | 'amber' | 'green' | 'purple' | 'gray';

export interface EmptyStateProps {
  /** Font Awesome class, e.g. 'fa-folder-open'. */
  icon: string;
  title: string;
  /** One-line description under the title. */
  text?: string;
  /** Smaller supporting note (what will appear here once populated). */
  note?: string;
  /** Icon disc colour — defaults to the standard brand blue. */
  tone?: EmptyTone;
  /** Optional action buttons row. */
  actions?: ComponentChildren;
}

export function EmptyState({ icon, title, text, note, tone = 'blue', actions }: EmptyStateProps): VNode {
  return (
    <div class="ui-empty">
      <div class="ui-empty-inner">
        <span class={`ui-empty-icon tone-${tone}`} aria-hidden="true"><i class={`fas ${icon}`} /></span>
        <h4 class="ui-empty-title">{title}</h4>
        {text && <p class="ui-empty-text">{text}</p>}
        {note && <p class="ui-empty-note">{note}</p>}
        {actions && <div class="ui-empty-actions">{actions}</div>}
      </div>
    </div>
  );
}
