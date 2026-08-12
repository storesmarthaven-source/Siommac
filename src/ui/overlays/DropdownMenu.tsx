/**
 * src/ui/overlays/DropdownMenu.tsx — the canonical action menu.
 *
 * Replaces `@ui/Menu`, `@ui/NewMenu`, `hrfin/RowActionMenu` and the row-`⋮`
 * menus each table grew privately. One implementation of the WAI-ARIA menu
 * pattern, so every menu in the app has the same keyboard model.
 *
 *   ↓ / ↑         move, skipping disabled items and wrapping at the ends
 *   Home / End    first / last item
 *   a–z           typeahead
 *   Enter/Space   activate
 *   Escape        close and return focus to the trigger
 *   Tab           close and let focus continue
 *
 * Unlike a listbox, a menu moves REAL DOM focus onto its items — that is what
 * the menu pattern specifies, and it is why `Tab` must close rather than walk
 * through the items.
 */

import { type VNode } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { AnchoredPopup } from './AnchoredPopup';
import '../primitives/actions.recipe.css';

export interface MenuAction {
  id: string;
  label: string;
  icon?: VNode;
  /** Keyboard hint shown right-aligned. Display only — bind the key yourself. */
  shortcut?: string;
  disabled?: boolean;
  /** Renders in the danger colour. Destructive actions must look destructive. */
  danger?: boolean;
  onSelect?: () => void;
}

export interface MenuGroup {
  /** Optional heading. Omit for an unlabelled group separated by a rule. */
  label?: string;
  items: readonly MenuAction[];
}

export type MenuItems = readonly MenuAction[] | readonly MenuGroup[];

function isGrouped(items: MenuItems): items is readonly MenuGroup[] {
  const first = items[0];
  return first !== undefined && 'items' in first;
}

function toGroups(items: MenuItems): readonly MenuGroup[] {
  return isGrouped(items) ? items : [{ items: items }];
}

export interface DropdownMenuProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  items: MenuItems;
  /** Accessible name for the menu itself. */
  label: string;
  /** Match the trigger's width (filter menus) or size to content (action menus). */
  matchAnchorWidth?: boolean;
  id?: string;
}

export function DropdownMenu({
  open, anchor, onClose, items, label, matchAnchorWidth = false, id,
}: DropdownMenuProps): VNode | null {
  const groups = toGroups(items);
  const flat = groups.flatMap(g => g.items);
  const [activeIndex, setActiveIndex] = useState(-1);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const typeBuffer = useRef({ text: '', at: 0 });

  const step = useCallback((from: number, dir: 1 | -1): number => {
    const n = flat.length;
    if (n === 0) return -1;
    for (let i = 1; i <= n; i++) {
      const idx = (((from + dir * i) % n) + n) % n;
      if (!flat[idx]?.disabled) return idx;
    }
    return -1;
  }, [flat]);

  // Opening focuses the first enabled item — a menu opened by keyboard that
  // leaves focus on the trigger needs a second ArrowDown to become usable.
  useEffect(() => {
    if (!open) { setActiveIndex(-1); return; }
    const first = flat.findIndex(i => !i.disabled);
    setActiveIndex(first);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  function activate(item: MenuAction): void {
    if (item.disabled) return;
    // Close BEFORE the handler: an action that opens a dialog must not have this
    // menu still mounted, or the dialog's focus trap fights the menu's.
    onClose();
    item.onSelect?.();
  }

  function onKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActiveIndex(i => step(i, 1)); return;
      case 'ArrowUp':   e.preventDefault(); setActiveIndex(i => step(i, -1)); return;
      case 'Home':      e.preventDefault(); setActiveIndex(flat.findIndex(i => !i.disabled)); return;
      case 'End': {
        e.preventDefault();
        for (let i = flat.length - 1; i >= 0; i--) { if (!flat[i]?.disabled) { setActiveIndex(i); break; } }
        return;
      }
      case 'Escape':
        // stopPropagation so closing a menu inside a dialog does not also close
        // the dialog.
        e.preventDefault(); e.stopPropagation(); onClose(); return;
      case 'Tab':
        onClose(); return;
      default: break;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const now = e.timeStamp || 0;
    const buf = typeBuffer.current;
    /* eslint-disable react-hooks/immutability -- a typeahead buffer must survive renders without causing one; that is what a ref is for */
    buf.text = now - buf.at < 1000 ? buf.text + e.key : e.key;
    buf.at = now;
    /* eslint-enable react-hooks/immutability */
    const found = flat.findIndex(i => !i.disabled && i.label.toLowerCase().startsWith(buf.text.toLowerCase()));
    if (found >= 0) { e.preventDefault(); setActiveIndex(found); }
  }

  if (!open) return null;

  // Flat index per group, computed up front. A counter incremented while
  // rendering is order-dependent and would silently desync from the keyboard
  // cursor if the tree were ever rendered out of order.
  const offsets: number[] = [];
  groups.reduce((acc, g) => { offsets.push(acc); return acc + g.items.length; }, 0);

  return (
    <AnchoredPopup
      open={open}
      anchor={anchor}
      onDismiss={onClose}
      matchAnchorWidth={matchAnchorWidth}
      role="menu"
      aria-label={label}
      id={id}
      class="ui-menu"
      onKeyDown={onKeyDown}
    >
      <div>
        {groups.map((group, gi) => (
          <div key={group.label ?? `g${gi}`} role="group" aria-label={group.label}>
            {gi > 0 && <div class="ui-menu-separator" role="separator" />}
            {group.label && <div class="ui-menu-label">{group.label}</div>}
            {group.items.map((item, oi) => {
              const i = (offsets[gi] ?? 0) + oi;
              return (
                <button
                  key={item.id}
                  ref={el => { itemRefs.current[i] = el; }}
                  type="button"
                  role="menuitem"
                  class="ui-menu-item"
                  data-active={i === activeIndex ? 'true' : 'false'}
                  data-danger={item.danger ? 'true' : undefined}
                  aria-disabled={item.disabled ? 'true' : undefined}
                  tabIndex={i === activeIndex ? 0 : -1}
                  onClick={() => activate(item)}
                  onPointerEnter={() => { if (!item.disabled) setActiveIndex(i); }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.shortcut && <span class="ui-menu-item-shortcut">{item.shortcut}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </AnchoredPopup>
  );
}
