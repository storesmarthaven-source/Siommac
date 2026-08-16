/**
 * The canonical "nothing here yet" surface for sections, cards and drawers.
 * The component owns structure and visual semantics; actions remain composed
 * canonical Buttons. Static states are quiet by default, while async result
 * changes can opt into status or alert announcement semantics.
 */
import { type ComponentChildren, type JSX, type VNode } from 'preact';
import './emptyState.recipe.css';

export type EmptyTone = 'blue' | 'amber' | 'green' | 'purple' | 'gray';
export type EmptyStateSize = 'compact' | 'default';

export interface EmptyStateProps {
  /** Font Awesome class, e.g. 'fa-folder-open', or a canonical icon node. */
  icon?: string | ComponentChildren;
  /** Rich visual header such as an avatar composition, illustration or file icon. */
  visual?: ComponentChildren;
  /** Quiet concentric guide behind the visual header. */
  pattern?: boolean;
  title: string;
  text?: string;
  note?: string;
  tone?: EmptyTone;
  /** Compact is for drawers, cards and table states; default is for sections. */
  size?: EmptyStateSize;
  /** Match the surrounding document outline. */
  headingLevel?: 2 | 3 | 4;
  actions?: ComponentChildren;
  /** Optional announcement semantics for async results or failures. */
  role?: 'status' | 'alert';
}

export function EmptyState({
  icon, visual, pattern = false, title, text, note, tone = 'gray', size = 'default', headingLevel = 3, actions, role,
}: EmptyStateProps): VNode {
  const Heading = `h${headingLevel}` as keyof JSX.IntrinsicElements;
  return (
    <div class={`ui-empty ui-empty--${size}`} role={role}>
      <div class="ui-empty-inner">
        {(visual ?? icon) && <div class={`ui-empty-visual${pattern ? ' has-pattern' : ''}`} aria-hidden="true">
          {pattern && <span class="ui-empty-pattern" />}
          {visual ?? <span class={`ui-empty-icon tone-${tone}`} aria-hidden="true">
            {typeof icon === 'string' ? <i class={`fas ${icon}`} /> : icon}
          </span>}
        </div>}
        <Heading class="ui-empty-title">{title}</Heading>
        {text && <p class="ui-empty-text">{text}</p>}
        {note && <p class="ui-empty-note">{note}</p>}
        {actions && <div class="ui-empty-actions">{actions}</div>}
      </div>
    </div>
  );
}
