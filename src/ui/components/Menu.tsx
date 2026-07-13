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
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { LucideIcon, type LucideName } from '../LucideIcon';

// Menu items pass Font Awesome names (legacy); render them as the app-standard Lucide icons,
// inline (no chip background). Anything unmapped falls back to a chevron.
const MENU_LUCIDE: Record<string, LucideName> = {
  'fa-angle-right': 'ChevronRight', 'fa-chevron-right': 'ChevronRight',
  'fa-pen': 'Pencil', 'fa-pencil': 'Pencil', 'fa-edit': 'Pencil',
  'fa-file': 'FileText', 'fa-file-lines': 'FileText',
  'fa-file-shield': 'ShieldCheck', 'fa-shield': 'ShieldCheck',
  'fa-clock-rotate-left': 'RotateCcw', 'fa-clock': 'Clock', 'fa-history': 'RotateCcw',
  'fa-triangle-exclamation': 'TriangleAlert', 'fa-exclamation-triangle': 'TriangleAlert',
  'fa-trash': 'Trash2', 'fa-download': 'Download', 'fa-upload': 'Upload',
  'fa-check': 'Check', 'fa-xmark': 'X', 'fa-times': 'X', 'fa-eye': 'Eye',
  'fa-users': 'Users', 'fa-user': 'UserRound', 'fa-plus': 'Plus',
};
const menuLucide = (fa: string): LucideName => MENU_LUCIDE[fa] ?? 'ChevronRight';

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
  // Popup position, measured from the trigger wrap at open time. The popup PORTALS to
  // <body> with fixed positioning, so an ancestor's `overflow` (e.g. the rich drawer's
  // scroll body) can never clip or swallow it.
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggle = (e: Event) => {
    e.stopPropagation();
    if (!open && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setPos({
        top: Math.round(r.bottom + 8),
        ...(align === 'right'
          ? { right: Math.max(8, Math.round(window.innerWidth - r.right)) }
          : { left: Math.max(8, Math.round(r.left)) }),
      });
    }
    setOpen(o => !o);
  };
  // Escape closes. (No scroll/resize close — a capture-phase scroll listener fires the instant
  // the popup opens, which reads as "the menu never opened"; outside-click via the overlay is
  // enough, matching the DataTable ⋮ menu.)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);
  return (
    <div class="ui-menu-wrap" ref={wrapRef}>
      {trigger({ open, toggle })}
      {open && createPortal(
        <div class="ui-menu-overlay" onClick={e => { if (e.target === e.currentTarget) { e.stopPropagation(); setOpen(false); } }}>
          <div class={`ui-menu is-${align}`} role="menu"
            style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right }}
            onClick={e => e.stopPropagation()}>
            {items.map(it => (
              <button
                key={it.label} type="button" role="menuitem"
                class={`ui-menu-item${it.danger ? ' danger' : ''}`} disabled={it.disabled}
                onClick={() => { setOpen(false); it.onSelect(); }}
              >
                {it.icon && <LucideIcon name={menuLucide(it.icon)} size={16} strokeWidth={2} class="ui-menu-ico" />}
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
