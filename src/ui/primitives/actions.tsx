/**
 * src/ui/primitives/actions.tsx — action controls that are NOT just a Button.
 *
 *   SegmentedControl  ONE value, several options — a radiogroup with roving focus
 *   DropdownButton    a trigger that owns menu state and its ARIA wiring
 *   SplitButton       a default action plus a menu of alternatives
 *
 * `LinkButton` and `ToggleButton` used to live here and have been deleted: both
 * were fixed-prop wrappers over `Button`, adding a name to learn and nothing
 * else. They are now `<Button href>` and `<Button pressed>`.
 *
 * The three that remain each own real behaviour a caller would otherwise
 * reimplement. SegmentedControl carries radiogroup semantics and arrow-key
 * movement — which is what separates it from a `ButtonGroup` of independent
 * actions, and changes what a screen reader announces. DropdownButton and
 * SplitButton own the anchor, the open state, the `aria-expanded`/`aria-controls`
 * pair and focus return; inline that is five things per call site to get wrong.
 */

import { type VNode } from 'preact';
import { useCallback, useId, useRef, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { type ControlSize, type UiState } from '../tokens';
import { DropdownMenu, type MenuItems, type MenuAction } from '../overlays/DropdownMenu';
import { Button, type ButtonVariant } from './Button';
import './Button.recipe.css';
import './actions.recipe.css';

/* ── SegmentedControl ──────────────────────────────────────────────────────*/

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: VNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Accessible name for the group. Required — an unnamed radiogroup is unusable. */
  label: string;
  size?: ControlSize;
  fullWidth?: boolean;
  disabled?: boolean;
  forceState?: UiState;
  class?: string;
}

export function SegmentedControl<T extends string>({
  value, onChange, options, label, fullWidth = false, disabled = false, forceState, class: extra,
}: SegmentedControlProps<T>): VNode {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Roving focus + arrow-key movement: the radiogroup pattern puts ONE option in
  // the tab order and moves between them with arrows, so Tab skips the whole
  // control rather than stepping through every option.
  const move = useCallback((from: number, dir: 1 | -1) => {
    const n = options.length;
    for (let i = 1; i <= n; i++) {
      const idx = (((from + dir * i) % n) + n) % n;
      if (!options[idx]?.disabled) {
        onChange(options[idx]!.value);
        refs.current[idx]?.focus();
        return;
      }
    }
  }, [options, onChange]);

  const selectedIndex = options.findIndex(o => o.value === value);

  return (
    <div
      class={`ui-segmented${fullWidth ? ' ui-segmented--full' : ''}${extra ? ` ${extra}` : ''}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((opt, i) => {
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="radio"
            class="ui-segmented-item"
            aria-checked={checked}
            disabled={disabled || opt.disabled}
            tabIndex={checked || (selectedIndex < 0 && i === 0) ? 0 : -1}
            data-ui-state={forceState === 'hover' || forceState === 'focus' ? forceState : undefined}
            onClick={() => onChange(opt.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
              if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); move(i, -1); }
            }}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── DropdownButton ────────────────────────────────────────────────────────*/

export interface DropdownButtonProps {
  label: string;
  items: MenuItems;
  variant?: ButtonVariant;
  size?: ControlSize;
  iconLeft?: VNode;
  disabled?: boolean;
  /** Match the menu width to the trigger — right for filters, wrong for actions. */
  matchWidth?: boolean;
  forceState?: UiState;
  class?: string;
}

/** A button whose only job is to open a menu. */
export function DropdownButton({
  label, items, variant = 'outline', size = 'md', iconLeft,
  disabled = false, matchWidth = false, forceState, class: extra,
}: DropdownButtonProps): VNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const uid = useId();
  const menuId = `dd${uid}`;

  return (
    <>
      <span ref={setAnchor} style={{ display: 'inline-flex' }}>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          iconLeft={iconLeft}
          iconRight={<LucideIcon name="ChevronDown" class="ui-btn-chevron" />}
          forceState={forceState}
          class={extra}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(o => !o)}
        >
          {label}
        </Button>
      </span>
      <DropdownMenu
        id={menuId}
        open={open}
        anchor={anchor}
        onClose={() => { setOpen(false); anchor?.querySelector('button')?.focus(); }}
        items={items}
        label={label}
        matchAnchorWidth={matchWidth}
      />
    </>
  );
}

/* ── SplitButton ───────────────────────────────────────────────────────────*/

export interface SplitButtonProps {
  /** The default action — the one the label describes. */
  action: Omit<MenuAction, 'id'> & { id?: string };
  /** The alternatives, shown in the menu half. */
  items: MenuItems;
  variant?: ButtonVariant;
  size?: ControlSize;
  disabled?: boolean;
  loading?: boolean;
  /** Accessible name for the menu half, e.g. "More save options". */
  menuLabel?: string;
  forceState?: UiState;
  class?: string;
}

/**
 * A primary action plus a menu of alternatives — "Save" with "Save and close",
 * "Save as draft" behind the chevron.
 *
 * Two real buttons, never one that guesses which half was clicked: a single
 * element cannot be operated unambiguously by keyboard, and on touch the split
 * point is invisible.
 */
export function SplitButton({
  action, items, variant = 'primary', size = 'md',
  disabled = false, loading = false, menuLabel, forceState, class: extra,
}: SplitButtonProps): VNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const uid = useId();
  const menuId = `sp${uid}`;
  const label = menuLabel ?? `More ${action.label.toLowerCase()} options`;

  return (
    <>
      <span ref={setAnchor} class={`ui-split${extra ? ` ${extra}` : ''}`}>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          loading={loading}
          iconLeft={action.icon}
          forceState={forceState}
          onClick={() => action.onSelect?.()}
        >
          {action.label}
        </Button>
        <Button
          variant={variant}
          size={size}
          disabled={disabled || loading}
          iconOnly
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          iconLeft={<LucideIcon name="ChevronDown" class="ui-btn-chevron" />}
          onClick={() => setOpen(o => !o)}
        />
      </span>
      <DropdownMenu
        id={menuId}
        open={open}
        anchor={anchor}
        onClose={() => { setOpen(false); anchor?.querySelectorAll('button')[1]?.focus(); }}
        items={items}
        label={label}
      />
    </>
  );
}
