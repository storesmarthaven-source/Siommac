/**
 * src/ui/overlays/AnchoredPopup.tsx — a portalled, anchor-positioned surface.
 *
 * The low-level primitive under Select, Combobox, PersonSearchSelect and (later)
 * DropdownMenu, Popover and Tooltip. One implementation of the three things that
 * every dropdown in this repo currently gets wrong somewhere:
 *
 *  1. PORTALLING. A `position: fixed` descendant of a TRANSFORMED ancestor
 *     positions against that ancestor and is clipped by its overflow.
 *     react-grid-layout translates every board tile, so a dropdown opened inside
 *     a widget renders inside the tile — the same bug that made the widget
 *     settings dialog render at 96px (see Modal.tsx). Portalling to <body> makes
 *     the surface independent of wherever it was invoked from.
 *
 *  2. COLLISION. Flips above the anchor when there is not enough room below, and
 *     clamps horizontally to the viewport, so a control near the bottom of the
 *     screen does not open into nothing.
 *
 *  3. DISMISSAL. Closes on outside pointerdown, on scroll of any ancestor, and
 *     on window resize — because a fixed surface anchored to a rect that has
 *     moved is worse than no surface at all.
 *
 * It deliberately does NOT trap focus. A listbox keeps DOM focus on its trigger
 * and drives the list with `aria-activedescendant`; trapping would break that.
 * Focus-trapping overlays use `useOverlayA11y` instead.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { usePortalRoot } from './portalRoot';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface AnchoredPopupProps {
  open: boolean;
  /** The element the surface is positioned against. */
  anchor: HTMLElement | null;
  onDismiss: () => void;
  /** Match the anchor's width (dropdowns) or size to content (menus). */
  matchAnchorWidth?: boolean;
  /** Horizontal relationship to the anchor when the surface sizes to content. */
  align?: 'start' | 'center' | 'end';
  /** Prefer a side or let collision detection choose one. */
  placement?: 'auto' | 'top' | 'bottom';
  /** Gap between anchor and surface, in px. */
  offset?: number;
  /** Max height before the surface scrolls internally. */
  maxHeight?: number;
  class?: string;
  id?: string;
  /** e.g. 'listbox' | 'menu' | 'dialog'. Typed as the DOM's own role union. */
  role?: 'listbox' | 'menu' | 'dialog' | 'tree' | 'grid';
  'aria-label'?: string;
  /**
   * Key handling for the whole surface. Attached HERE rather than to an inner
   * wrapper so a keydown from anywhere inside — including a focused menu item —
   * reaches it. A handler on a child only sees events that originate below it.
   */
  onKeyDown?: (e: KeyboardEvent) => void;
  /** Exposes the real portalled surface to semantic wrappers such as Popover. */
  onSurfaceMount?: (surface: HTMLDivElement | null) => void;
  children: ComponentChildren;
}

interface Position {
  top: number | undefined;
  bottom: number | undefined;
  left: number;
  width: number | undefined;
  maxHeight: number;
  placement: 'bottom' | 'top';
}

export function AnchoredPopup({
  open, anchor, onDismiss,
  matchAnchorWidth = true, align = 'start', placement = 'auto', offset = 4, maxHeight = 280,
  class: extra, id, role, onKeyDown, onSurfaceMount, children, ...aria
}: AnchoredPopupProps): VNode | null {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);

  // useLayoutEffect: measure and place before paint, or the surface is visible
  // for one frame at the wrong coordinates.
  useLayoutEffect(() => {
    if (!open || !anchor) { setPos(null); return; }

    function place(): void {
      const el = anchor;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom - offset - 8;
      const spaceAbove = r.top - offset - 8;

      // Flip up only when below genuinely cannot hold a usable list AND above is
      // roomier — flipping for a few pixels makes the surface jump around as the
      // list is filtered.
      const flip = placement === 'top'
        || (placement === 'auto' && spaceBelow < Math.min(maxHeight, 160) && spaceAbove > spaceBelow);
      const available = Math.max(120, flip ? spaceAbove : spaceBelow);
      const height = Math.min(maxHeight, available);

      const width = matchAnchorWidth ? r.width : undefined;
      const rawLeft = r.left;
      const surfaceWidth = width ?? surfaceRef.current?.offsetWidth ?? r.width;
      const alignedLeft = matchAnchorWidth || align === 'start'
        ? rawLeft
        : align === 'center'
          ? r.left + (r.width - surfaceWidth) / 2
          : r.right - surfaceWidth;
      const left = Math.max(8, Math.min(alignedLeft, window.innerWidth - surfaceWidth - 8));

      setPos({
        // A top-placed surface uses `bottom`, not an estimated `top`. Its
        // content height is unknown until the portal renders; subtracting the
        // maximum height left short popovers floating hundreds of pixels above
        // their trigger.
        top: flip ? undefined : r.bottom + offset,
        bottom: flip ? window.innerHeight - r.top + offset : undefined,
        left,
        width,
        maxHeight: height,
        placement: flip ? 'top' : 'bottom',
      });
    }

    place();

    // `capture: true` on scroll so an ancestor scroll container is heard — a
    // scroll event from a nested element does not bubble.
    const onScroll = (): void => onDismiss();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchor, matchAnchorWidth, align, placement, offset, maxHeight, onDismiss]);

  // Content-sized surfaces cannot be horizontally centred/clamped until their
  // real width exists. Correct the provisional anchor-width measurement in the
  // same layout phase, before the browser paints the portal.
  useLayoutEffect(() => {
    if (!open || !anchor || !pos || matchAnchorWidth || !surfaceRef.current) return;
    const r = anchor.getBoundingClientRect();
    const surfaceWidth = surfaceRef.current.offsetWidth;
    const raw = align === 'center'
      ? r.left + (r.width - surfaceWidth) / 2
      : align === 'end'
        ? r.right - surfaceWidth
        : r.left;
    const left = Math.max(8, Math.min(raw, window.innerWidth - surfaceWidth - 8));
    if (Math.abs(left - pos.left) > 0.5) setPos(current => current ? { ...current, left } : current);
  }, [open, anchor, matchAnchorWidth, align, pos]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      const t = e.target as Node;
      // A click on the anchor is the trigger's own business (it toggles); only
      // dismiss for clicks genuinely outside both.
      if (surfaceRef.current?.contains(t)) return;
      if (anchor?.contains(t)) return;
      onDismiss();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, anchor, onDismiss]);

  // Unconditional: every hook must run on every render, and the early return
  // below is the first place this component can bail out.
  const portalRoot = usePortalRoot();

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={(node) => {
        surfaceRef.current = node;
        onSurfaceMount?.(node);
      }}
      id={id}
      role={role}
      class={`ui-popup${extra ? ` ${extra}` : ''}`}
      data-placement={pos.placement}
      style={{
        position: 'fixed',
        top: pos.top == null ? undefined : `${pos.top}px`,
        bottom: pos.bottom == null ? undefined : `${pos.bottom}px`,
        left: `${pos.left}px`,
        width: pos.width != null ? `${pos.width}px` : undefined,
        maxHeight: `${pos.maxHeight}px`,
      }}
      onKeyDown={onKeyDown}
      {...aria}
    >
      {children}
    </div>,
    // Not `document.body` directly — a themed region (the Gallery preview)
    // can supply its own root so the popup inherits its scoped tokens.
    portalRoot,
  );
}
