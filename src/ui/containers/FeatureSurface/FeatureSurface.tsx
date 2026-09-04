/**
 * A high-emphasis SIOMAC surface for a single important setting or status.
 *
 * FeatureSurface owns the navy frame, inverse typography, decorative depth and
 * responsive slot layout. Consumers provide meaning through the icon, copy and
 * optional actions; they should not recreate the background in module CSS.
 */

import { type ComponentChildren, type HTMLAttributes, type VNode } from 'preact';
import './feature-surface.recipe.css';

type RootAttrs = Omit<HTMLAttributes<HTMLElement>, 'class' | 'className' | 'title'>;

export interface FeatureSurfaceProps extends RootAttrs {
  icon?: ComponentChildren;
  eyebrow?: ComponentChildren;
  title: ComponentChildren;
  description?: ComponentChildren;
  actions?: ComponentChildren;
  class?: string;
}

export function FeatureSurface({
  icon, eyebrow, title, description, actions, class: extra, ...attrs
}: FeatureSurfaceProps): VNode {
  return (
    <section class={`ui-feature-surface${extra ? ` ${extra}` : ''}`} {...attrs}>
      {icon != null && <span class="ui-feature-surface__icon" aria-hidden="true">{icon}</span>}
      <span class="ui-feature-surface__copy">
        {eyebrow != null && <span class="ui-feature-surface__eyebrow">{eyebrow}</span>}
        <strong class="ui-feature-surface__title">{title}</strong>
        {description != null && <span class="ui-feature-surface__description">{description}</span>}
      </span>
      {actions != null && <div class="ui-feature-surface__actions">{actions}</div>}
    </section>
  );
}
