/**
 * src/ui/containers/Card/Card.tsx — the ONE surface container.
 *
 * The audit found NINE card components with overlapping roles: `MetricCard`
 * (`.inc-mini-card`), `StatsCard`, `SparkCard`, `ChartCard`, `KpiTile`,
 * `InfoCard`, `MiniCard`, `StatCard` and a per-module handful of raw
 * `<div class="…-card">`. Each one re-decided padding, radius, border,
 * elevation, header spacing and hover — which is why no two "cards" in SIOMAC
 * are the same shape.
 *
 * This component owns the SURFACE and nothing else:
 *
 *   padding · border · radius · background · elevation · header/footer spacing
 *   interactive / selected / disabled states · semantic accent + tone
 *
 * It owns nothing about CONTENT. A KPI number, a donut, a sparkline, a detail
 * list and a table are all just children. That split is the reason nine
 * components collapse into one: they differed in what they DREW, not in what
 * kind of surface they were.
 *
 * Three axes, per RECIPES.md §7 — none of them is a new component:
 *
 *   variant   the surface's shape    surface (default) | panel | metric | action
 *   density   its rhythm             compact | standard | comfortable
 *   tone      its meaning            neutral | accent | success | warning | danger | info
 *
 * ── Why an interactive card is a <div> with an overlay, not a <button> ───────
 * A `<button>` may not contain a button or a link, and real SIOMAC cards carry
 * edit/delete overlays, drill-through links and row menus. Wrapping the content
 * in a `<button>` would produce invalid, unnavigable markup on exactly the
 * cards that need it most. So an actionable card renders a stretched
 * `.ui-card-hit` control on top of the surface: one focus stop, one accessible
 * name, real Enter/Space activation from the browser — and nested controls stay
 * legal, raised above it by `.ui-card-actions` / `.ui-card-raise`.
 *
 * The trade-off is deliberate and documented: text inside an actionable card is
 * not selectable, because the overlay is what the pointer hits. If the card's
 * text must be selectable, do not make the whole card the control — put the
 * action on a button in the header.
 */

import { type VNode, type ComponentChildren, type HTMLAttributes, type CSSProperties } from 'preact';
import { Skeleton } from '../../components/Skeleton';
import { type UiState } from '../../tokens';
import './card.recipe.css';

export type CardVariant = 'surface' | 'panel' | 'metric' | 'action';
export type CardTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type CardAccent = 'none' | 'left' | 'top';
export type CardDensity = 'compact' | 'standard' | 'comfortable';

type RootAttrs = Omit<
  HTMLAttributes<HTMLDivElement>,
  'class' | 'className' | 'onClick' | 'loading' | 'header' | 'ref'
>;

interface CardBaseProps extends RootAttrs {
  children?: ComponentChildren;

  /** The surface's SHAPE. Not a different component — see the file header. */
  variant?: CardVariant;
  /**
   * What the card MEANS. Drives the accent bar, the hover border and the
   * selected ring — never the whole background, because a repainted surface
   * reads as a banner (that is `Alert`), not as data.
   */
  tone?: CardTone;
  /**
   * Where the tone shows. Defaults to `left` as soon as a non-neutral tone is
   * set, so `<Card tone="danger">` is visibly a danger card without a second prop.
   */
  accent?: CardAccent;
  density?: CardDensity;

  /** Header slot. Use `<CardHeader>` for the standard title/description/actions row. */
  header?: ComponentChildren;
  /** Footer slot — pinned to the bottom on a subtle band. */
  footer?: ComponentChildren;

  /**
   * Hover/press affordance. Defaults to `true` when `onClick` or `href` is set;
   * set it explicitly for a card whose interactivity lives elsewhere (a drag
   * handle, a drop target).
   */
  interactive?: boolean;
  /**
   * Selection state. Pass it ONLY for a card that is genuinely a toggle — when
   * present on an actionable card it emits `aria-pressed`, which is a promise
   * that clicking the card flips it.
   */
  selected?: boolean;
  disabled?: boolean;
  /** Cold-load — a shimmer body instead of a fake "0". Gate with `isLoading && !data`. */
  loading?: boolean;

  /** Frame only: the body drops its padding and gap, and the content owns them. */
  flush?: boolean;

  /** Class/style for the body slot (the frame's own class/style stay on the root). */
  bodyClass?: string;
  bodyStyle?: CSSProperties;

  /** Forced visual state — Gallery preview only (RECIPES.md §5). Never in app code. */
  forceState?: UiState;

  class?: string;
}

/** A card that is not itself a control. */
interface CardStaticProps {
  onClick?: undefined;
  href?: undefined;
  actionLabel?: undefined;
  target?: undefined;
  rel?: undefined;
}

/** A card that performs an action. `actionLabel` is REQUIRED — the overlay has
 *  no text of its own, so without it the control is unnamed for a screen reader. */
interface CardButtonProps {
  onClick: (event: MouseEvent) => void;
  actionLabel: string;
  href?: undefined;
  target?: undefined;
  rel?: undefined;
}

/** A card that navigates. Renders a real `<a>`, so middle-click and open-in-new-tab work. */
interface CardLinkProps {
  href: string;
  actionLabel: string;
  target?: string;
  rel?: string;
  onClick?: undefined;
}

export type CardProps = CardBaseProps & (CardStaticProps | CardButtonProps | CardLinkProps);

/** The union is for CALLERS; inside, one widened object type so rest works. */
type ResolvedCardProps = CardBaseProps & {
  onClick?: (event: MouseEvent) => void;
  href?: string;
  actionLabel?: string;
  target?: string;
  rel?: string;
};

