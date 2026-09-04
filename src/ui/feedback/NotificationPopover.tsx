import { type ComponentChildren, type VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import './notifications.recipe.css';

export interface NotificationPopoverProps {
  title?: string;
  ariaLabel?: string;
  headerActions?: ComponentChildren;
  navigation?: ComponentChildren;
  children: ComponentChildren;
  footer?: ComponentChildren;
  resetScrollKey?: string | number | boolean;
  class?: string;
}

/** The canonical compact notification surface used by header bells and embedded previews. */
export function NotificationPopover({
  title = 'Notifications',
  ariaLabel = 'Notifications',
  headerActions,
  navigation,
  children,
  footer,
  resetScrollKey,
  class: extra,
}: NotificationPopoverProps): VNode {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [resetScrollKey]);

  return (
    <section class={`ui-notification-popover${extra ? ` ${extra}` : ''}`} role="dialog" aria-label={ariaLabel}>
      <div ref={bodyRef} class="ui-notification-popover__body">
        <div class="ui-notification-popover__chrome">
          <header class="ui-notification-popover__header">
            <h2>{title}</h2>
            {headerActions != null && <div class="ui-notification-popover__header-actions">{headerActions}</div>}
          </header>
          {navigation != null && <div class="ui-notification-popover__navigation">{navigation}</div>}
        </div>
        <div class="ui-notification-popover__content">{children}</div>
      </div>
      {footer != null && <footer class="ui-notification-popover__footer">{footer}</footer>}
    </section>
  );
}
