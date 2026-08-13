/**
 * src/ui/primitives/Button.tsx — THE button. There is no other.
 *
 * Every clickable action in SIOMAC is this component. Icon-only, link-styled,
 * toggle, loading, destructive and full-width are all PROPS — not separate
 * components. An earlier pass shipped `IconButton`, `LinkButton` and
 * `ToggleButton` as wrappers, each of which was two lines delegating straight
 * back here: no new behaviour, three more names to learn, three more things a
 * migration has to know about. That is the fragmentation this kit exists to
 * remove, so they are gone.
 *
 * A separate component is justified only when the INTERACTION MODEL differs.
 * `SegmentedControl` earns one (radiogroup semantics, roving focus, arrow keys);
 * an icon-only button does not.
 *
 * ── Variants ────────────────────────────────────────────────────────────────
 *   primary    filled brand red     the one main CTA on a surface
 *   secondary  quiet bordered       white surface, navy text, subtle border —
 *                                   the supporting action beside a primary
 *   outline    bordered, no fill    neutral / quiet action
 *   ghost      no fill, no border   toolbars, icon actions, row controls
 *   danger     filled status red    destructive only
 *   link       text only            inline action that must read as a link
 *
 * `danger` uses a DIFFERENT red from `primary` on purpose — brand red means
 * "this is the main action", status red means "this destroys something". One
 * hue for both would make every save button look like a delete button.
 *
 * ── The element it renders ──────────────────────────────────────────────────
 * `<a>` when `href` is set, `<button>` otherwise. Not cosmetic: an `<a>` without
 * href is not focusable and is announced as plain text, and a `<button>` used
 * for navigation breaks middle-click and open-in-new-tab.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { type ControlSize, type UiState } from '../tokens';
import './Button.recipe.css';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link';

/**
 * Intent, kept SEPARATE from emphasis.
 *
 * `variant` says how loud an action is; `tone` says what kind of action it is.
 * Conflating them forces every destructive action to be a filled red block —
 * but "Delete band", sitting quietly beside a primary Save, is destructive AND
 * low-emphasis. The legacy `.sfp-btn-danger` (white surface, red border, red
 * text) expressed exactly that, and it would have been lost on migration.
 *
 * Deliberately just two values. This is not the start of a tone system; it is
 * the one axis a real migration proved was missing.
 */
export type ButtonTone = 'default' | 'danger';

interface ButtonBase {
  variant?: ButtonVariant;
  /**
   * Intent. Composes with the quiet variants (`outline`, `ghost`, `secondary`)
   * to give a low-emphasis destructive action. `variant="danger"` remains the
   * filled treatment for the loud case; `tone` on it is redundant and ignored.
   */
  tone?: ButtonTone;
  size?: ControlSize;

  iconLeft?: VNode;
  iconRight?: VNode;

  /**
   * Blocks activation and marks the control `aria-busy`. Use for any submit that
   * hits the network: it prevents the double-submit that a `disabled` toggle set
   * one render too late does not.
   */
  loading?: boolean;
  /** Shown in place of the label while loading, e.g. "Saving…". */
  loadingText?: string;

  disabled?: boolean;
  fullWidth?: boolean;

  /**
   * Makes this a TOGGLE — a button that holds an on/off state (a filter that
   * stays applied, a pinned panel). Emits `aria-pressed`, which is announced
   * "pressed / not pressed"; `aria-checked` would wrongly say the user is in a
   * single-choice group.
   */
  pressed?: boolean;

  /** Renders an <a>. Use whenever the action is navigation. */
  href?: string;
  target?: '_blank';

  type?: 'button' | 'submit' | 'reset';
  onClick?: (e: MouseEvent) => void;
  title?: string;
  'aria-haspopup'?: 'menu' | 'dialog' | 'listbox' | 'true';
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  id?: string;
  class?: string;

  /**
   * Gallery-only: force a visual state that cannot be triggered synthetically
   * (`hover`, `focus`, `active`). Application code never sets this — genuine
   * states have real props. See src/ui/RECIPES.md §5.
   */
  forceState?: UiState;
}

