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
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface AnchoredPopupProps {
  open: boolean;
  /** The element the surface is positioned against. */
  anchor: HTMLElement | null;
  /** Viewport point for cursor/context menus that have no durable DOM trigger. */
  anchorPoint?: { x: number; y: number } | null;
  /** Optional collision boundary. Defaults to the browser viewport. */
  boundary?: HTMLElement | null;
  onDismiss: () => void;
  /** Match the anchor's width (dropdowns) or size to content (menus). */
  matchAnchorWidth?: boolean;
  /** Horizontal relationship to the anchor when the surface sizes to content. */
  align?: 'start' | 'center' | 'end';
  /** Prefer a side or let collision detection choose one. */
  placement?: 'auto' | 'top' | 'bottom' | 'left' | 'right';
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
  maxWidth: number;
  placement: 'bottom' | 'top' | 'left' | 'right';
}

export function AnchoredPopup({
  open, anchor, anchorPoint = null, boundary = null, onDismiss,
  matchAnchorWidth = true, align = 'start', placement = 'auto', offset = 4, maxHeight = 280,
  class: extra, id, role, onKeyDown, onSurfaceMount, children, ...aria
}: AnchoredPopupProps): VNode | null {
  const popupId = `ui-popup-${useId()}`;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const parentPopup = anchor?.closest<HTMLElement>('.ui-popup') ?? null;
  const popupAncestors = [
    parentPopup?.dataset.uiPopupId,
    ...(parentPopup?.dataset.uiPopupAncestors?.split(' ').filter(Boolean) ?? []),
  ].filter((value): value is string => Boolean(value));
  const overlayOrigin = anchor?.closest<HTMLElement>('.hdr-modal-overlay')?.id
    ?? parentPopup?.dataset.uiOverlayOrigin;

  // useLayoutEffect: measure and place before paint, or the surface is visible
  // for one frame at the wrong coordinates.
  useLayoutEffect(() => {
    if (!open || (!anchor && !anchorPoint)) { setPos(null); return; }

    function place(): void {
      const r = anchor?.getBoundingClientRect() ?? (anchorPoint ? {
        top: anchorPoint.y,
        right: anchorPoint.x,
        bottom: anchorPoint.y,
        left: anchorPoint.x,
        width: 0,
        height: 0,
      } : null);
      if (!r) return;
      const boundaryRect = boundary?.getBoundingClientRect();
      const bounds = {
        top: Math.max(0, boundaryRect?.top ?? 0),
        right: Math.min(window.innerWidth, boundaryRect?.right ?? window.innerWidth),
        bottom: Math.min(window.innerHeight, boundaryRect?.bottom ?? window.innerHeight),
        left: Math.max(0, boundaryRect?.left ?? 0),
      };
      const inset = 8;
      const minLeft = bounds.left + inset;
      const maxRight = bounds.right - inset;
      const minTop = bounds.top + inset;
      const maxBottom = bounds.bottom - inset;
      const boundaryMaxWidth = Math.max(1, maxRight - minLeft);
      const surfaceWidth = matchAnchorWidth ? r.width : surfaceRef.current?.offsetWidth ?? r.width;

      if (placement === 'left' || placement === 'right') {
        const spaceRight = maxRight - r.right - offset;
        const spaceLeft = r.left - offset - minLeft;
        const resolvedSide = placement === 'right' && spaceRight < surfaceWidth && spaceLeft > spaceRight
          ? 'left'
          : placement === 'left' && spaceLeft < surfaceWidth && spaceRight > spaceLeft
            ? 'right'
            : placement;
        const left = resolvedSide === 'right' ? r.right + offset : r.left - surfaceWidth - offset;
        setPos({
          top: Math.max(minTop, Math.min(r.top, maxBottom - Math.min(maxHeight, maxBottom - minTop))),
          bottom: undefined,
          left: Math.max(minLeft, Math.min(left, maxRight - Math.min(surfaceWidth, boundaryMaxWidth))),
          width: matchAnchorWidth ? r.width : undefined,
          maxHeight: Math.min(maxHeight, maxBottom - minTop),
          maxWidth: boundaryMaxWidth,
          placement: resolvedSide,
        });
        return;
      }
      const spaceBelow = maxBottom - r.bottom - offset;
      const spaceAbove = r.top - offset - minTop;

      // Flip up only when below genuinely cannot hold a usable list AND above is
      // roomier — flipping for a few pixels makes the surface jump around as the
      // list is filtered.
      const flip = placement === 'top'
        || (placement === 'auto' && spaceBelow < Math.min(maxHeight, 160) && spaceAbove > spaceBelow);
      const available = Math.max(120, flip ? spaceAbove : spaceBelow);
      const height = Math.min(maxHeight, available);

      const width = matchAnchorWidth ? r.width : undefined;
      const rawLeft = r.left;
      const resolvedSurfaceWidth = width ?? surfaceRef.current?.offsetWidth ?? r.width;
      const alignedLeft = matchAnchorWidth || align === 'start'
        ? rawLeft
        : align === 'center'
          ? r.left + (r.width - resolvedSurfaceWidth) / 2
          : r.right - resolvedSurfaceWidth;
      const left = Math.max(minLeft, Math.min(alignedLeft, maxRight - Math.min(resolvedSurfaceWidth, boundaryMaxWidth)));

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
        maxWidth: boundaryMaxWidth,
        placement: flip ? 'top' : 'bottom',
      });
    }

    place();

    // `capture: true` hears ancestor/page scrolling even though scroll events
    // do not bubble. Scrolling the popup itself is normal list interaction and
    // must never dismiss it (mouse-wheel scrolling used to close every Select,
    // Combobox and action menu on the first wheel tick).
    const onScroll = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && surfaceRef.current?.contains(target)) return;
      onDismiss();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchor, anchorPoint, boundary, matchAnchorWidth, align, placement, offset, maxHeight, onDismiss]);

  // Content-sized surfaces cannot be horizontally centred/clamped or reliably
  // collision-tested until their real dimensions exist. Correct the provisional
  // placement in the same layout phase, before the browser paints the portal.
  // This second vertical check matters for form popovers: a surface can have
  // more than the 160px "usable list" threshold while still clipping its footer.
  useLayoutEffect(() => {
    if (!open || (!anchor && !anchorPoint) || !pos || !surfaceRef.current) return;
    const r = anchor?.getBoundingClientRect() ?? (anchorPoint ? {
      top: anchorPoint.y,
      right: anchorPoint.x,
      bottom: anchorPoint.y,
      left: anchorPoint.x,
      width: 0,
      height: 0,
    } : null);
    if (!r) return;
    const boundaryRect = boundary?.getBoundingClientRect();
    const bounds = {
      top: Math.max(0, boundaryRect?.top ?? 0) + 8,
      right: Math.min(window.innerWidth, boundaryRect?.right ?? window.innerWidth) - 8,
      bottom: Math.min(window.innerHeight, boundaryRect?.bottom ?? window.innerHeight) - 8,
      left: Math.max(0, boundaryRect?.left ?? 0) + 8,
    };
    const surface = surfaceRef.current;
    if (pos.placement === 'left' || pos.placement === 'right') {
      const surfaceWidth = surface.offsetWidth;
      const surfaceHeight = Math.min(surface.offsetHeight, pos.maxHeight);
      const spaceRight = bounds.right - r.right - offset;
      const spaceLeft = r.left - offset - bounds.left;
      const resolvedSide = placement === 'right' && spaceRight < surfaceWidth && spaceLeft > spaceRight
        ? 'left'
        : placement === 'left' && spaceLeft < surfaceWidth && spaceRight > spaceLeft
          ? 'right'
          : placement === 'left' ? 'left' : 'right';
      const left = resolvedSide === 'right' ? r.right + offset : r.left - surfaceWidth - offset;
      const top = Math.max(bounds.top, Math.min(r.top, bounds.bottom - surfaceHeight));
      const clampedLeft = Math.max(bounds.left, Math.min(left, bounds.right - Math.min(surfaceWidth, pos.maxWidth)));
      if (resolvedSide !== pos.placement || Math.abs(clampedLeft - pos.left) > 0.5 || Math.abs(top - (pos.top ?? 0)) > 0.5) {
        setPos(current => current ? { ...current, left: clampedLeft, top, bottom: undefined, placement: resolvedSide } : current);
      }
      return;
    }
    let left = pos.left;
    if (!matchAnchorWidth) {
      const surfaceWidth = surface.offsetWidth;
      const raw = align === 'center'
        ? r.left + (r.width - surfaceWidth) / 2
        : align === 'end'
          ? r.right - surfaceWidth
          : r.left;
      left = Math.max(bounds.left, Math.min(raw, bounds.right - Math.min(surfaceWidth, pos.maxWidth)));
    }

    const spaceBelow = bounds.bottom - r.bottom - offset;
    const spaceAbove = r.top - offset - bounds.top;
    const shouldFlipForMeasuredContent = placement === 'auto'
      && pos.placement === 'bottom'
      && surface.scrollHeight > pos.maxHeight + 1
      && spaceAbove > spaceBelow + 24;

    if (Math.abs(left - pos.left) > 0.5 || shouldFlipForMeasuredContent) {
      setPos(current => current ? {
        ...current,
        left,
        ...(shouldFlipForMeasuredContent ? {
          top: undefined,
          bottom: window.innerHeight - r.top + offset,
          maxHeight: Math.min(maxHeight, Math.max(120, spaceAbove)),
          placement: 'top' as const,
        } : {}),
      } : current);
    }
  }, [open, anchor, anchorPoint, boundary, matchAnchorWidth, align, placement, offset, maxHeight, pos]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      const t = e.target as Node;
      // A click on the anchor is the trigger's own business (it toggles); only
      // dismiss for clicks genuinely outside both.
      if (surfaceRef.current?.contains(t)) return;
      if (anchor?.contains(t)) return;
      // A modal alert opened by a control inside this surface temporarily owns
      // interaction. Keep the underlying menu mounted so its state and focus
      // context are intact when the alert resolves.
      if (t instanceof Element && t.closest('.cpop')) return;
      const clickedPopup = e.composedPath().find(node => node instanceof HTMLElement && node.matches('.ui-popup'));
      if (clickedPopup instanceof HTMLElement) {
        const ancestors = clickedPopup.dataset.uiPopupAncestors?.split(' ').filter(Boolean) ?? [];
        if (ancestors.includes(popupId)) return;
      }
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
      data-ui-popup-id={popupId}
      data-ui-popup-ancestors={popupAncestors.length > 0 ? popupAncestors.join(' ') : undefined}
      data-ui-overlay-origin={overlayOrigin}
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
        maxWidth: `${pos.maxWidth}px`,
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
