/**
 * src/ui/components/Menu.tsx
 *
 * The app-wide dropdown MENU — a trigger plus a list of actions, with built-in
 * open state and outside-click dismissal (a transparent fixed overlay catches
 * the outside click, so callers don't wire document listeners).
 *
 * Used for kebab menus, "More actions", and "More tabs" overflow on the rich
 * SidePanel/Drawer. Styled by `.ui-menu*` in assets/styles/uikit-overlay.css.
 *
 *   <Menu align="right" items={[
 *     { label: 'Request Change', icon: 'fa-pen', onSelect: …},
 *     { label: 'Start Offboarding', icon: 'fa-triangle-exclamation', danger: true, onSelect: … },
 *   ]} trigger={({ toggle }) => (
 *     <button class="ui-icon-action" onClick={toggle} aria-label="More">⋮</button>
 *   )} />
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export interface MenuItem {
  label: string;
  /** FontAwesome class, e.g. 'fa-pen'. */
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  items: MenuItem[];
  /** Which edge the menu aligns to (default 'right'). */
  align?: 'left' | 'right';
  /** Render the trigger; `toggle` opens/closes, `open` reflects state. */
  trigger: (o: { open: boolean; toggle: (e: Event) => void }) => ComponentChildren;
}

export function Menu({ items, align = 'right', trigger }: MenuProps): VNode {
  const [open, setOpen] = useState(false);
  const toggle = (e: Event) => { e.stopPropagation(); setOpen(o => !o); };
  // Escape closes the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);
  return (
    <div class="ui-menu-wrap">
      {trigger({ open, toggle })}
      {open && (
        <>
          <div class="ui-menu-overlay" onClick={e => { e.stopPropagation(); setOpen(false); }} />
          <div class={`ui-menu is-${align}`} role="menu" onClick={e => e.stopPropagation()}>
            {items.map(it => (
              <button
                key={it.label} type="button" role="menuitem"
                class={`ui-menu-item${it.danger ? ' danger' : ''}`} disabled={it.disabled}
                onClick={() => { setOpen(false); it.onSelect(); }}
              >
                {it.icon && <span class="ui-menu-ico"><i class={`fas ${it.icon}`} /></span>}
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