/**
 * Icon-only REQUIRES an accessible name, enforced by the type rather than by a
 * lint rule or a reviewer noticing. This is what the deleted `IconButton`
 * wrapper existed to guarantee; the guarantee is kept, the component is not.
 */
interface IconOnlyButton extends ButtonBase {
  iconOnly: true;
  'aria-label': string;
  children?: never;
}

interface LabelledButton extends ButtonBase {
  iconOnly?: false;
  'aria-label'?: string;
  children: ComponentChildren;
}

export type ButtonProps = IconOnlyButton | LabelledButton;

/** States the recipe styles via `[data-ui-state~='…']` rather than a real prop. */
const FORCEABLE: ReadonlySet<UiState> = new Set(['hover', 'focus', 'active']);

/** The union is for CALLERS; inside, one widened object type so rest works. */
type ResolvedButtonProps = ButtonBase & {
  iconOnly?: boolean;
  'aria-label'?: string;
  children?: ComponentChildren;
};

export function Button(props: ButtonProps): VNode {
  const {
    variant = 'secondary',
    tone = 'default',
    size = 'md',
    iconLeft,
    iconRight,
    iconOnly = false,
    loading = false,
    loadingText,
    disabled = false,
    fullWidth = false,
    pressed,
    href,
    target,
    type = 'button',
    onClick,
    title,
    id,
    class: extra,
    forceState,
    children,
    ...aria
  } = props as ResolvedButtonProps;

  // Loading is a form of "not interactive", but it must NOT set `disabled`:
  // a disabled button leaves the tab order, so a user who tabbed to Save and
  // pressed Enter would have focus thrown to the top of the page mid-submit.
  const inert = disabled || loading;

  const cls = [
    'ui-btn',
    `ui-btn--${variant}`,
    size !== 'md' ? `ui-btn--${size}` : '',
    tone === 'danger' && variant !== 'danger' ? 'ui-btn--tone-danger' : '',
    iconOnly ? 'ui-btn--icon' : '',
    fullWidth ? 'ui-btn--full' : '',
    loading && loadingText ? 'ui-btn--loading-text' : '',
    extra ?? '',
  ].filter(Boolean).join(' ');

  const forced = forceState && FORCEABLE.has(forceState) ? forceState : undefined;

  const content = (
    <>
      {/* While loading the spinner stands IN PLACE OF the leading icon, so the
          button does not change width and the layout under the cursor holds. */}
      {loading ? <span class="ui-btn-spinner" aria-hidden="true" /> : iconLeft}
      {/* The label stays. `loadingText` is an explicit override, not the
          default: defaulting to it would have forced every migrated call site
          to invent new user-facing copy ("Saving…") that never existed. */}
      {loading && loadingText
        ? <span class="ui-btn-label ui-btn-label--loading">{loadingText}</span>
        : children != null && <span class="ui-btn-label">{children}</span>}
      {iconRight}
    </>
  );

  // Navigation renders a real link — but a DISABLED link is not a thing, so a
  // disabled `href` falls back to a button that cannot be followed.
  if (href && !inert) {
    return (
      <a
        id={id}
        class={cls}
        href={href}
        target={target}
        rel={target === '_blank' ? 'noopener noreferrer' : undefined}
        data-ui-state={forced}
        title={title}
        onClick={onClick}
        {...aria}
      >
        {content}
      </a>
    );
  }

  function handleClick(e: MouseEvent): void {
    if (inert) { e.preventDefault(); e.stopPropagation(); return; }
    onClick?.(e);
  }

  return (
    <button
      id={id}
      type={type}
      class={cls}
      disabled={disabled}
      aria-busy={loading ? 'true' : undefined}
      aria-pressed={pressed}
      data-ui-state={forced}
      onClick={handleClick}
      title={title}
      {...aria}
    >
      {content}
    </button>
  );
}
