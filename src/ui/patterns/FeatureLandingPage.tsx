import { type ComponentChildren, type VNode } from 'preact';
import { useId } from 'preact/hooks';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { Button } from '../primitives/Button';
import './featureLandingPage.recipe.css';

export interface FeatureLandingCard {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  /** Rich media supplied by the product. Omit for the governed blank placeholder. */
  media?: ComponentChildren;
  mediaLabel?: string;
}

export interface FeatureLandingAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  disabledLabel?: string;
}

export interface FeatureLandingPageProps {
  title: string;
  description: string;
  icon: LucideName;
  cards: readonly FeatureLandingCard[];
  action: FeatureLandingAction;
  assurance?: string;
  cardGroupLabel?: string;
  class?: string;
}

/**
 * Governed feature-introduction page used before an empty, staged or newly
 * enabled workspace. Products own the copy and media; the UI Kit owns the
 * hierarchy, spacing, responsive card layout, actions and accessibility.
 */
export function FeatureLandingPage({
  title,
  description,
  icon,
  cards,
  action,
  assurance,
  cardGroupLabel = 'Feature highlights',
  class: extra,
}: FeatureLandingPageProps): VNode {
  const uid = useId();
  const titleId = `feature-landing-${uid}-title`;

  return (
    <main class={`ui-feature-landing${extra ? ` ${extra}` : ''}`} aria-labelledby={titleId}>
      <section class="ui-feature-landing__hero">
        <span class="ui-feature-landing__icon" aria-hidden="true"><LucideIcon name={icon} /></span>
        <h1 id={titleId}>{title}</h1>
        <p>{description}</p>
      </section>

      <section class="ui-feature-landing__cards" aria-label={cardGroupLabel}>
        {cards.map(card => (
          <article class="ui-feature-landing-card" key={card.id}>
            <div
              class={`ui-feature-landing-card__media${card.media ? ' has-media' : ' is-placeholder'}`}
              role="img"
              aria-label={card.mediaLabel ?? `${card.eyebrow} image placeholder`}
            >
              {card.media ?? <span aria-hidden="true" />}
            </div>
            <div class="ui-feature-landing-card__copy">
              <span>{card.eyebrow}</span>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
            </div>
          </article>
        ))}
      </section>

      <div class="ui-feature-landing__actions">
        <Button
          variant="primary"
          size="lg"
          iconRight={<LucideIcon name="ArrowRight" />}
          onClick={action.onSelect}
          disabled={action.disabled}
        >
          {action.disabled ? (action.disabledLabel ?? action.label) : action.label}
        </Button>
        {assurance && <span><LucideIcon name="ShieldCheck" /> {assurance}</span>}
      </div>
    </main>
  );
}