export function Card(props: CardProps): VNode {
  const {
    children, variant = 'surface', tone = 'neutral', accent, density = 'standard',
    header, footer, interactive, selected, disabled = false, loading = false,
    flush = false, bodyClass, bodyStyle, forceState, class: extra,
    onClick, href, actionLabel, target, rel,
    ...rest
  } = props as ResolvedCardProps;

  const resolvedAccent: CardAccent = accent ?? (tone !== 'neutral' ? 'left' : 'none');
  const hasAction = Boolean(onClick ?? href);
  const isInteractive = interactive ?? hasAction;

  const cls = [
    'ui-card',
    `ui-card--${variant}`,
    tone !== 'neutral' ? `ui-card--${tone}` : '',
    density !== 'standard' ? `ui-card--${density}` : '',
    resolvedAccent !== 'none' ? `ui-card--accent-${resolvedAccent}` : '',
    flush ? 'ui-card--flush' : '',
    isInteractive ? 'is-interactive' : '',
    selected ? 'is-selected' : '',
    disabled ? 'is-disabled' : '',
    extra ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div
      class={cls}
      data-ui-state={forceState}
      data-selected={selected === undefined ? undefined : String(selected)}
      aria-busy={loading ? 'true' : undefined}
      {...rest}
    >
      {hasAction && (href !== undefined
        ? (
          <a
            class="ui-card-hit"
            href={disabled ? undefined : href}
            target={target}
            rel={rel ?? (target === '_blank' ? 'noreferrer noopener' : undefined)}
            aria-label={actionLabel}
            aria-disabled={disabled ? 'true' : undefined}
            aria-current={selected ? 'true' : undefined}
          />
        )
        : (
          <button
            type="button"
            class="ui-card-hit"
            aria-label={actionLabel}
            /* Undefined omits the attribute entirely; `false` renders as
               "false". That is the distinction between "not a toggle" and
               "a toggle that is currently off". */
            aria-pressed={selected}
            disabled={disabled}
            /* The handler is detached as well as the button disabled: a
               synthetically dispatched click still reaches a disabled button
               (jsdom, and any programmatic dispatchEvent), so `disabled` alone
               is not the guarantee it looks like. */
            onClick={disabled ? undefined : onClick}
          />
        ))}

      {header !== undefined && header !== null && header !== false && (
        <div class="ui-card-head">{header}</div>
      )}

      {/* No body element at all when there is nothing to put in it — an empty
          padded box under a header is dead space on every action card whose
          whole content IS its header. */}
      {(loading || (children !== undefined && children !== null && children !== false)) && (
        <div class={`ui-card-body${bodyClass ? ` ${bodyClass}` : ''}`} style={bodyStyle}>
          {loading ? <CardBodySkeleton variant={variant} /> : children}
        </div>
      )}

      {footer !== undefined && footer !== null && footer !== false && (
        <div class="ui-card-foot">{footer}</div>
      )}
    </div>
  );
}

/**
 * The cold-load body. A metric card shimmers as a caption + a figure, because a
 * three-line paragraph skeleton where a number will appear causes a visible
 * jump when the data lands.
 */
function CardBodySkeleton({ variant }: { variant: CardVariant }): VNode {
  if (variant === 'metric') {
    return (
      <div class="ui-card-skeleton">
        <Skeleton height={11} width="45%" />
        <Skeleton height={26} width={64} radius={8} />
      </div>
    );
  }
  return (
    <div class="ui-card-skeleton">
      <Skeleton height={12} width="90%" />
      <Skeleton height={12} width="75%" />
      <Skeleton height={12} width="55%" />
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────────────────────────*/

export interface CardHeaderProps {
  title: ComponentChildren;
  /** One supporting line under the title. */
  description?: ComponentChildren;
  /**
   * Leading glyph. A NODE, not a FontAwesome class string — the kit decides icon
   * geometry from `--ui-icon-*`, which a class string bypasses.
   */
  icon?: ComponentChildren;
  /** Right-aligned controls. Automatically raised above an actionable card's overlay. */
  actions?: ComponentChildren;
  /**
   * Heading level for the title. `null` renders a `<div>` — use it when the card
   * is not a document section (a KPI tile in a strip is not an `<h3>`).
   */
  level?: 2 | 3 | 4 | 5 | 6 | null;
  class?: string;
}

export function CardHeader({
  title, description, icon, actions, level = 3, class: extra,
}: CardHeaderProps): VNode {
  const Title = (level === null ? 'div' : `h${level}`) as 'h3';
  return (
    <div class={`ui-card-header${extra ? ` ${extra}` : ''}`}>
      {icon != null && <span class="ui-card-header-icon" aria-hidden="true">{icon}</span>}
      <div class="ui-card-header-text">
        <Title class="ui-card-title">{title}</Title>
        {description != null && <p class="ui-card-desc">{description}</p>}
      </div>
      {actions != null && <div class="ui-card-actions">{actions}</div>}
    </div>
  );
}

/* ── Footer ─────────────────────────────────────────────────────────────────*/

export interface CardFooterProps {
  children: ComponentChildren;
  class?: string;
}

/**
 * The footer band. It is a plain slot on purpose: the things that go here —
 * a drill-through link, a "last synced" note, a pair of buttons — are already
 * canonical components, and giving the footer its own `actions`/`meta` props
 * would be a second layout API for content it does not own.
 */
export function CardFooter({ children, class: extra }: CardFooterProps): VNode {
  return <div class={`ui-card-footer${extra ? ` ${extra}` : ''}`}>{children}</div>;
}
