/**
 * Compact notification inbox anchored to the application bell. The component
 * owns notification-specific filtering and actions while its controls come
 * from the canonical UI kit.
 */

import { type CSSProperties, type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  useNotifications, useCommsSummary, useMarkNotificationRead,
  useMarkAllNotificationsRead, useArchiveNotification,
  useNotificationPreferences,
  type CanonicalNotification, type NotificationListArgs,
} from '@api/communications';
import { showSection } from '@components/nav/navCore';
import { useHeaderModalOpen } from '@/hooks/useHeaderModalOpen';
import { useCan } from '@lib/permissions';
import {
  ActivityDots, Button, DropdownMenu, EmptyState, LucideIcon, NotificationPopover, SwitchArtwork, Tabs, TabPanel,
  type MenuAction, type TabItem,
} from '@ui';
import { BroadcastComposer } from './BroadcastComposer';
import { NotificationPreferencesPanel } from './NotificationPreferencesPanel';
import { NotificationDropdownItem } from './NotificationDropdownItem';
import { NotificationEmptyVisual } from './NotificationEmptyVisual';
import {
  archiveAllReadPreviewNotifications, countPreviewNotifications, createPreviewNotifications,
  isArchivedNotification, markAllPreviewNotificationsRead, markPreviewNotificationRead,
} from './previewNotifications';
import { openNotificationTarget, openTicketNotification } from './notifAction';
import './notificationDropdown.css';

const TAB_KEYS = ['all', 'unread', 'action'] as const;
type NotificationTab = typeof TAB_KEYS[number];

const unboxedHeaderActionStyle: CSSProperties = {
  background: 'transparent',
  borderColor: 'transparent',
  boxShadow: 'none',
};

function isNotificationTab(value: string): value is NotificationTab {
  return TAB_KEYS.some(key => key === value);
}

function closeModal(): void {
  document.getElementById('hdrNotifModal')?.classList.remove('open');
  document.querySelectorAll('[data-pill-action].active').forEach(button => button.classList.remove('active'));
}

function goToCenter(): void {
  closeModal();
  showSection('s-notification-center');
}

