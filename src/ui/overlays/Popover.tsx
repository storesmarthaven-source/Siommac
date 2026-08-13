/**
 * A non-modal, anchor-positioned dialog surface.
 *
 * Positioning, collision and dismissal stay in AnchoredPopup. Popover adds the
 * semantic contract: an accessible name, Escape handling, optional initial
 * focus and focus return after a keyboard dismissal.
 */
import { type ComponentChildren, type VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { AnchoredPopup } from './AnchoredPopup';
import '../forms/listbox.recipe.css';
import './overlays.recipe.css';

export interface PopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Required because the surface uses role="dialog". */
  label: string;
  children: ComponentChildren;
  id?: string;
  class?: string;
  matchAnchorWidth?: boolean;
  align?: 'start' | 'center' | 'end';
  offset?: number;
  maxHeight?: number;
  /** Move focus to the first interactive descendant after opening. */
  initialFocus?: boolean;
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Popover({
  open, anchor, onClose, label, children, id, class: extra,
  matchAnchorWidth = false, align = 'start', offset = 8, maxHeight = 360,
  initialFocus = false,
}: PopoverProps): VNode | null {
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !initialFocus) return;
    surfaceRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open, initialFocus]);

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
    anchor?.focus();
  }

  return (
    <AnchoredPopup
      open={open}
      anchor={anchor}
      onDismiss={onClose}
      matchAnchorWidth={matchAnchorWidth}
      align={align}
      offset={offset}
      maxHeight={maxHeight}
      id={id}
      role="dialog"
      aria-label={label}
      class={`ui-popover${extra ? ` ${extra}` : ''}`}
      onSurfaceMount={(surface) => { surfaceRef.current = surface; }}
      onKeyDown={onKeyDown}
    >
      {children}
    </AnchoredPopup>
  );
}
