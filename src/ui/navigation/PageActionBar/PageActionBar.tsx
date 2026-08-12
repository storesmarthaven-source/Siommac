/**
 * The canonical page-level action row.
 *
 * Action behaviour stays with Button and DropdownMenu. This component owns the
 * page relationship only: supporting status/content on the left, visible
 * secondary and primary actions on the right, and a canonical overflow menu.
 */
import { type ComponentChildren, type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '../../primitives/Button';
import { LucideIcon } from '../../LucideIcon';
import { DropdownMenu, type MenuItems } from '../../overlays/DropdownMenu';
import './pageActionBar.recipe.css';

export interface PageActionBarProps {
  /** Accessible name for the action group. */
  label: string;
  /** Context or status aligned opposite the actions. */
  start?: ComponentChildren;
  /** Visible supporting actions. Consumers compose canonical Buttons here. */
  secondary?: ComponentChildren;
  /** The single main page action. */
  primary?: ComponentChildren;
  /** Lower-frequency actions rendered in the canonical menu. */
  overflow?: MenuItems;
  class?: string;
}

export function PageActionBar({
  label, start, secondary, primary, overflow, class: extra,
}: PageActionBarProps): VNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const hasOverflow = (overflow?.length ?? 0) > 0;

  return (
    <div class={`ui-page-actions${extra ? ` ${extra}` : ''}`} role="group" aria-label={label}>
      {start != null && <div class="ui-page-actions-start">{start}</div>}
      <div class="ui-page-actions-end">
        {secondary}
        {primary}
        {hasOverflow && (
          <span ref={setMenuAnchor} class="ui-page-actions-overflow">
            <Button
              iconOnly
              aria-label="More page actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              variant="secondary"
              iconLeft={<LucideIcon name="Ellipsis" />}
              onClick={() => setMenuOpen(open => !open)}
            />
            <DropdownMenu
              open={menuOpen}
              anchor={menuAnchor}
              onClose={() => setMenuOpen(false)}
              items={overflow ?? []}
              label={`${label} — more`}
            />
          </span>
        )}
      </div>
    </div>
  );
}
