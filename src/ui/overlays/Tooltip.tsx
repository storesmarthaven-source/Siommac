/** Hover/focus help for any single element, portalled so cards cannot clip it. */
import { cloneElement, type ComponentChildren, type VNode } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { AnchoredPopup } from './AnchoredPopup';
import '../forms/listbox.recipe.css';
import './overlays.recipe.css';

type TriggerEvent = Event & { currentTarget: EventTarget & HTMLElement };
type TriggerHandler = (event: TriggerEvent) => void;
interface TooltipTriggerProps {
  'aria-describedby'?: string;
  onMouseEnter?: TriggerHandler;
  onMouseLeave?: TriggerHandler;
  onFocusIn?: TriggerHandler;
  onFocusOut?: TriggerHandler;
  onKeyDown?: (event: KeyboardEvent) => void;
  children?: ComponentChildren;
}

export interface TooltipProps {
  content: ComponentChildren;
  /** Exactly one element. Its existing event handlers are preserved. */
  children: VNode<TooltipTriggerProps>;
  id?: string;
  disabled?: boolean;
  showDelay?: number;
  hideDelay?: number;
  maxWidth?: number;
  placement?: 'auto' | 'top' | 'bottom';
}

export function Tooltip({
  content, children, id: providedId, disabled = false,
  showDelay = 350, hideDelay = 80, maxWidth = 260, placement = 'auto',
}: TooltipProps): VNode {
  const uid = useId();
  const id = providedId ?? `ui-tooltip-${uid}`;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers(): void {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    showTimerRef.current = null;
    hideTimerRef.current = null;
  }

  useEffect(() => () => clearTimers(), []);

  function show(target: HTMLElement, delayed: boolean): void {
    clearTimers();
    if (disabled) return;
    setAnchor(target);
    if (delayed && showDelay > 0) showTimerRef.current = setTimeout(() => setOpen(true), showDelay);
    else setOpen(true);
  }

  function hide(delayed: boolean): void {
    clearTimers();
    if (delayed && hideDelay > 0) hideTimerRef.current = setTimeout(() => setOpen(false), hideDelay);
    else setOpen(false);
  }

  const original = children.props;
  /* eslint-disable react-hooks/refs -- Preact's VNode type has an optional ref, but cloneElement does not read it here; this rule cannot distinguish the VNode from a RefObject. */
  const trigger = cloneElement(children, {
    'aria-describedby': disabled ? original['aria-describedby'] : [original['aria-describedby'], id].filter(Boolean).join(' '),
    onMouseEnter: (e: TriggerEvent) => { original.onMouseEnter?.(e); show(e.currentTarget, true); },
    onMouseLeave: (e: TriggerEvent) => { original.onMouseLeave?.(e); hide(true); },
    onFocusIn: (e: TriggerEvent) => { original.onFocusIn?.(e); show(e.currentTarget, false); },
    onFocusOut: (e: TriggerEvent) => { original.onFocusOut?.(e); hide(false); },
    onKeyDown: (e: KeyboardEvent) => {
      original.onKeyDown?.(e);
      if (e.key === 'Escape' && open) { e.stopPropagation(); hide(false); }
    },
  });
  /* eslint-enable react-hooks/refs */

  return (
    <>
      {trigger}
      <AnchoredPopup
        open={open}
        anchor={anchor}
        onDismiss={() => hide(false)}
        matchAnchorWidth={false}
        align="center"
        placement={placement}
        offset={8}
        maxHeight={120}
        id={id}
        class="ui-tooltip"
      >
        <span role="tooltip" style={{ maxWidth: `${maxWidth}px` }}>{content}</span>
      </AnchoredPopup>
    </>
  );
}
