import { type ComponentChildren, type VNode } from 'preact';
import { type LucideName } from '../LucideIcon';
import { IconTile, type IconTileTone } from './IconTile';
import { NotificationIcon, type NotificationIconVariant } from './NotificationIcon';
import './notifications.recipe.css';

export type NotificationIndicatorTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface NotificationListItemProps {
  title: string;
  description?: string;
  metadata?: readonly string[];
  timestamp: string;
  dateTime?: string;
  icon?: LucideName;
  iconTone?: IconTileTone;
  /** Semantic notification treatment. Prefer this over selecting icon and tone independently. */
  iconVariant?: NotificationIconVariant;
  visual?: ComponentChildren;
  status?: ComponentChildren;
  /** Optional structured preview rendered below the metadata (attachment, record, etc.). */
  details?: ComponentChildren;
  /** Compact row-level controls such as archive or dismiss. */
  controls?: ComponentChildren;
  action?: ComponentChildren;
  unread?: boolean;
  indicatorTone?: NotificationIndicatorTone;
  muted?: boolean;
  onOpen: () => void;
  class?: string;
}

/**
 * Scan-friendly notification row. Business code supplies content and actions;
 * the kit owns alignment, truncation, hover, status and unread presentation.
 */
export function NotificationListItem({
  title,
  description,
  metadata = [],
  timestamp,
  dateTime,
  icon = 'Bell',
  iconTone = 'neutral',
  iconVariant,
  visual,
  status,
  details,
  controls,
  action,
  unread = false,
  indicatorTone = 'info',
  muted = false,
  onOpen,
  class: extra,
}: NotificationListItemProps): VNode {
  const classes = [
    'ui-notification-item',
    unread ? 'is-unread' : '',
    muted ? 'is-muted' : '',
    extra,
  ].filter(Boolean).join(' ');

  return (
    <article class={classes} data-indicator-tone={indicatorTone}>
      <button type="button" class="ui-notification-item__main" onClick={onOpen}>
        {visual != null
          ? <span class="ui-notification-item__custom-visual" aria-hidden="true">{visual}</span>
          : iconVariant
            ? <NotificationIcon variant={iconVariant} />
            : <IconTile icon={icon} tone={iconTone} />}

        <span class="ui-notification-item__copy">
          <span class="ui-notification-item__title-row">
            <strong>{title}</strong>
            {status}
          </span>
          {description && <span class="ui-notification-item__description">{description}</span>}
          {metadata.length > 0 && (
            <span class="ui-notification-item__metadata">
              {metadata.map((entry, index) => (
                <span class="ui-notification-item__metadata-entry" key={`${entry}-${index}`}>
                  {index > 0 && <span class="ui-notification-item__separator" aria-hidden="true" />}
                  <span>{entry}</span>
                </span>
              ))}
            </span>
          )}
          {details != null && <span class="ui-notification-item__details">{details}</span>}
        </span>

        <span class="ui-notification-item__trailing">
          <span class="ui-notification-item__time-row">
            {unread && <span class="ui-notification-item__unread" aria-label="Unread" />}
            <time dateTime={dateTime}>{timestamp}</time>
          </span>
        </span>
      </button>

      {controls != null && <span class="ui-notification-item__controls">{controls}</span>}
      {action != null && <div class="ui-notification-item__action">{action}</div>}
    </article>
  );
}
