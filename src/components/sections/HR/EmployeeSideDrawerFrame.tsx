import { type ComponentChildren, type VNode } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { usePortalRoot } from '../../../ui/overlays/portalRoot';
import { ProfileIconSprite } from './profile/ProfileIconSprite';
import './ProfileDrawer.mockup.css';
import './ProfileDrawer.css';

const DRAWER_MOTION_MS = 150;
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface EmployeeSideDrawerFrameProps {
  /** Whether the frame is open. Closing content stays mounted for the exit motion. */
  open?: boolean;
  /** Accessible name for the modal sheet. */
  label?: string;
  /** Called by backdrop dismissal or the default Escape-key behaviour. */
  onClose: () => void;
  /** Lets a composition close an inner dialog before closing the sheet itself. */
  onEscape?: (() => void) | undefined;
  /** Backdrop dismissal is enabled by default. */
  closeOnBackdrop?: boolean;
  /** Optional composition class for Studio templates or domain-specific skins. */
  className?: string | undefined;
  children: ComponentChildren;
}

/**
 * The canonical viewport frame extracted from HR Employee Master.
 *
 * It deliberately owns only modal behaviour and the approved employee-drawer
 * canvas. Header, identity, tabs, body and footer remain slots in the composed
 * template, so another business drawer can reuse the frame without inheriting
 * employee data or permissions.
 */
export function EmployeeSideDrawerFrame({
  open = true,
  label = 'Employee profile',
  onClose,
  onEscape,
  closeOnBackdrop = true,
  className,
  children,
}: EmployeeSideDrawerFrameProps): VNode | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const [displayChildren, setDisplayChildren] = useState<ComponentChildren>(children);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [rendered, setRendered] = useState(open);
  const [active, setActive] = useState(false);
  const portalRoot = usePortalRoot();

  useEffect(() => {
    if (open) setDisplayChildren(children);
  }, [children, open]);

  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    let closeTimer = 0;

    if (open) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setRendered(true);
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setActive(true));
      });
    } else if (rendered) {
      setActive(false);
      closeTimer = window.setTimeout(() => {
        setRendered(false);
        restoreFocusRef.current?.focus();
        restoreFocusRef.current = null;
      }, DRAWER_MOTION_MS);
    }

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(closeTimer);
    };
  }, [open, rendered]);

  useEffect(() => {
    if (!active) return undefined;
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [active]);

  useEffect(() => () => {
    restoreFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!active) return undefined;

    function keepFocusInside(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        (onEscape ?? onClose)();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(element => !element.hidden && element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    window.addEventListener('keydown', keepFocusInside);
    return () => window.removeEventListener('keydown', keepFocusInside);
  }, [active, onClose, onEscape]);

  if (!rendered) return null;

  const motionClass = active ? ' is-open' : ' is-closing';

  return createPortal(
    <div
      class={`epd-overlay${motionClass}${className ? ` ${className}__overlay` : ''}`}
      role="presentation"
      onClick={event => {
        if (closeOnBackdrop && active && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-hidden={!active}
        class={`epd-root${className ? ` ${className}` : ''}`}
      >
        <ProfileIconSprite />
        {displayChildren}
      </div>
    </div>,
    portalRoot,
  );
}