export function NotificationDropdown(): VNode {
  const [tab, setTab] = useState<NotificationTab>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLSpanElement | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [previewNotifications, setPreviewNotifications] = useState(createPreviewNotifications);
  const isOpen = useHeaderModalOpen('hdrNotifModal');
  const canBroadcast = useCan('communications.admin');

  useEffect(() => {
    if (!isOpen) setMenuOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || menuOpen) return;
      event.preventDefault();
      closeModal();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, menuOpen]);

  const { data: summary } = useCommsSummary();
  const { data: quietPreferences } = useNotificationPreferences({ enabled: isOpen });
  const quietMode = quietPreferences?.snooze ?? null;
  const quietModeUntil = quietMode?.mutedUntil
    ? `Until ${new Date(quietMode.mutedUntil).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : 'Until Resumed';

  const args: NotificationListArgs = { limit: 30 };
  const { data, isLoading, isError, isFetching, refetch } = useNotifications(args, { enabled: isOpen && showLive });
  const previewCounts = useMemo(() => countPreviewNotifications(previewNotifications), [previewNotifications]);
  const total = showLive ? (summary?.notificationsTotal ?? 0) : previewCounts.total;
  const unread = showLive ? (summary?.notificationsUnread ?? 0) : previewCounts.unread;
  const actionRequired = showLive ? (summary?.notificationsActionRequired ?? 0) : previewCounts.actionRequired;
  const sourceRows = showLive ? (data ?? []) : previewNotifications;
  const rows = useMemo(() => sourceRows.filter(notification => {
    if (isArchivedNotification(notification)) return false;
    if (tab === 'unread') return !notification.is_read;
    if (tab === 'action') return notification.action_required && notification.action_status === 'pending';
    return true;
  }).slice(0, 10), [sourceRows, tab]);

  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const archive = useArchiveNotification();

  function openPreferences(): void {
    closeModal();
    setMenuOpen(false);
    setPreferencesOpen(true);
  }

  const tabs: readonly TabItem[] = [
    { id: 'all', label: 'View All' },
    { id: 'unread', label: 'Unread', badge: unread || undefined },
    { id: 'action', label: 'Needs Action', badge: actionRequired || undefined },
  ];

  const menuItems: readonly MenuAction[] = [
    {
      id: 'feature-preview',
      label: 'Staged Notifications',
      icon: <LucideIcon name="GalleryVerticalEnd" size={16} />,
      control: ({ ref, tabIndex }) => (
        <button
          ref={ref}
          type="button"
          role="menuitemcheckbox"
          tabIndex={tabIndex}
          aria-checked={!showLive}
          aria-label="Show Staged Notifications"
          class={`nc-dropdown__menu-switch${!showLive ? ' is-on' : ''}`}
          onClick={() => {
            if (showLive) setPreviewNotifications(createPreviewNotifications());
            setShowLive(current => !current);
          }}
        >
          <SwitchArtwork size="sm" />
        </button>
      ),
    },
    {
      id: 'preferences',
      label: 'Notification Preferences',
      description: 'Choose which alerts and updates you receive.',
      icon: <LucideIcon name="Settings2" size={16} />,
      onSelect: openPreferences,
    },
    {
      id: 'refresh',
      label: showLive
        ? (isFetching ? 'Refreshing Notifications' : 'Refresh Notifications')
        : 'Reset Feature Preview',
      icon: <LucideIcon name="RefreshCw" size={16} />,
      disabled: showLive && isFetching,
      onSelect: () => {
        if (showLive) void refetch();
        else setPreviewNotifications(createPreviewNotifications());
      },
    },
    {
      id: 'archive-read',
      label: 'Archive All Read',
      description: 'Move read notifications out of this preview.',
      icon: <LucideIcon name="Archive" size={16} />,
      disabled: (showLive && archive.isPending) || total - unread === 0,
      onSelect: () => {
        if (showLive) archive.mutate({ all: true });
        else setPreviewNotifications(archiveAllReadPreviewNotifications);
      },
    },
  ];

  function open(notification: CanonicalNotification): void {
    if (!notification.is_read) {
      if (showLive) markRead.mutate(notification.id);
      else setPreviewNotifications(current => markPreviewNotificationRead(current, notification.id));
    }
    closeModal();
    if (!openNotificationTarget(notification)) openTicketNotification(notification);
  }

  function openBroadcast(): void {
    closeModal();
    setBroadcastOpen(true);
  }

  function markAllRead(): void {
    if (showLive) markAll.mutate({});
    else setPreviewNotifications(markAllPreviewNotificationsRead);
  }

  const emptyCopy = tab === 'unread'
    ? { title: 'No Unread Notifications', text: 'You have reviewed every notification in your inbox.' }
    : tab === 'action'
      ? { title: 'No Actions Waiting', text: 'Nothing currently needs your review or decision.' }
      : { title: "You're All Caught Up", text: 'New alerts, approvals, assignments and reminders will appear here.' };

  const body = (
    <>
      {showLive && isLoading && (
        <div class="ui-notification-popover__state">
          <ActivityDots label="Loading Notifications" size="sm" />
        </div>
      )}

      {showLive && !isLoading && isError && (
        <EmptyState
          size="compact"
          visual={<NotificationEmptyVisual kind="error" compact />}
          title="Notifications Could Not Be Loaded"
          text="Check your connection and try again."
          actions={<Button size="sm" variant="secondary" iconLeft={<LucideIcon name="RefreshCw" />} onClick={() => void refetch()}>Try Again</Button>}
          role="alert"
        />
      )}

      {(!showLive || (!isLoading && !isError)) && rows.length === 0 && (
        <EmptyState
          size="compact"
          visual={<NotificationEmptyVisual kind={tab === 'action' ? 'action' : tab === 'unread' ? 'unread' : 'all'} compact />}
          title={emptyCopy.title}
          text={emptyCopy.text}
          role="status"
        />
      )}

      {(!showLive || (!isLoading && !isError)) && rows.length > 0 && (
        <>
          {rows.map(notification => (
            <NotificationDropdownItem key={notification.id} n={notification} onOpen={open} />
          ))}
        </>
      )}
    </>
  );

  return (
    <>
    <NotificationPopover
      resetScrollKey={`${isOpen}-${tab}-${showLive}`}
      headerActions={(
        <>
          <Button
            iconOnly
            variant="ghost"
            size="sm"
            style={unboxedHeaderActionStyle}
            aria-label="Mark All Read"
            title="Mark All as Read"
            disabled={unread === 0}
            loading={showLive && markAll.isPending}
            onClick={markAllRead}
            iconLeft={<LucideIcon name="CheckCheck" />}
          />
          <Button
            iconOnly
            variant="ghost"
            size="sm"
            class="nc-dropdown__broadcast-action"
            style={unboxedHeaderActionStyle}
            aria-label="Send Broadcast"
            title={canBroadcast ? 'Send Broadcast' : 'Broadcast Permission Required'}
            disabled={!canBroadcast}
            onClick={openBroadcast}
            iconLeft={<LucideIcon name="Megaphone" size={17} strokeWidth={2} style={{ color: 'var(--siomac-red, #e40c0c)' }} />}
          />
          <span ref={setMenuAnchor} class="nc-dropdown__menu-anchor">
            <Button
              iconOnly
              variant="ghost"
              size="sm"
              style={unboxedHeaderActionStyle}
              aria-label="Notification Settings"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Notification Settings"
              onClick={() => setMenuOpen(value => !value)}
              iconLeft={<LucideIcon name="Settings2" />}
            />
          </span>
          <Button
            iconOnly
            variant="ghost"
            size="sm"
            class="hdr-modal-close"
            style={unboxedHeaderActionStyle}
            aria-label="Close Notifications"
            title="Close"
            onClick={closeModal}
            iconLeft={<LucideIcon name="X" />}
          />
          <DropdownMenu
            open={menuOpen}
            anchor={menuAnchor}
            onClose={() => setMenuOpen(false)}
            label="Notification Settings"
            items={menuItems}
            align="end"
            pointer
          />
        </>
      )}
      navigation={(
        <>
          <Tabs
            id="notification-dropdown-tabs"
            items={tabs}
            value={tab}
            onChange={value => { if (isNotificationTab(value)) setTab(value); }}
            label="Notification Views"
            variant="contained"
            size="sm"
          />
          {quietMode && <div class="nc-dropdown__quiet-status" role="status">
            <span class="nc-dropdown__quiet-icon"><LucideIcon name="MoonStar" /></span>
            <span><strong>Quiet Mode On</strong><small>{quietModeUntil} · routine popups paused</small></span>
            <Button variant="secondary" size="sm" onClick={openPreferences}>Manage</Button>
          </div>}
        </>
      )}
      footer={(
        <>
        <span class="nc-dropdown__summary">
          <strong>{unread}</strong> unread
          <span aria-hidden="true" />
          <strong>{actionRequired}</strong> need action
        </span>
        <Button variant="primary" size="sm" iconRight={<LucideIcon name="ArrowRight" />} onClick={goToCenter}>
          View All Notifications
        </Button>
        </>
      )}
    >
      {TAB_KEYS.map(key => (
        <TabPanel key={key} tabsId="notification-dropdown-tabs" tabId={key} value={tab}>
          {body}
        </TabPanel>
      ))}
    </NotificationPopover>
    <BroadcastComposer open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    <NotificationPreferencesPanel open={preferencesOpen} onClose={() => setPreferencesOpen(false)} />
    </>
  );
}
